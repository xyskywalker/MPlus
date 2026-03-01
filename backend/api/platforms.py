"""
平台画像 API 路由
提供平台信息查询 (Mock 数据)
"""

from fastapi import APIRouter, HTTPException

router = APIRouter()

# Mock 平台数据
PLATFORMS = [
    {
        "code": "xiaohongshu",
        "name": "小红书",
        "icon": "📕",
        "color": "#FE2C55",
        "type": "种草社区",
        "content_forms": ["图文", "短视频"],
        "description": "年轻女性为主的生活方式分享平台",
        "user_profile": {
            "age_distribution": [
                {"range": "18-24", "percentage": 35},
                {"range": "25-34", "percentage": 45},
                {"range": "35+", "percentage": 20}
            ],
            "gender_ratio": {"female": 70, "male": 30},
            "city_distribution": {"tier1": 40, "tier2": 35, "other": 25}
        },
        "algorithm": {
            "cold_start_exposure": "200-500",
            "viral_threshold": {
                "level2": "互动率 > 5%",
                "level3": "互动率 > 10%",
                "viral": "互动率 > 15%"
            }
        },
        "peak_hours": ["12:00-14:00", "20:00-23:00"],
        "interests": [
            {"name": "美妆护肤", "percentage": 25},
            {"name": "穿搭时尚", "percentage": 20},
            {"name": "美食探店", "percentage": 18},
            {"name": "生活方式", "percentage": 15},
            {"name": "职场成长", "percentage": 10},
            {"name": "其他", "percentage": 12}
        ]
    },
    {
        "code": "douyin",
        "name": "抖音",
        "icon": "🎵",
        "color": "#000000",
        "type": "短视频平台",
        "content_forms": ["短视频", "直播"],
        "description": "国民级短视频娱乐平台",
        "user_profile": {
            "age_distribution": [
                {"range": "18-24", "percentage": 30},
                {"range": "25-34", "percentage": 35},
                {"range": "35+", "percentage": 35}
            ],
            "gender_ratio": {"female": 52, "male": 48},
            "city_distribution": {"tier1": 25, "tier2": 30, "other": 45}
        },
        "algorithm": {
            "cold_start_exposure": "300-800",
            "viral_threshold": {
                "level2": "完播率 > 30%",
                "level3": "完播率 > 50%",
                "viral": "完播率 > 70%"
            }
        },
        "peak_hours": ["12:00-14:00", "18:00-22:00"],
        "interests": [
            {"name": "搞笑娱乐", "percentage": 22},
            {"name": "颜值达人", "percentage": 18},
            {"name": "生活记录", "percentage": 15},
            {"name": "知识科普", "percentage": 12},
            {"name": "美食", "percentage": 10},
            {"name": "其他", "percentage": 23}
        ]
    },
    {
        "code": "weibo",
        "name": "微博",
        "icon": "🔴",
        "color": "#E6162D",
        "type": "社交媒体",
        "content_forms": ["图文", "视频", "直播"],
        "description": "开放式社交媒体平台，热点讨论聚集地",
        "user_profile": {
            "age_distribution": [
                {"range": "18-24", "percentage": 28},
                {"range": "25-34", "percentage": 40},
                {"range": "35+", "percentage": 32}
            ],
            "gender_ratio": {"female": 55, "male": 45},
            "city_distribution": {"tier1": 35, "tier2": 35, "other": 30}
        },
        "algorithm": {
            "cold_start_exposure": "粉丝基础",
            "viral_threshold": {
                "trending": "转发 > 1000",
                "hot": "转发 > 10000"
            }
        },
        "peak_hours": ["08:00-10:00", "12:00-14:00", "20:00-23:00"],
        "interests": [
            {"name": "娱乐八卦", "percentage": 25},
            {"name": "时事热点", "percentage": 20},
            {"name": "情感", "percentage": 15},
            {"name": "搞笑", "percentage": 12},
            {"name": "其他", "percentage": 28}
        ]
    },
    {
        "code": "bilibili",
        "name": "B站",
        "icon": "📺",
        "color": "#00A1D6",
        "type": "视频社区",
        "content_forms": ["视频", "直播", "专栏"],
        "description": "年轻人的文化社区，ACG与泛娱乐内容",
        "user_profile": {
            "age_distribution": [
                {"range": "18-24", "percentage": 45},
                {"range": "25-34", "percentage": 40},
                {"range": "35+", "percentage": 15}
            ],
            "gender_ratio": {"female": 45, "male": 55},
            "city_distribution": {"tier1": 35, "tier2": 35, "other": 30}
        },
        "algorithm": {
            "cold_start_exposure": "100-300",
            "viral_threshold": {
                "popular": "播放 > 10万",
                "hot": "播放 > 100万"
            }
        },
        "peak_hours": ["12:00-14:00", "19:00-23:00"],
        "interests": [
            {"name": "游戏", "percentage": 20},
            {"name": "动漫", "percentage": 18},
            {"name": "科技数码", "percentage": 15},
            {"name": "生活", "percentage": 12},
            {"name": "知识", "percentage": 10},
            {"name": "其他", "percentage": 25}
        ]
    },
    {
        "code": "zhihu",
        "name": "知乎",
        "icon": "💡",
        "color": "#0066FF",
        "type": "知识问答",
        "content_forms": ["图文", "视频", "专栏"],
        "description": "高质量问答社区，专业内容聚集地",
        "user_profile": {
            "age_distribution": [
                {"range": "18-24", "percentage": 25},
                {"range": "25-34", "percentage": 50},
                {"range": "35+", "percentage": 25}
            ],
            "gender_ratio": {"female": 40, "male": 60},
            "city_distribution": {"tier1": 45, "tier2": 35, "other": 20}
        },
        "algorithm": {
            "cold_start_exposure": "问题热度相关",
            "viral_threshold": {
                "good": "赞同 > 100",
                "hot": "赞同 > 1000"
            }
        },
        "peak_hours": ["10:00-12:00", "20:00-23:00"],
        "interests": [
            {"name": "职场", "percentage": 18},
            {"name": "科技", "percentage": 15},
            {"name": "生活", "percentage": 14},
            {"name": "教育", "percentage": 12},
            {"name": "心理", "percentage": 10},
            {"name": "其他", "percentage": 31}
        ]
    },
    {
        "code": "wechat",
        "name": "公众号",
        "icon": "💚",
        "color": "#07C160",
        "type": "订阅媒体",
        "content_forms": ["图文", "视频"],
        "description": "微信生态内容订阅平台",
        "user_profile": {
            "age_distribution": [
                {"range": "18-24", "percentage": 20},
                {"range": "25-34", "percentage": 40},
                {"range": "35+", "percentage": 40}
            ],
            "gender_ratio": {"female": 50, "male": 50},
            "city_distribution": {"tier1": 30, "tier2": 35, "other": 35}
        },
        "algorithm": {
            "cold_start_exposure": "粉丝基础",
            "viral_threshold": {
                "good": "阅读 > 1万",
                "viral": "阅读 > 10万"
            }
        },
        "peak_hours": ["08:00-09:00", "12:00-13:00", "21:00-22:00"],
        "interests": [
            {"name": "资讯", "percentage": 20},
            {"name": "职场", "percentage": 15},
            {"name": "情感", "percentage": 14},
            {"name": "教育", "percentage": 12},
            {"name": "健康", "percentage": 10},
            {"name": "其他", "percentage": 29}
        ]
    },
    {
        "code": "generic",
        "name": "通用",
        "icon": "📱",
        "color": "#6366F1",
        "type": "通用平台",
        "content_forms": ["图文", "视频"],
        "description": "通用平台画像，适用于未特别定制的平台",
        "user_profile": {
            "age_distribution": [
                {"range": "18-24", "percentage": 30},
                {"range": "25-34", "percentage": 40},
                {"range": "35+", "percentage": 30}
            ],
            "gender_ratio": {"female": 50, "male": 50},
            "city_distribution": {"tier1": 33, "tier2": 34, "other": 33}
        },
        "algorithm": {
            "cold_start_exposure": "300-500",
            "viral_threshold": {
                "good": "互动率 > 3%",
                "viral": "互动率 > 10%"
            }
        },
        "peak_hours": ["12:00-14:00", "19:00-22:00"],
        "interests": []
    }
]


@router.get("/platforms")
async def list_platforms():
    """获取可用平台列表"""
    # 返回简化的平台列表（含 content_forms 供前端过滤内容类型）
    platform_list = [
        {
            "code": p["code"],
            "name": p["name"],
            "icon": p["icon"],
            "color": p["color"],
            "type": p["type"],
            "description": p["description"],
            "content_forms": p.get("content_forms", [])
        }
        for p in PLATFORMS
    ]
    
    return {
        "code": 0,
        "data": platform_list,
        "message": "success"
    }


@router.get("/platforms/{platform_code}")
async def get_platform(platform_code: str):
    """获取平台详情"""
    for platform in PLATFORMS:
        if platform["code"] == platform_code:
            return {"code": 0, "data": platform, "message": "success"}
    
    raise HTTPException(status_code=404, detail="平台不存在")
