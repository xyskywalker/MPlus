"""
MPlus TUI 主程序
提供终端管理界面，支持一键初始化、服务管理和监控
兼容 Windows / macOS / Linux 全平台
"""

import platform
import shutil
import signal
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from typing import Dict, Optional

# 自动安装 rich（首次运行时可能尚未安装依赖）
try:
    from rich import box
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Confirm, Prompt
    from rich.rule import Rule
    from rich.table import Table
    from rich.text import Text
except ImportError:
    print("正在安装界面组件 (rich)...")
    subprocess.check_call(
        [sys.executable, "-m", "pip", "install", "rich"],
        stdout=subprocess.DEVNULL,
    )
    from rich import box  # noqa: E402
    from rich.console import Console  # noqa: E402
    from rich.panel import Panel  # noqa: E402
    from rich.prompt import Confirm, Prompt  # noqa: E402
    from rich.rule import Rule  # noqa: E402
    from rich.table import Table  # noqa: E402
    from rich.text import Text  # noqa: E402

# 项目根目录
PROJECT_ROOT = Path(__file__).parent.parent.resolve()

# 控制台实例
console = Console()

# 全局状态
server_process: Optional[subprocess.Popen] = None


# ============================================================
#  工具函数
# ============================================================

def get_version() -> str:
    """从 pyproject.toml 读取版本号"""
    try:
        toml_path = PROJECT_ROOT / "pyproject.toml"
        if toml_path.exists():
            for line in toml_path.read_text(encoding="utf-8").splitlines():
                if line.strip().startswith("version"):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return "1.0.0"


def _npm_cmd() -> str:
    """返回当前平台的 npm 可执行命令名"""
    return "npm.cmd" if platform.system() == "Windows" else "npm"


def _run(cmd, cwd=None, timeout=300, show_last_lines=5) -> subprocess.CompletedProcess:
    """执行子进程，统一错误处理"""
    result = subprocess.run(
        cmd,
        cwd=cwd or str(PROJECT_ROOT),
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0 and show_last_lines:
        output = (result.stderr or result.stdout or "").strip()
        if output:
            lines = output.splitlines()[-show_last_lines:]
            for line in lines:
                console.print(f"    [dim]{line}[/dim]")
    return result


def open_browser(url: str):
    """跨平台打开默认浏览器"""
    try:
        webbrowser.open(url)
        console.print(f"  [green]✓[/green] 已打开浏览器: {url}")
    except Exception:
        console.print(f"  [yellow]⚠️  无法自动打开浏览器，请手动访问: {url}[/yellow]")


# ============================================================
#  界面展示
# ============================================================

def print_banner():
    """打印欢迎横幅"""
    ver = get_version()
    banner = Text()
    banner.append("百万加 MPlus\n", style="bold bright_white")
    banner.append("AI驱动的自媒体选题和模拟预测智能体\n\n", style="bright_cyan")
    banner.append(f"v{ver}", style="dim")
    banner.append(f"  |  Python {platform.python_version()}", style="dim")
    banner.append(f"  |  {platform.system()} {platform.machine()}", style="dim")
    console.print(Panel(
        banner,
        title="[bold bright_blue]MPlus[/bold bright_blue]",
        title_align="left",
        border_style="bright_blue",
        padding=(1, 3),
        box=box.DOUBLE,
    ))


def print_menu():
    """打印主菜单"""
    table = Table(show_header=False, show_edge=False, box=None, padding=(0, 2))
    table.add_column("选项", style="bold cyan", width=6, justify="center")
    table.add_column("描述", style="white")
    table.add_column("说明", style="dim")

    table.add_row("[0]", "一键初始化", "推荐新用户 — 自动完成所有准备并启动")
    table.add_row("", "", "")
    table.add_row("[1]", "启动服务", "启动 Web 服务并可自动打开浏览器")
    table.add_row("[2]", "停止服务", "停止当前运行的 Web 服务")
    table.add_row("[3]", "系统状态", "查看运行状态与环境信息")
    table.add_row("", "", "")
    table.add_row("[4]", "环境检查", "检测运行环境和依赖完整性")
    table.add_row("[5]", "安装依赖", "安装后端 Python + 前端 Node.js 依赖")
    table.add_row("[6]", "构建前端", "编译前端资源到生产目录")
    table.add_row("[7]", "初始化数据库", "创建或重置数据库表结构")
    table.add_row("", "", "")
    table.add_row("[8]", "查看日志", "查看服务运行日志")
    table.add_row("[9]", "配置管理", "查看当前系统配置")
    table.add_row("", "", "")
    table.add_row("(q)", "(q) 退出", "")

    console.print(Panel(
        table,
        title="[bold]主菜单[/bold]",
        border_style="bright_blue",
        box=box.ROUNDED,
    ))


# ============================================================
#  环境检测
# ============================================================

def _cmd_version(cmd: str, args=("--version",), timeout=10) -> Optional[str]:
    """获取命令行工具版本，失败返回 None"""
    path = shutil.which(cmd)
    if not path:
        return None
    try:
        r = subprocess.run(
            [path, *args], capture_output=True, text=True, timeout=timeout,
        )
        return r.stdout.strip() or r.stderr.strip() if r.returncode == 0 else None
    except Exception:
        return None


def check_env_file() -> bool:
    return (PROJECT_ROOT / ".env").exists()


def check_data_dir() -> bool:
    return (PROJECT_ROOT / "data").is_dir()


def check_database() -> bool:
    return (PROJECT_ROOT / "data" / "mplus.db").exists()


def check_frontend_built() -> bool:
    return (PROJECT_ROOT / "backend" / "static" / "index.html").exists()


def check_frontend_deps() -> bool:
    return (PROJECT_ROOT / "frontend" / "node_modules").is_dir()


def check_python_deps() -> bool:
    """检查关键 Python 依赖是否可导入"""
    for mod in ("fastapi", "uvicorn", "sqlalchemy", "aiosqlite", "pydantic"):
        try:
            __import__(mod)
        except ImportError:
            return False
    return True


def run_environment_check() -> Dict[str, dict]:
    """完整环境检查，返回各项结果"""
    checks: Dict[str, dict] = {}

    # Python
    checks["python"] = {
        "name": "Python 环境",
        "ok": True,
        "detail": f"{platform.python_version()} ({sys.executable})",
    }

    # Node.js
    node_ver = _cmd_version("node")
    checks["node"] = {
        "name": "Node.js",
        "ok": node_ver is not None,
        "detail": node_ver or "未安装（构建前端需要）",
    }

    # npm
    npm_ver = _cmd_version(_npm_cmd())
    checks["npm"] = {
        "name": "npm",
        "ok": npm_ver is not None,
        "detail": npm_ver or "未安装（安装前端依赖需要）",
    }

    # Poetry
    has_poetry = shutil.which("poetry") is not None
    checks["poetry"] = {
        "name": "Poetry",
        "ok": has_poetry,
        "detail": "已安装" if has_poetry else "未安装（将用 pip 代替）",
    }

    # .env
    has_env = check_env_file()
    checks["env"] = {
        "name": ".env 配置文件",
        "ok": has_env,
        "detail": "已存在" if has_env else "缺失（将从模板创建）",
    }

    # Python 依赖
    has_py = check_python_deps()
    checks["python_deps"] = {
        "name": "Python 依赖包",
        "ok": has_py,
        "detail": "核心依赖就绪" if has_py else "缺失或不完整",
    }

    # 数据目录
    checks["data_dir"] = {
        "name": "数据目录 (data/)",
        "ok": check_data_dir(),
        "detail": "已存在" if check_data_dir() else "缺失（将自动创建）",
    }

    # 数据库
    has_db = check_database()
    checks["database"] = {
        "name": "SQLite 数据库",
        "ok": has_db,
        "detail": "已初始化" if has_db else "未初始化",
    }

    # 前端依赖
    has_fe = check_frontend_deps()
    checks["frontend_deps"] = {
        "name": "前端依赖 (node_modules)",
        "ok": has_fe,
        "detail": "已安装" if has_fe else "未安装",
    }

    # 前端构建
    has_build = check_frontend_built()
    checks["frontend_build"] = {
        "name": "前端构建产物",
        "ok": has_build,
        "detail": "已构建 → backend/static/" if has_build else "未构建",
    }

    return checks


def show_environment_check():
    """在终端展示环境检查报告"""
    console.print(Rule("环境检查", style="bright_blue"))

    with console.status("[bold blue]正在检测运行环境...[/bold blue]"):
        checks = run_environment_check()

    table = Table(show_header=True, box=box.SIMPLE_HEAVY, header_style="bold")
    table.add_column("检查项", style="cyan", min_width=22)
    table.add_column("状态", width=10, justify="center")
    table.add_column("详情", style="dim")

    all_ok = True
    for check in checks.values():
        ok_text = "[green]✓ 通过[/green]" if check["ok"] else "[red]✗ 未通过[/red]"
        if not check["ok"]:
            all_ok = False
        table.add_row(check["name"], ok_text, check["detail"])

    console.print(table)

    if all_ok:
        console.print("\n[bold green]所有检查通过，系统就绪！[/bold green]")
    else:
        console.print(
            "\n[yellow]部分检查未通过，可使用 "
        "[bold]\"0. 一键初始化\"[/bold] 自动修复[/yellow]"
        )


# ============================================================
#  初始化操作
# ============================================================

def ensure_env_file() -> bool:
    """确保 .env 文件存在，不存在则从模板创建"""
    env_path = PROJECT_ROOT / ".env"
    if env_path.exists():
        console.print("  [green]✓[/green] .env 文件已存在")
        return True

    example = PROJECT_ROOT / ".env.example"
    if example.exists():
        shutil.copy2(example, env_path)
        console.print("  [green]✓[/green] 已从 .env.example 创建 .env")
    else:
        env_path.write_text(
            "HOST=0.0.0.0\nPORT=8000\nDEBUG=true\n"
            "DATABASE_URL=sqlite:///./data/mplus.db\n"
            "SIMULATION_ENGINE=mock\n",
            encoding="utf-8",
        )
        console.print("  [green]✓[/green] 已创建默认 .env 文件")
    return True


def ensure_data_dir() -> bool:
    """确保 data/ 目录存在"""
    data_dir = PROJECT_ROOT / "data"
    if data_dir.exists():
        console.print("  [green]✓[/green] data/ 目录已存在")
        return True
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        console.print("  [green]✓[/green] 已创建 data/ 目录")
        return True
    except Exception as e:
        console.print(f"  [red]✗[/red] 创建 data/ 目录失败: {e}")
        return False


def install_python_deps() -> bool:
    """安装 Python 后端依赖"""
    console.print("\n[bold blue]安装 Python 依赖...[/bold blue]")

    # 优先 Poetry
    if shutil.which("poetry"):
        console.print("  使用 Poetry 安装...")
        try:
            r = _run(["poetry", "install", "--no-interaction"], timeout=600)
            if r.returncode == 0:
                console.print("  [green]✓[/green] Python 依赖安装成功 (Poetry)")
                return True
            console.print("  [yellow]Poetry 安装遇到问题，尝试 pip 方案...[/yellow]")
        except subprocess.TimeoutExpired:
            console.print("  [yellow]Poetry 安装超时，尝试 pip 方案...[/yellow]")
        except Exception:
            console.print("  [yellow]Poetry 执行异常，尝试 pip 方案...[/yellow]")

    # pip 回退
    console.print("  使用 pip 安装核心依赖...")
    core_deps = [
        "fastapi>=0.109.0",
        "uvicorn[standard]>=0.27.0",
        "websockets>=12.0",
        "sqlalchemy>=2.0.0",
        "aiosqlite>=0.19.0",
        "httpx>=0.27.0",
        "pydantic>=2.0.0",
        "pydantic-settings>=2.0.0",
        "python-dotenv>=1.0.0",
        "rich>=13.0.0",
        "pyyaml>=6.0",
        "cachetools>=5.3.0",
    ]
    try:
        r = _run(
            [sys.executable, "-m", "pip", "install", *core_deps],
            timeout=600,
        )
        if r.returncode == 0:
            console.print("  [green]✓[/green] Python 核心依赖安装成功 (pip)")
            return True
        console.print("  [red]✗[/red] pip 安装失败")
        return False
    except subprocess.TimeoutExpired:
        console.print("  [red]✗[/red] pip 安装超时（600 秒）")
        return False
    except Exception as e:
        console.print(f"  [red]✗[/red] pip 安装失败: {e}")
        return False


def install_frontend_deps() -> bool:
    """安装前端 Node.js 依赖"""
    console.print("\n[bold blue]安装前端依赖...[/bold blue]")

    npm = shutil.which(_npm_cmd())
    if not npm:
        console.print("  [red]✗[/red] npm 未安装。请先安装 Node.js:")
        console.print("    下载地址: [link=https://nodejs.org]https://nodejs.org[/link]")
        return False

    frontend_dir = PROJECT_ROOT / "frontend"
    if not frontend_dir.exists():
        console.print("  [red]✗[/red] frontend/ 目录不存在")
        return False

    try:
        console.print("  正在执行 npm install（首次安装可能需要几分钟）...")
        r = _run(
            [npm, "install", "--legacy-peer-deps"],
            cwd=str(frontend_dir),
            timeout=600,
        )
        if r.returncode == 0:
            console.print("  [green]✓[/green] 前端依赖安装成功")
            return True
        console.print("  [red]✗[/red] 前端依赖安装失败")
        return False
    except subprocess.TimeoutExpired:
        console.print("  [red]✗[/red] 安装超时（600 秒），请检查网络连接")
        return False
    except Exception as e:
        console.print(f"  [red]✗[/red] 安装失败: {e}")
        return False


def build_frontend() -> bool:
    """构建前端到 backend/static/"""
    console.print("\n[bold blue]构建前端...[/bold blue]")

    npm = shutil.which(_npm_cmd())
    if not npm:
        console.print("  [red]✗[/red] npm 未安装")
        return False

    frontend_dir = PROJECT_ROOT / "frontend"

    # 自动安装依赖（如缺失）
    if not (frontend_dir / "node_modules").is_dir():
        console.print("  [yellow]前端依赖未安装，先执行安装...[/yellow]")
        if not install_frontend_deps():
            return False

    try:
        console.print("  正在编译 TypeScript 并打包资源...")
        r = _run(
            [npm, "run", "build"],
            cwd=str(frontend_dir),
            timeout=120,
        )
        if r.returncode == 0:
            console.print("  [green]✓[/green] 前端构建成功 → backend/static/")
            return True
        console.print("  [red]✗[/red] 前端构建失败（详情见上方输出）")
        return False
    except subprocess.TimeoutExpired:
        console.print("  [red]✗[/red] 构建超时（120 秒）")
        return False
    except Exception as e:
        console.print(f"  [red]✗[/red] 构建失败: {e}")
        return False


def init_database() -> bool:
    """初始化数据库（创建表结构，不会删除已有数据）"""
    console.print("\n[bold blue]初始化数据库...[/bold blue]")
    ensure_data_dir()

    try:
        r = _run(
            [sys.executable, "scripts/init_db.py"],
            timeout=30,
        )
        if r.returncode == 0:
            console.print("  [green]✓[/green] 数据库初始化成功")
            return True
        console.print("  [red]✗[/red] 数据库初始化失败")
        return False
    except Exception as e:
        console.print(f"  [red]✗[/red] 数据库初始化失败: {e}")
        return False


def init_database_interactive():
    """手动菜单调用：初始化数据库（含覆盖警告）"""
    if check_database():
        db_path = PROJECT_ROOT / "data" / "mplus.db"
        size_kb = db_path.stat().st_size / 1024
        console.print(Panel(
            "[bold yellow]数据库文件已存在[/bold yellow]\n\n"
            f"  路径: {db_path}\n"
            f"  大小: {size_kb:.1f} KB\n\n"
            "  重新初始化会重建表结构。\n"
            "  [bold]已有数据通常不受影响[/bold]，"
            "但建议先备份数据库文件。",
            title="[bold yellow]警告[/bold yellow]",
            border_style="yellow",
            box=box.HEAVY,
        ))
        if not Confirm.ask(
            "确定要重新初始化数据库吗？", default=False,
        ):
            console.print("  已取消")
            return
    init_database()


def build_frontend_interactive():
    """手动菜单调用：构建前端（含覆盖警告）"""
    if check_frontend_built():
        static_dir = PROJECT_ROOT / "backend" / "static"
        console.print(Panel(
            "[bold yellow]前端构建产物已存在[/bold yellow]\n\n"
            f"  目录: {static_dir}\n\n"
            "  重新构建会覆盖当前构建产物。",
            title="[bold yellow]提示[/bold yellow]",
            border_style="yellow",
            box=box.HEAVY,
        ))
        if not Confirm.ask(
            "确定要重新构建前端吗？", default=False,
        ):
            console.print("  已取消")
            return
    build_frontend()


# ============================================================
#  一键初始化
# ============================================================

def _step_header(step: int, total: int, title: str):
    """打印步骤标题行"""
    pad = "─" * max(1, 38 - len(title))
    console.print(
        f"\n[bold bright_blue]──── "
        f"步骤 {step}/{total}: {title} "
        f"{pad}[/bold bright_blue]"
    )


def auto_initialize():
    """
    一键初始化：完成所有准备工作并启动服务
    使用仓库内置已构建的前端，无需安装 Node.js
    """
    console.print(Rule("一键初始化", style="bright_blue"))
    console.print("[bold]将自动完成以下步骤（无需 Node.js）:[/bold]\n")
    steps = [
        "1. 环境检测",
        "2. 创建配置文件与数据目录",
        "3. 安装 Python 后端依赖",
        "4. 检查前端资源（使用仓库内置已构建版本）",
        "5. 初始化数据库",
        "6. 启动 Web 服务并打开浏览器",
    ]
    for s in steps:
        console.print(f"  {s}")

    console.print()
    if not Confirm.ask("是否开始？", default=True):
        return

    total = 6

    # ---- 步骤 1 ----
    _step_header(1, total, "环境检测")
    checks = run_environment_check()

    if not checks["python"]["ok"]:
        console.print("[red]Python 环境异常，无法继续[/red]")
        return

    console.print("  [green]✓[/green] 环境检测完成")

    # ---- 步骤 2 ----
    _step_header(2, total, "配置文件")
    ensure_env_file()
    ensure_data_dir()

    # ---- 步骤 3 ----
    _step_header(3, total, "Python 依赖")
    if checks["python_deps"]["ok"]:
        console.print("  [green]✓[/green] Python 依赖已就绪，跳过")
    else:
        if not install_python_deps():
            console.print("[red]Python 依赖安装失败，无法继续[/red]")
            return

    # ---- 步骤 4 ----
    _step_header(4, total, "前端资源")
    if check_frontend_built():
        console.print("  [green]✓[/green] 前端已构建（仓库内置），跳过")
    else:
        console.print(
            "  [yellow]⚠[/yellow] 未检测到前端构建产物 "
            "（backend/static/index.html）"
        )
        console.print(
            "  [dim]服务仍可启动，API 可用；"
            "Web 界面需通过菜单「6. 构建前端」"
            "（需 Node.js）补充[/dim]"
        )

    # ---- 步骤 5 ----
    _step_header(5, total, "数据库")
    if check_database():
        console.print("  [green]✓[/green] 数据库已存在")
    else:
        init_database()

    # ---- 步骤 6 ----
    _step_header(6, total, "启动服务")
    status = get_server_status()
    if status["running"]:
        console.print(f"  [green]✓[/green] 服务已在运行 (PID: {status['pid']})")
        open_browser(status["url"])
    else:
        start_server(auto_open_browser=True)

    # ---- 完成 ----
    console.print()
    port = _read_env_port()
    console.print(Panel(
        f"[bold green]初始化完成！[/bold green]\n\n"
        f"  访问地址: [link]http://localhost:{port}[/link]\n"
        f"  API 文档: [link]http://localhost:{port}/docs[/link]\n\n"
        f"  [dim]首次使用请到「设置 → 模型配置」中添加 AI 模型的 API Key[/dim]",
        title="完成",
        border_style="green",
        box=box.DOUBLE,
    ))


# ============================================================
#  服务管理
# ============================================================

def _read_env_port() -> str:
    """从 .env 读取端口号，默认 8000"""
    env_path = PROJECT_ROOT / ".env"
    if env_path.exists():
        try:
            for line in env_path.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if stripped.startswith("PORT="):
                    return stripped.split("=", 1)[1].strip() or "8000"
        except Exception:
            pass
    return "8000"


def _read_env_host() -> str:
    """从 .env 读取主机地址，默认 0.0.0.0"""
    env_path = PROJECT_ROOT / ".env"
    if env_path.exists():
        try:
            for line in env_path.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if stripped.startswith("HOST="):
                    return stripped.split("=", 1)[1].strip() or "0.0.0.0"
        except Exception:
            pass
    return "0.0.0.0"


def get_server_status() -> dict:
    """获取服务运行状态"""
    global server_process
    port = _read_env_port()
    info = {"running": False, "pid": None, "url": f"http://localhost:{port}"}

    if server_process and server_process.poll() is None:
        info["running"] = True
        info["pid"] = server_process.pid

    return info


def _wait_for_server(port: str, max_wait: int = 15) -> bool:
    """轮询等待服务就绪，返回是否成功"""
    import urllib.error
    import urllib.request

    console.print("  等待服务就绪", end="")
    for _ in range(max_wait):
        time.sleep(1)
        # 进程已退出
        if server_process and server_process.poll() is not None:
            console.print(" [red]失败[/red]")
            return False
        try:
            urllib.request.urlopen(
                f"http://127.0.0.1:{port}/api/health", timeout=2,
            )
            console.print(" [green]就绪[/green]")
            return True
        except (urllib.error.URLError, OSError):
            console.print(".", end="")

    # 超时但进程仍在
    if server_process and server_process.poll() is None:
        console.print(" [yellow]超时（进程仍在运行）[/yellow]")
        return True
    console.print(" [red]失败[/red]")
    return False


def start_server(auto_open_browser: bool = False):
    """启动 Web 服务"""
    global server_process

    status = get_server_status()
    if status["running"]:
        console.print(f"[yellow]服务已在运行中 (PID: {status['pid']})[/yellow]")
        if auto_open_browser:
            open_browser(status["url"])
        return

    # 前置检查
    if not check_python_deps():
        console.print("[red]Python 依赖缺失，请先执行「5. 安装依赖」[/red]")
        return
    if not check_frontend_built():
        console.print(
            "[yellow]前端未构建，Web 界面将不可用"
            "（API 仍可正常使用）[/yellow]"
        )

    console.print("[blue]启动 Web 服务...[/blue]")

    host = _read_env_host()
    port = _read_env_port()

    try:
        server_process = subprocess.Popen(
            [
                sys.executable, "-m", "uvicorn",
                "backend.main:app",
                "--host", host,
                "--port", port,
            ],
            cwd=str(PROJECT_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

        if _wait_for_server(port):
            url = f"http://localhost:{port}"
            console.print("[green]服务启动成功！[/green]")
            console.print(f"  访问地址: [link]{url}[/link]")
            console.print(f"  API 文档: [link]{url}/docs[/link]")

            should_open = auto_open_browser or Confirm.ask(
                "  是否打开浏览器？", default=True,
            )
            if should_open:
                open_browser(url)
        else:
            # 输出错误信息
            if server_process and server_process.poll() is not None:
                out = server_process.stdout.read()
                if out:
                    text = out.decode(errors="replace")
                    for line in text.strip().splitlines()[-8:]:
                        console.print(f"  [dim]{line}[/dim]")
                server_process = None
                console.print("[red]服务启动失败[/red]")

    except Exception as e:
        console.print(f"[red]启动失败: {e}[/red]")
        server_process = None


def stop_server():
    """停止 Web 服务"""
    global server_process

    status = get_server_status()
    if not status["running"]:
        console.print("[yellow]服务未运行[/yellow]")
        return

    console.print("[blue]正在停止服务...[/blue]")
    try:
        server_process.terminate()
        server_process.wait(timeout=5)
        console.print("[green]服务已停止[/green]")
    except subprocess.TimeoutExpired:
        server_process.kill()
        console.print("[yellow]服务已强制终止[/yellow]")
    except Exception as e:
        console.print(f"[red]停止失败: {e}[/red]")
    finally:
        server_process = None


def show_status():
    """显示服务状态和系统概览"""
    console.print(Rule("系统状态", style="bright_blue"))

    status = get_server_status()
    table = Table(show_header=True, box=box.SIMPLE_HEAVY)
    table.add_column("项目", style="cyan", min_width=18)
    table.add_column("状态")

    if status["running"]:
        table.add_row("运行状态", "[bold green]● 运行中[/bold green]")
        table.add_row("进程 PID", str(status["pid"]))
        table.add_row("访问地址", f"[link]{status['url']}[/link]")
    else:
        table.add_row("运行状态", "[red]○ 已停止[/red]")

    table.add_row("Python", f"{platform.python_version()}")
    table.add_row("操作系统", f"{platform.system()} {platform.release()}")
    table.add_row("项目目录", str(PROJECT_ROOT))
    fe_ok = check_frontend_built()
    table.add_row(
        "前端构建",
        "[green]已构建[/green]" if fe_ok else "[yellow]未构建[/yellow]",
    )
    table.add_row(
        "数据库",
        "[green]已初始化[/green]" if check_database() else "[yellow]未初始化[/yellow]",
    )

    console.print(table)


def view_logs():
    """查看服务运行日志"""
    global server_process

    if not server_process or server_process.poll() is not None:
        console.print("[yellow]服务未运行，无法查看日志[/yellow]")
        return

    console.print("[blue]实时日志 — 按 Ctrl+C 退出:[/blue]")
    console.print(Rule(style="dim"))

    try:
        while server_process.poll() is None:
            line = server_process.stdout.readline()
            if line:
                text = line.decode(errors="replace").strip()
                if text:
                    console.print(f"  {text}")
    except KeyboardInterrupt:
        console.print(Rule(style="dim"))
        console.print("[yellow]退出日志查看[/yellow]")


def config_management():
    """查看配置"""
    console.print(Rule("配置管理", style="bright_blue"))

    table = Table(show_header=True, box=box.SIMPLE_HEAVY)
    table.add_column("配置项", style="cyan", min_width=16)
    table.add_column("当前值")

    env_vars: dict = {}
    env_path = PROJECT_ROOT / ".env"
    if env_path.exists():
        try:
            for line in env_path.read_text(encoding="utf-8").splitlines():
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and "=" in stripped:
                    key, _, val = stripped.partition("=")
                    env_vars[key.strip()] = val.strip()
        except Exception:
            pass

    table.add_row("服务地址 (HOST)", env_vars.get("HOST", "0.0.0.0"))
    table.add_row("服务端口 (PORT)", env_vars.get("PORT", "8000"))
    table.add_row("调试模式 (DEBUG)", env_vars.get("DEBUG", "false"))
    table.add_row("数据库路径", env_vars.get("DATABASE_URL", "sqlite:///./data/mplus.db"))
    table.add_row("模拟引擎", env_vars.get("SIMULATION_ENGINE", "ripple"))

    console.print(table)
    console.print(
        "\n[dim]提示: 修改配置请编辑项目根目录下的 .env 文件；"
        "AI 模型 API Key 通过 Web 界面「设置」配置[/dim]"
    )


def install_deps_menu():
    """安装依赖子菜单"""
    console.print(Rule("安装依赖", style="bright_blue"))

    table = Table(show_header=False, show_edge=False, box=None)
    table.add_column("选项", style="bold cyan", width=6)
    table.add_column("描述")
    table.add_row("[1]", "仅安装 Python 后端依赖")
    table.add_row("[2]", "仅安装前端 Node.js 依赖")
    table.add_row("[3]", "全部安装（推荐）")
    table.add_row("[b]", "返回主菜单")
    console.print(table)

    choice = Prompt.ask("请选择", choices=["1", "2", "3", "b"], default="3")
    if choice == "1":
        install_python_deps()
    elif choice == "2":
        install_frontend_deps()
    elif choice == "3":
        install_python_deps()
        install_frontend_deps()


# ============================================================
#  清理与主循环
# ============================================================

def cleanup():
    """清理资源：停止服务进程"""
    global server_process
    if server_process and server_process.poll() is None:
        console.print("\n[yellow]正在停止服务...[/yellow]")
        server_process.terminate()
        try:
            server_process.wait(timeout=3)
        except Exception:
            server_process.kill()


def main():
    """TUI 主入口"""
    # 注册信号处理（Windows 无 SIGTERM）
    def _sig_handler(sig, frame):
        cleanup()
        sys.exit(0)

    signal.signal(signal.SIGINT, _sig_handler)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, _sig_handler)

    print_banner()

    # 首次启动快速检测
    with console.status("[bold blue]正在检测环境...[/bold blue]", spinner="dots"):
        checks = run_environment_check()
    missing = [k for k, v in checks.items() if not v["ok"]]
    if missing:
        console.print(
            f"[yellow]检测到 {len(missing)} 项未就绪，"
            f"建议选择 [bold]\"0. 一键初始化\"[/bold][/yellow]"
        )
    else:
        console.print("[green]环境检测通过，所有组件就绪[/green]")

    # 主菜单循环
    while True:
        console.print()
        print_menu()
        console.print()

        choice = Prompt.ask(
            "请选择操作",
            choices=["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "q"],
            default="0" if missing else "1",
        )
        console.print()

        if choice == "0":
            auto_initialize()
        elif choice == "1":
            start_server()
        elif choice == "2":
            stop_server()
        elif choice == "3":
            show_status()
        elif choice == "4":
            show_environment_check()
        elif choice == "5":
            install_deps_menu()
        elif choice == "6":
            build_frontend_interactive()
        elif choice == "7":
            init_database_interactive()
        elif choice == "8":
            view_logs()
        elif choice == "9":
            config_management()
        elif choice == "q":
            if get_server_status()["running"]:
                if Confirm.ask("服务正在运行，是否停止并退出？"):
                    cleanup()
                    break
            else:
                break

        console.print()

    console.print("[blue]再见！[/blue]")


if __name__ == "__main__":
    main()
