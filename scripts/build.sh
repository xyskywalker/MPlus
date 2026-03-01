#!/bin/bash
# ============================================================
# MPlus 生产环境构建脚本
# 编译前端为静态文件，运行时仅需 Python 后端即可
# 适配 macOS 和 Linux 系统
# ============================================================

set -e

# ==================== 颜色定义 ====================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ==================== 工具函数 ====================

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; }
step()    { echo -e "\n${CYAN}==== $1 ====${NC}"; }

# ==================== 变量定义 ====================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BACKEND_STATIC_DIR="$PROJECT_ROOT/backend/static"
DATA_DIR="$PROJECT_ROOT/data"

SKIP_NPM_INSTALL=false
SKIP_POETRY_INSTALL=false
SKIP_DB_INIT=false
CLEAN_NODE_MODULES=false
PROD_START=false

# ==================== 参数解析 ====================

usage() {
    echo "用法: $0 [选项]"
    echo ""
    echo "选项:"
    echo "  --skip-npm         跳过 npm install（已有 node_modules 时可用）"
    echo "  --skip-poetry      跳过 poetry install（已安装 Python 依赖时可用）"
    echo "  --skip-db          跳过数据库初始化"
    echo "  --clean            构建完成后删除 frontend/node_modules 节省空间"
    echo "  --start            构建完成后直接启动生产服务"
    echo "  -h, --help         显示帮助信息"
    echo ""
    echo "示例:"
    echo "  $0                 完整构建"
    echo "  $0 --clean         构建后清理 node_modules"
    echo "  $0 --start         构建并启动服务"
    echo "  $0 --skip-npm      跳过前端依赖安装（加速重复构建）"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-npm)       SKIP_NPM_INSTALL=true; shift ;;
        --skip-poetry)    SKIP_POETRY_INSTALL=true; shift ;;
        --skip-db)        SKIP_DB_INIT=true; shift ;;
        --clean)          CLEAN_NODE_MODULES=true; shift ;;
        --start)          PROD_START=true; shift ;;
        -h|--help)        usage; exit 0 ;;
        *)                error "未知参数: $1"; usage; exit 1 ;;
    esac
done

# ==================== 系统检测 ====================

step "检测系统环境"

OS_TYPE="$(uname -s)"
case "$OS_TYPE" in
    Darwin) OS_NAME="macOS" ;;
    Linux)  OS_NAME="Linux" ;;
    *)      error "不支持的操作系统: $OS_TYPE"; exit 1 ;;
esac

ARCH="$(uname -m)"
info "操作系统: $OS_NAME ($ARCH)"
info "项目路径: $PROJECT_ROOT"

# ==================== 前置检查 ====================

step "检查构建依赖"

HAS_ERROR=false

# Node.js（仅构建时需要）
if command -v node &>/dev/null; then
    NODE_VER="$(node --version)"
    success "Node.js: $NODE_VER"
    NODE_MAJOR="${NODE_VER#v}"
    NODE_MAJOR="${NODE_MAJOR%%.*}"
    if [[ "$NODE_MAJOR" -lt 16 ]]; then
        error "Node.js 版本过低，需要 >= 16.x"
        HAS_ERROR=true
    fi
else
    error "未找到 Node.js（仅构建时需要，运行时不需要）"
    echo "  安装方式:"
    if [[ "$OS_NAME" == "macOS" ]]; then
        echo "    brew install node"
    else
        echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
        echo "    sudo apt-get install -y nodejs"
    fi
    HAS_ERROR=true
fi

# npm
if command -v npm &>/dev/null; then
    success "npm: $(npm --version)"
else
    error "未找到 npm"
    HAS_ERROR=true
fi

# Python
if command -v python3 &>/dev/null; then
    PY_VER="$(python3 --version)"
    success "Python: $PY_VER"
elif command -v python &>/dev/null; then
    PY_VER="$(python --version)"
    success "Python: $PY_VER"
else
    error "未找到 Python 3"
    HAS_ERROR=true
fi

# Poetry
if command -v poetry &>/dev/null; then
    success "Poetry: $(poetry --version 2>/dev/null | head -1)"
else
    warn "未找到 Poetry，将跳过 Python 依赖安装"
    warn "  安装方式: curl -sSL https://install.python-poetry.org | python3 -"
    SKIP_POETRY_INSTALL=true
fi

if [[ "$HAS_ERROR" == true ]]; then
    error "请先安装缺失的依赖再重试"
    exit 1
fi

# ==================== 环境配置 ====================

step "检查环境配置"

if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
    if [[ -f "$PROJECT_ROOT/.env.example" ]]; then
        cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
        # 生产环境关闭 DEBUG
        if [[ "$OS_NAME" == "macOS" ]]; then
            sed -i '' 's/^DEBUG=true/DEBUG=false/' "$PROJECT_ROOT/.env"
        else
            sed -i 's/^DEBUG=true/DEBUG=false/' "$PROJECT_ROOT/.env"
        fi
        success "已从 .env.example 创建 .env（DEBUG 已设为 false）"
        warn "请根据需要修改 .env 中的配置"
    else
        warn "未找到 .env 文件和模板，请手动创建"
    fi
else
    success ".env 文件已存在"
fi

# 确保 data 目录存在
mkdir -p "$DATA_DIR"

# ==================== Python 依赖安装 ====================

if [[ "$SKIP_POETRY_INSTALL" == false ]]; then
    step "安装 Python 依赖"
    cd "$PROJECT_ROOT"
    poetry install --no-interaction 2>&1 | tail -5
    success "Python 依赖安装完成"
else
    info "跳过 Python 依赖安装"
fi

# ==================== 前端构建 ====================

step "构建前端"

cd "$FRONTEND_DIR"

# 安装前端依赖
if [[ "$SKIP_NPM_INSTALL" == false ]]; then
    info "安装前端依赖..."
    npm install --legacy-peer-deps 2>&1 | tail -3
    success "前端依赖安装完成"
else
    if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
        warn "node_modules 不存在，强制执行 npm install"
        npm install --legacy-peer-deps 2>&1 | tail -3
        success "前端依赖安装完成"
    else
        info "跳过 npm install"
    fi
fi

# 清理旧构建产物
if [[ -d "$BACKEND_STATIC_DIR" ]]; then
    info "清理旧的构建产物..."
    rm -rf "$BACKEND_STATIC_DIR"
fi

# 执行构建
info "编译前端（TypeScript 检查 + Vite 构建）..."
npm run build 2>&1

if [[ -f "$BACKEND_STATIC_DIR/index.html" ]]; then
    STATIC_SIZE=$(du -sh "$BACKEND_STATIC_DIR" 2>/dev/null | cut -f1)
    FILE_COUNT=$(find "$BACKEND_STATIC_DIR" -type f | wc -l | tr -d ' ')
    success "前端构建成功 -> backend/static/ ($FILE_COUNT 个文件, $STATIC_SIZE)"
else
    error "前端构建失败：未生成 index.html"
    exit 1
fi

# 清理 node_modules（可选）
if [[ "$CLEAN_NODE_MODULES" == true ]]; then
    info "清理 frontend/node_modules..."
    rm -rf "$FRONTEND_DIR/node_modules"
    success "node_modules 已清理（运行时不需要）"
fi

# ==================== 数据库初始化 ====================

if [[ "$SKIP_DB_INIT" == false ]]; then
    step "初始化数据库"
    cd "$PROJECT_ROOT"
    if [[ -f "$DATA_DIR/mplus.db" ]]; then
        info "数据库已存在，跳过初始化"
    else
        info "初始化数据库..."
        if command -v poetry &>/dev/null; then
            poetry run python scripts/init_db.py
        else
            python3 scripts/init_db.py
        fi
        success "数据库初始化完成"
    fi
else
    info "跳过数据库初始化"
fi

# ==================== 构建完成 ====================

step "构建完成"

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  MPlus 生产构建完成！${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "  前端产物: ${CYAN}backend/static/${NC}"
echo -e "  数据目录: ${CYAN}data/${NC}"
echo -e "  环境配置: ${CYAN}.env${NC}"
echo ""
echo -e "  ${YELLOW}运行时仅需 Python，无需 Node.js${NC}"
echo ""
echo "  启动方式："
echo -e "    ${CYAN}cd $PROJECT_ROOT${NC}"
echo ""
echo "    # 方式一：直接启动（确保已激活 Python 虚拟环境）"
echo -e "    ${CYAN}uvicorn backend.main:app --host 0.0.0.0 --port 8000${NC}"
echo ""
echo "    # 方式二：通过 Poetry 启动"
echo -e "    ${CYAN}poetry run uvicorn backend.main:app --host 0.0.0.0 --port 8000${NC}"
echo ""
echo "    # 方式三：使用 TUI 管理"
echo -e "    ${CYAN}poetry run mplus${NC}"
echo ""
echo -e "  访问地址: ${CYAN}http://localhost:8000${NC}"
echo -e "  API 文档: ${CYAN}http://localhost:8000/docs${NC}"
echo ""

# ==================== 可选：直接启动 ====================

if [[ "$PROD_START" == true ]]; then
    step "启动生产服务"
    cd "$PROJECT_ROOT"

    WORKERS=1
    if command -v nproc &>/dev/null; then
        CPU_CORES=$(nproc)
        WORKERS=$(( CPU_CORES > 4 ? 4 : CPU_CORES ))
    elif command -v sysctl &>/dev/null; then
        CPU_CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo 1)
        WORKERS=$(( CPU_CORES > 4 ? 4 : CPU_CORES ))
    fi

    HOST=$(grep -E '^HOST=' .env 2>/dev/null | cut -d= -f2 || echo "0.0.0.0")
    PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || echo "8000")
    HOST="${HOST:-0.0.0.0}"
    PORT="${PORT:-8000}"

    info "启动参数: host=$HOST, port=$PORT, workers=$WORKERS"

    trap 'echo ""; info "正在停止服务..."; kill $SERVER_PID 2>/dev/null; exit 0' SIGINT SIGTERM

    if command -v poetry &>/dev/null; then
        poetry run uvicorn backend.main:app \
            --host "$HOST" \
            --port "$PORT" \
            --workers "$WORKERS" \
            --log-level info &
    else
        uvicorn backend.main:app \
            --host "$HOST" \
            --port "$PORT" \
            --workers "$WORKERS" \
            --log-level info &
    fi
    SERVER_PID=$!

    success "服务已启动 (PID: $SERVER_PID)"
    info "按 Ctrl+C 停止服务"

    wait $SERVER_PID
fi
