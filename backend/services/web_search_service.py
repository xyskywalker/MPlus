"""
联网搜索统一服务模块
基于 Anspire Open API 提供联网搜索能力
系统中所有需要联网搜索的地方统一调用此服务

API 说明:
- EndPoint: https://plugin.anspire.cn/api/ntsearch/search
- 请求方式: GET
- 鉴权: Bearer Token (API Key)
"""

import httpx
import json
import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Anspire Open API 端点
ANSPIRE_API_URL = "https://plugin.anspire.cn/api/ntsearch/search"


@dataclass
class SearchResult:
    """单条搜索结果"""
    title: str
    url: str
    snippet: str
    source: Optional[str] = None


@dataclass
class WebSearchResponse:
    """联网搜索响应"""
    success: bool
    results: Optional[List[Dict[str, Any]]] = None
    error: Optional[str] = None
    raw_data: Optional[Dict[str, Any]] = None


async def web_search(
    api_key: str,
    query: str,
    top_k: int = 10,
    mode: int = 0,
    insite: Optional[str] = None,
    from_time: Optional[str] = None,
    to_time: Optional[str] = None,
    timeout: float = 30.0
) -> WebSearchResponse:
    """
    执行联网搜索（核心函数）
    
    参数:
        api_key: Anspire Open API Key
        query: 搜索查询词
        top_k: 返回结果条数 (10/20/30/40/50)，默认10
        mode: 搜索模式，默认0
        insite: 指定站点 (如 sohu.com)
        from_time: 起始时间 (如 2025-01-01 00:00:00)
        to_time: 结束时间 (如 2025-12-31 00:00:00)
        timeout: 请求超时时间（秒）
    
    返回:
        WebSearchResponse 对象
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Connection": "keep-alive",
        "Accept": "*/*"
    }
    
    params: Dict[str, str] = {
        "query": query,
        "mode": str(mode),
        "top_k": str(top_k)
    }
    
    # 可选参数
    if insite:
        params["Insite"] = insite
    if from_time:
        params["FromTime"] = from_time
    if to_time:
        params["ToTime"] = to_time
    
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(
                ANSPIRE_API_URL,
                headers=headers,
                params=params
            )
            
            if response.status_code == 200:
                result_json = response.json()
                
                # 如果 results 是字符串，再解析一次（API 可能返回嵌套的 JSON 字符串）
                if isinstance(result_json.get("results"), str):
                    result_json["results"] = json.loads(result_json["results"])
                
                return WebSearchResponse(
                    success=True,
                    results=result_json.get("results", []),
                    raw_data=result_json
                )
            else:
                # Anspire API 在无搜索结果时可能返回 500 + "No valid search results"
                # 这种情况视为"无结果"而非真正的服务端错误
                response_text = response.text
                if response.status_code == 500 and "No valid search results" in response_text:
                    logger.info(f"搜索无结果（API 返回 500）: query={query}")
                    return WebSearchResponse(
                        success=True,
                        results=[],
                        raw_data={"detail": "No valid search results"}
                    )

                error_msg = f"搜索请求失败，状态码: {response.status_code}"
                logger.error(f"{error_msg}, 响应: {response_text}")
                return WebSearchResponse(
                    success=False,
                    error=error_msg
                )
                
    except httpx.TimeoutException:
        error_msg = f"搜索请求超时（{timeout}秒）"
        logger.error(error_msg)
        return WebSearchResponse(success=False, error=error_msg)
    except Exception as e:
        error_msg = f"搜索请求异常: {str(e)}"
        logger.exception(error_msg)
        return WebSearchResponse(success=False, error=error_msg)


async def test_api_key(api_key: str) -> WebSearchResponse:
    """
    测试 API Key 是否有效
    使用一个简单的搜索查询进行测试
    
    参数:
        api_key: 待测试的 Anspire Open API Key
    
    返回:
        WebSearchResponse 对象
    """
    return await web_search(
        api_key=api_key,
        query="测试",
        top_k=10,
        timeout=15.0
    )


async def search_with_config(
    db_session,
    query: str,
    top_k: int = 10,
    mode: int = 0,
    insite: Optional[str] = None,
    from_time: Optional[str] = None,
    to_time: Optional[str] = None
) -> WebSearchResponse:
    """
    使用数据库中保存的配置执行联网搜索
    这是系统中统一调用联网搜索的入口函数
    
    参数:
        db_session: 数据库会话
        query: 搜索查询词
        top_k: 返回结果条数
        mode: 搜索模式
        insite: 指定站点
        from_time: 起始时间
        to_time: 结束时间
    
    返回:
        WebSearchResponse 对象
    """
    from ..db.crud import get_setting
    
    # 从数据库获取 API Key
    config = await get_setting(db_session, "anspire_api_key")
    if not config or not config.get("key"):
        return WebSearchResponse(
            success=False,
            error="联网搜索未配置，请先在系统设置中配置 Anspire API Key"
        )
    
    api_key = config["key"]
    
    return await web_search(
        api_key=api_key,
        query=query,
        top_k=top_k,
        mode=mode,
        insite=insite,
        from_time=from_time,
        to_time=to_time
    )
