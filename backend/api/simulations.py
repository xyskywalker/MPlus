"""
模拟管理 API 路由
提供模拟任务的启动、进度查询、取消、历史查询和文件下载
核心约束：同一时刻只允许一个模拟任务运行
模拟以后台服务方式运行，关闭浏览器不会终止
"""

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any
import uuid

from ..db.database import get_session
from ..db import crud
from ..services.simulation_service import get_simulation_service
from ..services.ripple_adapter import RippleAdapter

router = APIRouter()


class SimulationCreate(BaseModel):
    """创建模拟任务请求"""
    topic_id: str
    platform: str
    model_config_id: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


# ==================== 启动模拟 ====================

@router.post("/simulations")
async def create_simulation_api(data: SimulationCreate):
    """
    启动新的模拟任务
    同一时刻只允许一个模拟运行，已有运行中模拟时会拒绝
    """
    simulation_service = get_simulation_service()

    # 检查是否已有模拟在运行
    if simulation_service.is_running:
        progress = simulation_service.get_progress()
        raise HTTPException(
            status_code=409,
            detail={
                "message": "已有模拟任务正在运行，请等待完成或取消后再开始新的模拟",
                "running_simulation_id": simulation_service.current_simulation_id,
                "progress": progress,
            }
        )

    simulation_id = str(uuid.uuid4())

    try:
        result = await simulation_service.start_simulation(
            simulation_id=simulation_id,
            topic_id=data.topic_id,
            platform=data.platform,
            config=data.config or {"user_count": 500, "duration_hours": 48},
            model_config_id=data.model_config_id,
        )

        return {
            "code": 0,
            "data": result,
            "message": "模拟任务已启动"
        }
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"启动模拟失败: {str(e)}")


# ==================== 获取运行中的模拟状态 ====================

@router.get("/simulations/running")
async def get_running_simulation():
    """
    获取当前运行中的模拟状态和进度
    前端轮询此接口获取实时进度
    无运行中模拟时返回 null
    """
    simulation_service = get_simulation_service()

    if simulation_service.is_running:
        progress = simulation_service.get_progress()
        return {
            "code": 0,
            "data": progress,
            "message": "success"
        }

    # 检查是否有刚完成/取消的模拟（进度信息还在内存中）
    progress = simulation_service.get_progress()
    if progress and progress.get("status") in ("completed", "cancelled", "failed"):
        return {
            "code": 0,
            "data": progress,
            "message": "success"
        }

    return {
        "code": 0,
        "data": None,
        "message": "当前没有运行中的模拟"
    }


# ==================== 取消模拟 ====================

@router.post("/simulations/{simulation_id}/cancel")
async def cancel_simulation_api(simulation_id: str):
    """取消正在运行的模拟任务"""
    simulation_service = get_simulation_service()

    if not simulation_service.is_running:
        raise HTTPException(status_code=404, detail="当前没有运行中的模拟任务")

    if simulation_service.current_simulation_id != simulation_id:
        raise HTTPException(status_code=400, detail="指定的模拟 ID 与当前运行的模拟不匹配")

    success = await simulation_service.cancel_simulation(simulation_id)

    if success:
        return {
            "code": 0,
            "data": {"simulation_id": simulation_id, "status": "cancelled"},
            "message": "模拟已取消"
        }
    else:
        raise HTTPException(status_code=500, detail="取消模拟失败")


# ==================== 获取模拟详情 ====================

@router.get("/simulations/{simulation_id}")
async def get_simulation_api(simulation_id: str):
    """获取模拟结果详情"""
    # 如果是当前运行中的模拟，返回实时进度
    simulation_service = get_simulation_service()
    if simulation_service.current_simulation_id == simulation_id:
        progress = simulation_service.get_progress()
        if progress:
            # 同时获取数据库中的信息
            async with get_session() as session:
                simulation = await crud.get_simulation(session, simulation_id)
            if simulation:
                simulation["progress_detail"] = progress
            return {"code": 0, "data": simulation or progress, "message": "success"}

    async with get_session() as session:
        simulation = await crud.get_simulation(session, simulation_id)

    if simulation:
        return {"code": 0, "data": simulation, "message": "success"}

    raise HTTPException(status_code=404, detail="模拟任务不存在")


# ==================== 获取选题的模拟历史 ====================

@router.get("/topics/{topic_id}/simulations")
async def list_topic_simulations(
    topic_id: str,
    limit: int = 10,
    include_results: bool = False,
):
    """获取选题的模拟历史
    include_results=False（默认）返回轻量摘要，用于列表展示
    include_results=True 返回含完整结果的详情
    """
    async with get_session() as session:
        simulations = await crud.list_simulations_by_topic(
            session, topic_id, limit=limit, include_results=include_results
        )

    return {
        "code": 0,
        "data": {
            "items": simulations,
            "total": len(simulations)
        },
        "message": "success"
    }


# ==================== 删除模拟记录 ====================

@router.delete("/simulations/{simulation_id}")
async def delete_simulation_api(simulation_id: str):
    """删除模拟记录（不可删除正在运行的模拟）"""
    simulation_service = get_simulation_service()
    if simulation_service.is_running and simulation_service.current_simulation_id == simulation_id:
        raise HTTPException(status_code=409, detail="无法删除正在运行的模拟任务")

    async with get_session() as session:
        deleted = await crud.delete_simulation(session, simulation_id)

    if not deleted:
        raise HTTPException(status_code=404, detail="模拟记录不存在")

    return {"code": 0, "data": None, "message": "删除成功"}


# ==================== 获取模拟进度（兼容旧接口） ====================

@router.get("/simulations/{simulation_id}/progress")
async def get_simulation_progress(simulation_id: str):
    """获取模拟进度详情"""
    simulation_service = get_simulation_service()

    # 如果是当前模拟，返回实时进度
    if simulation_service.current_simulation_id == simulation_id:
        progress = simulation_service.get_progress()
        if progress:
            return {"code": 0, "data": progress, "message": "success"}

    # 查询数据库中的状态
    async with get_session() as session:
        simulation = await crud.get_simulation(session, simulation_id)

    if not simulation:
        raise HTTPException(status_code=404, detail="模拟任务不存在")

    # 已完成的模拟返回完成状态
    return {
        "code": 0,
        "data": {
            "simulation_id": simulation_id,
            "status": simulation.get("status", "unknown"),
            "progress": 100 if simulation.get("status") == "completed" else 0,
            "current_stage": {
                "index": 8 if simulation.get("status") == "completed" else 0,
                "name": "模拟完成" if simulation.get("status") == "completed" else "未知",
                "description": "",
            },
        },
        "message": "success"
    }


# ==================== 文件下载 ====================

@router.get("/simulations/{simulation_id}/files")
async def list_simulation_files(simulation_id: str):
    """获取模拟产生的可下载文件列表"""
    async with get_session() as session:
        simulation = await crud.get_simulation(session, simulation_id)
    if not simulation:
        raise HTTPException(status_code=404, detail="模拟任务不存在")

    files = RippleAdapter.list_simulation_files(simulation_id)
    return {
        "code": 0,
        "data": {"items": files, "total": len(files)},
        "message": "success",
    }


@router.get("/simulations/{simulation_id}/download/{file_type}")
async def download_simulation_file(simulation_id: str, file_type: str):
    """下载模拟文件

    file_type: json / md / report
    """
    async with get_session() as session:
        simulation = await crud.get_simulation(session, simulation_id)
    if not simulation:
        raise HTTPException(status_code=404, detail="模拟任务不存在")

    files = RippleAdapter.list_simulation_files(simulation_id)
    target = None
    for f in files:
        if f["type"] == file_type:
            target = f
            break

    if not target:
        raise HTTPException(status_code=404, detail=f"未找到类型为 {file_type} 的文件")

    file_path = Path(target["path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")

    media_type = "application/json" if file_type == "json" else "text/markdown"
    return FileResponse(
        path=str(file_path),
        filename=target["name"],
        media_type=media_type,
    )
