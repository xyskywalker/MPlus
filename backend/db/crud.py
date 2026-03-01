"""
MPlus 数据库 CRUD 操作模块
提供基础的增删改查操作
"""

import json
from typing import Optional, List, Dict, Any
from datetime import datetime
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import logging

logger = logging.getLogger(__name__)


# ==================== Settings CRUD ====================

async def get_setting(session: AsyncSession, key: str) -> Optional[Dict[str, Any]]:
    """获取配置项"""
    result = await session.execute(
        text("SELECT value FROM settings WHERE key = :key"),
        {"key": key}
    )
    row = result.fetchone()
    if row and row[0]:
        return json.loads(row[0])
    return None


async def set_setting(session: AsyncSession, key: str, value: Dict[str, Any]):
    """设置配置项"""
    value_json = json.dumps(value, ensure_ascii=False)
    
    # 使用 UPSERT 语法
    await session.execute(
        text("""
            INSERT INTO settings (key, value, updated_at) 
            VALUES (:key, :value, :updated_at)
            ON CONFLICT(key) DO UPDATE SET 
                value = :value,
                updated_at = :updated_at
        """),
        {
            "key": key,
            "value": value_json,
            "updated_at": datetime.now().isoformat()
        }
    )
    await session.commit()


async def delete_setting(session: AsyncSession, key: str) -> bool:
    """删除配置项"""
    result = await session.execute(
        text("DELETE FROM settings WHERE key = :key"),
        {"key": key}
    )
    await session.commit()
    return result.rowcount > 0


async def get_all_settings(session: AsyncSession) -> Dict[str, Any]:
    """获取所有配置"""
    result = await session.execute(text("SELECT key, value FROM settings"))
    settings = {}
    for row in result.fetchall():
        if row[1]:
            settings[row[0]] = json.loads(row[1])
    return settings


# ==================== Model Config CRUD ====================

async def create_model_config(
    session: AsyncSession,
    config_id: str,
    name: str,
    model_type: str,
    base_url: str,
    api_key: str,
    model_name: str,
    is_default: bool = False,
    is_fast_task: bool = False,
) -> Dict[str, Any]:
    """创建模型配置"""
    now = datetime.now().isoformat()
    
    # 如果设为默认，先清除其他默认配置
    if is_default:
        await session.execute(
            text("UPDATE model_configs SET is_default = FALSE WHERE is_default = TRUE")
        )

    # 如果设为快速任务模型，先清除其他快速任务标记
    if is_fast_task:
        await session.execute(
            text("UPDATE model_configs SET is_fast_task = FALSE WHERE is_fast_task = TRUE")
        )
    
    await session.execute(
        text("""
            INSERT INTO model_configs (id, name, model_type, base_url, api_key, model_name, is_default, is_fast_task, created_at, updated_at)
            VALUES (:id, :name, :model_type, :base_url, :api_key, :model_name, :is_default, :is_fast_task, :created_at, :updated_at)
        """),
        {
            "id": config_id,
            "name": name,
            "model_type": model_type,
            "base_url": base_url,
            "api_key": api_key,
            "model_name": model_name,
            "is_default": is_default,
            "is_fast_task": is_fast_task,
            "created_at": now,
            "updated_at": now
        }
    )
    await session.commit()
    
    return {
        "id": config_id,
        "name": name,
        "model_type": model_type,
        "base_url": base_url,
        "model_name": model_name,
        "is_default": is_default,
        "is_fast_task": is_fast_task,
        "created_at": now,
        "updated_at": now
    }


async def get_model_config(session: AsyncSession, config_id: str) -> Optional[Dict[str, Any]]:
    """获取模型配置详情（包含完整 api_key）"""
    result = await session.execute(
        text("SELECT * FROM model_configs WHERE id = :id"),
        {"id": config_id}
    )
    row = result.fetchone()
    if row:
        return dict(row._mapping)
    return None


async def get_all_model_configs(session: AsyncSession) -> List[Dict[str, Any]]:
    """获取所有模型配置（不包含完整 api_key）"""
    result = await session.execute(
        text("SELECT id, name, model_type, base_url, api_key, model_name, is_default, is_fast_task, created_at, updated_at FROM model_configs ORDER BY created_at DESC")
    )
    return [dict(row._mapping) for row in result.fetchall()]


async def get_default_model_config(session: AsyncSession) -> Optional[Dict[str, Any]]:
    """获取默认模型配置"""
    result = await session.execute(
        text("SELECT * FROM model_configs WHERE is_default = TRUE LIMIT 1")
    )
    row = result.fetchone()
    if row:
        return dict(row._mapping)
    return None


async def update_model_config(
    session: AsyncSession,
    config_id: str,
    **kwargs
) -> Optional[Dict[str, Any]]:
    """更新模型配置"""
    # 如果设为默认，先清除其他默认配置
    if kwargs.get("is_default"):
        await session.execute(
            text("UPDATE model_configs SET is_default = FALSE WHERE is_default = TRUE AND id != :id"),
            {"id": config_id}
        )

    # 如果设为快速任务模型，先清除其他快速任务标记
    if kwargs.get("is_fast_task"):
        await session.execute(
            text("UPDATE model_configs SET is_fast_task = FALSE WHERE is_fast_task = TRUE AND id != :id"),
            {"id": config_id}
        )
    
    # 构建更新语句
    update_fields = []
    params = {"id": config_id, "updated_at": datetime.now().isoformat()}
    
    for key in ["name", "model_type", "base_url", "api_key", "model_name", "is_default", "is_fast_task"]:
        if key in kwargs:
            update_fields.append(f"{key} = :{key}")
            params[key] = kwargs[key]
    
    if not update_fields:
        return await get_model_config(session, config_id)
    
    update_fields.append("updated_at = :updated_at")
    
    await session.execute(
        text(f"UPDATE model_configs SET {', '.join(update_fields)} WHERE id = :id"),
        params
    )
    await session.commit()
    
    return await get_model_config(session, config_id)


async def delete_model_config(session: AsyncSession, config_id: str) -> bool:
    """删除模型配置"""
    result = await session.execute(
        text("DELETE FROM model_configs WHERE id = :id"),
        {"id": config_id}
    )
    await session.commit()
    return result.rowcount > 0


async def set_default_model_config(session: AsyncSession, config_id: str) -> bool:
    """设置默认模型配置"""
    # 清除其他默认配置
    await session.execute(
        text("UPDATE model_configs SET is_default = FALSE WHERE is_default = TRUE")
    )
    # 设置新的默认配置
    result = await session.execute(
        text("UPDATE model_configs SET is_default = TRUE, updated_at = :updated_at WHERE id = :id"),
        {"id": config_id, "updated_at": datetime.now().isoformat()}
    )
    await session.commit()
    return result.rowcount > 0


async def get_fast_task_model_config(session: AsyncSession) -> Optional[Dict[str, Any]]:
    """获取快速任务模型配置"""
    result = await session.execute(
        text("SELECT * FROM model_configs WHERE is_fast_task = TRUE LIMIT 1")
    )
    row = result.fetchone()
    if row:
        return dict(row._mapping)
    return None


async def set_fast_task_model_config(session: AsyncSession, config_id: str) -> bool:
    """设置快速任务模型配置"""
    # 清除其他快速任务标记
    await session.execute(
        text("UPDATE model_configs SET is_fast_task = FALSE WHERE is_fast_task = TRUE")
    )
    # 设置新的快速任务模型
    result = await session.execute(
        text("UPDATE model_configs SET is_fast_task = TRUE, updated_at = :updated_at WHERE id = :id"),
        {"id": config_id, "updated_at": datetime.now().isoformat()}
    )
    await session.commit()
    return result.rowcount > 0


# ==================== Session CRUD ====================

async def create_session(
    session: AsyncSession,
    session_id: str,
    title: str = None,
    platform_code: str = None,
    model_config_id: str = None,
    account_profile_id: str = None,
) -> Dict[str, Any]:
    """创建会话（支持关联账号画像）"""
    now = datetime.now().isoformat()
    
    await session.execute(
        text("""
            INSERT INTO sessions (id, title, platform_code, model_config_id, account_profile_id, created_at, updated_at)
            VALUES (:id, :title, :platform_code, :model_config_id, :account_profile_id, :created_at, :updated_at)
        """),
        {
            "id": session_id,
            "title": title or "新会话",
            "platform_code": platform_code,
            "model_config_id": model_config_id,
            "account_profile_id": account_profile_id,
            "created_at": now,
            "updated_at": now
        }
    )
    await session.commit()
    
    # 如果关联了账号，查询账号摘要信息
    account_summary = None
    if account_profile_id:
        account_summary = await _get_account_summary(session, account_profile_id)
    
    return {
        "id": session_id,
        "title": title or "新会话",
        "platform_code": platform_code,
        "model_config_id": model_config_id,
        "account_profile_id": account_profile_id,
        "account_summary": account_summary,
        "created_at": now,
        "updated_at": now
    }


async def _get_account_summary(session: AsyncSession, profile_id: str) -> Optional[Dict[str, Any]]:
    """获取账号摘要信息（用于会话列表展示，避免前端额外请求）"""
    result = await session.execute(
        text("SELECT account_name, main_category, followers_count FROM account_profiles WHERE id = :id"),
        {"id": profile_id}
    )
    row = result.fetchone()
    if row:
        return dict(row._mapping)
    return None


async def get_session_by_id(session: AsyncSession, session_id: str) -> Optional[Dict[str, Any]]:
    """获取会话详情（含关联账号摘要）"""
    result = await session.execute(
        text("SELECT * FROM sessions WHERE id = :id"),
        {"id": session_id}
    )
    row = result.fetchone()
    if row:
        data = dict(row._mapping)
        # 附加账号摘要信息
        account_profile_id = data.get("account_profile_id")
        if account_profile_id:
            data["account_summary"] = await _get_account_summary(session, account_profile_id)
        else:
            data["account_summary"] = None
        return data
    return None


async def list_sessions(
    session: AsyncSession,
    limit: int = 20,
    offset: int = 0
) -> List[Dict[str, Any]]:
    """获取会话列表（含关联账号摘要）"""
    result = await session.execute(
        text("""
            SELECT * FROM sessions 
            ORDER BY updated_at DESC 
            LIMIT :limit OFFSET :offset
        """),
        {"limit": limit, "offset": offset}
    )
    sessions_list = []
    for row in result.fetchall():
        data = dict(row._mapping)
        # 附加账号摘要信息
        account_profile_id = data.get("account_profile_id")
        if account_profile_id:
            data["account_summary"] = await _get_account_summary(session, account_profile_id)
        else:
            data["account_summary"] = None
        sessions_list.append(data)
    return sessions_list


async def update_session(
    session: AsyncSession,
    session_id: str,
    **kwargs
) -> Optional[Dict[str, Any]]:
    """更新会话"""
    update_fields = []
    params = {"id": session_id, "updated_at": datetime.now().isoformat()}
    
    for key in ["title", "platform_code", "model_config_id",
                "account_profile_id",
                "topic_readiness_level", "topic_readiness_summary"]:
        if key in kwargs:
            update_fields.append(f"{key} = :{key}")
            params[key] = kwargs[key]
    
    if not update_fields:
        return await get_session_by_id(session, session_id)
    
    update_fields.append("updated_at = :updated_at")
    
    await session.execute(
        text(f"UPDATE sessions SET {', '.join(update_fields)} WHERE id = :id"),
        params
    )
    await session.commit()
    
    return await get_session_by_id(session, session_id)


async def delete_session(session: AsyncSession, session_id: str) -> bool:
    """删除会话"""
    result = await session.execute(
        text("DELETE FROM sessions WHERE id = :id"),
        {"id": session_id}
    )
    await session.commit()
    return result.rowcount > 0


# ==================== Conversation CRUD ====================

async def create_conversation(
    session: AsyncSession,
    session_id: str,
    role: str,
    content: str,
    metadata: Dict[str, Any] = None,
) -> Dict[str, Any]:
    """创建对话消息"""
    import uuid as _uuid
    conv_id = str(_uuid.uuid4())
    now = datetime.now().isoformat()
    metadata_json = json.dumps(metadata or {}, ensure_ascii=False)

    await session.execute(
        text("""
            INSERT INTO conversations (id, session_id, role, content, metadata, created_at)
            VALUES (:id, :session_id, :role, :content, :metadata, :created_at)
        """),
        {
            "id": conv_id,
            "session_id": session_id,
            "role": role,
            "content": content,
            "metadata": metadata_json,
            "created_at": now,
        }
    )
    await session.commit()

    return {
        "id": conv_id,
        "session_id": session_id,
        "role": role,
        "content": content,
        "metadata": metadata or {},
        "created_at": now,
    }


async def list_conversations(
    session: AsyncSession,
    session_id: str,
    limit: int = 50,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    """获取会话的对话历史（按时间顺序）"""
    result = await session.execute(
        text("""
            SELECT id, session_id, role, content, metadata, created_at
            FROM conversations
            WHERE session_id = :session_id
            ORDER BY created_at ASC
            LIMIT :limit OFFSET :offset
        """),
        {"session_id": session_id, "limit": limit, "offset": offset}
    )

    conversations = []
    for row in result.fetchall():
        data = dict(row._mapping)
        if data.get("metadata"):
            try:
                data["metadata"] = json.loads(data["metadata"])
            except (json.JSONDecodeError, TypeError):
                data["metadata"] = {}
        conversations.append(data)

    return conversations


async def delete_conversations(
    session: AsyncSession,
    session_id: str,
) -> bool:
    """删除会话的所有对话记录"""
    result = await session.execute(
        text("DELETE FROM conversations WHERE session_id = :session_id"),
        {"session_id": session_id}
    )
    await session.commit()
    return result.rowcount > 0


async def get_conversation_count(
    session: AsyncSession,
    session_id: str,
) -> int:
    """获取会话的对话消息数量"""
    result = await session.execute(
        text("SELECT COUNT(*) FROM conversations WHERE session_id = :session_id"),
        {"session_id": session_id}
    )
    row = result.fetchone()
    return row[0] if row else 0


# ==================== Topic CRUD ====================

async def create_topic(
    session: AsyncSession,
    topic_id: str,
    title: str,
    session_id: str = None,
    description: str = None,
    target_platform: str = None,
    content: str = None,
    metadata: Dict[str, Any] = None,
    account_profile_id: str = None,
) -> Dict[str, Any]:
    """创建选题（支持关联账号画像）"""
    now = datetime.now().isoformat()
    metadata_json = json.dumps(metadata or {}, ensure_ascii=False)
    
    await session.execute(
        text("""
            INSERT INTO topics 
            (id, session_id, title, description, target_platform, content, metadata, account_profile_id, created_at, updated_at)
            VALUES (:id, :session_id, :title, :description, :target_platform, :content, :metadata, :account_profile_id, :created_at, :updated_at)
        """),
        {
            "id": topic_id,
            "session_id": session_id,
            "title": title,
            "description": description,
            "target_platform": target_platform,
            "content": content,
            "metadata": metadata_json,
            "account_profile_id": account_profile_id,
            "created_at": now,
            "updated_at": now
        }
    )
    await session.commit()
    
    # 查询账号摘要
    account_summary = None
    if account_profile_id:
        account_summary = await _get_account_summary(session, account_profile_id)
    
    return {
        "id": topic_id,
        "session_id": session_id,
        "title": title,
        "description": description,
        "target_platform": target_platform,
        "content": content,
        "metadata": metadata or {},
        "account_profile_id": account_profile_id,
        "account_summary": account_summary,
        "status": "draft",
        "created_at": now,
        "updated_at": now
    }


async def get_topic(session: AsyncSession, topic_id: str) -> Optional[Dict[str, Any]]:
    """获取选题详情（含关联账号摘要 + 模拟次数）"""
    result = await session.execute(
        text("""
            SELECT t.*,
                   (SELECT COUNT(*) FROM simulations s
                    WHERE s.topic_id = t.id AND s.status = 'completed') AS simulation_count
            FROM topics t WHERE t.id = :id
        """),
        {"id": topic_id}
    )
    row = result.fetchone()
    if row:
        data = dict(row._mapping)
        if data.get("metadata"):
            data["metadata"] = json.loads(data["metadata"])
        account_profile_id = data.get("account_profile_id")
        if account_profile_id:
            data["account_summary"] = await _get_account_summary(session, account_profile_id)
        else:
            data["account_summary"] = None
        return data
    return None


async def list_topics(
    session: AsyncSession,
    session_id: str = None,
    status: str = None,
    platform: str = None,
    limit: int = 20,
    offset: int = 0
) -> List[Dict[str, Any]]:
    """获取选题列表"""
    conditions = []
    params = {"limit": limit, "offset": offset}
    
    if session_id:
        conditions.append("t.session_id = :session_id")
        params["session_id"] = session_id
    if status:
        conditions.append("t.status = :status")
        params["status"] = status
    if platform:
        conditions.append("t.target_platform = :platform")
        params["platform"] = platform
    
    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    
    result = await session.execute(
        text(f"""
            SELECT t.*,
                   (SELECT COUNT(*) FROM simulations s
                    WHERE s.topic_id = t.id AND s.status = 'completed') AS simulation_count
            FROM topics t
            {where_clause}
            ORDER BY t.created_at DESC 
            LIMIT :limit OFFSET :offset
        """),
        params
    )

    topics = []
    for row in result.fetchall():
        data = dict(row._mapping)
        if data.get("metadata"):
            data["metadata"] = json.loads(data["metadata"])
        account_profile_id = data.get("account_profile_id")
        if account_profile_id:
            data["account_summary"] = await _get_account_summary(session, account_profile_id)
        else:
            data["account_summary"] = None
        topics.append(data)

    return topics


async def update_topic(
    session: AsyncSession,
    topic_id: str,
    **kwargs
) -> Optional[Dict[str, Any]]:
    """更新选题"""
    update_fields = []
    params = {"id": topic_id, "updated_at": datetime.now().isoformat()}
    
    for key in ["title", "description", "target_platform", "content", "status", "account_profile_id"]:
        if key in kwargs:
            update_fields.append(f"{key} = :{key}")
            params[key] = kwargs[key]
    
    if "metadata" in kwargs:
        update_fields.append("metadata = :metadata")
        params["metadata"] = json.dumps(kwargs["metadata"], ensure_ascii=False)
    
    if not update_fields:
        return await get_topic(session, topic_id)
    
    update_fields.append("updated_at = :updated_at")
    
    await session.execute(
        text(f"UPDATE topics SET {', '.join(update_fields)} WHERE id = :id"),
        params
    )
    await session.commit()
    
    return await get_topic(session, topic_id)


async def delete_topic(session: AsyncSession, topic_id: str) -> bool:
    """删除选题"""
    result = await session.execute(
        text("DELETE FROM topics WHERE id = :id"),
        {"id": topic_id}
    )
    await session.commit()
    return result.rowcount > 0


# ==================== Simulation CRUD ====================

async def create_simulation(
    session: AsyncSession,
    simulation_id: str,
    topic_id: str,
    platform: str,
    config: Dict[str, Any] = None,
    search_data: Dict[str, Any] = None,
    model_config_id: str = None
) -> Dict[str, Any]:
    """创建模拟任务"""
    now = datetime.now().isoformat()
    
    await session.execute(
        text("""
            INSERT INTO simulations 
            (id, topic_id, platform, model_config_id, config, search_data, status, created_at)
            VALUES (:id, :topic_id, :platform, :model_config_id, :config, :search_data, 'pending', :created_at)
        """),
        {
            "id": simulation_id,
            "topic_id": topic_id,
            "platform": platform,
            "model_config_id": model_config_id,
            "config": json.dumps(config or {}, ensure_ascii=False),
            "search_data": json.dumps(search_data or {}, ensure_ascii=False),
            "created_at": now
        }
    )
    await session.commit()
    
    return {
        "id": simulation_id,
        "topic_id": topic_id,
        "platform": platform,
        "model_config_id": model_config_id,
        "config": config or {},
        "search_data": search_data or {},
        "status": "pending",
        "created_at": now
    }


async def get_simulation(session: AsyncSession, simulation_id: str) -> Optional[Dict[str, Any]]:
    """获取模拟任务详情"""
    result = await session.execute(
        text("SELECT * FROM simulations WHERE id = :id"),
        {"id": simulation_id}
    )
    row = result.fetchone()
    if row:
        data = dict(row._mapping)
        for key in ["config", "search_data", "results"]:
            if data.get(key):
                data[key] = json.loads(data[key])
        return data
    return None


async def update_simulation(
    session: AsyncSession,
    simulation_id: str,
    status: str = None,
    results: Dict[str, Any] = None,
    error_message: str = None
) -> Optional[Dict[str, Any]]:
    """更新模拟任务"""
    update_fields = []
    params = {"id": simulation_id}
    
    if status:
        update_fields.append("status = :status")
        params["status"] = status
        if status == "completed":
            update_fields.append("completed_at = :completed_at")
            params["completed_at"] = datetime.now().isoformat()
        elif status == "cancelled":
            update_fields.append("cancelled_at = :cancelled_at")
            params["cancelled_at"] = datetime.now().isoformat()
    
    if results is not None:
        update_fields.append("results = :results")
        params["results"] = json.dumps(results, ensure_ascii=False)
    
    if error_message is not None:
        update_fields.append("error_message = :error_message")
        params["error_message"] = error_message
    
    if not update_fields:
        return await get_simulation(session, simulation_id)
    
    await session.execute(
        text(f"UPDATE simulations SET {', '.join(update_fields)} WHERE id = :id"),
        params
    )
    await session.commit()
    
    return await get_simulation(session, simulation_id)


async def get_running_simulation(session: AsyncSession) -> Optional[Dict[str, Any]]:
    """获取正在运行的模拟任务（同一时刻只允许一个）"""
    result = await session.execute(
        text("SELECT * FROM simulations WHERE status = 'running' ORDER BY created_at DESC LIMIT 1")
    )
    row = result.fetchone()
    if row:
        data = dict(row._mapping)
        for key in ["config", "search_data", "results"]:
            if data.get(key):
                data[key] = json.loads(data[key])
        return data
    return None


async def list_simulations_by_topic(
    session: AsyncSession,
    topic_id: str,
    limit: int = 10,
    include_results: bool = True,
) -> List[Dict[str, Any]]:
    """获取选题的模拟历史
    include_results=False 时不返回 results 字段，用于轻量列表查询
    通过 LEFT JOIN model_configs 表附带模型名称
    """
    if include_results:
        cols = "s.*, mc.name AS model_config_name, mc.model_name AS model_model_name"
        json_keys = ["config", "search_data", "results"]
    else:
        cols = ("s.id, s.topic_id, s.platform, s.model_config_id, s.config, s.search_data, "
                "s.status, s.error_message, s.created_at, s.completed_at, s.cancelled_at, "
                "mc.name AS model_config_name, mc.model_name AS model_model_name")
        json_keys = ["config", "search_data"]

    result = await session.execute(
        text(f"""
            SELECT {cols} FROM simulations s
            LEFT JOIN model_configs mc ON s.model_config_id = mc.id
            WHERE s.topic_id = :topic_id
            ORDER BY s.created_at DESC 
            LIMIT :limit
        """),
        {"topic_id": topic_id, "limit": limit}
    )

    simulations = []
    for row in result.fetchall():
        data = dict(row._mapping)
        for key in json_keys:
            if data.get(key):
                data[key] = json.loads(data[key])
        # 合成可读的模型显示名称
        config_name = data.pop("model_config_name", None)
        model_name = data.pop("model_model_name", None)
        if config_name:
            data["model_display_name"] = f"{config_name}" if not model_name else f"{config_name}({model_name})"
        else:
            data["model_display_name"] = None
        simulations.append(data)

    return simulations


async def delete_simulation(session: AsyncSession, simulation_id: str) -> bool:
    """删除模拟记录"""
    result = await session.execute(
        text("DELETE FROM simulations WHERE id = :id"),
        {"id": simulation_id}
    )
    await session.commit()
    return result.rowcount > 0


# ==================== 账号配置 CRUD ====================

def _deserialize_account(data: Dict[str, Any]) -> Dict[str, Any]:
    """反序列化账号数据中的 JSON 字段"""
    for key in ("sub_categories", "extra_metrics"):
        if data.get(key) and isinstance(data[key], str):
            try:
                data[key] = json.loads(data[key])
            except (json.JSONDecodeError, TypeError):
                pass
    # tags 在 post_performances 中
    return data


def _deserialize_post(data: Dict[str, Any]) -> Dict[str, Any]:
    """反序列化历史内容数据中的 JSON 字段，并计算 engagement_rate"""
    for key in ("tags", "extra_metrics"):
        if data.get(key) and isinstance(data[key], str):
            try:
                data[key] = json.loads(data[key])
            except (json.JSONDecodeError, TypeError):
                pass
    # 动态计算 engagement_rate
    views = data.get("views", 0) or 0
    if views > 0:
        interactions = (data.get("likes", 0) or 0) + (data.get("comments", 0) or 0) + \
                       (data.get("favorites", 0) or 0) + (data.get("shares", 0) or 0)
        data["engagement_rate"] = round(interactions / views * 100, 2)
    else:
        data["engagement_rate"] = 0
    return data


async def create_account_profile(
    session: AsyncSession,
    profile_id: str,
    platform_code: str,
    account_name: str,
    main_category: str,
    **kwargs
) -> Dict[str, Any]:
    """创建账号配置"""
    now = datetime.now().isoformat()
    
    sub_categories = kwargs.get("sub_categories")
    if isinstance(sub_categories, list):
        sub_categories = json.dumps(sub_categories, ensure_ascii=False)
    
    extra_metrics = kwargs.get("extra_metrics")
    if isinstance(extra_metrics, dict):
        extra_metrics = json.dumps(extra_metrics, ensure_ascii=False)
    
    await session.execute(
        text("""
            INSERT INTO account_profiles 
            (id, platform_code, account_name, account_id, bio, main_category, 
             sub_categories, content_style, target_audience,
             followers_count, posts_count,
             verification_status, started_at, stats_updated_at, extra_metrics,
             created_at, updated_at)
            VALUES (:id, :platform_code, :account_name, :account_id, :bio, 
                    :main_category, :sub_categories, :content_style, :target_audience,
                    :followers_count, :posts_count,
                    :verification_status, :started_at, :stats_updated_at, :extra_metrics,
                    :created_at, :updated_at)
        """),
        {
            "id": profile_id,
            "platform_code": platform_code,
            "account_name": account_name,
            "account_id": kwargs.get("account_id"),
            "bio": kwargs.get("bio"),
            "main_category": main_category,
            "sub_categories": sub_categories,
            "content_style": kwargs.get("content_style"),
            "target_audience": kwargs.get("target_audience"),
            "followers_count": kwargs.get("followers_count", 0),
            "posts_count": kwargs.get("posts_count", 0),
            "verification_status": kwargs.get("verification_status", "none"),
            "started_at": kwargs.get("started_at"),
            "stats_updated_at": now,
            "extra_metrics": extra_metrics,
            "created_at": now,
            "updated_at": now
        }
    )
    await session.commit()
    
    return await get_account_profile(session, profile_id)


async def get_account_profile(session: AsyncSession, profile_id: str) -> Optional[Dict[str, Any]]:
    """获取账号配置详情（含历史内容）"""
    result = await session.execute(
        text("SELECT * FROM account_profiles WHERE id = :id"),
        {"id": profile_id}
    )
    row = result.fetchone()
    if not row:
        return None
    
    data = _deserialize_account(dict(row._mapping))
    # 关联查询历史内容
    data["post_performances"] = await list_post_performances(session, profile_id)
    return data


async def list_account_profiles(
    session: AsyncSession,
    platform_code: str = None
) -> List[Dict[str, Any]]:
    """获取账号配置列表（含历史内容）"""
    if platform_code:
        result = await session.execute(
            text("SELECT * FROM account_profiles WHERE platform_code = :platform ORDER BY created_at DESC"),
            {"platform": platform_code}
        )
    else:
        result = await session.execute(
            text("SELECT * FROM account_profiles ORDER BY created_at DESC")
        )
    
    profiles = []
    for row in result.fetchall():
        data = _deserialize_account(dict(row._mapping))
        # 关联查询历史内容
        data["post_performances"] = await list_post_performances(session, data["id"])
        profiles.append(data)
    
    return profiles


async def update_account_profile(
    session: AsyncSession,
    profile_id: str,
    **kwargs
) -> Optional[Dict[str, Any]]:
    """更新账号配置"""
    # 构建动态更新语句
    update_fields = []
    params = {"id": profile_id}
    
    field_mapping = {
        "account_name": "account_name",
        "account_id": "account_id",
        "bio": "bio",
        "main_category": "main_category",
        "content_style": "content_style",
        "target_audience": "target_audience",
        "followers_count": "followers_count",
        "posts_count": "posts_count",
        "verification_status": "verification_status",
        "started_at": "started_at",
    }
    
    for key, col in field_mapping.items():
        if key in kwargs:
            update_fields.append(f"{col} = :{key}")
            params[key] = kwargs[key]
    
    # JSON 字段特殊处理
    if "sub_categories" in kwargs:
        val = kwargs["sub_categories"]
        if isinstance(val, list):
            val = json.dumps(val, ensure_ascii=False)
        update_fields.append("sub_categories = :sub_categories")
        params["sub_categories"] = val
    
    if "extra_metrics" in kwargs:
        val = kwargs["extra_metrics"]
        if isinstance(val, dict):
            val = json.dumps(val, ensure_ascii=False)
        update_fields.append("extra_metrics = :extra_metrics")
        params["extra_metrics"] = val
    
    if not update_fields:
        return await get_account_profile(session, profile_id)
    
    # 自动更新时间戳
    now = datetime.now().isoformat()
    update_fields.append("updated_at = :updated_at")
    params["updated_at"] = now
    update_fields.append("stats_updated_at = :stats_updated_at")
    params["stats_updated_at"] = now
    
    sql = f"UPDATE account_profiles SET {', '.join(update_fields)} WHERE id = :id"
    result = await session.execute(text(sql), params)
    await session.commit()
    
    if result.rowcount == 0:
        return None
    
    return await get_account_profile(session, profile_id)


async def delete_account_profile(session: AsyncSession, profile_id: str) -> bool:
    """删除账号配置（级联删除历史内容）"""
    result = await session.execute(
        text("DELETE FROM account_profiles WHERE id = :id"),
        {"id": profile_id}
    )
    await session.commit()
    return result.rowcount > 0


# ==================== 历史内容 CRUD ====================

async def create_post_performance(
    session: AsyncSession,
    post_id: str,
    account_profile_id: str,
    title: str,
    **kwargs
) -> Dict[str, Any]:
    """创建历史内容记录"""
    now = datetime.now().isoformat()
    
    tags = kwargs.get("tags")
    if isinstance(tags, list):
        tags = json.dumps(tags, ensure_ascii=False)
    
    extra_metrics = kwargs.get("extra_metrics")
    if isinstance(extra_metrics, dict):
        extra_metrics = json.dumps(extra_metrics, ensure_ascii=False)
    
    await session.execute(
        text("""
            INSERT INTO post_performances
            (id, account_profile_id, title, content, post_type, tags, is_top, post_url,
             publish_time, metrics_captured_at,
             views, likes, comments, favorites, shares,
             extra_metrics, created_at)
            VALUES (:id, :account_profile_id, :title, :content, :post_type, :tags, :is_top, :post_url,
                    :publish_time, :metrics_captured_at,
                    :views, :likes, :comments, :favorites, :shares,
                    :extra_metrics, :created_at)
        """),
        {
            "id": post_id,
            "account_profile_id": account_profile_id,
            "title": title,
            "content": kwargs.get("content"),
            "post_type": kwargs.get("post_type", "图文"),
            "tags": tags,
            "is_top": 1 if kwargs.get("is_top") else 0,
            "post_url": kwargs.get("post_url"),
            "publish_time": kwargs.get("publish_time"),
            "metrics_captured_at": kwargs.get("metrics_captured_at") or now,
            "views": kwargs.get("views", 0),
            "likes": kwargs.get("likes", 0),
            "comments": kwargs.get("comments", 0),
            "favorites": kwargs.get("favorites", 0),
            "shares": kwargs.get("shares", 0),
            "extra_metrics": extra_metrics,
            "created_at": now,
        }
    )
    await session.commit()
    
    return await get_post_performance(session, post_id)


async def get_post_performance(session: AsyncSession, post_id: str) -> Optional[Dict[str, Any]]:
    """获取单条历史内容详情"""
    result = await session.execute(
        text("SELECT * FROM post_performances WHERE id = :id"),
        {"id": post_id}
    )
    row = result.fetchone()
    if row:
        return _deserialize_post(dict(row._mapping))
    return None


async def list_post_performances(
    session: AsyncSession,
    account_profile_id: str
) -> List[Dict[str, Any]]:
    """获取指定账号的所有历史内容"""
    result = await session.execute(
        text("""
            SELECT * FROM post_performances 
            WHERE account_profile_id = :account_id 
            ORDER BY is_top DESC, publish_time DESC, created_at DESC
        """),
        {"account_id": account_profile_id}
    )
    
    posts = []
    for row in result.fetchall():
        posts.append(_deserialize_post(dict(row._mapping)))
    return posts


async def update_post_performance(
    session: AsyncSession,
    post_id: str,
    **kwargs
) -> Optional[Dict[str, Any]]:
    """更新历史内容记录"""
    update_fields = []
    params = {"id": post_id}
    
    simple_fields = ["title", "content", "post_type", "is_top", "post_url", 
                     "publish_time", "metrics_captured_at",
                     "views", "likes", "comments", "favorites", "shares"]
    
    for key in simple_fields:
        if key in kwargs:
            val = kwargs[key]
            if key == "is_top":
                val = 1 if val else 0
            update_fields.append(f"{key} = :{key}")
            params[key] = val
    
    # JSON 字段
    if "tags" in kwargs:
        val = kwargs["tags"]
        if isinstance(val, list):
            val = json.dumps(val, ensure_ascii=False)
        update_fields.append("tags = :tags")
        params["tags"] = val
    
    if "extra_metrics" in kwargs:
        val = kwargs["extra_metrics"]
        if isinstance(val, dict):
            val = json.dumps(val, ensure_ascii=False)
        update_fields.append("extra_metrics = :extra_metrics")
        params["extra_metrics"] = val
    
    if not update_fields:
        return await get_post_performance(session, post_id)
    
    sql = f"UPDATE post_performances SET {', '.join(update_fields)} WHERE id = :id"
    result = await session.execute(text(sql), params)
    await session.commit()
    
    if result.rowcount == 0:
        return None
    
    return await get_post_performance(session, post_id)


async def delete_post_performance(session: AsyncSession, post_id: str) -> bool:
    """删除历史内容记录"""
    result = await session.execute(
        text("DELETE FROM post_performances WHERE id = :id"),
        {"id": post_id}
    )
    await session.commit()
    return result.rowcount > 0
