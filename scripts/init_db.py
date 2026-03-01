#!/usr/bin/env python
"""
数据库初始化脚本
可单独执行以重置数据库
"""

import asyncio
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.db.database import init_db, engine


async def main():
    """主函数"""
    print("开始初始化数据库...")
    
    try:
        await init_db()
        print("✓ 数据库初始化成功")
    except Exception as e:
        print(f"✗ 数据库初始化失败: {e}")
        sys.exit(1)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
