"""
MPlus 异常定义模块
定义所有业务异常类型
"""


class MplusException(Exception):
    """MPlus 基础异常类"""
    
    def __init__(self, message: str, code: int = 500):
        self.message = message
        self.code = code
        super().__init__(message)


class LLMException(MplusException):
    """LLM 调用异常"""
    
    def __init__(self, provider: str, message: str):
        self.provider = provider
        super().__init__(f"[{provider}] {message}", code=503)


class SimulationException(MplusException):
    """模拟引擎异常"""
    
    def __init__(self, message: str):
        super().__init__(message, code=500)


class PlatformNotFoundException(MplusException):
    """平台画像未找到"""
    
    def __init__(self, platform_code: str):
        super().__init__(f"平台画像未找到: {platform_code}", code=404)


class WebSearchException(MplusException):
    """联网搜索异常"""
    
    def __init__(self, message: str, response_text: str = ""):
        self.response_text = response_text
        super().__init__(message, code=503)


class SessionNotFoundException(MplusException):
    """会话未找到"""
    
    def __init__(self, session_id: str):
        super().__init__(f"会话未找到: {session_id}", code=404)


class TopicNotFoundException(MplusException):
    """选题未找到"""
    
    def __init__(self, topic_id: str):
        super().__init__(f"选题未找到: {topic_id}", code=404)


class ModelConfigNotFoundException(MplusException):
    """模型配置未找到"""
    
    def __init__(self, config_id: str):
        super().__init__(f"模型配置未找到: {config_id}", code=404)


class ModelConfigTestException(MplusException):
    """模型配置测试失败"""
    
    def __init__(self, message: str):
        super().__init__(f"模型测试失败: {message}", code=400)
