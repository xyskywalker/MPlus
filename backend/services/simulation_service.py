"""
模拟预测服务 — 单例后台模拟管理器

负责管理模拟任务的生命周期：启动、进度追踪、取消。
支持两种引擎：Ripple（真实 CAS 模拟）和 Mock（开发测试）。
同一时刻只允许一个模拟任务运行，关闭浏览器不会终止模拟。
"""

import asyncio
import math
import random
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from ..config import settings
from ..db.database import get_session
from ..db import crud

logger = logging.getLogger(__name__)

# Mock 模式模拟总时长（秒）— 30 分钟
MOCK_DURATION_SECONDS = 30 * 60

# Ripple 模式阶段定义：(阶段名称, 描述, 占总进度百分比)
RIPPLE_STAGES = [
    ("初始化模拟环境", "解析选题内容，构建传播拓扑，创建智能体...", 5),
    ("注入种子涟漪", "创建种子涟漪，确定初始传播能量...", 5),
    ("涟漪传播模拟", "星-海智能体协作模拟多轮传播扩散...", 40),
    ("合议庭评审", "多专家结构化辩论，校准预测偏差...", 12),
    ("全局观测分析", "聚合宏观指标，观测系统状态...", 8),
    ("合成预测报告", "综合分析生成最终预测报告...", 10),
    ("生成解读报告", "AI 专家解读模拟结果，生成运营建议...", 20),
]

# Mock 模式阶段定义（保留兼容）
MOCK_STAGES = [
    ("初始化模拟环境", "配置模拟参数，准备计算资源...", 3),
    ("构建社交网络", "根据平台特征生成社交关系图谱...", 7),
    ("生成虚拟用户画像", "基于平台真实用户分布创建虚拟受众...", 10),
    ("加载平台推荐算法", "模拟平台内容分发机制与流量池逻辑...", 5),
    ("模拟内容发布", "在虚拟环境中发布内容，触发初始分发...", 5),
    ("模拟用户浏览与互动", "虚拟用户开始浏览、点赞、评论、收藏...", 40),
    ("模拟算法推荐传播", "内容进入推荐流量池，模拟二次传播...", 15),
    ("统计分析数据", "汇总互动数据，计算各维度指标...", 10),
    ("生成预测报告", "综合分析生成最终预测报告...", 5),
]

# Ripple Phase → 阶段索引映射
_PHASE_TO_STAGE_INDEX = {
    "INIT": 0,
    "SEED": 1,
    "RIPPLE": 2,
    "DELIBERATE": 3,
    "OBSERVE": 4,
    "SYNTHESIZE": 5,
}


def _get_stages():
    """根据当前引擎配置返回阶段定义"""
    if settings.simulation_engine == "ripple":
        return RIPPLE_STAGES
    return MOCK_STAGES


class SimulationProgress:
    """模拟进度数据结构"""

    def __init__(self, simulation_id: str):
        stages = _get_stages()
        self.simulation_id = simulation_id
        self.status = "running"
        self.progress = 0  # 0-100
        self.current_stage_index = 0
        self.current_stage_name = ""
        self.current_stage_description = ""
        self.started_at = datetime.now()
        self.elapsed_seconds = 0
        self.error_message = None
        self.engine = settings.simulation_engine

        # Ripple 模式的实时指标
        self.live_metrics = {
            "current_phase": "",
            "current_wave": 0,
            "total_waves": 0,
            "agents_activated": 0,
        }

        # 阶段完成状态
        self.stages = [
            {"name": s[0], "description": s[1], "completed": False, "progress": 0}
            for s in stages
        ]

        # 最近的活动日志
        self.recent_activities = []

    def to_dict(self) -> Dict[str, Any]:
        """转换为可序列化的字典"""
        now = datetime.now()
        self.elapsed_seconds = (now - self.started_at).total_seconds()

        return {
            "simulation_id": self.simulation_id,
            "status": self.status,
            "progress": round(self.progress, 1),
            "current_stage": {
                "index": self.current_stage_index,
                "name": self.current_stage_name,
                "description": self.current_stage_description,
            },
            "time": {
                "started_at": self.started_at.isoformat(),
                "elapsed_seconds": round(self.elapsed_seconds),
            },
            "live_metrics": self.live_metrics,
            "stages": self.stages,
            "recent_activities": self.recent_activities[-15:],
            "error_message": self.error_message,
            "engine": self.engine,
        }


class SimulationService:
    """模拟服务单例 — 管理后台模拟任务的启动、进度追踪和取消"""

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._current_task: Optional[asyncio.Task] = None
        self._current_progress: Optional[SimulationProgress] = None
        self._cancel_event = asyncio.Event()
        logger.info("模拟服务初始化完成 (engine=%s)", settings.simulation_engine)

    @property
    def is_running(self) -> bool:
        return (
            self._current_task is not None
            and not self._current_task.done()
            and self._current_progress is not None
            and self._current_progress.status == "running"
        )

    @property
    def current_simulation_id(self) -> Optional[str]:
        if self.is_running and self._current_progress:
            return self._current_progress.simulation_id
        return None

    def get_progress(self) -> Optional[Dict[str, Any]]:
        if self._current_progress:
            return self._current_progress.to_dict()
        return None

    async def start_simulation(
        self,
        simulation_id: str,
        topic_id: str,
        platform: str,
        config: Dict[str, Any],
        model_config_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """启动模拟任务，根据配置选择引擎"""
        if self.is_running:
            raise RuntimeError(
                f"已有模拟任务正在运行 (ID: {self._current_progress.simulation_id})，"
                "请等待当前模拟完成或取消后再开始新的模拟"
            )

        self._current_progress = SimulationProgress(simulation_id)
        self._cancel_event.clear()

        # 保存 Ripple 配置参数到 config 中
        sim_config = dict(config)
        sim_config["engine"] = settings.simulation_engine
        if settings.simulation_engine == "ripple":
            sim_config["max_waves"] = settings.ripple_max_waves
            sim_config["max_llm_calls"] = settings.ripple_max_llm_calls
            sim_config["ensemble_runs"] = settings.ripple_ensemble_runs
            sim_config["deliberation_rounds"] = settings.ripple_deliberation_rounds
            sim_config["simulation_hours"] = settings.ripple_simulation_hours

        async with get_session() as session:
            await crud.create_simulation(
                session,
                simulation_id=simulation_id,
                topic_id=topic_id,
                platform=platform,
                config=sim_config,
                model_config_id=model_config_id,
            )
            await crud.update_simulation(
                session,
                simulation_id=simulation_id,
                status="running",
            )

        # 根据引擎配置选择执行方法
        if settings.simulation_engine == "ripple":
            self._current_task = asyncio.create_task(
                self._run_ripple_simulation(
                    simulation_id, topic_id, platform, sim_config, model_config_id
                )
            )
        else:
            self._current_task = asyncio.create_task(
                self._run_mock_simulation(simulation_id, topic_id, platform, sim_config)
            )

        logger.info(
            "模拟任务启动: %s (engine=%s)", simulation_id, settings.simulation_engine
        )
        return {
            "id": simulation_id,
            "topic_id": topic_id,
            "platform": platform,
            "config": sim_config,
            "model_config_id": model_config_id,
            "status": "running",
            "engine": settings.simulation_engine,
        }

    async def cancel_simulation(self, simulation_id: str) -> bool:
        if not self.is_running:
            return False
        if self._current_progress and self._current_progress.simulation_id != simulation_id:
            return False

        logger.info("取消模拟任务: %s", simulation_id)
        self._cancel_event.set()

        if self._current_task:
            try:
                await asyncio.wait_for(self._current_task, timeout=10.0)
            except asyncio.TimeoutError:
                self._current_task.cancel()

        return True

    # ===== Ripple 引擎执行 =====

    async def _run_ripple_simulation(
        self,
        simulation_id: str,
        topic_id: str,
        platform: str,
        config: Dict[str, Any],
        model_config_id: Optional[str] = None,
    ):
        """执行 Ripple CAS 模拟（后台异步任务）"""
        from .ripple_adapter import RippleAdapter

        progress = self._current_progress
        if not progress:
            return

        try:
            # 获取选题数据
            async with get_session() as session:
                topic = await crud.get_topic(session, topic_id)
            if not topic:
                raise ValueError(f"选题不存在: {topic_id}")

            # 准备输出目录
            output_dir = RippleAdapter.get_output_dir(simulation_id)

            # Agent 激活计数器（闭包变量）
            activated_agents = set()

            # 创建进度回调
            def update_progress(phase, prog_0to1, wave, total_waves, detail_text):
                if self._cancel_event.is_set():
                    return

                stage_idx = _PHASE_TO_STAGE_INDEX.get(phase)
                if stage_idx is not None:
                    stages = RIPPLE_STAGES
                    ripple_total_weight = sum(s[2] for s in stages[:6])
                    report_weight = stages[6][2]
                    total_weight = ripple_total_weight + report_weight

                    cum = sum(stages[i][2] for i in range(stage_idx))
                    current_weight = stages[stage_idx][2]
                    stage_progress = prog_0to1 * 100
                    overall_pct = (cum + prog_0to1 * current_weight) / total_weight * 100
                    progress.progress = min(overall_pct, 80)

                    progress.current_stage_index = stage_idx
                    progress.current_stage_name = stages[stage_idx][0]
                    progress.current_stage_description = stages[stage_idx][1]

                    for i in range(stage_idx):
                        progress.stages[i]["completed"] = True
                        progress.stages[i]["progress"] = 100
                    progress.stages[stage_idx]["progress"] = round(stage_progress)

                # 更新实时指标
                progress.live_metrics["current_phase"] = phase
                if wave is not None:
                    progress.live_metrics["current_wave"] = wave + 1
                if total_waves is not None:
                    progress.live_metrics["total_waves"] = total_waves

                # 从日志中提取 Agent 激活信息并累计去重计数
                if detail_text and detail_text.startswith("激活 "):
                    agent_key = detail_text.split("(")[0].strip()
                    activated_agents.add(agent_key)
                    progress.live_metrics["agents_activated"] = len(activated_agents)

                # 追加活动日志
                if detail_text:
                    progress.recent_activities.append({
                        "time": datetime.now().strftime("%H:%M:%S"),
                        "content": detail_text,
                    })
                    if len(progress.recent_activities) > 50:
                        progress.recent_activities = progress.recent_activities[-50:]

            on_progress = RippleAdapter.create_progress_callback(update_progress)

            # 检查取消
            if self._cancel_event.is_set():
                await self._handle_cancel(simulation_id, progress)
                return

            # 执行 Ripple 模拟
            raw_result = await RippleAdapter.run_simulation(
                topic=topic,
                platform=platform,
                model_config_id=model_config_id,
                on_progress=on_progress,
                output_dir=output_dir,
            )

            if self._cancel_event.is_set():
                await self._handle_cancel(simulation_id, progress)
                return

            # 标记模拟阶段完成（前 6 阶段）
            for i in range(6):
                progress.stages[i]["completed"] = True
                progress.stages[i]["progress"] = 100
            progress.progress = 80

            # 转换结果
            transformed = RippleAdapter.transform_result(raw_result)

            # 提取关键数据
            json_path = raw_result.get("output_file", "")
            if json_path:
                key_metrics = RippleAdapter.extract_key_metrics(json_path)
                transformed["key_metrics"] = key_metrics

            # === 阶段 7：生成解读报告 ===
            progress.current_stage_index = 6
            progress.current_stage_name = RIPPLE_STAGES[6][0]
            progress.current_stage_description = RIPPLE_STAGES[6][1]
            progress.recent_activities.append({
                "time": datetime.now().strftime("%H:%M:%S"),
                "content": "开始生成 AI 解读报告...",
            })

            try:
                from .report_service import ReportService
                report_md = await ReportService.generate_report(
                    compact_log_path=raw_result.get("compact_log_file", ""),
                    json_log_path=json_path,
                    key_metrics=transformed.get("key_metrics", {}),
                    model_config_id=model_config_id,
                    topic=topic,
                    platform=platform,
                )
                if report_md:
                    transformed["report_markdown"] = report_md
                    # 同时保存为文件
                    report_path = RippleAdapter.get_output_dir(simulation_id)
                    from pathlib import Path
                    report_file = Path(report_path) / "report.md"
                    report_file.write_text(report_md, encoding="utf-8")
                    logger.info("解读报告已生成: %s", report_file)
            except Exception as e:
                logger.warning("解读报告生成失败（不影响模拟结果）: %s", e)
                transformed["report_markdown"] = None

            progress.stages[6]["completed"] = True
            progress.stages[6]["progress"] = 100
            progress.progress = 100
            progress.status = "completed"

            # 更新数据库：标记模拟完成 + 更新选题状态
            async with get_session() as session:
                await crud.update_simulation(
                    session,
                    simulation_id=simulation_id,
                    status="completed",
                    results=transformed,
                )
                await crud.update_topic(session, topic_id, status="simulated")

            logger.info("Ripple 模拟任务完成: %s", simulation_id)

        except asyncio.CancelledError:
            await self._handle_cancel(simulation_id, progress)
        except Exception as e:
            logger.exception("Ripple 模拟任务异常: %s", simulation_id)
            progress.status = "failed"
            progress.error_message = str(e)

            async with get_session() as session:
                await crud.update_simulation(
                    session,
                    simulation_id=simulation_id,
                    status="failed",
                    error_message=str(e),
                )

    # ===== Mock 引擎执行（开发测试用，保留原有逻辑） =====

    async def _run_mock_simulation(
        self,
        simulation_id: str,
        topic_id: str,
        platform: str,
        config: Dict[str, Any],
    ):
        """执行 Mock 模拟（后台异步任务），固定 30 分钟"""
        progress = self._current_progress
        if not progress:
            return

        user_count = config.get("user_count", 500)
        target_impressions = random.randint(8000, 20000)
        engagement_rate = random.uniform(5.0, 12.0)
        target_likes = int(target_impressions * engagement_rate / 100 * random.uniform(0.6, 0.8))
        target_comments = int(target_likes * random.uniform(0.1, 0.2))
        target_favorites = int(target_likes * random.uniform(0.3, 0.5))
        target_shares = int(target_likes * random.uniform(0.05, 0.1))

        activity_templates = [
            "用户 {user} 浏览了内容",
            "用户 {user} 点赞了内容",
            "用户 {user} 评论: \"{comment}\"",
            "用户 {user} 收藏了内容",
            "用户 {user} 分享了内容",
            "内容被推荐给 {count} 位新用户",
        ]
        mock_comments = [
            "太真实了", "有被共鸣到", "码住了", "哈哈哈笑死",
            "这也太精准了吧", "就是说!", "学到了", "关注了",
        ]
        mock_usernames = [
            "小红薯user_", "搞笑达人_", "生活博主_", "打工人_",
            "热心网友_", "路过的_", "分享家_", "探索者_",
        ]

        try:
            total_weight = sum(s[2] for s in MOCK_STAGES)
            stage_durations = [
                (s[2] / total_weight) * MOCK_DURATION_SECONDS
                for s in MOCK_STAGES
            ]
            cumulative_progress = 0

            for stage_idx, (stage_name, stage_desc, stage_weight) in enumerate(MOCK_STAGES):
                progress.current_stage_index = stage_idx
                progress.current_stage_name = stage_name
                progress.current_stage_description = stage_desc

                stage_duration = stage_durations[stage_idx]
                stage_progress_range = (stage_weight / total_weight) * 100
                stage_start_time = asyncio.get_event_loop().time()

                while True:
                    if self._cancel_event.is_set():
                        await self._handle_cancel(simulation_id, progress)
                        return

                    elapsed_in_stage = asyncio.get_event_loop().time() - stage_start_time
                    stage_ratio = min(elapsed_in_stage / stage_duration, 1.0) if stage_duration > 0 else 1.0
                    progress.progress = cumulative_progress + stage_ratio * stage_progress_range
                    progress.stages[stage_idx]["progress"] = round(stage_ratio * 100)

                    total_ratio = progress.progress / 100
                    growth_factor = _growth_curve(total_ratio)
                    progress.live_metrics = {
                        "current_phase": stage_name,
                        "current_wave": 0,
                        "total_waves": 0,
                        "agents_activated": 0,
                        "impressions": int(target_impressions * growth_factor),
                        "likes": int(target_likes * growth_factor),
                        "comments": int(target_comments * growth_factor),
                        "favorites": int(target_favorites * growth_factor),
                    }

                    if stage_idx >= 4 and random.random() < 0.6:
                        template = random.choice(activity_templates)
                        username = random.choice(mock_usernames) + str(random.randint(100, 999))
                        activity = template.format(
                            user=username,
                            comment=random.choice(mock_comments),
                            count=random.randint(50, 500),
                        )
                        progress.recent_activities.append({
                            "time": datetime.now().strftime("%H:%M:%S"),
                            "content": activity,
                        })
                        if len(progress.recent_activities) > 50:
                            progress.recent_activities = progress.recent_activities[-50:]

                    if stage_ratio >= 1.0:
                        progress.stages[stage_idx]["completed"] = True
                        progress.stages[stage_idx]["progress"] = 100
                        break

                    try:
                        await asyncio.sleep(2)
                    except asyncio.CancelledError:
                        await self._handle_cancel(simulation_id, progress)
                        return

                cumulative_progress += stage_progress_range

            progress.progress = 100
            progress.status = "completed"

            final_results = _generate_mock_results(
                platform, target_impressions, target_likes,
                target_comments, target_favorites, target_shares,
                engagement_rate, config,
            )

            async with get_session() as session:
                await crud.update_simulation(
                    session,
                    simulation_id=simulation_id,
                    status="completed",
                    results=final_results,
                )
                await crud.update_topic(session, topic_id, status="simulated")

            logger.info("Mock 模拟任务完成: %s", simulation_id)

        except asyncio.CancelledError:
            await self._handle_cancel(simulation_id, progress)
        except Exception as e:
            logger.exception("Mock 模拟任务异常: %s", simulation_id)
            progress.status = "failed"
            progress.error_message = str(e)

            async with get_session() as session:
                await crud.update_simulation(
                    session,
                    simulation_id=simulation_id,
                    status="failed",
                )

    # ===== 通用方法 =====

    async def _handle_cancel(self, simulation_id: str, progress: SimulationProgress):
        progress.status = "cancelled"
        progress.error_message = "模拟已被用户取消"
        logger.info("模拟任务已取消: %s", simulation_id)

        try:
            async with get_session() as session:
                await crud.update_simulation(
                    session,
                    simulation_id=simulation_id,
                    status="cancelled",
                )
        except Exception as e:
            logger.error("更新取消状态失败: %s", e)


# ===== 工具函数 =====

def _growth_curve(ratio: float) -> float:
    """S 型非线性增长曲线"""
    if ratio <= 0:
        return 0
    if ratio >= 1:
        return 1
    return 1 / (1 + math.exp(-10 * (ratio - 0.5)))


def _generate_mock_results(
    platform: str,
    impressions: int,
    likes: int,
    comments: int,
    favorites: int,
    shares: int,
    engagement_rate: float,
    config: Dict[str, Any],
) -> Dict[str, Any]:
    """生成 Mock 模拟结果"""
    duration_hours = config.get("duration_hours", 48)
    return {
        "engine": "mock",
        "metrics": {
            "impressions": impressions,
            "likes": likes,
            "comments": comments,
            "favorites": favorites,
            "engagement_rate": round(engagement_rate, 1),
            "shares": shares,
        },
        "relative_performance": {
            "platform_avg_engagement": 4.5,
            "percentile": random.randint(70, 95),
            "category_rank": f"Top {random.randint(10, 30)}%",
        },
        "viral_probability": {
            "level2_pool": random.randint(60, 90),
            "level3_pool": random.randint(30, 60),
            "viral": random.randint(10, 30),
        },
        "timeline": [
            {
                "hour": i * (duration_hours // 8),
                "impressions": int(impressions * (i + 1) / 8),
                "likes": int(likes * (i + 1) / 8),
            }
            for i in range(8)
        ],
        "suggestions": [
            {"type": "timing", "title": "发布时间建议", "content": "建议在工作日晚间 20:00-21:00 发布"},
            {"type": "title", "title": "标题优化", "content": "标题中加入数字增强点击欲望"},
            {"type": "content", "title": "内容建议", "content": "适当加入表情包增强共鸣感"},
        ],
    }


# 全局模拟服务实例
_simulation_service: Optional[SimulationService] = None


def get_simulation_service() -> SimulationService:
    """获取模拟服务单例"""
    global _simulation_service
    if _simulation_service is None:
        _simulation_service = SimulationService()
    return _simulation_service
