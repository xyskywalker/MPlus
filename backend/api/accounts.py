"""
账号配置 API 路由
提供自媒体账号配置和历史内容管理功能
"""

import json
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import uuid
from datetime import datetime

from ..db.database import get_session
from ..db import crud
from ..services.llm_service import LLMService, LLMConfig
from ..services.options_service import get_app_options

logger = logging.getLogger(__name__)

router = APIRouter()


# ==================== 请求模型 ====================

class AccountCreate(BaseModel):
    """创建账号配置请求"""
    platform_code: str
    account_name: str = Field(..., min_length=1)
    main_category: str = Field(..., min_length=1)
    account_id: Optional[str] = None
    bio: Optional[str] = None
    sub_categories: Optional[List[str]] = None
    content_style: Optional[str] = None
    target_audience: Optional[str] = None
    followers_count: int = 0
    posts_count: int = 0
    verification_status: str = "none"
    started_at: Optional[str] = None
    extra_metrics: Optional[Dict[str, Any]] = None


class AccountUpdate(BaseModel):
    """更新账号配置请求"""
    account_name: Optional[str] = None
    main_category: Optional[str] = None
    account_id: Optional[str] = None
    bio: Optional[str] = None
    sub_categories: Optional[List[str]] = None
    content_style: Optional[str] = None
    target_audience: Optional[str] = None
    followers_count: Optional[int] = None
    posts_count: Optional[int] = None
    verification_status: Optional[str] = None
    started_at: Optional[str] = None
    extra_metrics: Optional[Dict[str, Any]] = None


class PostPerformanceCreate(BaseModel):
    """添加历史内容请求"""
    title: str = Field(..., min_length=1)
    content: Optional[str] = None          # 内容原文或简介
    post_type: str = "图文"
    tags: Optional[List[str]] = None
    is_top: bool = False
    post_url: Optional[str] = None
    publish_time: Optional[str] = None
    metrics_captured_at: Optional[str] = None
    views: int = 0
    likes: int = 0
    comments: int = 0
    favorites: int = 0
    shares: int = 0
    extra_metrics: Optional[Dict[str, Any]] = None


class PostPerformanceUpdate(BaseModel):
    """更新历史内容请求"""
    title: Optional[str] = None
    content: Optional[str] = None          # 内容原文或简介
    post_type: Optional[str] = None
    tags: Optional[List[str]] = None
    is_top: Optional[bool] = None
    post_url: Optional[str] = None
    publish_time: Optional[str] = None
    metrics_captured_at: Optional[str] = None
    views: Optional[int] = None
    likes: Optional[int] = None
    comments: Optional[int] = None
    favorites: Optional[int] = None
    shares: Optional[int] = None
    extra_metrics: Optional[Dict[str, Any]] = None


class AccountAnalyzeRequest(BaseModel):
    """AI 分析账号定位请求"""
    platform_code: str
    account_name: str
    bio: str = Field(..., min_length=1)


# ==================== 账号管理接口 ====================

@router.get("/accounts")
async def list_accounts(platform_code: Optional[str] = None):
    """获取账号配置列表"""
    async with get_session() as session:
        accounts = await crud.list_account_profiles(session, platform_code=platform_code)
    
    return {
        "code": 0,
        "data": {
            "items": accounts,
            "total": len(accounts)
        },
        "message": "success"
    }


@router.post("/accounts/analyze")
async def analyze_account(data: AccountAnalyzeRequest):
    """AI 智能分析账号定位"""
    # 获取配置选项
    options = get_app_options()
    category_values = [c["value"] for c in options.get("category_options", [])]
    content_styles = options.get("content_styles", [])
    
    # 平台名称映射
    platform_names = {
        "xiaohongshu": "小红书", "douyin": "抖音", "weibo": "微博",
        "bilibili": "B站", "zhihu": "知乎", "wechat": "微信公众号",
        "generic": "通用平台"
    }
    platform_name = platform_names.get(data.platform_code, data.platform_code)
    
    # 优先使用快速任务模型，降级到默认模型
    from ..db.crud import get_fast_task_model_config, get_default_model_config
    async with get_session() as session:
        model_config = await get_fast_task_model_config(session)
        if not model_config:
            model_config = await get_default_model_config(session)
    
    if not model_config:
        raise HTTPException(status_code=400, detail="未配置 AI 模型，请先在设置中配置模型")
    
    # 构建 Prompt
    prompt = f"""你是一个自媒体运营分析专家。请根据以下账号信息，分析其内容定位。

平台：{platform_name}
账号名称：{data.account_name}
个人简介：{data.bio}

请分析并返回以下内容（JSON 格式）：
1. main_category：主要内容分类（从以下选项中选择最匹配的，如都不合适可自定义）
   可选分类：{', '.join(category_values)}
2. sub_categories：3-5 个子分类标签（可参考主分类下的推荐标签，也可自由生成）
3. content_style：内容风格（从以下选项中选择最匹配的，如都不合适可自定义）
   可选风格：{', '.join(content_styles)}
4. target_audience：目标受众的简要描述（包含年龄段、人群特征等，一句话即可）

仅返回 JSON 对象，不要包含 markdown 代码块标记或其他内容。示例格式：
{{"main_category": "职场成长", "sub_categories": ["职场技能", "求职面试", "个人成长"], "content_style": "干货教程型", "target_audience": "22-30岁职场新人及求职者"}}"""

    try:
        llm = LLMService(LLMConfig.from_dict(model_config))
        response = await llm.chat(prompt)
        
        if not response.success or not response.content:
            raise HTTPException(status_code=500, detail="AI 分析失败，请稍后重试")
        
        # 解析 JSON 响应
        content = response.content.strip()
        # 清理可能的 markdown 代码块
        if content.startswith("```"):
            content = content.split("\n", 1)[-1]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()
        
        result = json.loads(content)
        
        # 确保返回格式正确
        return {
            "code": 0,
            "data": {
                "main_category": result.get("main_category", ""),
                "sub_categories": result.get("sub_categories", []),
                "content_style": result.get("content_style", ""),
                "target_audience": result.get("target_audience", "")
            },
            "message": "success"
        }
    except json.JSONDecodeError:
        logger.error(f"AI 返回内容解析失败: {response.content if response else 'N/A'}")
        raise HTTPException(status_code=500, detail="AI 返回格式异常，请重试")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI 分析异常: {e}")
        raise HTTPException(status_code=500, detail=f"AI 分析失败: {str(e)}")


@router.get("/accounts/{account_id}")
async def get_account(account_id: str):
    """获取单个账号详情"""
    async with get_session() as session:
        account = await crud.get_account_profile(session, account_id)
    
    if not account:
        raise HTTPException(status_code=404, detail="账号配置不存在")
    
    return {"code": 0, "data": account, "message": "success"}


@router.post("/accounts")
async def create_account(data: AccountCreate):
    """创建账号配置"""
    async with get_session() as session:
        account = await crud.create_account_profile(
            session,
            profile_id=str(uuid.uuid4()),
            platform_code=data.platform_code,
            account_name=data.account_name,
            main_category=data.main_category,
            account_id=data.account_id,
            bio=data.bio,
            sub_categories=data.sub_categories,
            content_style=data.content_style,
            target_audience=data.target_audience,
            followers_count=data.followers_count,
            posts_count=data.posts_count,
            verification_status=data.verification_status,
            started_at=data.started_at,
            extra_metrics=data.extra_metrics
        )
    
    return {"code": 0, "data": account, "message": "创建成功"}


@router.put("/accounts/{account_id}")
async def update_account(account_id: str, data: AccountUpdate):
    """更新账号配置"""
    update_data = data.dict(exclude_unset=True)
    
    async with get_session() as session:
        account = await crud.update_account_profile(session, account_id, **update_data)
    
    if not account:
        raise HTTPException(status_code=404, detail="账号配置不存在")
    
    return {"code": 0, "data": account, "message": "更新成功"}


@router.delete("/accounts/{account_id}")
async def delete_account(account_id: str):
    """删除账号配置"""
    async with get_session() as session:
        success = await crud.delete_account_profile(session, account_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="账号配置不存在")
    
    return {"code": 0, "message": "删除成功"}


# ==================== 历史内容管理接口 ====================

@router.post("/accounts/{account_id}/posts")
async def add_post_performance(account_id: str, data: PostPerformanceCreate):
    """添加历史内容"""
    async with get_session() as session:
        # 验证账号存在
        account = await crud.get_account_profile(session, account_id)
        if not account:
            raise HTTPException(status_code=404, detail="账号配置不存在")
        
        post = await crud.create_post_performance(
            session,
            post_id=str(uuid.uuid4()),
            account_profile_id=account_id,
            title=data.title,
            content=data.content,
            post_type=data.post_type,
            tags=data.tags,
            is_top=data.is_top,
            post_url=data.post_url,
            publish_time=data.publish_time,
            metrics_captured_at=data.metrics_captured_at,
            views=data.views,
            likes=data.likes,
            comments=data.comments,
            favorites=data.favorites,
            shares=data.shares,
            extra_metrics=data.extra_metrics
        )
    
    return {"code": 0, "data": post, "message": "添加成功"}


@router.put("/accounts/posts/{post_id}")
async def update_post_performance(post_id: str, data: PostPerformanceUpdate):
    """更新历史内容"""
    update_data = data.dict(exclude_unset=True)
    
    async with get_session() as session:
        post = await crud.update_post_performance(session, post_id, **update_data)
    
    if not post:
        raise HTTPException(status_code=404, detail="历史内容不存在")
    
    return {"code": 0, "data": post, "message": "更新成功"}


@router.delete("/accounts/posts/{post_id}")
async def delete_post_performance(post_id: str):
    """删除历史内容"""
    async with get_session() as session:
        success = await crud.delete_post_performance(session, post_id)
    
    if not success:
        raise HTTPException(status_code=404, detail="历史内容不存在")
    
    return {"code": 0, "message": "删除成功"}
