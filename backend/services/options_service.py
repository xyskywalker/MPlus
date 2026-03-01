"""
应用选项配置服务
从 YAML 配置文件加载前端 UI 使用的各种选项配置
"""

import yaml
import logging
from pathlib import Path
from typing import Dict, Any, Optional
from functools import lru_cache
import os

logger = logging.getLogger(__name__)

# 配置文件路径
CONFIG_FILE_PATH = Path(__file__).parent.parent.parent / "config" / "app_options.yaml"

# 配置文件的修改时间（用于检测文件变化）
_config_mtime: float = 0

# 缓存的配置数据
_cached_config: Optional[Dict[str, Any]] = None


def _load_config_from_file() -> Dict[str, Any]:
    """
    从 YAML 文件加载配置
    
    Returns:
        配置字典
    """
    if not CONFIG_FILE_PATH.exists():
        logger.warning(f"配置文件不存在: {CONFIG_FILE_PATH}")
        return get_default_options()
    
    try:
        with open(CONFIG_FILE_PATH, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
            if config is None:
                logger.warning("配置文件为空，使用默认配置")
                return get_default_options()
            return config
    except yaml.YAMLError as e:
        logger.error(f"解析配置文件失败: {e}")
        return get_default_options()
    except Exception as e:
        logger.error(f"读取配置文件失败: {e}")
        return get_default_options()


def get_app_options() -> Dict[str, Any]:
    """
    获取应用选项配置
    支持热重载：检测文件修改时间，自动重新加载
    
    Returns:
        应用选项配置字典
    """
    global _config_mtime, _cached_config
    
    # 检查文件是否存在
    if not CONFIG_FILE_PATH.exists():
        if _cached_config is None:
            _cached_config = get_default_options()
        return _cached_config
    
    # 获取文件修改时间
    try:
        current_mtime = os.path.getmtime(CONFIG_FILE_PATH)
    except OSError:
        if _cached_config is None:
            _cached_config = get_default_options()
        return _cached_config
    
    # 如果文件有修改或者缓存为空，重新加载
    if _cached_config is None or current_mtime > _config_mtime:
        logger.info("重新加载应用选项配置...")
        _cached_config = _load_config_from_file()
        _config_mtime = current_mtime
    
    return _cached_config


def get_default_options() -> Dict[str, Any]:
    """
    获取默认配置
    当配置文件不存在或解析失败时使用
    
    Returns:
        默认配置字典
    """
    return {
        "verification_statuses": [
            {"value": "none", "label": "未认证"},
            {"value": "personal", "label": "个人认证"},
            {"value": "enterprise", "label": "企业/机构认证"},
        ],
        "content_styles": [
            "干货教程型", "故事叙述型", "种草推荐型", "测评对比型",
            "观点输出型", "情绪共鸣型", "记录分享型",
        ],
        "post_types": ["图文", "视频", "直播", "笔记", "短视频", "文章", "专栏"],
        "category_options": [
            {"value": "职场成长", "label": "💼 职场成长", "sub_suggestions": ["职场技能", "职场心理", "求职面试", "个人成长", "副业兼职"]},
            {"value": "生活方式", "label": "🏠 生活方式", "sub_suggestions": ["家居好物", "日常分享", "极简生活", "租房装修"]},
            {"value": "美食探店", "label": "🍜 美食探店", "sub_suggestions": ["家常菜谱", "探店测评", "烘焙甜点", "减脂餐"]},
            {"value": "美妆护肤", "label": "💄 美妆护肤", "sub_suggestions": ["护肤教程", "彩妆技巧", "产品测评", "成分分析"]},
            {"value": "穿搭时尚", "label": "👗 穿搭时尚", "sub_suggestions": ["日常穿搭", "通勤穿搭", "平价好物", "风格研究"]},
            {"value": "旅行攻略", "label": "✈️ 旅行攻略", "sub_suggestions": ["国内游", "出境游", "省钱攻略", "小众景点"]},
            {"value": "科技数码", "label": "📱 科技数码", "sub_suggestions": ["手机评测", "电脑硬件", "智能家居", "AI工具"]},
            {"value": "情感心理", "label": "❤️ 情感心理", "sub_suggestions": ["恋爱关系", "自我成长", "心理健康", "人际关系"]},
            {"value": "母婴育儿", "label": "👶 母婴育儿", "sub_suggestions": ["孕期知识", "育儿经验", "早教启蒙", "母婴好物"]},
            {"value": "健身运动", "label": "🏃 健身运动", "sub_suggestions": ["减脂塑形", "居家健身", "跑步", "瑜伽"]},
            {"value": "知识科普", "label": "📚 知识科普", "sub_suggestions": ["历史人文", "科学常识", "法律知识", "经济金融"]},
            {"value": "搞笑娱乐", "label": "🎭 搞笑娱乐", "sub_suggestions": ["段子", "影视解说", "综艺", "明星八卦"]},
        ],
        "model_types": {
            "openai": {
                "label": "OpenAI",
                "color": "bg-green-500",
                "text_color": "text-green-600 dark:text-green-400",
                "bg_color": "bg-green-100 dark:bg-green-900/30",
                "description": "支持 OpenAI 官方及所有 OpenAI 兼容模型",
                "default_url": "https://api.openai.com/v1",
            },
            "claude": {
                "label": "Claude",
                "color": "bg-yellow-500",
                "text_color": "text-yellow-600 dark:text-yellow-400",
                "bg_color": "bg-yellow-100 dark:bg-yellow-900/30",
                "description": "支持 Anthropic 官方模型及 Claude 兼容模型",
                "default_url": "https://api.anthropic.com",
            },
            "azure-openai": {
                "label": "Azure-OpenAI",
                "color": "bg-blue-500",
                "text_color": "text-blue-600 dark:text-blue-400",
                "bg_color": "bg-blue-100 dark:bg-blue-900/30",
                "description": "微软 Azure 平台上的 OpenAI 模型",
                "default_url": "https://{resource}.openai.azure.com",
            },
        },
        "url_examples": [
            {"label": "OpenAI 官方", "url": "https://api.openai.com/v1"},
            {"label": "DeepSeek", "url": "https://api.deepseek.com/v1"},
            {"label": "通义千问", "url": "https://dashscope.aliyuncs.com/compatible-mode/v1"},
            {"label": "硅基流动", "url": "https://api.siliconflow.cn/v1"},
            {"label": "Claude", "url": "https://api.anthropic.com"},
        ],
    }


def reload_config() -> Dict[str, Any]:
    """
    强制重新加载配置
    
    Returns:
        重新加载后的配置字典
    """
    global _config_mtime, _cached_config
    _config_mtime = 0
    _cached_config = None
    return get_app_options()
