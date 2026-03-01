"""
会话管理 API 路由
提供会话的增删改查功能
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid

from ..db.database import get_session
from ..db import crud

router = APIRouter()


class SessionCreate(BaseModel):
    """创建会话请求（支持关联账号画像）"""
    title: Optional[str] = None
    platform_code: Optional[str] = None
    model_config_id: Optional[str] = None
    account_profile_id: Optional[str] = None  # 关联的账号画像 ID（可选）


class SessionUpdate(BaseModel):
    """更新会话请求"""
    title: Optional[str] = None
    platform_code: Optional[str] = None
    model_config_id: Optional[str] = None
    account_profile_id: Optional[str] = None


@router.get("/sessions")
async def list_sessions(limit: int = 20, offset: int = 0):
    """获取会话列表"""
    async with get_session() as session:
        db_sessions = await crud.list_sessions(session, limit=limit, offset=offset)

    return {
        "code": 0,
        "data": {
            "items": db_sessions,
            "total": len(db_sessions)
        },
        "message": "success"
    }


@router.post("/sessions")
async def create_session_api(data: SessionCreate):
    """创建新会话"""
    async with get_session() as session:
        new_session = await crud.create_session(
            session,
            session_id=str(uuid.uuid4()),
            title=data.title,
            platform_code=data.platform_code,
            model_config_id=data.model_config_id,
            account_profile_id=data.account_profile_id,
        )

    return {"code": 0, "data": new_session, "message": "创建成功"}


@router.get("/sessions/{session_id}")
async def get_session_api(session_id: str):
    """获取会话详情"""
    async with get_session() as session:
        db_session = await crud.get_session_by_id(session, session_id)

    if db_session:
        return {"code": 0, "data": db_session, "message": "success"}

    raise HTTPException(status_code=404, detail="会话不存在")


@router.put("/sessions/{session_id}")
async def update_session_api(session_id: str, data: SessionUpdate):
    """更新会话"""
    update_data = data.model_dump(exclude_none=True)

    async with get_session() as session:
        updated = await crud.update_session(session, session_id, **update_data)

    if updated:
        return {"code": 0, "data": updated, "message": "更新成功"}

    raise HTTPException(status_code=404, detail="会话不存在")


@router.delete("/sessions/{session_id}")
async def delete_session_api(session_id: str):
    """删除会话"""
    async with get_session() as session:
        success = await crud.delete_session(session, session_id)

    if success:
        return {"code": 0, "message": "删除成功"}

    raise HTTPException(status_code=404, detail="会话不存在")
