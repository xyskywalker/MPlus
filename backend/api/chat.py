"""
对话 API 模块
提供 WebSocket 实时对话接口和对话历史查询接口。

WebSocket URL: /ws/chat/{session_id}?platform={platform_code}
"""

import json
import logging
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from ..services.brainstorm import brainstorm_manager
from ..db.database import get_session
from ..db import crud

logger = logging.getLogger(__name__)

router = APIRouter()


# ==================== WebSocket 对话端点 ====================

async def websocket_chat(
    websocket: WebSocket,
    session_id: str,
    platform: Optional[str] = None,
):
    """
    WebSocket 头脑风暴对话端点

    URL: /ws/chat/{session_id}?platform={platform_code}

    消息协议：
    Client → Server:
        {"type": "message", "content": "...", "enable_search": false}
        {"type": "reset"}
        {"type": "extract_topic", "enhanced": false}

    Server → Client:
        {"type": "connected", "session_id": "..."}
        {"type": "searching", "query": "..."}
        {"type": "search_result", "results": [...]}
        {"type": "search_failed"}
        {"type": "stream", "content": "..."}
        {"type": "complete", "usage": {...}}
        {"type": "reset_complete"}
        {"type": "topic_extracted", "topics": [...], "recommendation": "..."}
        {"type": "error", "message": "..."}
    """
    await websocket.accept()
    logger.info(f"WebSocket 连接建立: session={session_id}, platform={platform}")

    service = None

    # 安全发送 WebSocket 消息（连接断开时静默跳过）
    async def safe_send(data: dict) -> bool:
        """发送 JSON 消息，连接已断开时返回 False"""
        try:
            await websocket.send_json(data)
            return True
        except (WebSocketDisconnect, RuntimeError) as e:
            logger.debug(f"WebSocket 发送跳过（连接已断开）: {e}")
            return False

    try:
        # 获取或创建服务实例
        service = await brainstorm_manager.get_or_create(
            session_id=session_id,
            platform_code=platform,
        )

        # 发送连接确认
        await websocket.send_json({
            "type": "connected",
            "session_id": session_id,
        })

        # 消息循环
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type", "message")

            if msg_type == "message":
                # 流式对话
                content = data.get("content", "")
                enable_search = data.get("enable_search", False)

                if not content.strip():
                    await safe_send({
                        "type": "error",
                        "message": "消息内容不能为空",
                    })
                    continue

                async for chunk in service.chat_stream(
                    content, enable_search
                ):
                    if not await safe_send(chunk):
                        # 连接已断开，停止发送剩余 chunk
                        break

                    # 自动生成的标题实时持久化到数据库
                    if chunk.get("type") == "title_generated":
                        try:
                            async with get_session() as db:
                                await crud.update_session(
                                    db, session_id,
                                    title=chunk.get("title", ""),
                                )
                            logger.info(f"会话标题已更新: session={session_id}, title={chunk.get('title')}")
                        except Exception as e:
                            logger.warning(f"持久化会话标题失败: {e}")

                    # 评估结果实时持久化到数据库（页面关闭后可恢复）
                    if chunk.get("type") == "topic_readiness":
                        try:
                            async with get_session() as db:
                                await crud.update_session(
                                    db, session_id,
                                    topic_readiness_level=chunk.get("level"),
                                    topic_readiness_summary=chunk.get("summary", ""),
                                )
                        except Exception as e:
                            logger.warning(f"持久化评估结果失败: {e}")

            elif msg_type == "reset":
                # 重置会话
                service.reset()
                # 清空数据库中的对话记录
                async with get_session() as session:
                    await crud.delete_conversations(session, session_id)
                await safe_send({"type": "reset_complete"})

            elif msg_type == "extract_topic":
                # 提取选题（耗时操作，需要健壮的错误处理）
                enhanced = data.get("enhanced", False)
                logger.info(f"开始选题提取: session={session_id}, enhanced={enhanced}")
                try:
                    result = await service.extract_topic(enhanced=enhanced)
                    logger.info(
                        f"选题提取完成: session={session_id}, "
                        f"topics={len(result.get('topics', []))}"
                    )
                    await safe_send({
                        "type": "topic_extracted",
                        **result,
                    })
                except (WebSocketDisconnect, RuntimeError):
                    # 提取期间连接断开，静默处理
                    logger.info(f"选题提取期间连接断开: session={session_id}")
                    break
                except Exception as e:
                    logger.error(f"选题提取失败: {e}", exc_info=True)
                    await safe_send({
                        "type": "error",
                        "message": f"选题生成失败: {str(e)}",
                    })

            else:
                await safe_send({
                    "type": "error",
                    "message": f"未知消息类型: {msg_type}",
                })

    except WebSocketDisconnect:
        logger.info(f"WebSocket 连接断开: session={session_id}")

    except (RuntimeError, Exception) as e:
        # RuntimeError: "WebSocket is not connected" — 客户端已断开
        # 其他异常: 服务异常
        if "not connected" in str(e).lower() or "websocket" in str(e).lower():
            logger.info(f"WebSocket 连接已断开（服务端检测）: session={session_id}")
        else:
            logger.error(f"WebSocket 异常: {e}", exc_info=True)
            await safe_send({
                "type": "error",
                "message": f"服务异常: {str(e)}",
            })

    finally:
        # 统一保存记忆
        if service:
            try:
                await service.save_memory()
            except Exception as e:
                logger.warning(f"保存记忆失败: {e}")


# ==================== REST API - 对话历史 ====================

@router.get("/sessions/{session_id}/conversations")
async def get_conversations(
    session_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """获取会话的对话历史"""
    async with get_session() as session:
        conversations = await crud.list_conversations(
            session, session_id, limit=limit, offset=offset
        )

    return {
        "code": 0,
        "data": {
            "items": conversations,
            "total": len(conversations),
        },
        "message": "success",
    }
