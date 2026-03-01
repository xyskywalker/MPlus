"""
统一的 LLM 服务模块
提供统一的 LLM 调用接口，支持多种模型类型和 API 模式。

支持的模型类型：
- OpenAI 兼容 API（包括豆包/火山引擎、DeepSeek、通义千问等）
- Claude API（Anthropic 原生）
- Azure OpenAI

支持的 API 模式（自动识别 + 404 回退）：
- Chat Completions（/chat/completions）：标准模式，使用 messages 字段
- Responses（/responses）：新版模式，使用 input 数组字段，火山引擎/OpenAI 已支持

所有 LLM 调用都应通过此模块进行，确保一致性。
"""

import httpx
import logging
from typing import Optional, Dict, Any, List, Union
from dataclasses import dataclass
from enum import Enum

logger = logging.getLogger(__name__)


class ModelType(str, Enum):
    """支持的模型类型"""
    OPENAI = "openai"
    CLAUDE = "claude"
    AZURE_OPENAI = "azure-openai"


@dataclass
class LLMConfig:
    """LLM 配置"""
    model_type: str
    base_url: str
    api_key: str
    model_name: str
    
    @classmethod
    def from_dict(cls, config: Dict[str, Any]) -> "LLMConfig":
        """从字典创建配置"""
        return cls(
            model_type=config["model_type"],
            base_url=config["base_url"].rstrip("/"),
            api_key=config["api_key"],
            model_name=config["model_name"]
        )


@dataclass
class LLMResponse:
    """LLM 响应"""
    success: bool
    content: Optional[str] = None
    error: Optional[str] = None
    raw_response: Optional[Dict[str, Any]] = None


class LLMService:
    """
    统一的 LLM 服务类
    
    使用示例:
        config = LLMConfig.from_dict(model_config_dict)
        service = LLMService(config)
        response = await service.chat("你好")
    """
    
    def __init__(self, config: LLMConfig, timeout: float = 60.0):
        """
        初始化 LLM 服务
        
        Args:
            config: LLM 配置
            timeout: 请求超时时间（秒）
        """
        self.config = config
        self.timeout = timeout
    
    async def chat(
        self,
        message: Union[str, List[Dict[str, str]]],
        system_prompt: Optional[str] = None,
        **kwargs
    ) -> LLMResponse:
        """
        发送聊天请求
        
        Args:
            message: 用户消息，可以是字符串或消息列表
            system_prompt: 系统提示（可选）
            **kwargs: 其他参数（如 temperature, top_p 等）
        
        Returns:
            LLMResponse: 包含响应内容或错误信息
        """
        try:
            if self.config.model_type == ModelType.OPENAI:
                return await self._chat_openai(message, system_prompt, **kwargs)
            elif self.config.model_type == ModelType.CLAUDE:
                return await self._chat_claude(message, system_prompt, **kwargs)
            elif self.config.model_type == ModelType.AZURE_OPENAI:
                return await self._chat_azure_openai(message, system_prompt, **kwargs)
            else:
                return LLMResponse(
                    success=False,
                    error=f"不支持的模型类型: {self.config.model_type}"
                )
        except httpx.TimeoutException:
            return LLMResponse(
                success=False,
                error="请求超时，请检查网络或 API 地址"
            )
        except Exception as e:
            logger.exception(f"LLM 调用失败: {e}")
            return LLMResponse(
                success=False,
                error=f"调用失败: {str(e)}"
            )
    
    async def test_connection(self) -> LLMResponse:
        """
        测试 LLM 连接
        
        Returns:
            LLMResponse: 测试结果
        """
        return await self.chat("Hi")
    
    @staticmethod
    def _extract_base_url(url: str) -> str:
        """从用户填写的 URL 中提取纯 base_url（不含 API 路径）"""
        url = url.rstrip("/")
        for suffix in ["/chat/completions", "/completions", "/responses"]:
            if url.endswith(suffix):
                return url[:-len(suffix)].rstrip("/")
        return url

    async def _chat_openai(
        self,
        message: Union[str, List[Dict[str, str]]],
        system_prompt: Optional[str] = None,
        **kwargs
    ) -> LLMResponse:
        """
        OpenAI 兼容 API 调用（包括豆包、DeepSeek 等）

        智能适配两种 API 模式，带自动回退：
        - 如果用户指定 /responses → 先尝试 Responses API，404 则回退到 Chat Completions
        - 如果用户指定 /chat/completions 或纯 base_url → 先尝试 Chat Completions，404 则回退到 Responses
        - 回退成功后会打印日志提示
        """
        raw_url = self.config.base_url.rstrip("/")
        base_url = self._extract_base_url(raw_url)

        headers = {
            "Authorization": f"Bearer {self.config.api_key}",
            "Content-Type": "application/json"
        }

        # 根据用户 URL 确定优先尝试的 API 模式
        if raw_url.endswith("/responses"):
            try_order = ["responses", "chat_completions"]
        else:
            try_order = ["chat_completions", "responses"]

        last_result = None
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for i, mode in enumerate(try_order):
                endpoint, body = self._build_request(
                    mode, base_url, message, system_prompt, **kwargs
                )
                response = await client.post(endpoint, headers=headers, json=body)

                # 非 404 → 已命中有效端点，直接返回解析结果
                if response.status_code != 404:
                    if mode == "responses":
                        return self._parse_responses_api_response(response)
                    else:
                        return self._parse_openai_response(response)

                # 404 → 记录并尝试下一个模式
                last_result = response
                if i < len(try_order) - 1:
                    next_mode = try_order[i + 1]
                    logger.info(
                        f"API 端点 {endpoint} 返回 404，回退尝试 {next_mode} 模式"
                    )
                else:
                    logger.warning(f"API 端点 {endpoint} 返回 404，已无可回退模式")

        # 所有模式均 404
        error_msg = last_result.text[:500] if last_result else "未知错误"
        logger.error(f"所有 API 模式均失败: {error_msg}")
        return LLMResponse(
            success=False,
            error=f"API 返回错误: 所有端点均不可用 - {error_msg}"
        )

    def _build_request(
        self,
        mode: str,
        base_url: str,
        message: Union[str, List[Dict[str, str]]],
        system_prompt: Optional[str] = None,
        **kwargs
    ) -> tuple:
        """
        根据 API 模式构建请求端点和请求体

        Args:
            mode: "chat_completions" 或 "responses"
            base_url: 纯 base_url（不含 API 路径）
            message: 用户消息
            system_prompt: 系统提示

        Returns:
            (endpoint_url, request_body) 元组
        """
        if mode == "responses":
            endpoint = f"{base_url}/responses"
            # Responses API 使用 input 数组格式（火山引擎/OpenAI 标准）
            # input: [{"role": "user", "content": [{"type": "input_text", "text": "..."}]}]
            input_messages = []
            if system_prompt:
                input_messages.append({
                    "role": "system",
                    "content": [{"type": "input_text", "text": system_prompt}]
                })
            if isinstance(message, str):
                input_messages.append({
                    "role": "user",
                    "content": [{"type": "input_text", "text": message}]
                })
            else:
                for msg in message:
                    input_messages.append({
                        "role": msg.get("role", "user"),
                        "content": [
                            {"type": "input_text", "text": msg.get("content", "")}
                        ]
                    })
            body = {
                "model": self.config.model_name,
                "input": input_messages,
                **kwargs
            }
        else:
            endpoint = f"{base_url}/chat/completions"
            messages = self._build_messages(message, system_prompt)
            body = {
                "model": self.config.model_name,
                "messages": messages,
                **kwargs
            }
        return endpoint, body
    
    async def _chat_claude(
        self,
        message: Union[str, List[Dict[str, str]]],
        system_prompt: Optional[str] = None,
        **kwargs
    ) -> LLMResponse:
        """Claude API 调用"""
        api_endpoint = f"{self.config.base_url}/v1/messages"
        
        # 构建消息列表（Claude 格式）
        messages = self._build_messages(message, system_prompt=None)  # Claude 的 system 单独处理
        
        # 构建请求体
        request_body = {
            "model": self.config.model_name,
            "messages": messages,
            "max_tokens": kwargs.pop("max_tokens", 1024),  # Claude 必须指定 max_tokens
            **kwargs
        }
        
        # Claude 的 system prompt 是单独的字段
        if system_prompt:
            request_body["system"] = system_prompt
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                api_endpoint,
                headers={
                    "x-api-key": self.config.api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json"
                },
                json=request_body
            )
            
            return self._parse_claude_response(response)
    
    async def _chat_azure_openai(
        self,
        message: Union[str, List[Dict[str, str]]],
        system_prompt: Optional[str] = None,
        **kwargs
    ) -> LLMResponse:
        """Azure OpenAI API 调用（支持新旧两种 API）"""
        base_url = self.config.base_url
        
        # 判断是否使用新版 Responses API
        is_responses_api = "/openai/responses" in base_url or "cognitiveservices.azure.com" in base_url
        
        if is_responses_api:
            return await self._chat_azure_responses_api(message, system_prompt, **kwargs)
        else:
            return await self._chat_azure_chat_completions_api(message, system_prompt, **kwargs)
    
    async def _chat_azure_responses_api(
        self,
        message: Union[str, List[Dict[str, str]]],
        system_prompt: Optional[str] = None,
        **kwargs
    ) -> LLMResponse:
        """Azure OpenAI 新版 Responses API（GPT-5 等新模型）"""
        base_url = self.config.base_url
        
        # 智能处理 endpoint URL
        if "/openai/responses" in base_url:
            if "api-version" in base_url:
                azure_endpoint = base_url
            elif "?" in base_url:
                azure_endpoint = f"{base_url}&api-version=2025-04-01-preview"
            else:
                azure_endpoint = f"{base_url}?api-version=2025-04-01-preview"
        else:
            azure_endpoint = f"{base_url}/openai/responses?api-version=2025-04-01-preview"
        
        # Responses API 使用 input 数组格式
        # input: [{"role": "user", "content": [{"type": "input_text", "text": "..."}]}]
        input_messages = []
        if system_prompt:
            input_messages.append({
                "role": "system",
                "content": [{"type": "input_text", "text": system_prompt}]
            })
        if isinstance(message, str):
            input_messages.append({
                "role": "user",
                "content": [{"type": "input_text", "text": message}]
            })
        else:
            for msg in message:
                input_messages.append({
                    "role": msg.get("role", "user"),
                    "content": [
                        {"type": "input_text", "text": msg.get("content", "")}
                    ]
                })
        
        request_body = {
            "model": self.config.model_name,
            "input": input_messages,
            **kwargs
        }
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                azure_endpoint,
                headers={
                    "Authorization": f"Bearer {self.config.api_key}",
                    "Content-Type": "application/json"
                },
                json=request_body
            )
            
            # 复用统一的 Responses API 响应解析器
            return self._parse_responses_api_response(response)
    
    async def _chat_azure_chat_completions_api(
        self,
        message: Union[str, List[Dict[str, str]]],
        system_prompt: Optional[str] = None,
        **kwargs
    ) -> LLMResponse:
        """Azure OpenAI 旧版 Chat Completions API"""
        base_url = self.config.base_url
        
        # 智能处理 endpoint URL
        if "/openai/deployments/" in base_url:
            if "api-version" in base_url:
                azure_endpoint = base_url
            elif "?" in base_url:
                azure_endpoint = f"{base_url}&api-version=2024-02-01"
            else:
                azure_endpoint = f"{base_url}?api-version=2024-02-01"
        else:
            azure_endpoint = f"{base_url}/openai/deployments/{self.config.model_name}/chat/completions?api-version=2024-02-01"
        
        # 构建消息列表
        messages = self._build_messages(message, system_prompt)
        
        request_body = {
            "messages": messages,
            **kwargs
        }
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                azure_endpoint,
                headers={
                    "api-key": self.config.api_key,
                    "Content-Type": "application/json"
                },
                json=request_body
            )
            
            return self._parse_openai_response(response)
    
    def _build_messages(
        self,
        message: Union[str, List[Dict[str, str]]],
        system_prompt: Optional[str] = None
    ) -> List[Dict[str, str]]:
        """构建消息列表"""
        messages = []
        
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        
        if isinstance(message, str):
            messages.append({"role": "user", "content": message})
        else:
            messages.extend(message)
        
        return messages
    
    def _parse_openai_response(self, response: httpx.Response) -> LLMResponse:
        """解析 OpenAI Chat Completions 格式的响应"""
        if response.status_code == 200:
            try:
                data = response.json()
                content = data["choices"][0]["message"]["content"]
                return LLMResponse(
                    success=True,
                    content=content,
                    raw_response=data
                )
            except (KeyError, IndexError) as e:
                return LLMResponse(
                    success=False,
                    error=f"响应解析失败: {e}",
                    raw_response=response.json() if response.text else None
                )
        else:
            error_msg = response.text[:500]
            logger.error(f"OpenAI API 调用失败: {response.status_code} - {error_msg}")
            return LLMResponse(
                success=False,
                error=f"API 返回错误: {response.status_code} - {error_msg}"
            )

    def _parse_responses_api_response(self, response: httpx.Response) -> LLMResponse:
        """
        解析 Responses API 格式的响应

        Responses API 是 OpenAI 新版 API，火山引擎等厂商也已支持。
        响应结构（火山引擎/OpenAI）：
        {
          "output": [
            {"type": "message", "content": [{"type": "output_text", "text": "..."}]}
          ]
        }
        也兼容 choices 格式（部分厂商兼容模式）和 output 为字符串的情况。
        """
        if response.status_code == 200:
            try:
                data = response.json()
                content = None

                # 格式1：标准 Responses API — output 数组
                if "output" in data:
                    output = data["output"]
                    if isinstance(output, list):
                        texts = []
                        for item in output:
                            if item.get("type") == "message":
                                for part in item.get("content", []):
                                    if part.get("type") == "output_text":
                                        texts.append(part.get("text", ""))
                        content = "".join(texts) if texts else None
                        # 降级：尝试直接从 output 数组中提取文本
                        if not content:
                            for item in output:
                                if isinstance(item, dict) and "text" in item:
                                    content = item["text"]
                                    break
                    elif isinstance(output, str):
                        content = output

                # 格式2：choices 兼容格式
                if not content and "choices" in data:
                    content = data["choices"][0]["message"]["content"]

                # 格式3：直接 text / content 字段
                if not content:
                    content = data.get("text") or data.get("content")

                # 兜底
                if not content:
                    content = str(data)

                return LLMResponse(
                    success=True,
                    content=content,
                    raw_response=data
                )
            except (KeyError, IndexError) as e:
                return LLMResponse(
                    success=False,
                    error=f"Responses API 响应解析失败: {e}",
                    raw_response=response.json() if response.text else None
                )
        else:
            error_msg = response.text[:500]
            logger.error(f"Responses API 调用失败: {response.status_code} - {error_msg}")
            return LLMResponse(
                success=False,
                error=f"API 返回错误: {response.status_code} - {error_msg}"
            )
    
    def _parse_claude_response(self, response: httpx.Response) -> LLMResponse:
        """解析 Claude 格式的响应"""
        if response.status_code == 200:
            try:
                data = response.json()
                content = data["content"][0]["text"]
                return LLMResponse(
                    success=True,
                    content=content,
                    raw_response=data
                )
            except (KeyError, IndexError) as e:
                return LLMResponse(
                    success=False,
                    error=f"响应解析失败: {e}",
                    raw_response=response.json() if response.text else None
                )
        else:
            error_msg = response.text[:500]
            logger.error(f"Claude API 调用失败: {response.status_code} - {error_msg}")
            return LLMResponse(
                success=False,
                error=f"API 返回错误: {response.status_code} - {error_msg}"
            )
    


# 便捷函数：创建 LLM 服务实例
def create_llm_service(config: Dict[str, Any], timeout: float = 60.0) -> LLMService:
    """
    创建 LLM 服务实例的便捷函数
    
    Args:
        config: 模型配置字典
        timeout: 请求超时时间
    
    Returns:
        LLMService: LLM 服务实例
    """
    llm_config = LLMConfig.from_dict(config)
    return LLMService(llm_config, timeout=timeout)


# 便捷函数：测试 LLM 连接
async def test_llm_connection(config: Dict[str, Any], timeout: float = 30.0) -> LLMResponse:
    """
    测试 LLM 连接的便捷函数
    
    Args:
        config: 模型配置字典
        timeout: 请求超时时间
    
    Returns:
        LLMResponse: 测试结果
    """
    service = create_llm_service(config, timeout=timeout)
    return await service.test_connection()
