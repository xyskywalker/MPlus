"""
Ripple 模拟引擎适配器 — MPlus 与 Ripple 之间的唯一桥梁

职责：
1. LLM 配置转换：MPlus DB model_configs → Ripple llm_config dict
2. 选题数据转换：MPlus Topic → Ripple event 输入
3. 进度事件映射：Ripple SimulationEvent → MPlus SimulationProgress
4. 结果格式转换：Ripple 原始结果 → MPlus 前端结构
5. 文件管理：管理模拟输出文件（JSON/MD）的存储路径
"""

import json
import logging
import os
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from ripple import simulate
from ripple.primitives.events import SimulationEvent

from ..config import settings
from ..db.database import get_session
from ..db import crud

logger = logging.getLogger(__name__)

# Ripple Phase → MPlus 阶段映射
PHASE_MAPPING = {
    "INIT": {"index": 0, "name": "初始化模拟环境", "description": "解析选题内容，构建传播拓扑，创建智能体..."},
    "SEED": {"index": 1, "name": "注入种子涟漪", "description": "创建种子涟漪，确定初始传播能量..."},
    "RIPPLE": {"index": 2, "name": "涟漪传播模拟", "description": "星-海智能体协作模拟多轮传播扩散..."},
    "DELIBERATE": {"index": 3, "name": "合议庭评审", "description": "多专家结构化辩论，校准预测偏差..."},
    "OBSERVE": {"index": 4, "name": "全局观测分析", "description": "聚合宏观指标，观测系统状态..."},
    "SYNTHESIZE": {"index": 5, "name": "合成预测报告", "description": "综合分析生成最终预测报告..."},
}

# 模拟输出根目录
SIMULATION_OUTPUT_DIR = Path("data/simulations")

# Skill 目录（项目内维护，随项目部署）
_DEFAULT_SKILL_DIR = Path("skills/social-media")


class RippleAdapter:
    """Ripple 模拟引擎适配器"""

    # ===== LLM 配置转换 =====

    @staticmethod
    async def build_llm_config(model_config_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """将 MPlus DB 中的模型配置转换为 Ripple llm_config 格式

        MPlus 格式: {model_type, base_url, api_key, model_name}
        Ripple 格式: {_default: {model_platform, model_name, api_key, url}}
        """
        async with get_session() as session:
            if model_config_id:
                config = await crud.get_model_config(session, model_config_id)
            else:
                config = await crud.get_default_model_config(session)

        if not config:
            logger.warning("未找到可用的模型配置，Ripple 将使用自身配置搜索机制")
            return None

        platform_map = {
            "openai": "openai",
            "claude": "anthropic",
            "azure-openai": "azure",
        }
        model_platform = platform_map.get(config["model_type"], "openai")

        llm_config: Dict[str, Any] = {
            "_default": {
                "model_platform": model_platform,
                "model_name": config["model_name"],
                "api_key": config["api_key"],
                "url": config["base_url"].rstrip("/"),
            }
        }
        logger.info(
            "LLM 配置已转换: platform=%s, model=%s",
            model_platform, config["model_name"]
        )
        return llm_config

    # ===== 选题数据转换 =====

    @staticmethod
    def build_event(topic: Dict[str, Any]) -> Dict[str, Any]:
        """将 MPlus Topic 转换为 Ripple event 输入

        参考 Ripple examples/e2e_helpers.py 的 build_event_from_topic()
        """
        title = topic.get("title") or ""
        description = topic.get("description") or ""
        content = topic.get("content") or ""
        target_platform = topic.get("target_platform") or ""

        parts = [f"标题：{title}"]
        if description:
            parts.append(f"选题说明：{description}")
        if content:
            preview = content[:500] + "..." if len(content) > 500 else content
            parts.append(f"正文摘要：{preview}")

        return {
            "title": title,
            "description": description,
            "content": content,
            "target_platform": target_platform,
            "summary": " ".join(parts),
        }

    @staticmethod
    def build_source(account: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """将 MPlus 账号画像转换为 Ripple source 输入"""
        if not account:
            return None

        name = account.get("account_name") or ""
        bio = account.get("bio") or ""
        main_category = account.get("main_category") or ""
        sub_categories = account.get("sub_categories")
        sub_str = (
            "、".join(sub_categories[:5])
            if isinstance(sub_categories, list)
            else (str(sub_categories) if sub_categories else "")
        )
        content_style = account.get("content_style") or ""
        target_audience = account.get("target_audience") or ""
        followers_count = account.get("followers_count", 0) or 0

        parts = [f"账号名：{name}", f"主赛道：{main_category}"]
        if sub_str:
            parts.append(f"细分赛道：{sub_str}")
        if bio:
            parts.append(f"简介：{bio}")
        if content_style:
            parts.append(f"内容风格：{content_style}")
        if target_audience:
            parts.append(f"目标受众：{target_audience}")
        parts.append(f"粉丝数：{followers_count}")

        return {
            "account_name": name,
            "bio": bio,
            "main_category": main_category,
            "sub_categories": sub_categories,
            "content_style": content_style,
            "target_audience": target_audience,
            "followers_count": followers_count,
            "summary": " | ".join(parts),
        }

    @staticmethod
    def build_historical(posts: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
        """将 MPlus 历史发帖数据转换为 Ripple historical 输入"""
        if not posts:
            return None

        out = []
        for p in posts[:10]:
            views = p.get("views", 0) or 0
            likes = p.get("likes", 0) or 0
            comments = p.get("comments", 0) or 0
            favorites = p.get("favorites", 0) or 0
            shares = p.get("shares", 0) or 0
            engagement_rate = p.get("engagement_rate")
            if engagement_rate is None and views > 0:
                engagement_rate = round(
                    (likes + comments + favorites + shares) / views * 100, 2,
                )
            out.append({
                "title": p.get("title") or "",
                "content_preview": (p.get("content") or "")[:300],
                "views": views,
                "likes": likes,
                "comments": comments,
                "favorites": favorites,
                "shares": shares,
                "engagement_rate": engagement_rate,
                "post_type": p.get("post_type") or "图文",
            })
        return out

    # ===== 进度事件映射 =====

    @staticmethod
    def create_progress_callback(
        update_fn: Callable[[str, float, Optional[int], Optional[int], Optional[str]], None]
    ) -> Callable[[SimulationEvent], None]:
        """创建 Ripple 进度回调函数

        Args:
            update_fn: 回调函数，签名为 (phase_name, progress_0to1, wave, total_waves, detail_text)
        """
        def on_progress(event: SimulationEvent) -> None:
            phase_info = PHASE_MAPPING.get(event.phase, {})
            phase_name = phase_info.get("name", event.phase)

            detail_text = None
            if event.type == "phase_start":
                detail_text = f"{phase_name} 开始"
            elif event.type == "phase_end":
                detail = event.detail or {}
                if event.phase == "INIT":
                    detail_text = (
                        f"初始化完成 — 星 Agent ×{detail.get('star_count', '?')} "
                        f"海 Agent ×{detail.get('sea_count', '?')} "
                        f"预估 {detail.get('estimated_waves', '?')} 轮"
                    )
                elif event.phase == "SEED":
                    detail_text = f"种子注入完成 — 能量={detail.get('seed_energy', '?')}"
                elif event.phase == "RIPPLE":
                    detail_text = f"传播完成 — 实际 {detail.get('effective_waves', '?')} 轮"
                elif event.phase == "DELIBERATE":
                    detail_text = f"合议庭评审完成 — {detail.get('rounds', '?')} 轮合议"
                else:
                    detail_text = f"{phase_name} 完成"
            elif event.type == "wave_start":
                w = (event.wave or 0) + 1
                detail_text = f"Wave {w}/{event.total_waves or '?'}"
            elif event.type == "wave_end":
                detail = event.detail or {}
                if detail.get("terminated"):
                    detail_text = f"传播终止: {detail.get('reason', '')}"
                else:
                    detail_text = f"{detail.get('agent_count', 0)} 个 Agent 响应"
            elif event.type == "agent_activated":
                aid = event.agent_id or "?"
                atype = event.agent_type or "?"
                energy = (event.detail or {}).get("energy", "?")
                detail_text = f"激活 {atype}:{aid} (能量={energy})"
            elif event.type == "agent_responded":
                aid = event.agent_id or "?"
                rtype = (event.detail or {}).get("response_type", "?")
                detail_text = f"{aid} 响应: {rtype}"

            update_fn(
                event.phase,
                event.progress,
                event.wave,
                event.total_waves,
                detail_text,
            )

        return on_progress

    # ===== 运行模拟 =====

    @staticmethod
    async def run_simulation(
        topic: Dict[str, Any],
        platform: str,
        model_config_id: Optional[str] = None,
        account: Optional[Dict[str, Any]] = None,
        historical_posts: Optional[List[Dict[str, Any]]] = None,
        on_progress: Optional[Callable[[SimulationEvent], None]] = None,
        output_dir: Optional[str] = None,
    ) -> Dict[str, Any]:
        """执行 Ripple 模拟并返回原始结果

        这是调用 Ripple 的唯一入口点。
        """
        event = RippleAdapter.build_event(topic)
        source = RippleAdapter.build_source(account) if account else None
        historical = RippleAdapter.build_historical(historical_posts) if historical_posts else None
        llm_config = await RippleAdapter.build_llm_config(model_config_id)

        # 平台代号映射
        platform_map = {
            "xiaohongshu": "xiaohongshu",
            "douyin": "douyin",
            "weibo": "weibo",
            "bilibili": "bilibili",
            "zhihu": "zhihu",
            "wechat": "wechat",
        }
        ripple_platform = platform_map.get(platform, platform)
        sim_hours = settings.ripple_simulation_hours

        logger.info(
            "开始 Ripple 模拟: platform=%s, max_waves=%d, max_llm_calls=%d",
            ripple_platform, settings.ripple_max_waves, settings.ripple_max_llm_calls,
        )

        # Skill 路径：优先使用 .env 配置，否则使用项目内 skills/ 目录
        skill_path = settings.ripple_skill_path or str(_DEFAULT_SKILL_DIR)

        result = await simulate(
            event=event,
            skill="social-media",
            platform=ripple_platform,
            source=source,
            historical=historical,
            llm_config=llm_config,
            max_waves=settings.ripple_max_waves,
            max_llm_calls=settings.ripple_max_llm_calls,
            ensemble_runs=settings.ripple_ensemble_runs,
            deliberation_rounds=settings.ripple_deliberation_rounds,
            simulation_horizon=f"{sim_hours}h",
            on_progress=on_progress,
            output_path=output_dir,
            skill_path=skill_path,
        )

        logger.info("Ripple 模拟完成: total_waves=%s", result.get("total_waves"))
        return result

    # ===== 结果格式转换 =====

    @staticmethod
    def transform_result(raw_result: Dict[str, Any]) -> Dict[str, Any]:
        """将 Ripple 原始结果转换为 MPlus 前端结构"""
        prediction = raw_result.get("prediction") or {}
        timeline = raw_result.get("timeline") or []
        bifurcation = raw_result.get("bifurcation_points") or []
        insights = raw_result.get("agent_insights") or {}
        observation = raw_result.get("observation") or {}

        # 提取预测指标
        relative = prediction.get("relative_estimate") or {}
        anchored = prediction.get("anchored_estimate") or {}
        estimate = anchored if anchored else relative

        transformed = {
            # 核心预测
            "prediction": {
                "impact": prediction.get("impact", ""),
                "verdict": prediction.get("verdict", ""),
                "estimate": estimate,
                "confidence": estimate.get("confidence", "medium"),
                "confidence_reasoning": estimate.get("confidence_reasoning", ""),
                "simulation_horizon": estimate.get("simulation_horizon", ""),
            },
            # 传播时间线
            "timeline": timeline,
            # 分叉点
            "bifurcation_points": bifurcation,
            # 智能体洞察
            "agent_insights": insights,
            # 全局观测
            "observation": observation if isinstance(observation, dict) else {"content": str(observation)},
            # 合议庭数据（从 process 中提取）
            "deliberation": raw_result.get("deliberation") or raw_result.get("deliberation_summary") or {},
            # 集成统计
            "ensemble_stats": raw_result.get("ensemble_stats"),
            # 元数据
            "meta": {
                "total_waves": raw_result.get("total_waves", 0),
                "run_id": raw_result.get("run_id", ""),
                "wave_records_count": raw_result.get("wave_records_count", 0),
                "disclaimer": raw_result.get("disclaimer", ""),
                "engine": "ripple",
                "engine_version": "0.2.0",
            },
            # 文件路径（供下载使用）
            "output_file": raw_result.get("output_file", ""),
            "compact_log_file": raw_result.get("compact_log_file", ""),
        }

        return transformed

    # ===== JSON 关键数据提取 =====

    @staticmethod
    def extract_key_metrics(json_path: str) -> Dict[str, Any]:
        """从 JSON 完整日志中程序化提取关键特征值

        参考 Ripple e2e_ab_test_fmcg_coffee.py 的数据提取模式。
        用于注入解读报告生成的上下文，不消耗 LLM token。
        """
        try:
            data = json.loads(Path(json_path).read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning("读取 JSON 日志失败: %s", e)
            return {}

        metrics: Dict[str, Any] = {}
        process = data.get("process") or {}

        # 1. 初始化参数
        init = process.get("init") or {}
        star_configs = init.get("star_configs") or []
        sea_configs = init.get("sea_configs") or []
        metrics["agent_count"] = {
            "stars": len(star_configs),
            "seas": len(sea_configs),
            "star_names": [
                f"{s.get('id', '?')}({s.get('description', '')[:30]})"
                for s in star_configs
            ],
            "sea_names": [
                f"{s.get('id', '?')}({s.get('description', '')[:30]})"
                for s in sea_configs
            ],
        }
        metrics["dynamic_parameters"] = init.get("dynamic_parameters") or {}
        metrics["estimated_waves"] = init.get("estimated_waves")
        metrics["seed_energy"] = (process.get("seed") or {}).get("energy")

        # 2. 合议庭评分（从 deliberation_summary.final_positions 提取）
        delib = process.get("deliberation") or {}
        summary = delib.get("deliberation_summary") or {}
        positions = summary.get("final_positions") or []
        if positions:
            role_scores: Dict[str, Dict[str, Any]] = {}
            all_dims: Dict[str, List[int]] = {}
            for pos in positions:
                role = pos.get("member_role", "")
                scores = pos.get("scores") or {}
                if role and scores:
                    role_scores[role] = {k: int(v) for k, v in scores.items() if _is_numeric(v)}
                    for dim, val in role_scores[role].items():
                        all_dims.setdefault(dim, []).append(val)

            dim_avgs = {d: round(sum(v) / len(v), 2) for d, v in all_dims.items() if v}
            all_values = [v for scores in role_scores.values() for v in scores.values()]
            overall_avg = round(sum(all_values) / len(all_values), 2) if all_values else 0.0

            metrics["tribunal_scores"] = {
                "role_scores": role_scores,
                "dimension_averages": dim_avgs,
                "overall_average": overall_avg,
                "converged": summary.get("converged", False),
                "consensus_points": summary.get("consensus_points") or [],
                "dissent_points": summary.get("dissent_points") or [],
            }

        # 3. Agent 峰值能量
        agent_peaks: Dict[str, float] = {}
        for wave in process.get("waves") or []:
            resps = wave.get("agent_responses") or {}
            if not isinstance(resps, dict):
                continue
            for aid, info in resps.items():
                if not isinstance(info, dict):
                    continue
                e = info.get("outgoing_energy")
                if isinstance(e, (int, float)) and e > agent_peaks.get(aid, 0.0):
                    agent_peaks[aid] = round(e, 3)
        if agent_peaks:
            metrics["agent_peak_energies"] = agent_peaks

        # 4. 实际波次与终止原因
        waves = process.get("waves") or []
        metrics["actual_waves"] = len(waves)
        if waves:
            last_wave = waves[-1]
            verdict = last_wave.get("verdict") or {}
            if verdict.get("termination_reason"):
                metrics["termination_reason"] = verdict["termination_reason"]

        return metrics

    # ===== 文件路径管理 =====

    @staticmethod
    def get_output_dir(simulation_id: str) -> str:
        """获取模拟输出目录路径"""
        output_dir = SIMULATION_OUTPUT_DIR / simulation_id
        output_dir.mkdir(parents=True, exist_ok=True)
        return str(output_dir)

    @staticmethod
    def list_simulation_files(simulation_id: str) -> List[Dict[str, Any]]:
        """列出模拟产生的所有可下载文件"""
        output_dir = SIMULATION_OUTPUT_DIR / simulation_id
        if not output_dir.exists():
            return []

        files = []
        for f in sorted(output_dir.iterdir()):
            if not f.is_file():
                continue
            file_info = {
                "name": f.name,
                "path": str(f),
                "size": f.stat().st_size,
                "size_display": _format_file_size(f.stat().st_size),
            }
            if f.suffix == ".json":
                file_info["type"] = "json"
                file_info["label"] = "完整模拟日志 (JSON)"
            elif f.name == "report.md":
                file_info["type"] = "report"
                file_info["label"] = "解读报告 (Markdown)"
            elif f.suffix == ".md":
                file_info["type"] = "md"
                file_info["label"] = "压缩日志 (Markdown)"
            else:
                continue
            files.append(file_info)

        return files


def _is_numeric(v: Any) -> bool:
    """判断值是否可转为数字"""
    try:
        int(v)
        return True
    except (TypeError, ValueError):
        return False


def _format_file_size(size_bytes: int) -> str:
    """格式化文件大小"""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
