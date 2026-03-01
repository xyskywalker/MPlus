"""
头脑风暴服务模块
封装 CAMEL ChatAgent，提供完整的头脑风暴对话能力。
包含 BrainstormService（单会话实例）和 BrainstormServiceManager（全局管理器）。
"""

import asyncio
import json
import logging
from typing import Optional, AsyncGenerator, Dict, Any

from camel.agents import ChatAgent
from camel.memories import ChatHistoryMemory
from camel.messages import BaseMessage
from camel.types import ModelType, OpenAIBackendRole

from .model_factory import MplusModelFactory
from .platform_loader import PlatformProfileLoader
from .topic_extractor import TopicExtractor
from ..tools.anspire_search import AnspireSearchTool
from ..prompts.brainstorm_prompts import (
    build_system_prompt,
    build_search_context,
    SEARCH_INTENT_SYSTEM_MESSAGE,
    SEARCH_INTENT_ANALYSIS_PROMPT,
    SEARCH_RESULT_FILTER_PROMPT,
    TOPIC_READINESS_SYSTEM,
    TOPIC_READINESS_PROMPT,
    TITLE_GENERATION_SYSTEM,
    TITLE_GENERATION_PROMPT,
)
from ..db.database import get_session as get_db_session
from ..db import crud

logger = logging.getLogger(__name__)


class BrainstormService:
    """
    头脑风暴服务（单会话实例）

    一个实例对应一个活跃的头脑风暴会话。
    管理 ChatAgent、搜索工具、记忆和选题提取。
    """

    def __init__(
        self,
        session_id: str,
        agent: ChatAgent,
        platform_profile=None,
        account_profile: Optional[Dict[str, Any]] = None,
        search_tool: Optional[AnspireSearchTool] = None,
        topic_extractor: Optional[TopicExtractor] = None,
    ):
        """
        初始化头脑风暴服务

        Args:
            session_id: 会话 ID
            agent: CAMEL ChatAgent 实例
            platform_profile: 平台画像对象
            account_profile: 关联的账号画像数据（可选，含 post_performances）
            search_tool: 搜索工具（可选）
            topic_extractor: 选题提取器
        """
        self.session_id = session_id
        self.agent = agent
        self.platform_profile = platform_profile
        self.account_profile = account_profile  # 关联的账号画像（供选题提取使用）
        self.search_tool = search_tool
        self.topic_extractor = topic_extractor or TopicExtractor()
        # 轮次计数器（用于阶段提醒注入）
        self.turn_count = 0

    # ─── 阶段提醒方法 ───

    def _get_phase_reminder(self) -> str:
        """
        根据当前轮次生成阶段提醒（注入到 API 调用中，不写入记忆）

        帮助 Agent 明确当前处于对话的哪个阶段，应遵循什么策略。
        包含平台信息提醒，避免 Agent 重复询问已知信息。
        """
        # 构建平台提醒（如有）
        platform_note = ""
        if self.platform_profile:
            platform_note = (
                f"目标平台已确定为【{self.platform_profile.platform_name}】，"
                "不要再问用户选择什么平台。"
            )

        # 构建账号提醒（如有关联账号）
        account_note = ""
        if self.account_profile:
            account_name = self.account_profile.get("account_name", "")
            main_category = self.account_profile.get("main_category", "")
            account_note = (
                f"当前会话已关联创作者账号【{account_name}】（{main_category}），"
                "所有建议须贴合该账号定位和调性，不要偏离。"
            )

        if self.turn_count <= 3:
            return (
                f"[系统提醒] 当前是第 {self.turn_count} 轮对话，处于【自由探索阶段】。"
                f"{platform_note}{account_note}"
                "请聚焦了解用户想做什么样的内容、有什么灵感或想法。"
                "不要输出完整选题方案。回复控制在 200 字以内，结尾提出 1 个追问。"
                "不要问已知信息（平台、用户身份、账号定位等）。"
            )
        elif self.turn_count <= 5:
            return (
                f"[系统提醒] 当前是第 {self.turn_count} 轮对话，处于【探索→补全过渡期】。"
                f"{platform_note}{account_note}"
                "如果用户方向已明确，开始逐步确认关键要素。"
                "如果还不够明确，继续探索。每轮聚焦 1 个要素。"
            )
        elif self.turn_count <= 8:
            return (
                f"[系统提醒] 当前是第 {self.turn_count} 轮对话，处于【结构化补全阶段】。"
                f"{platform_note}{account_note}"
                "逐步确认选题的关键要素（受众、调性、形式、钩子、差异化）。"
                "提供 2-3 个选项让用户选择。"
            )
        else:
            return (
                f"[系统提醒] 当前是第 {self.turn_count} 轮对话，处于【选题输出阶段】。"
                f"{platform_note}{account_note}"
                "如果关键要素已确认，可以输出完整的选题方案。"
                "如果还有未确认的要素，继续补全。"
            )

    # ─── 搜索意图分析相关方法 ───

    async def _run_model_collect(self, messages: list) -> str:
        """
        在线程池中运行模型调用，收集完整响应文本（不阻塞事件循环）

        即使模型配置为 stream=True，也能安全使用。
        适用于搜索意图分析等短响应场景。

        Args:
            messages: OpenAI 格式的消息列表

        Returns:
            模型完整响应文本（已清理思考标签）
        """
        import re
        from openai import Stream

        loop = asyncio.get_event_loop()

        def _call():
            response = self.agent.model_backend.run(messages)
            full_text = ""
            if isinstance(response, Stream):
                for chunk in response:
                    for choice in chunk.choices:
                        if choice.delta.content:
                            full_text += choice.delta.content
            else:
                if response.choices:
                    full_text = response.choices[0].message.content or ""
            return full_text

        raw_text = await loop.run_in_executor(None, _call)

        # 清理深度思考模型的 <think>...</think> 标签
        cleaned = re.sub(
            r'<think(?:ing)?>\s*[\s\S]*?\s*</think(?:ing)?>',
            '',
            raw_text,
            flags=re.IGNORECASE,
        ).strip()

        if cleaned != raw_text:
            logger.debug(
                f"已清理思考标签: 原始长度={len(raw_text)}, 清理后={len(cleaned)}"
            )

        return cleaned

    def _get_recent_context_text(self, max_turns: int = 3) -> str:
        """
        获取最近几轮对话的文本摘要（用于搜索意图分析）

        Args:
            max_turns: 最多取几轮（每轮 = 一问一答）

        Returns:
            格式化的对话文本，或"（无历史对话）"
        """
        try:
            openai_messages, _ = self.agent.memory.get_context()
            # 过滤 system 消息，只保留对话
            chat_messages = [
                m for m in openai_messages if m.get("role") != "system"
            ]
            # 取最近 N 轮（每轮 2 条消息）
            recent = chat_messages[-(max_turns * 2):]

            if not recent:
                return "（无历史对话）"

            lines = []
            for msg in recent:
                role_label = "用户" if msg["role"] == "user" else "助手"
                content = msg.get("content", "")
                # 截断过长的消息（搜索意图分析不需要完整内容）
                if len(content) > 300:
                    content = content[:300] + "..."
                lines.append(f"{role_label}: {content}")

            return "\n".join(lines)
        except Exception:
            return "（无历史对话）"

    async def _analyze_search_intent(self, user_message: str) -> Optional[str]:
        """
        使用 LLM 结合对话上下文智能判断是否需要联网搜索

        判断逻辑由 LLM 基于对话上下文和用户最新消息综合决定：
        - 用户在做选择/确认/追问时，不搜索
        - 用户提出新话题/需要实时数据时，搜索并返回优化的 query

        搜索 query 会自动融入业务场景（自媒体选题）和目标平台信息。

        Args:
            user_message: 用户最新消息

        Returns:
            优化后的搜索 query（需要搜索时），或 None（不需要搜索时）
        """
        try:
            recent_context = self._get_recent_context_text(max_turns=3)

            # 获取平台名称，供搜索意图分析使用
            platform_name = (
                self.platform_profile.platform_name
                if self.platform_profile
                else "通用"
            )

            analysis_prompt = SEARCH_INTENT_ANALYSIS_PROMPT.format(
                platform_name=platform_name,
                recent_context=recent_context,
                user_message=user_message,
            )

            messages = [
                {"role": "system", "content": SEARCH_INTENT_SYSTEM_MESSAGE},
                {"role": "user", "content": analysis_prompt},
            ]

            result = await self._run_model_collect(messages)
            result = result.strip()

            logger.info(f"搜索意图分析结果: session={self.session_id}, {result}")

            # 解析结果
            if "NO_SEARCH" in result:
                return None

            if "SEARCH:" in result:
                query = result.split("SEARCH:")[-1].strip()
                # 清理可能的引号或多余空白
                query = query.strip("\"'""''")
                if query:
                    return query[:30]  # 限制长度

            # 无法解析时默认不搜索（保守策略）
            logger.warning(f"搜索意图分析结果无法解析: {result}")
            return None

        except Exception as e:
            logger.warning(f"搜索意图分析失败，默认不搜索: {e}")
            return None

    async def _filter_search_results(
        self,
        results: list,
        user_message: str,
    ) -> list:
        """
        使用 LLM 对搜索结果进行二次筛选，过滤无关内容

        只保留与自媒体内容创作场景真正相关的搜索结果，
        过滤掉论文选题、学术工具、广告软文等无关内容。

        Args:
            results: 原始搜索结果列表
            user_message: 用户当前消息（提供话题上下文）

        Returns:
            筛选后的搜索结果列表
        """
        if not results or len(results) <= 1:
            return results

        try:
            platform_name = (
                self.platform_profile.platform_name
                if self.platform_profile
                else "通用"
            )

            # 构建搜索结果文本
            results_text = ""
            for i, item in enumerate(results, 1):
                title = item.get("title", "无标题")
                snippet = (item.get("snippet", "") or "")[:150]
                results_text += f"{i}. 标题: {title}\n   摘要: {snippet}\n\n"

            filter_prompt = SEARCH_RESULT_FILTER_PROMPT.format(
                platform_name=platform_name,
                topic_context=user_message[:100],
                search_results=results_text,
            )

            messages = [
                {"role": "system", "content": "你是搜索结果质量评估助手。只输出筛选判断，不要解释。"},
                {"role": "user", "content": filter_prompt},
            ]

            result_text = await self._run_model_collect(messages)
            result_text = result_text.strip()

            logger.info(f"搜索结果筛选: session={self.session_id}, {result_text}")

            # 解析筛选结果
            judgments = [j.strip().upper() for j in result_text.split(",")]

            filtered = []
            for i, item in enumerate(results):
                if i < len(judgments) and judgments[i] == "KEEP":
                    filtered.append(item)
                elif i >= len(judgments):
                    # 如果 LLM 返回的判断数量不足，保守保留
                    filtered.append(item)

            logger.info(
                f"搜索结果筛选: {len(results)} → {len(filtered)} 条"
            )
            return filtered if filtered else results[:2]  # 保底至少返回部分结果

        except Exception as e:
            logger.warning(f"搜索结果筛选失败，返回原始结果: {e}")
            return results

    # ─── 快速任务模型调用 ───

    async def _call_fast_task_model(self, messages: list) -> str:
        """
        使用快速任务模型执行简短任务（标题生成、就绪度评估等）

        快速任务模型是用户在设置页面指定的轻量级模型，
        适合处理不需要深度推理的短任务，响应速度更快。

        Args:
            messages: OpenAI 格式的消息列表 [{"role": "system/user", "content": "..."}]

        Returns:
            模型完整响应文本（已清理思考标签）

        Raises:
            RuntimeError: 快速任务模型调用失败
        """
        import re
        from ..services.llm_service import LLMService, LLMConfig
        from ..db.crud import get_fast_task_model_config, get_default_model_config

        # 获取快速任务模型配置（如无则降级到默认模型）
        async with get_db_session() as session:
            config = await get_fast_task_model_config(session)
            if not config:
                config = await get_default_model_config(session)
        if not config:
            raise RuntimeError("未找到快速任务模型配置，请先在设置页面配置模型")

        llm_config = LLMConfig.from_dict(config)
        service = LLMService(llm_config, timeout=30.0)

        # 从消息列表中提取 system 和 user 内容
        system_prompt = None
        user_content = ""
        for msg in messages:
            if msg["role"] == "system":
                system_prompt = msg["content"]
            elif msg["role"] == "user":
                user_content = msg["content"]

        response = await service.chat(user_content, system_prompt=system_prompt)
        if not response.success:
            raise RuntimeError(f"快速任务模型调用失败: {response.error}")

        content = response.content or ""

        # 清理深度思考模型的 <think>...</think> 标签
        cleaned = re.sub(
            r'<think(?:ing)?>\s*[\s\S]*?\s*</think(?:ing)?>',
            '',
            content,
            flags=re.IGNORECASE,
        ).strip()

        if cleaned != content:
            logger.debug(
                f"快速任务: 已清理思考标签, 原始长度={len(content)}, 清理后={len(cleaned)}"
            )

        return cleaned

    # ─── 会话标题自动生成 ───

    async def _generate_session_title(self, user_message: str) -> Optional[str]:
        """
        使用快速任务模型根据用户首条消息自动生成会话标题

        Args:
            user_message: 用户首条消息内容

        Returns:
            生成的标题字符串，失败时返回 None
        """
        try:
            prompt = TITLE_GENERATION_PROMPT.format(
                user_message=user_message[:500]  # 限制长度，减少 token 消耗
            )

            messages = [
                {"role": "system", "content": TITLE_GENERATION_SYSTEM},
                {"role": "user", "content": prompt},
            ]

            title = await self._call_fast_task_model(messages)

            # 清理：去掉可能的引号、多余空白、换行
            title = title.strip().strip("\"'""''「」【】").strip()
            # 限制长度
            if len(title) > 30:
                title = title[:30]

            if title:
                logger.info(
                    f"会话标题生成: session={self.session_id}, title={title}"
                )
                return title

            logger.warning(f"会话标题生成结果为空: session={self.session_id}")
            return None

        except Exception as e:
            logger.warning(f"会话标题生成失败: session={self.session_id}, error={e}")
            return None

    # ─── 选题就绪度评估（使用快速任务模型） ───

    async def _evaluate_topic_readiness(self) -> dict:
        """
        评估当前对话是否已收集足够信息来生成选题方案

        使用快速任务模型而非主对话模型，提升响应速度、降低成本。
        """
        try:
            # 获取最近对话上下文
            recent_context = self._get_recent_context_text(max_turns=5)
            if not recent_context:
                return {"level": "low", "summary": "对话刚开始"}

            prompt = TOPIC_READINESS_PROMPT.format(
                recent_context=recent_context
            )

            messages = [
                {"role": "system", "content": TOPIC_READINESS_SYSTEM},
                {"role": "user", "content": prompt},
            ]

            # 使用快速任务模型（而非主对话模型）
            result = await self._call_fast_task_model(messages)
            result = result.strip()

            # 尝试提取 JSON（有时 LLM 会在 JSON 外加额外文字）
            json_start = result.find("{")
            json_end = result.rfind("}") + 1
            if json_start >= 0 and json_end > json_start:
                parsed = json.loads(result[json_start:json_end])
                level = parsed.get("level", "low")
                summary = parsed.get("summary", "")
                # 确保 level 值合法
                if level not in ("low", "medium", "high"):
                    level = "low"
                logger.info(f"选题就绪度评估: session={self.session_id}, level={level}, summary={summary}")
                return {"level": level, "summary": summary}

            logger.warning(f"选题就绪度评估结果无法解析: session={self.session_id}, result={result}")
        except Exception as e:
            logger.warning(f"选题就绪度评估失败: session={self.session_id}, error={e}")

        # 降级策略：基于轮次数判断
        if self.turn_count >= 6:
            return {"level": "high", "summary": "对话已进行多轮，信息可能较充分"}
        elif self.turn_count >= 3:
            return {"level": "medium", "summary": "对话进行中，已有部分信息"}
        else:
            return {"level": "low", "summary": "对话刚开始，信息较少"}

    # ─── 核心对话方法 ───

    async def chat_stream(
        self,
        user_message: str,
        enable_search: bool = False,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        流式对话核心方法

        关键设计：
        1. 搜索由 LLM 结合上下文智能判断（而非简单关键词提取）
        2. 原始用户消息写入 Agent 记忆（不含搜索数据），保持上下文纯净
        3. 搜索结果仅在当次 API 调用中注入，不污染后续对话记忆

        Args:
            user_message: 用户消息
            enable_search: 是否启用联网搜索

        Yields:
            消息块字典: {"type": str, ...}
        """
        search_results = None
        search_context = ""
        # 跟踪发送给前端的筛选后搜索结果（用于持久化到 assistant 消息 metadata）
        sent_search_results = []

        # 递增轮次计数
        self.turn_count += 1
        logger.info(f"对话轮次: {self.turn_count}, 会话: {self.session_id}")

        # ── 阶段 1：智能搜索增强 ──
        if enable_search and self.search_tool:
            # 使用 LLM 结合上下文判断是否需要搜索，以及生成优化后的 query
            search_query = await self._analyze_search_intent(user_message)

            if search_query:
                logger.info(f"搜索意图: session={self.session_id}, 需要搜索, query={search_query}")
                yield {"type": "searching", "query": search_query}

                platform_code = (
                    self.platform_profile.platform_code
                    if self.platform_profile
                    else None
                )
                search_results = await self.search_tool.search_with_fallback(
                    search_query, platform_code
                )

                if search_results:
                    raw_items = search_results.get("items", [])
                    # 使用 LLM 二次筛选搜索结果，过滤无关内容
                    filtered_items = await self._filter_search_results(
                        raw_items, user_message
                    )

                    # 记录筛选后的搜索结果，用于后续持久化到 assistant 消息
                    sent_search_results = filtered_items
                    yield {
                        "type": "search_result",
                        "results": filtered_items,
                    }
                    # 用筛选后的结果构建搜索上下文
                    search_context = build_search_context(
                        query=search_query,
                        results=filtered_items,
                    )
                else:
                    yield {"type": "search_failed"}
            else:
                logger.info(f"搜索意图: session={self.session_id}, 无需搜索 (用户消息: {user_message[:30]})")

        # ── 阶段 2：保存用户消息到数据库 ──
        await self._save_conversation(
            role="user",
            content=user_message,
            metadata={"search_results": search_results} if search_results else {},
        )

        # ── 阶段 3：流式 Agent 响应 ──
        # 注意：CAMEL ChatAgent.step() 会在内部消费整个流，不支持逐块输出。
        # 因此我们直接使用模型后端进行流式调用，同时手动管理 Agent 记忆。
        #
        # 关键点：OpenAI SDK 的 Stream 是同步迭代器，直接在 async 函数中遍历
        # 会阻塞 asyncio 事件循环，导致 WebSocket 无法发送消息。
        # 解决方案：将同步迭代放入线程池，通过 asyncio.Queue 异步传递数据块。
        try:
            # 1. 将【原始】用户消息写入 Agent 记忆（不含搜索数据，保持记忆纯净）
            user_msg = BaseMessage.make_user_message(
                role_name="User",
                content=user_message,
            )
            self.agent.update_memory(user_msg, OpenAIBackendRole.USER)

            # 2. 从 Agent 记忆中获取完整上下文（含 System Prompt + 历史消息）
            openai_messages, num_tokens = self.agent.memory.get_context()

            # 3. 注入上下文增强信息（仅影响本次 API 调用，不写入记忆）
            openai_messages = list(openai_messages)  # 浅拷贝列表

            # 3a. 注入阶段提醒（作为 system 消息插入到用户消息之前）
            phase_reminder = self._get_phase_reminder()
            for i in range(len(openai_messages) - 1, -1, -1):
                if openai_messages[i].get("role") == "user":
                    openai_messages.insert(i, {
                        "role": "system",
                        "content": phase_reminder,
                    })
                    break

            # 3b. 注入搜索上下文（追加到最后一条用户消息）
            if search_context:
                for i in range(len(openai_messages) - 1, -1, -1):
                    if openai_messages[i].get("role") == "user":
                        openai_messages[i] = dict(openai_messages[i])
                        openai_messages[i]["content"] += f"\n\n{search_context}"
                        break

            # 4. 直接调用模型后端获取流式响应
            response = self.agent.model_backend.run(openai_messages)

            full_response = ""

            # 5. 通过异步队列 + 线程池实现非阻塞流式输出
            from openai import Stream
            if isinstance(response, Stream):
                queue: asyncio.Queue = asyncio.Queue()
                _SENTINEL = object()  # 流结束标记
                _ERROR = object()     # 错误标记
                loop = asyncio.get_event_loop()

                def _consume_stream():
                    """在线程池中同步消费 OpenAI Stream，逐块写入队列"""
                    try:
                        for chunk in response:
                            for choice in chunk.choices:
                                delta = choice.delta
                                if delta.content:
                                    loop.call_soon_threadsafe(
                                        queue.put_nowait, delta.content
                                    )
                        loop.call_soon_threadsafe(queue.put_nowait, _SENTINEL)
                    except Exception as e:
                        loop.call_soon_threadsafe(
                            queue.put_nowait, (_ERROR, str(e))
                        )

                # 在线程池中启动同步流消费
                stream_future = loop.run_in_executor(None, _consume_stream)

                # 从队列中异步读取数据块并 yield
                while True:
                    item = await queue.get()
                    if item is _SENTINEL:
                        break
                    if isinstance(item, tuple) and len(item) == 2 and item[0] is _ERROR:
                        raise RuntimeError(item[1])
                    full_response += item
                    yield {"type": "stream", "content": item}

                # 等待线程结束（正常情况下已结束）
                await stream_future

            else:
                # 非流式响应回退（理论上不会走到这里，因为 stream=True）
                if response.choices:
                    full_response = response.choices[0].message.content or ""
                    if full_response:
                        yield {"type": "stream", "content": full_response}

            # 6. 将 AI 回复写入 Agent 记忆
            if full_response:
                assistant_msg = BaseMessage.make_assistant_message(
                    role_name="Assistant",
                    content=full_response,
                )
                self.agent.record_message(assistant_msg)

            # 保存 AI 回复到数据库（含搜索结果，供历史消息恢复时使用）
            await self._save_conversation(
                role="assistant",
                content=full_response,
                metadata={"search_results": sent_search_results} if sent_search_results else {},
            )

            # 发送完成信号
            yield {"type": "complete", "usage": {}}

            # ── 后处理任务（在 complete 之后发送，不阻塞对话渲染） ──

            # 任务1：首轮对话时自动生成会话标题
            if self.turn_count == 1:
                try:
                    title = await self._generate_session_title(user_message)
                    if title:
                        yield {"type": "title_generated", "title": title}
                except Exception as te:
                    logger.warning(f"标题生成发送失败: {te}")

            # 任务2：评估选题就绪度
            try:
                readiness = await self._evaluate_topic_readiness()
                yield {"type": "topic_readiness", **readiness}
            except Exception as re:
                logger.warning(f"就绪度评估发送失败: {re}")

        except Exception as e:
            logger.error(f"Agent 响应失败: {e}", exc_info=True)
            yield {"type": "error", "message": f"AI 回复生成失败: {str(e)}"}

    async def extract_topic(self, enhanced: bool = False) -> Dict[str, Any]:
        """
        提取结构化选题

        Args:
            enhanced: 是否使用增强字段集

        Returns:
            选题提取结果
        """
        platform_code = (
            self.platform_profile.platform_code
            if self.platform_profile
            else "generic"
        )

        return await self.topic_extractor.extract(
            agent=self.agent,
            session_id=self.session_id,
            platform_code=platform_code,
            platform_profile=self.platform_profile,
            account_profile=self.account_profile,
            enhanced=enhanced,
        )

    def reset(self):
        """重置会话（清空 Agent 记忆和轮次计数）"""
        self.agent.reset()
        self.turn_count = 0
        logger.info(f"会话已重置: {self.session_id}")

    async def save_memory(self):
        """
        保存 Agent 记忆

        当前实现：记忆通过数据库（conversations 表）持久化，
        每条消息实时保存，此方法仅作为接口预留。
        """
        logger.debug(f"记忆已通过数据库实时保存: {self.session_id}")

    async def load_memory(self) -> bool:
        """
        从数据库加载历史对话到 Agent 记忆

        读取 conversations 表中的历史消息，按时间顺序写入 Agent 的记忆。
        """
        try:
            async with get_db_session() as session:
                conversations = await crud.list_conversations(
                    session, self.session_id, limit=100, offset=0
                )

            if not conversations:
                logger.debug(f"无历史对话: {self.session_id}")
                return False

            # 按时间顺序将历史消息写入 Agent 记忆
            for conv in conversations:
                role = conv.get("role", "")
                content = conv.get("content", "")
                if not content:
                    continue

                if role == "user":
                    msg = BaseMessage.make_user_message(
                        role_name="User", content=content
                    )
                    self.agent.update_memory(msg, OpenAIBackendRole.USER)
                elif role == "assistant":
                    msg = BaseMessage.make_assistant_message(
                        role_name="Assistant", content=content
                    )
                    self.agent.update_memory(msg, OpenAIBackendRole.ASSISTANT)

            # 根据加载的用户消息数量恢复轮次计数
            user_msg_count = sum(
                1 for c in conversations if c.get("role") == "user"
            )
            self.turn_count = user_msg_count

            logger.info(
                f"加载历史对话成功: {self.session_id}, "
                f"共 {len(conversations)} 条消息, 轮次恢复到 {self.turn_count}"
            )
            return True

        except Exception as e:
            logger.warning(f"加载记忆失败: {e}")
            return False

    async def _save_conversation(
        self,
        role: str,
        content: str,
        metadata: Dict[str, Any] = None,
    ):
        """保存单条对话到数据库"""
        try:
            async with get_db_session() as session:
                await crud.create_conversation(
                    session,
                    session_id=self.session_id,
                    role=role,
                    content=content,
                    metadata=metadata or {},
                )
        except Exception as e:
            logger.warning(f"保存对话失败: {e}")


class BrainstormServiceManager:
    """
    头脑风暴服务管理器

    管理所有活跃的 BrainstormService 实例。
    支持按 session_id 获取或创建实例。
    """

    def __init__(self):
        self._services: Dict[str, BrainstormService] = {}

    async def get_or_create(
        self,
        session_id: str,
        platform_code: str = None,
    ) -> BrainstormService:
        """
        获取或创建会话服务实例

        Args:
            session_id: 会话 ID
            platform_code: 平台代码（可选，优先使用数据库中的记录）

        Returns:
            BrainstormService 实例
        """
        if session_id in self._services:
            return self._services[session_id]

        # 从数据库获取会话信息
        async with get_db_session() as session:
            session_data = await crud.get_session_by_id(session, session_id)

        if not session_data:
            raise ValueError(f"会话不存在: {session_id}")

        # 使用传入的 platform_code 或数据库中的
        platform_code = platform_code or session_data.get("platform_code")
        model_config_id = session_data.get("model_config_id")
        account_profile_id = session_data.get("account_profile_id")

        # 加载平台画像
        platform_profile = None
        if platform_code:
            platform_profile = PlatformProfileLoader.load(platform_code)

        # 加载关联的账号画像（如有）
        account_profile = None
        if account_profile_id:
            async with get_db_session() as session:
                account_profile = await crud.get_account_profile(session, account_profile_id)
            if account_profile:
                logger.info(
                    f"已加载关联账号画像: session={session_id}, "
                    f"account={account_profile.get('account_name')}"
                )

        # 从数据库获取模型配置
        async with get_db_session() as session:
            if model_config_id:
                model_config = await crud.get_model_config(session, model_config_id)
            else:
                model_config = await crud.get_default_model_config(session)

        if not model_config:
            raise ValueError("未找到模型配置，请先在设置页面配置模型")

        # 创建流式模型
        model = MplusModelFactory.create_sync(
            config=model_config,
            temperature=0.7,
            stream=True,
        )

        # 构建 System Prompt（含平台画像和账号画像）
        system_prompt = build_system_prompt(
            platform_profile=platform_profile,
            account_profile=account_profile,
        )

        # 创建 ChatAgent
        # 关键：token_limit 必须设为模型的实际上下文窗口大小，
        # 而不是 max_tokens（生成长度限制）。CAMEL 默认会用 model_backend.token_limit
        # 作为内存的上下文裁剪阈值，而 model_backend.token_limit 返回的是
        # model_config_dict["max_tokens"]（即 4096），这远小于实际上下文窗口。
        # 如果不修正，ScoreBasedContextCreator 会把对话历史全部裁剪掉，
        # 导致 Agent 丧失上下文记忆能力。
        CONTEXT_WINDOW_SIZE = 65536  # 确保支持 15-20+ 轮深度对话
        agent = ChatAgent(
            system_message=system_prompt,
            model=model,
            token_limit=CONTEXT_WINDOW_SIZE,
        )

        # 创建搜索工具（可选）
        search_tool = None
        async with get_db_session() as session:
            anspire_config = await crud.get_setting(session, "anspire_api_key")
        if anspire_config and anspire_config.get("key"):
            search_tool = AnspireSearchTool(anspire_config["key"])

        # 创建服务实例（传入账号画像，供阶段提醒和选题提取使用）
        service = BrainstormService(
            session_id=session_id,
            agent=agent,
            platform_profile=platform_profile,
            account_profile=account_profile,
            search_tool=search_tool,
        )

        # 尝试恢复记忆
        await service.load_memory()

        self._services[session_id] = service
        return service

    async def remove(self, session_id: str):
        """移除并保存会话实例"""
        if session_id in self._services:
            try:
                await self._services[session_id].save_memory()
            except Exception as e:
                logger.warning(f"移除时保存记忆失败: {e}")
            del self._services[session_id]

    def get(self, session_id: str) -> Optional[BrainstormService]:
        """获取服务实例（不创建）"""
        return self._services.get(session_id)


# 全局管理器实例
brainstorm_manager = BrainstormServiceManager()
