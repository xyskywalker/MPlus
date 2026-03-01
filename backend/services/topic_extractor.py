"""
选题提取器模块
从对话历史中提取结构化选题方案，
采用独立调用模式（低温度模型 + 专用提取 Prompt）。

注意：model_backend.run() 接收 OpenAI 格式的字典消息（非 BaseMessage 对象），
且当 stream=True 时返回 Stream 对象，需收集完整响应。
"""

import asyncio
import json
import re
import logging
import uuid
from typing import Optional, List, Dict, Any

from pydantic import BaseModel, Field

from ..prompts.brainstorm_prompts import (
    build_extraction_prompt,
    CONVERSATION_SUMMARY_PROMPT,
    EXTRACTION_SYSTEM_MESSAGE,
)
from ..db.database import get_session as get_db_session
from ..db import crud

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────
# 数据结构定义
# ─────────────────────────────────────────

class TopicProposal(BaseModel):
    """单个选题方案"""
    title: str = Field(description="选题标题，符合目标平台标题规范")
    description: str = Field(description="内容摘要，200-300字")
    angle: str = Field(description="切入角度")
    target_audience: str = Field(description="目标受众描述")
    tone: str = Field(description="内容调性")
    content_format: str = Field(description="内容形式")
    tags: List[str] = Field(description="标签，3-5个")
    estimated_effect: str = Field(description="预估效果")


class TopicProposalList(BaseModel):
    """选题方案列表（标准输出）"""
    proposals: List[TopicProposal] = Field(description="2-3个选题方案")
    recommendation: str = Field(description="综合推荐说明和排序理由")


class EnhancedTopicProposal(TopicProposal):
    """增强选题方案"""
    viral_score: int = Field(description="爆款潜力评分，1-10分", ge=1, le=10)
    competition_level: str = Field(description="竞争度: 低/中/高")
    algorithm_match: str = Field(description="平台算法匹配度分析")
    suggested_publish_time: str = Field(description="建议发布时段")
    reference_cases: List[str] = Field(description="参考爆款案例")
    hook_suggestions: List[str] = Field(description="前3秒/首段钩子建议")


class EnhancedTopicProposalList(BaseModel):
    """增强选题方案列表"""
    proposals: List[EnhancedTopicProposal]
    recommendation: str
    overall_assessment: str = Field(description="整体评估和策略建议")


# ─────────────────────────────────────────
# 选题提取器
# ─────────────────────────────────────────

class TopicExtractor:
    """
    选题提取器

    从对话历史提取结构化选题方案。
    使用独立的低温度模型调用，确保输出稳定性。
    """

    @staticmethod
    async def _run_model_collect(model_backend, messages: list) -> str:
        """
        在线程池中运行模型调用，收集完整响应文本

        处理 stream=True 返回的 Stream 对象，也兼容非流式响应。
        不阻塞 asyncio 事件循环。

        Args:
            model_backend: CAMEL 模型后端实例
            messages: OpenAI 格式的消息列表（字典格式）

        Returns:
            模型完整响应文本（已清理思考标签）
        """
        from openai import Stream

        loop = asyncio.get_event_loop()

        def _call():
            response = model_backend.run(messages)
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
        # 部分模型（如豆包 Seed、DeepSeek-R1 等）会在正式回复前输出思考过程
        cleaned = TopicExtractor._strip_thinking_tags(raw_text)
        if cleaned != raw_text:
            logger.info(
                f"已清理思考标签: 原始长度={len(raw_text)}, 清理后={len(cleaned)}"
            )

        return cleaned

    @staticmethod
    def _strip_thinking_tags(text: str) -> str:
        """
        移除深度思考模型输出的 <think>...</think> 标签及其内容

        支持的标签格式：
        - <think>...</think>
        - <thinking>...</thinking>

        Args:
            text: 模型原始输出文本

        Returns:
            清理后的文本
        """
        # 移除 <think>...</think> 和 <thinking>...</thinking> 块
        cleaned = re.sub(
            r'<think(?:ing)?>\s*[\s\S]*?\s*</think(?:ing)?>',
            '',
            text,
            flags=re.IGNORECASE,
        )
        return cleaned.strip()

    async def extract(
        self,
        agent,
        session_id: str,
        platform_code: str,
        platform_profile=None,
        account_profile: Optional[Dict[str, Any]] = None,
        enhanced: bool = False,
    ) -> Dict[str, Any]:
        """
        从对话历史提取结构化选题

        流程：
        1. 获取对话历史
        2. 压缩为摘要
        3. 使用低温度提取模型生成结构化输出（含账号约束）
        4. 解析并验证
        5. 存入数据库

        Args:
            agent: ChatAgent 实例（用于摘要压缩）
            session_id: 会话 ID
            platform_code: 目标平台代码
            platform_profile: 平台画像对象
            account_profile: 关联的账号画像（可选，用于注入选题约束）
            enhanced: 是否使用增强字段集

        Returns:
            包含 topics 和 recommendation 的字典
        """
        # Step 1: 获取对话历史
        history = await self._get_conversation_history(session_id)
        if not history:
            raise ValueError("对话历史为空，请先进行几轮对话再提取选题")

        # Step 2: 压缩对话历史为摘要
        summary = await self._summarize_conversation(agent, history)

        # Step 3: 构建提取 Prompt
        platform_name = "通用平台"
        algorithm_signals = ""
        if platform_profile:
            platform_name = platform_profile.platform_name
            algorithm_signals = platform_profile.algorithm_signals

        extraction_prompt = build_extraction_prompt(
            conversation_summary=summary,
            platform_name=platform_name,
            enhanced=enhanced,
            algorithm_signals=algorithm_signals,
            account_profile=account_profile,
        )

        # Step 4: 使用 Agent 的模型后端直接调用（不影响对话记忆）
        # 注意：必须使用 OpenAI 格式字典消息，且处理流式响应
        try:
            messages = [
                {"role": "system", "content": EXTRACTION_SYSTEM_MESSAGE},
                {"role": "user", "content": extraction_prompt},
            ]

            logger.info(
                f"调用提取模型: session={session_id}, "
                f"prompt长度={len(extraction_prompt)}"
            )

            raw_content = await self._run_model_collect(
                agent.model_backend, messages
            )

            logger.info(
                f"提取模型返回: session={session_id}, "
                f"内容长度={len(raw_content)}, "
                f"前200字={raw_content[:200]}"
            )

        except Exception as e:
            logger.error(f"提取模型调用失败: {e}", exc_info=True)
            raise ValueError(f"选题生成失败: {str(e)}")

        # Step 5: 解析 JSON 结果
        topics_data = self._parse_json_response(raw_content)

        if not topics_data:
            raise ValueError(
                "无法从 AI 回复中解析出结构化选题，"
                "可能是模型输出格式不符合要求"
            )

        # 检查 proposals 是否为空
        proposals = topics_data.get("proposals", [])
        if not proposals:
            logger.warning(
                f"解析到 JSON 但 proposals 为空: session={session_id}, "
                f"JSON keys={list(topics_data.keys())}, "
                f"数据预览={json.dumps(topics_data, ensure_ascii=False)[:300]}"
            )
            raise ValueError(
                "AI 未能生成选题方案（proposals 为空），请继续对话补充信息后重试"
            )

        logger.info(
            f"选题解析成功: session={session_id}, "
            f"proposals数量={len(proposals)}"
        )

        # Step 6: 存入数据库（含关联账号 ID）
        account_profile_id = account_profile.get("id") if account_profile else None
        saved_topics = await self._save_topics(
            session_id=session_id,
            platform_code=platform_code,
            topics_data=topics_data,
            account_profile_id=account_profile_id,
        )

        return {
            "topics": saved_topics,
            "recommendation": topics_data.get("recommendation", ""),
            "overall_assessment": topics_data.get("overall_assessment", ""),
        }

    async def _get_conversation_history(self, session_id: str) -> str:
        """获取对话历史文本"""
        async with get_db_session() as session:
            conversations = await crud.list_conversations(session, session_id)

        if not conversations:
            return ""

        # 格式化为对话文本
        lines = []
        for conv in conversations:
            role = "用户" if conv["role"] == "user" else "AI"
            content = conv["content"][:500]  # 限制单条长度
            lines.append(f"{role}: {content}")

        return "\n\n".join(lines)

    async def _summarize_conversation(self, agent, history: str) -> str:
        """
        使用模型后端压缩对话历史为摘要（不影响 Agent 对话记忆）
        """
        if len(history) < 500:
            # 对话较短，不需要压缩
            logger.info(f"对话较短({len(history)}字)，跳过压缩")
            return history

        try:
            prompt = CONVERSATION_SUMMARY_PROMPT.format(
                conversation_history=history[:3000]  # 限制输入长度
            )
            messages = [
                {"role": "system", "content": "你是对话摘要助手。请准确压缩对话历史。"},
                {"role": "user", "content": prompt},
            ]
            summary = await self._run_model_collect(
                agent.model_backend, messages
            )
            logger.info(
                f"对话摘要压缩完成: 原始长度={len(history)}, "
                f"摘要长度={len(summary)}"
            )
            return summary
        except Exception as e:
            logger.warning(f"对话摘要压缩失败，使用原始历史: {e}")
            return history[:2000]

    def _parse_json_response(self, content: str) -> Optional[Dict[str, Any]]:
        """
        从 AI 回复中解析 JSON

        多策略解析，兼容各种模型输出格式。
        """
        if not content or not content.strip():
            logger.error("模型返回空内容，无法解析 JSON")
            return None

        logger.info(f"开始解析模型输出 (长度={len(content)})")
        # 记录前 500 字符用于调试
        logger.debug(f"模型原始输出前500字: {content[:500]}")

        # 策略1: 尝试直接解析整个内容
        try:
            result = json.loads(content.strip())
            logger.info("JSON 解析成功 (策略1: 直接解析)")
            return result
        except json.JSONDecodeError:
            pass

        # 策略2: 从 markdown ```json 代码块中提取
        json_block_match = re.search(
            r'```json\s*\n([\s\S]*?)```', content, re.DOTALL
        )
        if json_block_match:
            try:
                result = json.loads(json_block_match.group(1).strip())
                logger.info("JSON 解析成功 (策略2: markdown json 代码块)")
                return result
            except json.JSONDecodeError as e:
                logger.warning(f"markdown json 代码块解析失败: {e}")

        # 策略3: 从通用 markdown 代码块中提取
        generic_block_match = re.search(
            r'```\s*\n([\s\S]*?)```', content, re.DOTALL
        )
        if generic_block_match:
            try:
                result = json.loads(generic_block_match.group(1).strip())
                logger.info("JSON 解析成功 (策略3: 通用 markdown 代码块)")
                return result
            except json.JSONDecodeError:
                pass

        # 策略4: 基于括号匹配提取最外层 JSON 对象
        brace_start = content.find('{')
        if brace_start != -1:
            # 使用括号计数找到匹配的闭合括号
            depth = 0
            in_string = False
            escape_next = False
            for i in range(brace_start, len(content)):
                ch = content[i]
                if escape_next:
                    escape_next = False
                    continue
                if ch == '\\' and in_string:
                    escape_next = True
                    continue
                if ch == '"' and not escape_next:
                    in_string = not in_string
                    continue
                if not in_string:
                    if ch == '{':
                        depth += 1
                    elif ch == '}':
                        depth -= 1
                        if depth == 0:
                            json_str = content[brace_start:i + 1]
                            try:
                                result = json.loads(json_str)
                                logger.info("JSON 解析成功 (策略4: 括号匹配)")
                                return result
                            except json.JSONDecodeError as e:
                                logger.warning(f"括号匹配提取的 JSON 解析失败: {e}")
                            break

        # 策略5: 最后兜底 - 查找 { 到最后一个 }
        brace_end = content.rfind('}')
        if brace_start != -1 and brace_end != -1 and brace_end > brace_start:
            json_str = content[brace_start:brace_end + 1]
            try:
                result = json.loads(json_str)
                logger.info("JSON 解析成功 (策略5: 首尾花括号)")
                return result
            except json.JSONDecodeError:
                pass

        # 全部策略失败，输出完整内容用于调试
        logger.error(
            f"所有 JSON 解析策略均失败。模型完整输出:\n"
            f"{'=' * 40}\n{content}\n{'=' * 40}"
        )
        return None

    async def _save_topics(
        self,
        session_id: str,
        platform_code: str,
        topics_data: Dict[str, Any],
        account_profile_id: str = None,
    ) -> List[Dict[str, Any]]:
        """将提取的选题保存到数据库（含关联账号）"""
        proposals = topics_data.get("proposals", [])
        saved = []

        async with get_db_session() as session:
            for proposal in proposals:
                topic_id = str(uuid.uuid4())

                # 构建 metadata
                metadata = {
                    "angle": proposal.get("angle", ""),
                    "audience": proposal.get("target_audience", ""),
                    "tone": proposal.get("tone", ""),
                    "format": proposal.get("content_format", ""),
                    "tags": proposal.get("tags", []),
                    "estimated_effect": proposal.get("estimated_effect", ""),
                }

                # 增强字段
                for key in ["viral_score", "competition_level", "algorithm_match",
                            "suggested_publish_time", "reference_cases",
                            "hook_suggestions"]:
                    if key in proposal:
                        metadata[key] = proposal[key]

                topic = await crud.create_topic(
                    session,
                    topic_id=topic_id,
                    title=proposal.get("title", "未命名选题"),
                    session_id=session_id,
                    description=proposal.get("description", ""),
                    target_platform=platform_code,
                    metadata=metadata,
                    account_profile_id=account_profile_id,
                )
                saved.append(topic)

        return saved
