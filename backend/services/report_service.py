"""
模拟解读报告生成服务

基于 Ripple 输出的 MD 压缩日志生成专业的 LLM 解读报告。
从 JSON 完整日志中程序化提取关键数据注入 prompt 上下文。
参考 Ripple examples/e2e_simulation_xiaohongshu.py 的 3 轮报告结构。
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from .llm_service import LLMConfig, LLMService
from ..db.database import get_session
from ..db import crud

logger = logging.getLogger(__name__)

# 报告系统提示词前缀（参考 Ripple e2e_simulation_xiaohongshu.py）
_SYSTEM_PREFIX = (
    "你是 Ripple CAS（复杂自适应系统）社交传播模拟引擎的专业分析师。\n"
    "你的任务是基于模拟引擎输出的结构化数据，生成人类友好的专业解读。\n\n"
    "【格式规范】\n"
    "- 一律使用简体中文输出\n"
    "- 使用 Markdown 格式输出，用 ## 标记章节标题，### 标记子标题\n"
    "- 段落清晰、逻辑连贯，可直接展示给运营人员阅读\n"
    "- 关键数据用 **加粗** 标注\n\n"
    "【Agent 命名规范】\n"
    "- 带 star_ 前缀的 Agent 显示为「星-」+ 中文描述\n"
    "- 带 sea_ 前缀的 Agent 显示为「海-」+ 中文描述\n"
    "- 纯英文 Agent 名称翻译为中文\n\n"
    "【术语翻译规范】\n"
    "- 相态：explosion→爆发期, growth→成长期, decline→衰退期, seed→种子期, stable→稳定期\n"
    "- 响应：amplify→放大传播, absorb→吸收, mutate→变异/二创, create→原创, ignore→忽略\n"
    "- 能量：incoming_ripple_energy→输入能量, outgoing_energy→输出能量\n"
)


def _build_report_rounds(
    key_metrics: Dict[str, Any],
    topic: Dict[str, Any],
    platform: str,
) -> List[Dict[str, str]]:
    """构建 3 轮报告规范

    每轮包含 system_prompt 和可选的 extra_context。
    """
    # 构建关键数据补充上下文
    extra_parts: List[str] = []

    # 选题信息
    extra_parts.append(
        f"## 补充：选题信息\n"
        f"标题：{topic.get('title', '')}\n"
        f"平台：{platform}\n"
        f"说明：{topic.get('description', '')}"
    )

    # Agent 配置摘要
    agent_count = key_metrics.get("agent_count", {})
    if agent_count:
        star_names = agent_count.get("star_names", [])
        sea_names = agent_count.get("sea_names", [])
        parts = [f"## 补充：智能体配置\n星 Agent ({agent_count.get('stars', 0)}):"]
        for name in star_names:
            parts.append(f"  - {name}")
        parts.append(f"海 Agent ({agent_count.get('seas', 0)}):")
        for name in sea_names:
            parts.append(f"  - {name}")
        extra_parts.append("\n".join(parts))

    # 动态参数
    params = key_metrics.get("dynamic_parameters", {})
    if params:
        param_str = " | ".join(f"{k}={v}" for k, v in params.items())
        extra_parts.append(f"## 补充：模拟动态参数\n{param_str}")

    # 合议庭评分
    tribunal = key_metrics.get("tribunal_scores", {})
    if tribunal:
        lines = ["## 补充：合议庭评分数据"]
        role_scores = tribunal.get("role_scores", {})
        for role, scores in role_scores.items():
            sc_str = " ".join(f"{k}={v}" for k, v in scores.items())
            lines.append(f"  {role}: {sc_str}")
        dim_avgs = tribunal.get("dimension_averages", {})
        if dim_avgs:
            avg_str = " | ".join(f"{k}={v}" for k, v in dim_avgs.items())
            lines.append(f"  维度均分: {avg_str}")
            lines.append(f"  总体均分: {tribunal.get('overall_average', '?')}")
        consensus = tribunal.get("consensus_points", [])
        if consensus:
            lines.append("  共识点: " + "; ".join(str(c)[:80] for c in consensus[:3]))
        dissent = tribunal.get("dissent_points", [])
        if dissent:
            lines.append("  分歧点: " + "; ".join(str(d)[:80] for d in dissent[:3]))
        extra_parts.append("\n".join(lines))

    # Agent 峰值能量
    peaks = key_metrics.get("agent_peak_energies", {})
    if peaks:
        lines = ["## 补充：Agent 峰值能量"]
        for aid, energy in sorted(peaks.items(), key=lambda x: -x[1]):
            lines.append(f"  {aid}: E={energy}")
        extra_parts.append("\n".join(lines))

    extra_context = "\n\n".join(extra_parts)

    return [
        # 第 1 轮：模拟背景与初始环境
        {
            "label": "模拟背景与初始环境",
            "system_prompt": _SYSTEM_PREFIX + (
                "当前任务：撰写解读报告的前两个章节。\n\n"
                "## 模拟背景（100-150字）\n"
                "简要回顾本次模拟的背景信息：选题内容、目标平台、"
                "发布账号的基本画像（如有）、历史数据概况（如有）。\n\n"
                "## 初始环境（200-300字）\n"
                "解读全视者在初始化阶段设定的模拟环境：\n"
                "- 创建了哪些星 Agent 和海 Agent，各自的定位描述\n"
                "- 动态参数设定（wave 时间窗口、传播衰减等）\n"
                "- 种子涟漪的内容摘要与初始能量值\n"
                "- 预估的传播轮数与安全上限\n"
            ),
            "extra_context": extra_context,
        },
        # 第 2 轮：传播过程与关键事件
        {
            "label": "传播过程与关键事件",
            "system_prompt": _SYSTEM_PREFIX + (
                "当前任务：撰写解读报告的中间两个章节。\n\n"
                "## 传播过程回顾（150-250字）\n"
                "概述整个涟漪传播过程的全貌：\n"
                "- 共经历了几轮 wave，整体传播节奏\n"
                "- 提炼 3-5 个关键节点（首轮破圈、爆发、争议、终止等）\n"
                "- 引用全视者的全局观测作为总结性判断\n\n"
                "## 关键传播路径（200-350字）\n"
                "挑选 2-3 个对传播影响最大的 Agent 深度解读：\n"
                "- 在哪些 wave 被激活、接收/输出多少能量\n"
                "- 做了什么类型的响应、对传播态势的关键作用\n"
            ),
            "extra_context": extra_context,
        },
        # 第 3 轮：数据预测与运营建议
        {
            "label": "数据预测与运营建议",
            "system_prompt": _SYSTEM_PREFIX + (
                "当前任务：撰写解读报告的最后三个章节。\n\n"
                "## 关键时间点解读（150-250字）\n"
                "解读 2-3 个最重要的时间节点：涌现现象、相变触发、传播分叉。\n\n"
                "## 数据预测（150-250字）\n"
                "输出含置信度描述的关键指标预测：\n"
                "- 曝光量、互动总量、收藏、评论、转发、涨粉等预估区间\n"
                "- 爆款概率判断与核心假设条件\n\n"
                "## 运营建议（200-300字）\n"
                "3-5 条具体可落地的运营优化建议：\n"
                "- 内容优化方向、发布时机、评论区运营、风险规避、系列化建议\n"
            ),
            "extra_context": extra_context,
        },
    ]


class ReportService:
    """模拟解读报告生成服务"""

    @staticmethod
    async def generate_report(
        compact_log_path: str,
        json_log_path: str,
        key_metrics: Dict[str, Any],
        model_config_id: Optional[str],
        topic: Dict[str, Any],
        platform: str,
    ) -> Optional[str]:
        """生成 3 轮 LLM 解读报告

        使用 MD 压缩日志作为主要上下文，从 JSON 提取的关键数据作为补充。

        Returns:
            完整的 Markdown 格式解读报告，或 None（如果生成失败）。
        """
        # 读取 MD 压缩日志
        log_text = _load_compact_log(compact_log_path)
        if not log_text:
            logger.warning("无法读取压缩日志: %s", compact_log_path)
            return None

        # 获取 LLM 配置
        llm_service = await _create_llm_service(model_config_id)
        if not llm_service:
            logger.warning("无法创建 LLM 服务，跳过报告生成")
            return None

        # 构建 3 轮报告规范
        rounds = _build_report_rounds(key_metrics, topic, platform)

        # 逐轮调用 LLM
        parts: List[str] = []
        for i, rd in enumerate(rounds, 1):
            logger.info("解读报告第 %d/%d 轮: %s", i, len(rounds), rd["label"])

            user_message = f"以下是本次模拟的结构化日志数据：\n\n{log_text}"
            if rd.get("extra_context"):
                user_message += "\n\n" + rd["extra_context"]

            try:
                response = await llm_service.chat(
                    message=user_message,
                    system_prompt=rd["system_prompt"],
                    temperature=0.7,
                )
                if response.success and response.content:
                    parts.append(response.content.strip())
                    logger.info("第 %d 轮解读完成 (%d 字)", i, len(response.content))
                else:
                    logger.warning("第 %d 轮解读失败: %s", i, response.error)
            except Exception as e:
                logger.warning("第 %d 轮解读异常: %s", i, e)

        if not parts:
            return None

        # 拼装完整报告
        header = (
            "# 模拟预测解读报告\n\n"
            f"> 本报告由 AI 基于 Ripple CAS 模拟引擎输出数据自动生成，仅供参考。\n\n"
            "---\n\n"
        )
        return header + "\n\n---\n\n".join(parts)


def _load_compact_log(path: str) -> Optional[str]:
    """读取 MD 压缩日志文件"""
    if not path:
        return None
    p = Path(path)
    if not p.exists():
        return None
    try:
        return p.read_text(encoding="utf-8")
    except Exception as e:
        logger.warning("读取压缩日志失败: %s", e)
        return None


async def _create_llm_service(model_config_id: Optional[str]) -> Optional[LLMService]:
    """从数据库配置创建 LLM 服务实例"""
    async with get_session() as session:
        if model_config_id:
            config = await crud.get_model_config(session, model_config_id)
        else:
            config = await crud.get_default_model_config(session)

    if not config:
        return None

    try:
        llm_config = LLMConfig.from_dict(config)
        return LLMService(llm_config, timeout=120.0)
    except Exception as e:
        logger.warning("创建 LLM 服务失败: %s", e)
        return None
