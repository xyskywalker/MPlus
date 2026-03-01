"""
MPlus FastAPI 应用入口
提供 REST API 和 WebSocket 服务
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import logging
from pathlib import Path
import uuid

from .config import settings
from .exceptions import MplusException
from .db.database import init_db, get_session

# 配置日志
logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    # 启动时执行
    logger.info("MPlus 服务启动中...")
    await init_db()
    logger.info("数据库初始化完成")

    # 预加载平台画像
    try:
        from .services.platform_loader import PlatformProfileLoader
        PlatformProfileLoader.preload_all()
    except Exception as e:
        logger.warning(f"平台画像预加载失败（不影响启动）: {e}")

    yield

    # 关闭时执行
    logger.info("MPlus 服务关闭")


# 创建 FastAPI 应用
app = FastAPI(
    title="MPlus API",
    description="AI驱动的自媒体选题和模拟预测智能体",
    version="0.1.0",
    lifespan=lifespan
)

# CORS 配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境应限制
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 全局异常处理
@app.exception_handler(MplusException)
async def mplus_exception_handler(request: Request, exc: MplusException):
    """处理 MPlus 自定义异常"""
    return JSONResponse(
        status_code=exc.code,
        content={
            "code": exc.code,
            "error": exc.__class__.__name__,
            "message": exc.message
        }
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """处理未知异常"""
    logger.exception(f"未处理异常: {exc}")
    return JSONResponse(
        status_code=500,
        content={
            "code": 500,
            "error": "InternalError",
            "message": "服务器内部错误，请稍后重试"
        }
    )


# ==================== 健康检查 ====================

@app.get("/api/health")
async def health_check():
    """健康检查端点"""
    return {
        "code": 0,
        "data": {
            "status": "healthy",
            "version": "1.0.0"
        },
        "message": "success"
    }


# ==================== 应用选项配置 ====================

@app.get("/api/app-options")
async def get_app_options():
    """获取应用选项配置（从 YAML 配置文件动态加载）"""
    from .services.options_service import get_app_options as load_options
    
    options = load_options()
    return {
        "code": 0,
        "data": options,
        "message": "success"
    }


# ==================== 系统状态 ====================

@app.get("/api/settings/status")
async def get_settings_status():
    """获取配置状态（检查模型是否配置）"""
    from .db.crud import (
        get_all_model_configs, get_default_model_config,
        get_fast_task_model_config, get_setting,
    )
    
    async with get_session() as session:
        # 获取模型配置
        model_configs = await get_all_model_configs(session)
        default_config = await get_default_model_config(session)
        fast_task_config = await get_fast_task_model_config(session)
        
        # 获取联网搜索配置
        anspire_config = await get_setting(session, "anspire_api_key")
        
        return {
            "code": 0,
            "data": {
                "model_configured": len(model_configs) > 0,
                "model_count": len(model_configs),
                "default_model": default_config.get("name") if default_config else None,
                "default_model_name": default_config.get("model_name") if default_config else None,
                "fast_task_model": fast_task_config.get("name") if fast_task_config else None,
                "fast_task_model_name": fast_task_config.get("model_name") if fast_task_config else None,
                "search_configured": bool(anspire_config and anspire_config.get("key"))
            },
            "message": "success"
        }


# ==================== 模型配置 API (真实功能) ====================

class ModelConfigCreate(BaseModel):
    """创建模型配置请求"""
    name: str = Field(..., min_length=1, max_length=100)
    model_type: str = Field(..., pattern="^(openai|claude|azure-openai)$")
    base_url: str = Field(..., min_length=1)
    api_key: str = Field(..., min_length=1)
    model_name: str = Field(..., min_length=1)
    is_default: bool = False
    is_fast_task: bool = False


class ModelConfigUpdate(BaseModel):
    """更新模型配置请求"""
    name: Optional[str] = None
    model_type: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None
    is_default: Optional[bool] = None
    is_fast_task: Optional[bool] = None


@app.get("/api/model-configs")
async def list_model_configs():
    """获取所有模型配置"""
    from .db.crud import get_all_model_configs
    
    async with get_session() as session:
        configs = await get_all_model_configs(session)
        # 隐藏完整的 API Key
        for config in configs:
            if "api_key" in config and config["api_key"]:
                key = config["api_key"]
                config["api_key_masked"] = f"{key[:8]}...{key[-4:]}" if len(key) > 12 else "****"
                del config["api_key"]
        
        return {"code": 0, "data": configs, "message": "success"}


@app.post("/api/model-configs")
async def create_model_config_api(data: ModelConfigCreate):
    """创建模型配置"""
    from .db.crud import create_model_config
    
    async with get_session() as session:
        config = await create_model_config(
            session,
            config_id=str(uuid.uuid4()),
            name=data.name,
            model_type=data.model_type,
            base_url=data.base_url,
            api_key=data.api_key,
            model_name=data.model_name,
            is_default=data.is_default,
            is_fast_task=data.is_fast_task,
        )
        return {"code": 0, "data": config, "message": "创建成功"}


@app.get("/api/model-configs/{config_id}")
async def get_model_config_api(config_id: str):
    """获取模型配置详情"""
    from .db.crud import get_model_config
    
    async with get_session() as session:
        config = await get_model_config(session, config_id)
        if not config:
            raise HTTPException(status_code=404, detail="配置不存在")
        
        # 隐藏完整 API Key
        if config.get("api_key"):
            key = config["api_key"]
            config["api_key_masked"] = f"{key[:8]}...{key[-4:]}" if len(key) > 12 else "****"
            del config["api_key"]
        
        return {"code": 0, "data": config, "message": "success"}


@app.put("/api/model-configs/{config_id}")
async def update_model_config_api(config_id: str, data: ModelConfigUpdate):
    """更新模型配置"""
    from .db.crud import update_model_config, get_model_config
    
    async with get_session() as session:
        # 检查配置是否存在
        existing = await get_model_config(session, config_id)
        if not existing:
            raise HTTPException(status_code=404, detail="配置不存在")
        
        update_data = data.model_dump(exclude_none=True)
        config = await update_model_config(session, config_id, **update_data)
        
        # 隐藏 API Key
        if config and config.get("api_key"):
            key = config["api_key"]
            config["api_key_masked"] = f"{key[:8]}...{key[-4:]}" if len(key) > 12 else "****"
            del config["api_key"]
        
        return {"code": 0, "data": config, "message": "更新成功"}


@app.delete("/api/model-configs/{config_id}")
async def delete_model_config_api(config_id: str):
    """删除模型配置"""
    from .db.crud import delete_model_config
    
    async with get_session() as session:
        success = await delete_model_config(session, config_id)
        if not success:
            raise HTTPException(status_code=404, detail="配置不存在")
        return {"code": 0, "message": "删除成功"}


@app.put("/api/model-configs/{config_id}/default")
async def set_default_model_config_api(config_id: str):
    """设为默认模型配置"""
    from .db.crud import set_default_model_config
    
    async with get_session() as session:
        success = await set_default_model_config(session, config_id)
        if not success:
            raise HTTPException(status_code=404, detail="配置不存在")
        return {"code": 0, "message": "设置成功"}


@app.put("/api/model-configs/{config_id}/fast-task")
async def set_fast_task_model_config_api(config_id: str):
    """设为快速任务模型配置"""
    from .db.crud import set_fast_task_model_config
    
    async with get_session() as session:
        success = await set_fast_task_model_config(session, config_id)
        if not success:
            raise HTTPException(status_code=404, detail="配置不存在")
        return {"code": 0, "message": "设置成功"}


@app.post("/api/model-configs/{config_id}/test")
async def test_model_config_api(config_id: str):
    """测试模型配置连接"""
    from .db.crud import get_model_config
    from .services.llm_service import test_llm_connection
    
    async with get_session() as session:
        config = await get_model_config(session, config_id)
        if not config:
            raise HTTPException(status_code=404, detail="配置不存在")
        
        # 使用统一的 LLM 服务进行测试
        result = await test_llm_connection(config, timeout=30.0)
        
        if result.success:
            return {
                "code": 0,
                "data": {"status": "success", "message": "连接测试成功"},
                "message": "测试成功"
            }
        else:
            return {
                "code": 1,
                "data": {"status": "failed", "message": result.error},
                "message": "测试失败"
            }


# ==================== 联网搜索配置 API ====================

class SearchConfigUpdate(BaseModel):
    """更新联网搜索配置请求"""
    api_key: str = Field(..., min_length=1, description="Anspire Open API Key")


@app.get("/api/search-config")
async def get_search_config():
    """获取联网搜索配置（API Key 脱敏显示）"""
    from .db.crud import get_setting
    
    async with get_session() as session:
        config = await get_setting(session, "anspire_api_key")
        
        if config and config.get("key"):
            key = config["key"]
            # 脱敏处理：仅显示前8位和后4位
            masked_key = f"{key[:8]}...{key[-4:]}" if len(key) > 12 else "****"
            return {
                "code": 0,
                "data": {
                    "configured": True,
                    "api_key_masked": masked_key
                },
                "message": "success"
            }
        else:
            return {
                "code": 0,
                "data": {
                    "configured": False,
                    "api_key_masked": None
                },
                "message": "success"
            }


@app.put("/api/search-config")
async def update_search_config(data: SearchConfigUpdate):
    """保存/更新联网搜索配置"""
    from .db.crud import set_setting
    
    async with get_session() as session:
        await set_setting(session, "anspire_api_key", {"key": data.api_key})
        
        return {
            "code": 0,
            "data": {"configured": True},
            "message": "保存成功"
        }


class SearchConfigTest(BaseModel):
    """测试联网搜索配置请求（api_key 可选，不传则测试已保存的 key）"""
    api_key: Optional[str] = None


@app.post("/api/search-config/test")
async def test_search_config(data: SearchConfigTest = SearchConfigTest()):
    """
    测试联网搜索 API Key 连通性
    如果传入 api_key 则测试传入的 key，否则测试数据库中已保存的 key
    """
    from .services.web_search_service import test_api_key
    from .db.crud import get_setting
    
    api_key = None
    
    if data.api_key:
        # 使用传入的 API Key 测试
        api_key = data.api_key
    else:
        # 使用数据库中保存的 API Key 测试
        async with get_session() as session:
            config = await get_setting(session, "anspire_api_key")
            if config and config.get("key"):
                api_key = config["key"]
    
    if not api_key:
        return {
            "code": 1,
            "data": {"status": "failed", "message": "未配置 API Key，请先输入 API Key"},
            "message": "测试失败"
        }
    
    result = await test_api_key(api_key)
    
    if result.success:
        return {
            "code": 0,
            "data": {
                "status": "success",
                "message": "连接测试成功，API Key 有效",
                "result_count": len(result.results) if result.results else 0
            },
            "message": "测试成功"
        }
    else:
        return {
            "code": 1,
            "data": {"status": "failed", "message": result.error or "连接测试失败"},
            "message": "测试失败"
        }


@app.delete("/api/search-config")
async def delete_search_config():
    """删除联网搜索配置"""
    from .db.crud import delete_setting
    
    async with get_session() as session:
        await delete_setting(session, "anspire_api_key")
        return {
            "code": 0,
            "data": {"configured": False},
            "message": "删除成功"
        }


@app.post("/api/web-search")
async def web_search_api(
    query: str,
    top_k: int = 10,
    mode: int = 0,
    insite: Optional[str] = None,
    from_time: Optional[str] = None,
    to_time: Optional[str] = None
):
    """
    联网搜索统一入口 API
    系统中所有需要联网搜索的地方统一通过此接口调用
    """
    from .services.web_search_service import search_with_config
    
    async with get_session() as session:
        result = await search_with_config(
            db_session=session,
            query=query,
            top_k=top_k,
            mode=mode,
            insite=insite,
            from_time=from_time,
            to_time=to_time
        )
        
        if result.success:
            return {
                "code": 0,
                "data": {
                    "results": result.results,
                    "total": len(result.results) if result.results else 0
                },
                "message": "success"
            }
        else:
            return {
                "code": 1,
                "data": None,
                "message": result.error or "搜索失败"
            }


# ==================== 导入其他 API 路由 ====================

from .api import sessions, topics, simulations, platforms, accounts, chat
from .api.chat import websocket_chat

app.include_router(sessions.router, prefix="/api", tags=["会话"])
app.include_router(topics.router, prefix="/api", tags=["选题"])
app.include_router(simulations.router, prefix="/api", tags=["模拟"])
app.include_router(platforms.router, prefix="/api", tags=["平台"])
app.include_router(accounts.router, prefix="/api", tags=["账号"])
app.include_router(chat.router, prefix="/api", tags=["对话"])

# 注册 WebSocket 路由（在 /ws 路径下，与 Vite 代理配置匹配）
app.websocket("/ws/chat/{session_id}")(websocket_chat)


# ==================== 静态文件服务 ====================

# 前端静态文件目录
STATIC_DIR = Path(__file__).parent / "static"

# 如果 static 目录存在，挂载静态文件服务
if STATIC_DIR.exists():
    # 挂载 assets 目录
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    
    @app.get("/")
    async def serve_index():
        """服务前端首页"""
        return FileResponse(STATIC_DIR / "index.html")
    
    @app.get("/{path:path}")
    async def serve_spa(path: str):
        """SPA 路由回退"""
        # 跳过 API 路由
        if path.startswith("api/") or path.startswith("ws/"):
            raise HTTPException(status_code=404, detail="Not found")
        
        file_path = STATIC_DIR / path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")
