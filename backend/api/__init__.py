"""
MPlus API 路由模块
定义所有 REST API 端点
"""

from .sessions import router as sessions_router
from .topics import router as topics_router
from .simulations import router as simulations_router
from .platforms import router as platforms_router
from .accounts import router as accounts_router

__all__ = [
    'sessions_router',
    'topics_router',
    'simulations_router',
    'platforms_router',
    'accounts_router',
]
