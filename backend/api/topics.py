"""
选题管理 API 路由
提供选题的增删改查功能，以及 AI 生成详细内容和 AI 迁移选题功能
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import uuid
import logging
from datetime import datetime

from ..db.database import get_session
from ..db import crud

logger = logging.getLogger(__name__)

router = APIRouter()


class TopicCreate(BaseModel):
    """创建选题请求"""
    title: str = Field(..., min_length=1)
    session_id: Optional[str] = None
    description: Optional[str] = None
    target_platform: Optional[str] = None
    content: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    account_profile_id: Optional[str] = None  # 关联账号画像 ID


class TopicUpdate(BaseModel):
    """更新选题请求"""
    title: Optional[str] = None
    description: Optional[str] = None
    target_platform: Optional[str] = None
    content: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    status: Optional[str] = None
    account_profile_id: Optional[str] = None


class TopicGenerateContentRequest(BaseModel):
    """AI 生成详细内容请求"""
    pass  # 不需要额外参数，从选题本身获取所有信息


class TopicAIGenerateInfoRequest(BaseModel):
    """AI 一键生成选题信息请求（基于标题生成除详细内容外的所有字段）"""
    title: str = Field(..., min_length=1, description="选题标题")
    target_platform: Optional[str] = Field(None, description="目标平台代码")
    account_profile_id: Optional[str] = Field(None, description="关联账号画像 ID")


class TopicAIGenerateContentRequest(BaseModel):
    """AI 生成详细内容请求（不依赖已保存的选题，用于新增选题场景）"""
    title: str = Field(..., min_length=1, description="选题标题")
    description: Optional[str] = Field(None, description="选题描述")
    target_platform: Optional[str] = Field(None, description="目标平台代码")
    account_profile_id: Optional[str] = Field(None, description="关联账号画像 ID")
    metadata: Optional[Dict[str, Any]] = Field(None, description="元数据：audience, tone, format, tags")


class TopicMigrateRequest(BaseModel):
    """AI 迁移选题请求"""
    target_platform: str = Field(..., description="目标平台代码")
    target_account_profile_id: Optional[str] = Field(None, description="目标账号画像 ID")


@router.get("/topics")
async def list_topics(
    session_id: Optional[str] = None,
    status: Optional[str] = None,
    platform: Optional[str] = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0)
):
    """获取选题列表"""
    async with get_session() as session:
        db_topics = await crud.list_topics(
            session,
            session_id=session_id,
            status=status,
            platform=platform,
            limit=limit,
            offset=offset
        )
    
    return {
        "code": 0,
        "data": {
            "items": db_topics or [],
            "total": len(db_topics) if db_topics else 0
        },
        "message": "success"
    }


@router.post("/topics")
async def create_topic_api(data: TopicCreate):
    """创建选题"""
    async with get_session() as session:
        new_topic = await crud.create_topic(
            session,
            topic_id=str(uuid.uuid4()),
            title=data.title,
            session_id=data.session_id,
            description=data.description,
            target_platform=data.target_platform,
            content=data.content,
            metadata=data.metadata,
            account_profile_id=data.account_profile_id,
        )
    
    return {"code": 0, "data": new_topic, "message": "创建成功"}


@router.get("/topics/{topic_id}")
async def get_topic_api(topic_id: str):
    """获取选题详情"""
    async with get_session() as session:
        db_topic = await crud.get_topic(session, topic_id)
    
    if not db_topic:
        raise HTTPException(status_code=404, detail="选题不存在")
    
    return {"code": 0, "data": db_topic, "message": "success"}


@router.put("/topics/{topic_id}")
async def update_topic_api(topic_id: str, data: TopicUpdate):
    """更新选题"""
    async with get_session() as session:
        update_data = data.model_dump(exclude_none=True)
        updated = await crud.update_topic(session, topic_id, **update_data)
        
        if not updated:
            raise HTTPException(status_code=404, detail="选题不存在")
        
        return {"code": 0, "data": updated, "message": "更新成功"}


@router.delete("/topics/{topic_id}")
async def delete_topic_api(topic_id: str):
    """删除选题"""
    async with get_session() as session:
        success = await crud.delete_topic(session, topic_id)
        
        if not success:
            raise HTTPException(status_code=404, detail="选题不存在")
        
        return {"code": 0, "message": "删除成功"}


@router.get("/topics/{topic_id}/export")
async def export_topic(topic_id: str):
    """导出选题"""
    async with get_session() as session:
        topic = await crud.get_topic(session, topic_id)
    
    if not topic:
        raise HTTPException(status_code=404, detail="选题不存在")
    
    # 构建导出数据
    export_data = {
        "title": topic["title"],
        "description": topic.get("description", ""),
        "platform": topic.get("target_platform", ""),
        "tags": topic.get("metadata", {}).get("tags", []),
        "exported_at": datetime.now().isoformat()
    }
    
    return {
        "code": 0,
        "data": export_data,
        "message": "导出成功"
    }


@router.post("/topics/ai-generate-info")
async def ai_generate_topic_info(data: TopicAIGenerateInfoRequest):
    """
    AI 一键生成选题信息（不含详细内容）
    基于标题、平台画像、账号画像和历史数据生成：描述、受众、调性、形式、标签
    """
    from ..services.llm_service import LLMService, LLMConfig
    from ..services.platform_loader import PlatformProfileLoader

    # 加载平台画像
    platform_profile = PlatformProfileLoader.load(data.target_platform) if data.target_platform else None
    platform_name = platform_profile.platform_name if platform_profile else "通用平台"

    # 加载关联账号画像（含历史数据）
    account_profile = None
    if data.account_profile_id:
        async with get_session() as session:
            account_profile = await crud.get_account_profile(session, data.account_profile_id)

    # 获取默认模型配置
    async with get_session() as session:
        model_config = await crud.get_default_model_config(session)
    if not model_config:
        raise HTTPException(status_code=400, detail="未配置模型，请先在设置页面添加模型")

    # 构建提示词
    prompt_parts = [f"## 选题标题\n{data.title}\n\n## 目标平台\n{platform_name}"]

    if platform_profile:
        prompt_parts.append(f"""## 平台特征（{platform_name}）
- 内容调性: {platform_profile.tone_requirements}
- 爆款特征: {platform_profile.viral_characteristics}
- 受众画像: {platform_profile.audience_summary}
- 内容红线: {platform_profile.content_restrictions}""")

    if account_profile:
        acct_section = f"""## 关联账号信息
- 账号: {account_profile.get('account_name', '')}
- 主赛道: {account_profile.get('main_category', '')}
- 内容风格: {account_profile.get('content_style', '未指定')}
- 目标受众: {account_profile.get('target_audience', '未指定')}
- 粉丝量级: {account_profile.get('followers_count', 0)}"""

        # 历史爆款数据参考（取互动率最高的前 5 条）
        posts = account_profile.get("post_performances", [])
        if posts:
            top_posts = sorted(
                [p for p in posts if p.get("engagement_rate", 0) > 0],
                key=lambda p: p.get("engagement_rate", 0),
                reverse=True,
            )[:5]
            if top_posts:
                acct_section += "\n\n### 历史高互动内容参考"
                for i, p in enumerate(top_posts, 1):
                    tags_str = ", ".join(p.get("tags", []) or [])
                    acct_section += (
                        f"\n{i}. 「{p.get('title', '')}」"
                        f" 互动率={p.get('engagement_rate', 0)}%"
                        f" 点赞={p.get('likes', 0)} 收藏={p.get('favorites', 0)}"
                    )
                    if tags_str:
                        acct_section += f" 标签=[{tags_str}]"

        prompt_parts.append(acct_section)

    prompt_parts.append("""## 任务要求
请基于以上信息，为这个选题生成以下内容。要求贴合平台调性和账号风格，参考历史爆款数据的规律。

请严格以如下 JSON 格式输出（不要输出其他内容）：
```json
{
  "description": "选题描述（2-3句话，概括核心卖点和内容方向）",
  "audience": "目标受众（具体的人群描述）",
  "tone": "内容调性（如：轻松幽默、专业干货、情感共鸣）",
  "format": "内容形式（如：图文步骤、短视频口播、长文深度解析）",
  "tags": ["标签1", "标签2", "标签3", "标签4", "标签5"]
}
```""")

    user_prompt = "\n\n".join(prompt_parts)
    system_prompt = "你是一位资深的自媒体选题策划专家。请根据给定信息生成高质量的选题元数据。必须严格输出 JSON 格式，不要添加任何其他说明文字。"

    try:
        import re
        import json as json_lib

        llm_config = LLMConfig.from_dict(model_config)
        service = LLMService(llm_config, timeout=60.0)
        response = await service.chat(user_prompt, system_prompt=system_prompt)

        if not response.success:
            raise HTTPException(status_code=500, detail=f"AI 生成失败: {response.error}")

        raw = response.content or ""

        # 清理深度思考标签
        raw = re.sub(r'<think(?:ing)?>\s*[\s\S]*?\s*</think(?:ing)?>', '', raw, flags=re.IGNORECASE).strip()

        # 提取 JSON
        json_match = re.search(r'```(?:json)?\s*(\{[\s\S]*?\})\s*```', raw)
        if json_match:
            raw = json_match.group(1)
        else:
            # 尝试直接解析整段文本中的 JSON 对象
            brace_match = re.search(r'\{[\s\S]*\}', raw)
            if brace_match:
                raw = brace_match.group(0)

        result = json_lib.loads(raw)

        # 确保 tags 是数组
        tags = result.get("tags", [])
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(",") if t.strip()]

        return {
            "code": 0,
            "data": {
                "description": result.get("description", ""),
                "audience": result.get("audience", ""),
                "tone": result.get("tone", ""),
                "format": result.get("format", ""),
                "tags": tags,
            },
            "message": "生成成功",
        }

    except json_lib.JSONDecodeError:
        logger.error(f"AI 返回内容 JSON 解析失败: {raw[:500]}")
        raise HTTPException(status_code=500, detail="AI 返回格式异常，请重试")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI 一键生成选题信息失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


@router.post("/topics/ai-generate-content-draft")
async def ai_generate_content_draft(data: TopicAIGenerateContentRequest):
    """
    AI 生成选题详细内容（不依赖已保存的选题，用于新增选题场景）
    基于传入的选题信息、平台画像和账号画像生成内容大纲/脚本
    """
    from ..services.llm_service import LLMService, LLMConfig
    from ..services.platform_loader import PlatformProfileLoader

    # 加载平台画像
    platform_profile = PlatformProfileLoader.load(data.target_platform) if data.target_platform else None
    platform_name = platform_profile.platform_name if platform_profile else "通用平台"

    # 加载关联账号画像
    account_profile = None
    if data.account_profile_id:
        async with get_session() as session:
            account_profile = await crud.get_account_profile(session, data.account_profile_id)

    # 获取默认模型配置
    async with get_session() as session:
        model_config = await crud.get_default_model_config(session)
    if not model_config:
        raise HTTPException(status_code=400, detail="未配置模型，请先在设置页面添加模型")

    # 构建提示词（与已有 generate-content 逻辑一致）
    metadata = data.metadata or {}
    topic_info = f"""## 选题信息
- 标题: {data.title}
- 描述: {data.description or ''}
- 目标平台: {platform_name}
- 目标受众: {metadata.get('audience', '未指定')}
- 内容调性: {metadata.get('tone', '未指定')}
- 内容形式: {metadata.get('format', '未指定')}
- 标签: {', '.join(metadata.get('tags', []))}"""

    platform_section = ""
    if platform_profile:
        platform_section = f"""
## 平台特征（{platform_name}）
- 内容调性: {platform_profile.tone_requirements}
- 爆款特征: {platform_profile.viral_characteristics}"""

    account_section = ""
    if account_profile:
        account_section = f"""
## 关联账号信息
- 账号: {account_profile.get('account_name', '')}
- 主赛道: {account_profile.get('main_category', '')}
- 内容风格: {account_profile.get('content_style', '未指定')}
- 目标受众: {account_profile.get('target_audience', '未指定')}
- 粉丝量级: {account_profile.get('followers_count', 0)}

请确保生成的内容与该账号的风格和定位一致。"""

    user_prompt = f"""{topic_info}
{platform_section}
{account_section}

## 要求
请基于以上信息，生成该选题的详细内容大纲。根据内容形式不同，输出对应格式：
- 如果是图文/笔记类：生成完整的正文内容（包含开头钩子、主体内容分段、结尾互动引导）
- 如果是视频类：生成分镜脚本（包含开头钩子、各段内容要点、口播文案要点、结尾引导）
- 如果是长文/专栏类：生成完整提纲（包含标题、各章节要点、核心论据）

请直接输出内容，不要加任何解释前缀。内容要具体、可执行，符合{platform_name}的内容规范。"""

    system_prompt = "你是一位资深的自媒体内容创作助手。请根据选题信息生成高质量的详细内容。输出的内容应该是创作者可以直接参考使用的。"

    try:
        import re

        llm_config = LLMConfig.from_dict(model_config)
        service = LLMService(llm_config, timeout=120.0)
        response = await service.chat(user_prompt, system_prompt=system_prompt)

        if not response.success:
            raise HTTPException(status_code=500, detail=f"AI 生成失败: {response.error}")

        generated_content = response.content or ""
        generated_content = re.sub(
            r'<think(?:ing)?>\s*[\s\S]*?\s*</think(?:ing)?>',
            '', generated_content, flags=re.IGNORECASE
        ).strip()

        return {"code": 0, "data": {"content": generated_content}, "message": "生成成功"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI 生成选题内容失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


@router.post("/topics/{topic_id}/generate-content")
async def generate_topic_content(topic_id: str):
    """
    AI 生成选题详细内容
    基于选题基本信息、平台画像和关联账号画像自动生成内容大纲/脚本
    """
    from ..services.llm_service import LLMService, LLMConfig
    from ..services.platform_loader import PlatformProfileLoader

    # 获取选题数据
    async with get_session() as session:
        topic = await crud.get_topic(session, topic_id)
    if not topic:
        raise HTTPException(status_code=404, detail="选题不存在")

    # 加载平台画像
    platform_code = topic.get("target_platform", "")
    platform_profile = PlatformProfileLoader.load(platform_code) if platform_code else None
    platform_name = platform_profile.platform_name if platform_profile else "通用平台"

    # 加载关联账号画像
    account_profile = None
    account_profile_id = topic.get("account_profile_id")
    if account_profile_id:
        async with get_session() as session:
            account_profile = await crud.get_account_profile(session, account_profile_id)

    # 获取默认模型配置
    async with get_session() as session:
        model_config = await crud.get_default_model_config(session)
    if not model_config:
        raise HTTPException(status_code=400, detail="未配置模型，请先在设置页面添加模型")

    # 构建提示词
    metadata = topic.get("metadata", {})
    topic_info = f"""## 选题信息
- 标题: {topic.get('title', '')}
- 描述: {topic.get('description', '')}
- 目标平台: {platform_name}
- 目标受众: {metadata.get('audience', '未指定')}
- 内容调性: {metadata.get('tone', '未指定')}
- 内容形式: {metadata.get('format', '未指定')}
- 标签: {', '.join(metadata.get('tags', []))}"""

    # 平台画像段
    platform_section = ""
    if platform_profile:
        platform_section = f"""
## 平台特征（{platform_name}）
- 内容调性: {platform_profile.tone_requirements}
- 爆款特征: {platform_profile.viral_characteristics}"""

    # 账号画像段
    account_section = ""
    if account_profile:
        account_section = f"""
## 关联账号信息
- 账号: {account_profile.get('account_name', '')}
- 主赛道: {account_profile.get('main_category', '')}
- 内容风格: {account_profile.get('content_style', '未指定')}
- 目标受众: {account_profile.get('target_audience', '未指定')}
- 粉丝量级: {account_profile.get('followers_count', 0)}

请确保生成的内容与该账号的风格和定位一致。"""

    user_prompt = f"""{topic_info}
{platform_section}
{account_section}

## 要求
请基于以上信息，生成该选题的详细内容大纲。根据内容形式不同，输出对应格式：
- 如果是图文/笔记类：生成完整的正文内容（包含开头钩子、主体内容分段、结尾互动引导）
- 如果是视频类：生成分镜脚本（包含开头钩子、各段内容要点、口播文案要点、结尾引导）
- 如果是长文/专栏类：生成完整提纲（包含标题、各章节要点、核心论据）

请直接输出内容，不要加任何解释前缀。内容要具体、可执行，符合{platform_name}的内容规范。"""

    system_prompt = "你是一位资深的自媒体内容创作助手。请根据选题信息生成高质量的详细内容。输出的内容应该是创作者可以直接参考使用的。"

    try:
        import re

        llm_config = LLMConfig.from_dict(model_config)
        service = LLMService(llm_config, timeout=120.0)
        response = await service.chat(user_prompt, system_prompt=system_prompt)

        if not response.success:
            raise HTTPException(status_code=500, detail=f"AI 生成失败: {response.error}")

        generated_content = response.content or ""

        # 清理深度思考标签
        generated_content = re.sub(
            r'<think(?:ing)?>\s*[\s\S]*?\s*</think(?:ing)?>',
            '', generated_content, flags=re.IGNORECASE
        ).strip()

        return {"code": 0, "data": {"content": generated_content}, "message": "生成成功"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI 生成选题内容失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


@router.post("/topics/{topic_id}/migrate")
async def migrate_topic(topic_id: str, data: TopicMigrateRequest):
    """
    AI 迁移选题到目标平台/账号
    复制选题并通过 AI 适配目标平台的风格和规范
    """
    from ..services.llm_service import LLMService, LLMConfig
    from ..services.platform_loader import PlatformProfileLoader

    # 获取原始选题
    async with get_session() as session:
        source_topic = await crud.get_topic(session, topic_id)
    if not source_topic:
        raise HTTPException(status_code=404, detail="选题不存在")

    # 加载源平台和目标平台画像
    source_platform_code = source_topic.get("target_platform", "")
    target_platform_code = data.target_platform

    source_profile = PlatformProfileLoader.load(source_platform_code) if source_platform_code else None
    target_profile = PlatformProfileLoader.load(target_platform_code) if target_platform_code else None

    source_platform_name = source_profile.platform_name if source_profile else "通用平台"
    target_platform_name = target_profile.platform_name if target_profile else "通用平台"

    # 加载目标账号画像
    target_account = None
    if data.target_account_profile_id:
        async with get_session() as session:
            target_account = await crud.get_account_profile(session, data.target_account_profile_id)

    # 加载源账号画像（用于对比）
    source_account = None
    source_account_id = source_topic.get("account_profile_id")
    if source_account_id:
        async with get_session() as session:
            source_account = await crud.get_account_profile(session, source_account_id)

    # 获取默认模型配置
    async with get_session() as session:
        model_config = await crud.get_default_model_config(session)
    if not model_config:
        raise HTTPException(status_code=400, detail="未配置模型，请先在设置页面添加模型")

    # 构建迁移提示词
    metadata = source_topic.get("metadata", {})
    source_info = f"""## 原始选题
- 标题: {source_topic.get('title', '')}
- 描述: {source_topic.get('description', '')}
- 源平台: {source_platform_name}
- 目标受众: {metadata.get('audience', '未指定')}
- 内容调性: {metadata.get('tone', '未指定')}
- 内容形式: {metadata.get('format', '未指定')}
- 标签: {', '.join(metadata.get('tags', []))}"""

    if source_topic.get('content'):
        source_info += f"\n- 详细内容: {source_topic['content'][:500]}"

    # 源账号段
    source_account_section = ""
    if source_account:
        source_account_section = f"""
## 源账号
- 账号: {source_account.get('account_name', '')}
- 主赛道: {source_account.get('main_category', '')}
- 风格: {source_account.get('content_style', '未指定')}"""

    # 目标平台段
    target_section = f"\n## 目标平台: {target_platform_name}"
    if target_profile:
        target_section += f"""
- 内容调性要求: {target_profile.tone_requirements}
- 爆款特征: {target_profile.viral_characteristics}
- 受众画像: {target_profile.audience_summary}"""

    # 目标账号段
    target_account_section = ""
    if target_account:
        target_account_section = f"""
## 目标账号
- 账号: {target_account.get('account_name', '')}
- 主赛道: {target_account.get('main_category', '')}
- 内容风格: {target_account.get('content_style', '未指定')}
- 目标受众: {target_account.get('target_audience', '未指定')}
- 粉丝量级: {target_account.get('followers_count', 0)}

请确保迁移后的选题与目标账号的定位和风格一致。"""

    user_prompt = f"""{source_info}
{source_account_section}
{target_section}
{target_account_section}

## 迁移要求
请将上述选题迁移适配到目标平台{"和目标账号" if target_account else ""}，输出一个合法的 JSON 对象：

{{
  "title": "适配目标平台规范的新标题",
  "description": "适配后的选题描述（200-300字）",
  "audience": "目标受众",
  "tone": "内容调性",
  "format": "适合目标平台的内容形式",
  "tags": ["标签1", "标签2", "标签3"],
  "content": "适配后的详细内容（如原选题有详细内容则改写适配，否则留空字符串）"
}}

迁移原则：
1. 保留选题的核心创意和价值主张
2. 标题风格适配{target_platform_name}的规范（字数、语气、钩子）
3. 内容形式和调性匹配目标平台特征
4. 标签使用目标平台的热门标签风格
{"5. 整体风格和用语匹配目标账号的定位" if target_account else ""}"""

    system_prompt = (
        "你是自媒体跨平台内容迁移专家。请根据源选题信息，生成适配目标平台的新选题。"
        "你必须直接输出一个合法的 JSON 对象，不要输出 JSON Schema 定义，"
        "不要使用 markdown 代码块包裹，不要输出任何解释文字。"
    )

    try:
        import re
        import json as json_module

        llm_config = LLMConfig.from_dict(model_config)
        service = LLMService(llm_config, timeout=120.0)
        response = await service.chat(user_prompt, system_prompt=system_prompt)

        if not response.success:
            raise HTTPException(status_code=500, detail=f"AI 迁移失败: {response.error}")

        raw_content = response.content or ""
        logger.info(f"AI 迁移原始响应长度: {len(raw_content)}")

        # 清理思考标签
        raw_content = re.sub(
            r'<think(?:ing)?>\s*[\s\S]*?\s*</think(?:ing)?>',
            '', raw_content, flags=re.IGNORECASE
        ).strip()

        # ---- JSON 解析辅助函数 ----
        def _try_parse(text: str):
            """尝试解析 JSON，包含换行修复和逗号修复"""
            # 第一轮：直接解析
            try:
                return json_module.loads(text)
            except json_module.JSONDecodeError:
                pass
            # 第二轮：将裸换行替换为空格（LLM 常在字符串值中输出真实换行）
            fixed = text.replace('\r\n', ' ').replace('\n', ' ').replace('\r', ' ')
            try:
                return json_module.loads(fixed)
            except json_module.JSONDecodeError:
                pass
            # 第三轮：额外修复末尾多余逗号
            fixed2 = re.sub(r',\s*([}\]])', r'\1', fixed)
            try:
                return json_module.loads(fixed2)
            except json_module.JSONDecodeError:
                pass
            return None

        # 解析 JSON（多重降级策略）
        migrated = None

        # 策略1: 直接解析整体
        migrated = _try_parse(raw_content)

        # 策略2: 从 markdown 代码块提取
        if not migrated:
            json_match = re.search(r'```(?:json)?\s*\n?([\s\S]*?)```', raw_content)
            if json_match:
                migrated = _try_parse(json_match.group(1).strip())

        # 策略3: 花括号提取（深度匹配）
        if not migrated:
            brace_start = raw_content.find('{')
            if brace_start >= 0:
                depth = 0
                brace_end = -1
                in_string = False
                escape_next = False
                for i in range(brace_start, len(raw_content)):
                    ch = raw_content[i]
                    if escape_next:
                        escape_next = False
                        continue
                    if ch == '\\':
                        escape_next = True
                        continue
                    if ch == '"' and not escape_next:
                        in_string = not in_string
                        continue
                    if in_string:
                        continue
                    if ch == '{':
                        depth += 1
                    elif ch == '}':
                        depth -= 1
                        if depth == 0:
                            brace_end = i
                            break
                if brace_end > brace_start:
                    migrated = _try_parse(raw_content[brace_start:brace_end + 1])

        if not migrated:
            logger.error(f"AI 迁移 JSON 解析失败，原始内容前500字: {raw_content[:500]}")
            raise HTTPException(
                status_code=500,
                detail="AI 迁移结果解析失败，请重试"
            )

        # 创建新选题
        new_metadata = {
            "audience": migrated.get("audience", metadata.get("audience", "")),
            "tone": migrated.get("tone", metadata.get("tone", "")),
            "format": migrated.get("format", metadata.get("format", "")),
            "tags": migrated.get("tags", metadata.get("tags", [])),
            "migrated_from": topic_id,  # 记录来源
        }

        async with get_session() as session:
            new_topic = await crud.create_topic(
                session,
                topic_id=str(uuid.uuid4()),
                title=migrated.get("title", source_topic["title"]),
                session_id=source_topic.get("session_id"),
                description=migrated.get("description", source_topic.get("description", "")),
                target_platform=target_platform_code,
                content=migrated.get("content", "") or None,
                metadata=new_metadata,
                account_profile_id=data.target_account_profile_id,
            )

        return {"code": 0, "data": new_topic, "message": "迁移成功"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"AI 迁移选题失败: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"迁移失败: {str(e)}")
