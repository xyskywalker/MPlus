"""
MPlus 模型工厂模块
统一管理多模型平台的创建和配置。
从数据库读取模型配置，创建 CAMEL 模型实例。
支持运行时动态切换模型（通过 web UI 设置页面配置）。
"""

import logging
from typing import Optional, Dict, Any

from camel.models import ModelFactory
from camel.types import ModelPlatformType

from ..db.database import get_session
from ..db.crud import get_model_config, get_default_model_config

logger = logging.getLogger(__name__)

# CAMEL/OpenAI SDK 需要纯 base_url，会自动追加 API 路径
# 用户可能填写了包含 API 路径的完整 URL，需要裁剪到纯 base_url
# 注意顺序：长路径优先匹配，避免短路径误裁
_API_PATH_SUFFIXES = [
    "/responses/chat/completions",
    "/chat/completions",
    "/completions",
    "/embeddings",
    "/responses",
]


def _normalize_base_url(url: Optional[str]) -> Optional[str]:
    """
    提取纯 base_url（供 CAMEL/OpenAI SDK 使用）

    CAMEL 底层使用 OpenAI SDK，SDK 会自动在 base_url 后追加 API 路径
    （如 /chat/completions）。因此需要将用户填写的完整 URL 裁剪到纯 base_url。

    支持的用户输入格式：
    - "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
      → "https://ark.cn-beijing.volces.com/api/v3"
    - "https://ark.cn-beijing.volces.com/api/v3/responses"
      → "https://ark.cn-beijing.volces.com/api/v3"
    - "https://api.openai.com/v1" → "https://api.openai.com/v1"（无需裁剪）
    - "https://api.deepseek.com/v1/" → "https://api.deepseek.com/v1"
    """
    if not url:
        return url

    # 移除尾部斜杠
    url = url.rstrip("/")

    # 裁剪 API 路径后缀，还原为纯 base_url
    for suffix in _API_PATH_SUFFIXES:
        if url.endswith(suffix):
            url = url[: -len(suffix)]
            logger.info(f"base_url 裁剪 API 路径 '{suffix}' → {url}")
            break

    # 再次移除可能的尾部斜杠
    url = url.rstrip("/")

    return url


class MplusModelFactory:
    """
    MPlus 模型工厂

    封装 CAMEL ModelFactory，从数据库读取模型配置。

    支持的模型类型:
    - openai: OpenAI 官方及所有 OpenAI 兼容模型 (DeepSeek, 通义千问, 硅基流动等)
    - claude: Anthropic Claude 官方模型
    - azure-openai: 微软 Azure 平台上的 OpenAI 模型
    """

    # 使用 Anthropic 原生后端的模型类型
    ANTHROPIC_TYPES = {"claude"}

    # 其他所有类型（openai、azure-openai 等）统一使用 OPENAI_COMPATIBLE_MODEL
    # 原因：
    # - OPENAI_COMPATIBLE_MODEL 不做严格参数校验，兼容性最好
    # - 用户配置的模型来源多样（官方 OpenAI、DeepSeek、通义千问、火山引擎、Azure 代理等）
    # - 避免各后端的特殊参数要求（如 Azure 的 api_version）

    # 默认 max_tokens 值（避免 CAMEL 默认为 999_999_999）
    DEFAULT_MAX_TOKENS = 4096

    @classmethod
    async def create(
        cls,
        config_id: Optional[str] = None,
        temperature: float = 0.7,
        stream: bool = False,
        **kwargs
    ):
        """
        异步创建模型实例（从数据库读取配置）

        Args:
            config_id: 模型配置 ID（可选，为空则使用默认配置）
            temperature: 温度参数
            stream: 是否启用流式输出
            **kwargs: 其他模型配置参数

        Returns:
            CAMEL 模型实例

        Raises:
            ValueError: 未找到模型配置或配置无效
        """
        async with get_session() as session:
            if config_id:
                config = await get_model_config(session, config_id)
            else:
                config = await get_default_model_config(session)

            if not config:
                raise ValueError("未找到模型配置，请先在设置页面添加模型配置")

            return cls._create_from_config(config, temperature, stream, **kwargs)

    @classmethod
    def create_sync(
        cls,
        config: Dict[str, Any],
        temperature: float = 0.7,
        stream: bool = False,
        **kwargs
    ):
        """
        同步创建模型实例（从已获取的配置创建）

        Args:
            config: 模型配置字典
            temperature: 温度参数
            stream: 是否启用流式输出
            **kwargs: 其他模型配置参数

        Returns:
            CAMEL 模型实例
        """
        return cls._create_from_config(config, temperature, stream, **kwargs)

    @classmethod
    def _create_from_config(
        cls,
        config: Dict[str, Any],
        temperature: float = 0.7,
        stream: bool = False,
        **kwargs
    ):
        """
        从配置字典创建模型实例

        平台类型选择策略：
        - claude 类型 → ModelPlatformType.ANTHROPIC（Anthropic 原生后端）
        - 其他类型 → ModelPlatformType.OPENAI_COMPATIBLE_MODEL（通用兼容后端）

        Args:
            config: 模型配置字典
            temperature: 温度参数
            stream: 是否启用流式输出
            **kwargs: 其他模型配置参数

        Returns:
            CAMEL 模型实例
        """
        model_type = config.get("model_type")
        base_url = config.get("base_url")
        api_key = config.get("api_key")
        model_name = config.get("model_name")

        # 规范化 base_url（裁剪 OpenAI SDK 会自动追加的路径，避免路径重复）
        base_url = _normalize_base_url(base_url)

        # 确定 CAMEL 平台类型
        if model_type in cls.ANTHROPIC_TYPES:
            platform = ModelPlatformType.ANTHROPIC
        else:
            # openai、azure-openai 及其他所有类型统一走 OPENAI_COMPATIBLE_MODEL
            platform = ModelPlatformType.OPENAI_COMPATIBLE_MODEL

        # 构建模型配置（仅包含 LLM 调用参数，不包含连接参数）
        model_config_dict = {
            "temperature": temperature,
            "max_tokens": cls.DEFAULT_MAX_TOKENS,
            **kwargs
        }

        if stream:
            model_config_dict["stream"] = True

        logger.info(
            f"创建模型: platform={platform}, model={model_name}, "
            f"url={base_url}, temperature={temperature}, stream={stream}"
        )

        # url 和 api_key 作为独立参数传入 ModelFactory.create()
        # 不放入 model_config_dict，避免参数校验报错
        return ModelFactory.create(
            model_platform=platform,
            model_type=model_name,
            model_config_dict=model_config_dict,
            api_key=api_key,
            url=base_url,
        )
