"""
Anspire 联网搜索工具模块
为头脑风暴服务提供联网搜索能力，
由 BrainstormService 在服务层直接调用（非 Agent 自动调用）。
"""

import re
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta

from ..services.web_search_service import web_search

logger = logging.getLogger(__name__)


class AnspireSearchTool:
    """
    Anspire 联网搜索工具

    设计要点：
    - 不作为 CAMEL FunctionTool 注册（因为是用户手动开关模式）
    - 由 BrainstormService 在服务层直接调用
    - 搜索结果格式化为 Agent 友好的文本
    - 支持平台域名过滤
    """

    # 平台域名映射
    PLATFORM_DOMAINS = {
        "xiaohongshu": "xiaohongshu.com",
        "douyin": "douyin.com",
        "weibo": "weibo.com",
        "bilibili": "bilibili.com",
        "zhihu": "zhihu.com",
        "wechat": "mp.weixin.qq.com",
    }

    def __init__(self, api_key: str):
        """
        初始化搜索工具

        Args:
            api_key: Anspire API Key
        """
        self.api_key = api_key

    async def search(
        self,
        query: str,
        platform_code: Optional[str] = None,
        days: int = 7,
        top_k: int = 5,
    ) -> Optional[Dict[str, Any]]:
        """
        执行联网搜索

        注意：当前默认不传 insite 参数，因为 Anspire API 的 Insite 过滤
        在多数平台下都会返回 500 错误。搜索结果通过关键词本身来保证相关性。

        Args:
            query: 搜索关键词
            platform_code: 目标平台代码（当前仅用于日志记录，不传给 API）
            days: 搜索时间范围（天数）
            top_k: 返回结果数量

        Returns:
            搜索结果字典，包含 items 和 formatted 字段；失败返回 None
        """
        # 构建时间范围
        from_time = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
        to_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # 不再传 insite 参数（Anspire API 的站内搜索在多数平台下不可用）
        if platform_code:
            logger.debug(f"搜索平台: {platform_code}（不限定域名）")

        try:
            response = await web_search(
                api_key=self.api_key,
                query=query,
                top_k=top_k,
                insite=None,
                from_time=from_time,
                to_time=to_time,
                timeout=30.0,
            )

            if not response.success or not response.results:
                logger.warning(f"搜索无结果或失败: query={query}, error={response.error}")
                return None

            # 格式化搜索结果
            items = []
            for item in response.results[:top_k]:
                items.append({
                    "title": item.get("title", ""),
                    "snippet": (item.get("snippet", "") or "")[:200],
                    "url": item.get("url", ""),
                })

            formatted = self._format_results(items, query)

            return {
                "items": items,
                "formatted": formatted,
                "query": query,
            }

        except Exception as e:
            logger.error(f"搜索异常: {e}")
            return None

    async def search_with_fallback(
        self,
        query: str,
        platform_code: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        带降级策略的搜索

        降级流程：
        1. 先搜索最近 7 天
        2. 无结果时扩大到 30 天
        3. 全部失败返回 None（不影响对话）

        Args:
            query: 搜索关键词
            platform_code: 目标平台代码（传递给 search 用于日志）

        Returns:
            搜索结果或 None（失败时静默降级）
        """
        try:
            # 第一步：搜索最近 7 天
            result = await self.search(query, platform_code)
            if result and result.get("items"):
                return result

            # 第二步：扩大时间范围到 30 天
            logger.info(f"7天内搜索无结果，扩大到30天重试: query={query}")
            result = await self.search(query, platform_code=None, days=30)
            if result and result.get("items"):
                return result

            return None

        except Exception as e:
            logger.warning(f"搜索降级全部失败: query={query}, error={e}")
            return None

    def _format_results(self, items: List[Dict], query: str) -> str:
        """
        将搜索结果格式化为 Agent 友好的文本

        Args:
            items: 搜索结果列表
            query: 搜索关键词

        Returns:
            格式化的文本
        """
        if not items:
            return ""

        lines = []
        for i, item in enumerate(items, 1):
            title = item.get("title", "无标题")
            snippet = item.get("snippet", "")
            url = item.get("url", "")
            source = ""
            if url:
                try:
                    source = url.split("/")[2]
                except (IndexError, AttributeError):
                    pass

            line = f"{i}. 《{title}》"
            if snippet:
                line += f"\n   摘要: {snippet}"
            if source:
                line += f"\n   来源: {source}"
            lines.append(line)

        return "\n\n".join(lines)


def extract_search_keywords(message: str) -> str:
    """
    从用户消息中提取搜索关键词

    策略：
    1. 使用正则提取中文词组（2字及以上）
    2. 过滤常见停用词
    3. 保留名词和关键短语
    4. 如果提取结果太少，直接使用原始消息前30字
    5. 最终关键词限制在30字以内
    """
    # 常见停用词
    STOP_WORDS = {
        "我", "你", "的", "了", "是", "在", "有", "和", "就", "不",
        "也", "都", "这", "那", "要", "会", "能", "可以", "想", "做",
        "一个", "什么", "怎么", "为什么", "吗", "呢", "啊", "吧",
        "帮", "关于", "一下", "觉得", "比较", "还是", "或者",
        "不错", "可能", "应该", "需要", "然后", "因为", "所以",
        "如果", "但是", "而且", "虽然", "不过", "或许", "大概",
        "以及", "之后", "之前", "开始", "现在", "已经", "看看",
        "试试", "想想", "说说", "聊聊", "方向", "内容",
    }

    # 提取中文词组（2字及以上）
    words = re.findall(r'[\u4e00-\u9fff]{2,}', message)

    # 过滤停用词
    keywords = [w for w in words if w not in STOP_WORDS]

    if not keywords:
        # 回退：使用原始消息前30字
        return message[:30]

    # 最多5个关键词，总长度限制30字
    result = " ".join(keywords[:5])
    return result[:30]
