"""
MPlus 数据库连接与初始化模块
使用 SQLAlchemy 异步引擎
"""

from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import text
import logging

from ..config import settings

logger = logging.getLogger(__name__)

# 创建异步引擎
# 将 sqlite:/// 转换为 sqlite+aiosqlite:///
database_url = settings.database_url.replace("sqlite:///", "sqlite+aiosqlite:///")
engine = create_async_engine(
    database_url,
    echo=settings.debug,
    future=True
)

# 创建异步会话工厂
async_session_factory = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)

# 声明式基类
Base = declarative_base()


@asynccontextmanager
async def get_session():
    """获取数据库会话（上下文管理器）"""
    async with async_session_factory() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """初始化数据库表结构"""
    async with engine.begin() as conn:
        await _execute_init_sql(conn)
        await _fix_topic_simulation_status(conn)

    logger.info("数据库表结构初始化完成")


async def _fix_topic_simulation_status(conn):
    """修复历史数据：有已完成模拟但 status 未标记为 simulated 的选题"""
    result = await conn.execute(text("""
        UPDATE topics SET status = 'simulated'
        WHERE status != 'simulated'
          AND id IN (
              SELECT DISTINCT topic_id FROM simulations WHERE status = 'completed'
          )
    """))
    if result.rowcount > 0:
        logger.info("已修复 %d 个选题的模拟状态", result.rowcount)


async def _execute_init_sql(conn):
    """执行初始化 SQL 语句"""
    
    # 会话表
    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT,
            platform_code TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    
    # 对话历史表（每条消息一行，role: user/assistant/system）
    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id),
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    
    # 选题表
    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS topics (
            id TEXT PRIMARY KEY,
            session_id TEXT REFERENCES sessions(id),
            title TEXT NOT NULL,
            description TEXT,
            target_platform TEXT,
            content TEXT,
            metadata TEXT,
            status TEXT DEFAULT 'draft',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    
    # 模拟结果表
    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS simulations (
            id TEXT PRIMARY KEY,
            topic_id TEXT REFERENCES topics(id),
            platform TEXT NOT NULL,
            config TEXT,
            search_data TEXT,
            results TEXT,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP
        )
    """))
    
    # 配置表
    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    
    # 模型配置表
    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS model_configs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            model_type TEXT NOT NULL,
            base_url TEXT NOT NULL,
            api_key TEXT NOT NULL,
            model_name TEXT NOT NULL,
            is_default BOOLEAN DEFAULT FALSE,
            is_fast_task BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))

    # 兼容迁移：为已有数据库添加 is_fast_task 字段
    try:
        await conn.execute(text(
            "ALTER TABLE model_configs ADD COLUMN is_fast_task BOOLEAN DEFAULT FALSE"
        ))
        logger.info("已迁移 model_configs 表：添加 is_fast_task 字段")
    except Exception:
        pass  # 字段已存在，跳过
    
    # 搜索缓存表
    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS search_cache (
            cache_key TEXT PRIMARY KEY,
            result TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP
        )
    """))
    
    # 账号配置表
    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS account_profiles (
            id TEXT PRIMARY KEY,
            platform_code TEXT NOT NULL,
            account_name TEXT NOT NULL,
            account_id TEXT,
            bio TEXT,
            main_category TEXT NOT NULL,
            sub_categories TEXT,
            content_style TEXT,
            target_audience TEXT,
            followers_count INTEGER DEFAULT 0,
            posts_count INTEGER DEFAULT 0,
            verification_status TEXT DEFAULT 'none',
            started_at DATE,
            stats_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            extra_metrics TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    
    # 历史内容表现表
    await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS post_performances (
            id TEXT PRIMARY KEY,
            account_profile_id TEXT NOT NULL REFERENCES account_profiles(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            content TEXT,
            post_type TEXT DEFAULT '图文',
            tags TEXT,
            is_top INTEGER DEFAULT 0,
            post_url TEXT,
            publish_time DATE,
            metrics_captured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            views INTEGER DEFAULT 0,
            likes INTEGER DEFAULT 0,
            comments INTEGER DEFAULT 0,
            favorites INTEGER DEFAULT 0,
            shares INTEGER DEFAULT 0,
            extra_metrics TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    
    # 迁移：为 conversations 表添加 role 字段（从旧 schema 升级）
    try:
        await conn.execute(text(
            "ALTER TABLE conversations ADD COLUMN role TEXT DEFAULT 'user'"
        ))
    except Exception:
        pass  # 字段已存在则忽略

    # 迁移：为 conversations 表添加 content 字段（从旧 schema 升级）
    try:
        await conn.execute(text(
            "ALTER TABLE conversations ADD COLUMN content TEXT DEFAULT ''"
        ))
    except Exception:
        pass  # 字段已存在则忽略

    # 迁移：为 conversations 表添加 metadata 字段
    try:
        await conn.execute(text(
            "ALTER TABLE conversations ADD COLUMN metadata TEXT DEFAULT '{}'"
        ))
    except Exception:
        pass  # 字段已存在则忽略

    # 迁移：为 sessions 表添加 model_config_id 字段
    try:
        await conn.execute(text(
            "ALTER TABLE sessions ADD COLUMN model_config_id TEXT"
        ))
    except Exception:
        pass  # 字段已存在则忽略

    # 迁移：为 sessions 表添加选题就绪度评估持久化字段
    try:
        await conn.execute(text(
            "ALTER TABLE sessions ADD COLUMN topic_readiness_level TEXT"
        ))
    except Exception:
        pass  # 字段已存在则忽略

    try:
        await conn.execute(text(
            "ALTER TABLE sessions ADD COLUMN topic_readiness_summary TEXT"
        ))
    except Exception:
        pass  # 字段已存在则忽略
    
    # 迁移：为 sessions 表添加 account_profile_id 字段（关联账号画像）
    try:
        await conn.execute(text(
            "ALTER TABLE sessions ADD COLUMN account_profile_id TEXT"
        ))
        logger.info("已迁移 sessions 表：添加 account_profile_id 字段")
    except Exception:
        pass  # 字段已存在则忽略

    # 迁移：为 topics 表添加 account_profile_id 字段（选题关联的账号画像）
    try:
        await conn.execute(text(
            "ALTER TABLE topics ADD COLUMN account_profile_id TEXT"
        ))
        logger.info("已迁移 topics 表：添加 account_profile_id 字段")
    except Exception:
        pass  # 字段已存在则忽略

    # 迁移：为 simulations 表添加 model_config_id 字段
    try:
        await conn.execute(text(
            "ALTER TABLE simulations ADD COLUMN model_config_id TEXT"
        ))
    except Exception:
        pass  # 字段已存在则忽略
    
    # 迁移：为 simulations 表添加 cancelled_at 字段
    try:
        await conn.execute(text(
            "ALTER TABLE simulations ADD COLUMN cancelled_at TIMESTAMP"
        ))
    except Exception:
        pass  # 字段已存在则忽略
    
    # 迁移：为 simulations 表添加 error_message 字段
    try:
        await conn.execute(text(
            "ALTER TABLE simulations ADD COLUMN error_message TEXT"
        ))
    except Exception:
        pass  # 字段已存在则忽略
    
    # 创建索引
    await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_conversations_session 
        ON conversations(session_id)
    """))
    
    await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_topics_session 
        ON topics(session_id)
    """))
    
    await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_simulations_topic 
        ON simulations(topic_id)
    """))
    
    await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_model_configs_default 
        ON model_configs(is_default)
    """))

    await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_model_configs_fast_task 
        ON model_configs(is_fast_task)
    """))
    
    await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_account_profiles_platform 
        ON account_profiles(platform_code)
    """))

    await conn.execute(text("""
        CREATE INDEX IF NOT EXISTS idx_post_performances_account 
        ON post_performances(account_profile_id)
    """))

    # 迁移：为 account_profiles 表添加新字段
    for col_sql in [
        "ALTER TABLE account_profiles ADD COLUMN content_style TEXT",
        "ALTER TABLE account_profiles ADD COLUMN target_audience TEXT",
        "ALTER TABLE account_profiles ADD COLUMN stats_updated_at TIMESTAMP",
        "ALTER TABLE account_profiles ADD COLUMN extra_metrics TEXT",
        "ALTER TABLE account_profiles ADD COLUMN verification_status TEXT DEFAULT 'none'",
        "ALTER TABLE account_profiles ADD COLUMN started_at DATE",
    ]:
        try:
            await conn.execute(text(col_sql))
        except Exception:
            pass  # 字段已存在则忽略

    # 迁移：为 post_performances 表添加新字段
    for col_sql in [
        "ALTER TABLE post_performances ADD COLUMN content TEXT",
        "ALTER TABLE post_performances ADD COLUMN tags TEXT",
        "ALTER TABLE post_performances ADD COLUMN is_top INTEGER DEFAULT 0",
        "ALTER TABLE post_performances ADD COLUMN post_url TEXT",
        "ALTER TABLE post_performances ADD COLUMN metrics_captured_at TIMESTAMP",
        "ALTER TABLE post_performances ADD COLUMN extra_metrics TEXT",
    ]:
        try:
            await conn.execute(text(col_sql))
        except Exception:
            pass  # 字段已存在则忽略
