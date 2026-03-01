"""
平台画像加载器模块
解析 platform-profiles/*.md 文件为结构化数据，
提取注入 System Prompt 所需的关键信息块。
"""

import re
import logging
from dataclasses import dataclass, field
from typing import Optional, Dict
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class PlatformProfile:
    """平台画像结构化数据"""
    platform_code: str           # 平台代码
    platform_name: str           # 平台中文名
    algorithm_signals: str       # 算法核心信号（压缩文本）
    viral_characteristics: str   # 爆款内容特征（压缩文本）
    audience_summary: str        # 受众画像摘要（压缩文本）
    tone_requirements: str       # 内容调性要求（压缩文本）
    content_restrictions: str    # 平台红线（压缩文本）
    simulation_params: Optional[dict] = field(default=None)  # 模拟参数


# 平台代码到中文名的映射
PLATFORM_NAMES = {
    "xiaohongshu": "小红书",
    "douyin": "抖音",
    "weibo": "微博",
    "bilibili": "B站",
    "zhihu": "知乎",
    "wechat": "微信公众号",
    "generic": "通用平台",
}


class PlatformProfileLoader:
    """
    平台画像加载器

    职责：
    1. 解析 Markdown 画像文件为结构化数据
    2. 提取注入 System Prompt 所需的关键信息块
    3. 缓存解析结果（画像文件不常更新）

    解析维度（映射到 System Prompt 注入模板）：
    - algorithm_signals: 从"算法机制"/"推荐机制"章节提取
    - viral_characteristics: 从"内容生态"/"爆款特征"章节提取
    - audience_summary: 从"用户画像"章节提取
    - tone_requirements: 从"互动特征"/"内容调性"章节提取
    - content_restrictions: 从"内容红线"/"内容限制"章节提取
    - simulation_params: 从末尾 YAML 代码块提取
    """

    # 画像文件目录：使用 skills/social-media/platforms/ 内的版本
    PROFILE_DIR = Path("skills/social-media/platforms")

    # 支持的平台列表
    PLATFORMS = [
        "xiaohongshu", "douyin", "weibo",
        "bilibili", "zhihu", "wechat", "generic"
    ]

    # 类级缓存
    _cache: Dict[str, PlatformProfile] = {}

    @classmethod
    def load(cls, platform_code: str) -> Optional[PlatformProfile]:
        """加载平台画像（带缓存）"""
        if platform_code not in cls.PLATFORMS:
            logger.warning(f"不支持的平台: {platform_code}，使用 generic")
            platform_code = "generic"

        if platform_code not in cls._cache:
            profile = cls._parse_profile(platform_code)
            if profile:
                cls._cache[platform_code] = profile
            else:
                logger.error(f"解析平台画像失败: {platform_code}")
                return None

        return cls._cache[platform_code]

    @classmethod
    def preload_all(cls):
        """预加载所有平台画像（应用启动时调用）"""
        loaded = 0
        for platform in cls.PLATFORMS:
            profile = cls.load(platform)
            if profile:
                loaded += 1
        logger.info(f"平台画像预加载完成: {loaded}/{len(cls.PLATFORMS)} 个平台")

    @classmethod
    def clear_cache(cls):
        """清除缓存（画像文件更新后调用）"""
        cls._cache.clear()

    @classmethod
    def _parse_profile(cls, platform_code: str) -> Optional[PlatformProfile]:
        """解析 Markdown 画像文件"""
        file_path = cls.PROFILE_DIR / f"{platform_code}.md"
        if not file_path.exists():
            logger.error(f"画像文件不存在: {file_path}")
            return None

        try:
            content = file_path.read_text(encoding="utf-8")
        except Exception as e:
            logger.error(f"读取画像文件失败: {file_path}, {e}")
            return None

        # 按二级标题分割章节
        sections = cls._split_sections(content)

        # 提取各维度信息
        algorithm_signals = cls._extract_algorithm_signals(sections)
        viral_characteristics = cls._extract_viral_characteristics(sections)
        audience_summary = cls._extract_audience_summary(sections)
        tone_requirements = cls._extract_tone_requirements(sections)
        content_restrictions = cls._extract_content_restrictions(sections)
        simulation_params = cls._extract_simulation_params(content)

        platform_name = PLATFORM_NAMES.get(platform_code, platform_code)

        return PlatformProfile(
            platform_code=platform_code,
            platform_name=platform_name,
            algorithm_signals=algorithm_signals,
            viral_characteristics=viral_characteristics,
            audience_summary=audience_summary,
            tone_requirements=tone_requirements,
            content_restrictions=content_restrictions,
            simulation_params=simulation_params,
        )

    @classmethod
    def _split_sections(cls, content: str) -> Dict[str, str]:
        """按二级标题(##)分割章节"""
        sections = {}
        # 匹配所有 ## 标题
        pattern = r'^## (.+?)$'
        matches = list(re.finditer(pattern, content, re.MULTILINE))

        for i, match in enumerate(matches):
            title = match.group(1).strip()
            start = match.end()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
            section_content = content[start:end].strip()
            sections[title] = section_content

        return sections

    @classmethod
    def _extract_algorithm_signals(cls, sections: Dict[str, str]) -> str:
        """从算法机制章节提取核心信号"""
        # 尝试匹配不同的章节标题格式
        keywords = ["算法机制", "推荐机制", "算法", "推荐系统"]
        section_content = cls._find_section(sections, keywords)

        if not section_content:
            return "暂无算法信号数据"

        # 提取要点列表和关键数据，压缩为摘要
        return cls._compress_section(section_content, max_lines=15)

    @classmethod
    def _extract_viral_characteristics(cls, sections: Dict[str, str]) -> str:
        """从内容生态章节提取爆款特征"""
        keywords = ["内容生态", "内容特征", "爆款", "内容"]
        section_content = cls._find_section(sections, keywords)

        if not section_content:
            return "暂无爆款特征数据"

        # 优先提取"爆款"相关的子章节
        subsection = cls._extract_subsection(section_content, ["爆款", "热门", "高质量"])
        if subsection:
            return cls._compress_section(subsection, max_lines=12)

        return cls._compress_section(section_content, max_lines=12)

    @classmethod
    def _extract_audience_summary(cls, sections: Dict[str, str]) -> str:
        """从用户画像章节提取受众摘要"""
        keywords = ["用户画像", "用户", "受众"]
        section_content = cls._find_section(sections, keywords)

        if not section_content:
            return "暂无受众数据"

        # 优先提取人口统计子章节
        subsection = cls._extract_subsection(section_content, ["人口统计", "统计", "分布"])
        if subsection:
            return cls._compress_section(subsection, max_lines=10)

        return cls._compress_section(section_content, max_lines=10)

    @classmethod
    def _extract_tone_requirements(cls, sections: Dict[str, str]) -> str:
        """从互动特征章节提取调性要求"""
        keywords = ["互动特征", "互动", "社区文化", "调性"]
        section_content = cls._find_section(sections, keywords)

        if not section_content:
            return "暂无调性要求"

        # 优先提取文化/调性相关子章节
        subsection = cls._extract_subsection(
            section_content, ["社区文化", "文化", "调性", "评论区"]
        )
        if subsection:
            return cls._compress_section(subsection, max_lines=8)

        return cls._compress_section(section_content, max_lines=8)

    @classmethod
    def _extract_content_restrictions(cls, sections: Dict[str, str]) -> str:
        """从内容生态章节提取平台红线"""
        # 先在内容生态中查找红线子章节
        keywords = ["内容生态", "内容"]
        section_content = cls._find_section(sections, keywords)

        if section_content:
            subsection = cls._extract_subsection(
                section_content, ["红线", "禁忌", "限制", "违规"]
            )
            if subsection:
                return cls._compress_section(subsection, max_lines=8)

        # 也查找独立的红线章节
        keywords2 = ["红线", "限制", "禁忌"]
        section_content2 = cls._find_section(sections, keywords2)
        if section_content2:
            return cls._compress_section(section_content2, max_lines=8)

        return "遵守平台通用规则"

    @classmethod
    def _extract_simulation_params(cls, content: str) -> Optional[dict]:
        """从末尾 YAML 代码块提取模拟参数"""
        # 匹配 ```yaml ... ``` 代码块
        yaml_pattern = r'```yaml\s*\n(.*?)```'
        matches = re.findall(yaml_pattern, content, re.DOTALL)
        if not matches:
            return None

        try:
            import yaml
            # 取最后一个 yaml 块（通常是模拟参数）
            params = yaml.safe_load(matches[-1])
            return params
        except Exception:
            # yaml 不是必须依赖，解析失败不影响核心功能
            return None

    @classmethod
    def _find_section(cls, sections: Dict[str, str], keywords: list) -> Optional[str]:
        """通过关键词匹配查找章节"""
        for title, content in sections.items():
            for keyword in keywords:
                if keyword in title:
                    return content
        return None

    @classmethod
    def _extract_subsection(cls, content: str, keywords: list) -> Optional[str]:
        """从章节内容中提取包含关键词的子章节（### 级别）"""
        # 按三级标题分割
        pattern = r'^### (.+?)$'
        matches = list(re.finditer(pattern, content, re.MULTILINE))

        for i, match in enumerate(matches):
            title = match.group(1).strip()
            for keyword in keywords:
                if keyword in title:
                    start = match.end()
                    end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
                    return content[start:end].strip()

        return None

    @classmethod
    def _compress_section(cls, content: str, max_lines: int = 12) -> str:
        """
        压缩章节内容为简洁摘要

        策略：
        1. 保留要点列表（- 开头的行）
        2. 保留关键数据行
        3. 移除空行和过长的解释文本
        4. 限制总行数
        """
        lines = content.split("\n")
        compressed = []

        for line in lines:
            stripped = line.strip()
            # 跳过空行
            if not stripped:
                continue
            # 跳过子标题装饰
            if stripped.startswith("---"):
                continue
            # 跳过表格分隔线
            if stripped.startswith("|--") or stripped.startswith("| --"):
                continue
            # 保留要点列表
            if stripped.startswith("-") or stripped.startswith("*"):
                compressed.append(stripped)
                continue
            # 保留表格行
            if stripped.startswith("|"):
                compressed.append(stripped)
                continue
            # 保留三级标题
            if stripped.startswith("###"):
                compressed.append(stripped)
                continue
            # 保留包含数字/数据的行
            if re.search(r'\d+[%万亿]', stripped):
                compressed.append(stripped)
                continue
            # 保留较短的描述行（控制 token 量）
            if len(stripped) < 80:
                compressed.append(stripped)
                continue

        # 限制行数
        result = "\n".join(compressed[:max_lines])
        return result if result else content[:500]
