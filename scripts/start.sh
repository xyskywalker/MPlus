#!/bin/bash
# MPlus 启动脚本

echo "🚀 启动 MPlus 服务..."

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

cd "$PROJECT_ROOT"

# 检查数据库是否存在
if [ ! -f "data/mplus.db" ]; then
    echo "📦 初始化数据库..."
    python scripts/init_db.py
fi

# 启动后端服务
echo "🔧 启动后端服务..."
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

echo "✅ 后端服务已启动 (PID: $BACKEND_PID)"
echo "   访问地址: http://localhost:8000"
echo "   API 文档: http://localhost:8000/docs"

# 等待终止信号
trap "echo '正在停止服务...'; kill $BACKEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM

wait $BACKEND_PID
