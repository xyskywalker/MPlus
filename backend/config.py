"""
MPlus 配置管理模块
从环境变量和数据库读取配置
"""

from typing import Optional
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """应用配置类

    注意：模型配置（API Key、终结点等）已移至数据库 model_configs 表
    通过 Web UI 进行配置，支持多个模型配置灵活切换
    """

    # 服务配置
    host: str = Field(default="0.0.0.0", description="服务监听地址")
    port: int = Field(default=8000, description="服务监听端口")
    debug: bool = Field(default=False, description="调试模式")

    # 数据库配置
    database_url: str = Field(
        default="sqlite:///./data/mplus.db",
        description="数据库连接URL"
    )

    # ===== Ripple 模拟引擎配置 =====
    simulation_engine: str = Field(
        default="ripple",
        description="模拟引擎选择：ripple（真实引擎）/ mock（开发测试用）"
    )
    ripple_skill_path: Optional[str] = Field(
        default=None,
        description="自定义 Skill 目录路径（为空则使用 Ripple 内置搜索路径）"
    )
    ripple_max_waves: int = Field(
        default=24,
        description="最大传播轮数（48h / 2h per wave = 24）"
    )
    ripple_max_llm_calls: int = Field(
        default=300,
        description="单次模拟 LLM 调用次数上限"
    )
    ripple_ensemble_runs: int = Field(
        default=1,
        description="集成运行次数（1=单次模拟，3=集成模式）"
    )
    ripple_deliberation_rounds: int = Field(
        default=3,
        description="合议庭辩论轮数（服务端上限 4）"
    )
    ripple_simulation_hours: int = Field(
        default=48,
        description="模拟时间跨度（小时）"
    )

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


# 全局配置实例
settings = Settings()
