<p align="center">
  <img src="assets/main_visual.png" alt="MPlus 主视觉" width="600">
</p>

<h1 align="center">百万加 MPlus</h1>

<p align="center">
  <strong>AI驱动的自媒体选题和模拟预测智能体</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-blue?logo=python" alt="Python">
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react" alt="React">
  <img src="https://img.shields.io/badge/FastAPI-0.109+-009688?logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/CAMEL--AI-0.2+-orange" alt="CAMEL">
  <img src="https://img.shields.io/badge/Ripple-CAS-purple" alt="Ripple">
  <img src="https://img.shields.io/badge/License-AGPL--3.0-blue" alt="License">
</p>

---

<!-- 目录 -->

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [生产构建与部署](#生产构建与部署)
- [项目结构](#项目结构)
- [核心架构](#核心架构)
- [技术栈](#技术栈)
- [支持的平台](#支持的平台)
- [API 接口一览](#api-接口一览)
- [模型支持](#模型支持)
- [截图预览](#截图预览)
- [核心框架](#核心框架)
- [致谢](#致谢)
- [License](#license)

## 功能特性

- **💡 头脑风暴**: 基于 CAMEL ChatAgent 的实时 AI 对话，支持 WebSocket 流式输出、智能联网搜索、平台画像注入、选题就绪度评估
- **📋 选题管理**: 从对话中智能提取结构化选题，支持多平台适配、选题编辑和导出
- **📊 模拟预测**: 通过 Ripple CAS 社会行为预测引擎模拟内容传播效果，提供多维数据洞察与合议庭评审报告
- **👤 平台账号管理**: 管理各平台自媒体账号信息，为模拟预测提供真实账号画像
- **🌐 平台画像系统**: 内置 6 大主流平台的深度画像数据（算法机制、爆款特征、互动基准等），驱动 AI 生成平台化内容建议
- **⚙️ 模型配置**: 支持多种 LLM 模型配置（OpenAI 兼容、Claude、Azure-OpenAI），支持默认模型和快速任务模型分离配置

## 快速开始

### TUI 启动模式（推荐初学者）

**只需三步**，**无需安装 Node.js**，使用仓库内置已构建的前端。TUI 会自动完成 Python 依赖安装、数据库初始化并启动服务：

1. **确保已安装 Python 3.11+**
2. **克隆仓库**
3. **启动 TUI**

```bash
git clone <仓库地址>
cd MPlus-dev
python tui/main.py
# 或: poetry run mplus
```

在 TUI 菜单中选择「0. 一键初始化」即可。Windows / macOS / Linux 均可使用。

---

### 环境要求

- Python 3.11+（运行时必需）
- Node.js 16+（仅开发/重新构建前端时需要；**TUI 模式使用内置已构建版本，无需 Node.js**）
- Poetry（Python 依赖管理，推荐）或 pip

### 1. 安装依赖

**后端依赖：**

```bash
# 使用 Poetry（推荐）
poetry install

# 或在已激活的虚拟环境中使用 pip
pip install -e .
```

**前端依赖：**

```bash
cd frontend
npm install --legacy-peer-deps
```

### 2. 配置环境

```bash
cp .env.example .env
```

编辑 `.env` 设置服务地址和端口。LLM 模型的 API Key 等配置通过 Web 界面完成（启动后访问 **设置 → 模型配置**）。

### 3. 初始化数据库

```bash
python scripts/init_db.py
```

### 4. 启动开发服务

**后端服务：**

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

**前端开发服务器（可选，开发调试用）：**

```bash
cd frontend
npm run dev
```

> 前端 Vite 开发服务器运行在 3000 端口，自动代理 `/api` 和 `/ws` 请求到后端 8000 端口。

### 5. 访问应用

- **Web 界面**: http://localhost:3000（开发模式）或 http://localhost:8000（生产模式）
- **API 文档**: http://localhost:8000/docs

## 生产构建与部署

MPlus 采用前后端一体化部署方案：前端经 Vite 编译为纯静态文件（HTML/CSS/JS），由 FastAPI 直接服务。**运行时仅需 Python 环境，无需 Node.js。**

### 一键构建

项目提供了 `scripts/build.sh` 构建脚本，适配 macOS 和 Linux：

```bash
# 完整构建（安装依赖 + 编译前端 + 初始化数据库）
./scripts/build.sh

# 构建后清理 node_modules（节省磁盘空间，运行时不需要）
./scripts/build.sh --clean

# 构建完成后直接启动生产服务
./scripts/build.sh --start

# 加速重复构建（跳过依赖安装步骤）
./scripts/build.sh --skip-npm --skip-poetry
```

构建脚本功能：

| 步骤 | 说明 |
|------|------|
| 系统检测 | 自动识别 macOS / Linux，检查架构信息 |
| 依赖检查 | 验证 Node.js（>=16，仅构建时需要）、Python 3、Poetry |
| 环境配置 | 自动从 `.env.example` 创建 `.env`，生产环境默认关闭 DEBUG |
| Python 依赖 | 通过 `poetry install` 安装后端依赖 |
| 前端编译 | TypeScript 类型检查 + Vite 生产构建，输出到 `backend/static/` |
| 数据库初始化 | 自动检测并在需要时初始化 SQLite 数据库 |

### 手动构建

如果不使用构建脚本，也可手动执行：

```bash
# 1. 编译前端
cd frontend
npm install --legacy-peer-deps
npm run build          # 输出到 backend/static/

# 2. 回到项目根目录
cd ..

# 3. 初始化数据库（首次部署）
python scripts/init_db.py
```

### 启动生产服务

构建完成后，仅需 Python 环境即可运行：

```bash
# 方式一：直接启动（确保已激活 Python 虚拟环境）
uvicorn backend.main:app --host 0.0.0.0 --port 8000

# 方式二：通过 Poetry 启动
poetry run uvicorn backend.main:app --host 0.0.0.0 --port 8000

# 方式三：使用 TUI 管理界面
poetry run mplus
```

> 生产环境下访问 http://localhost:8000 即可使用完整应用，FastAPI 自动服务 `backend/static/` 中的前端静态文件。

## 项目结构

```
MPlus-dev/
├── assets/                      # 静态资源（主视觉图片等）
├── backend/                     # 后端服务（FastAPI）
│   ├── api/                     # API 路由模块
│   │   ├── accounts.py              # 平台账号管理 API
│   │   ├── chat.py                  # WebSocket 实时对话 API
│   │   ├── sessions.py              # 会话管理 API
│   │   ├── topics.py                # 选题管理 API
│   │   ├── simulations.py           # 模拟预测 API
│   │   └── platforms.py             # 平台信息 API
│   ├── db/                      # 数据库模块
│   │   ├── database.py              # 异步引擎 / 会话工厂 / 初始化
│   │   └── crud.py                  # 所有 CRUD 操作
│   ├── models/                  # SQLAlchemy ORM 数据模型
│   ├── prompts/                 # AI 提示词模板
│   │   └── brainstorm_prompts.py    # 头脑风暴提示词
│   ├── services/                # 业务服务层
│   │   ├── brainstorm.py            # 头脑风暴核心服务（CAMEL ChatAgent）
│   │   ├── model_factory.py         # CAMEL 模型工厂
│   │   ├── platform_loader.py       # 平台画像加载器
│   │   ├── topic_extractor.py       # 选题智能提取服务
│   │   ├── llm_service.py           # 统一 LLM 接口
│   │   ├── simulation_service.py    # 模拟任务管理服务
│   │   ├── ripple_adapter.py        # Ripple CAS 引擎适配器
│   │   ├── report_service.py        # 模拟报告生成服务
│   │   ├── web_search_service.py    # 联网搜索服务
│   │   └── options_service.py       # 应用选项服务
│   ├── tools/                   # CAMEL Agent 工具
│   │   └── anspire_search.py        # Anspire 搜索工具
│   ├── static/                  # 前端构建产物（生产模式自动服务）
│   ├── config.py                # Pydantic Settings 配置管理
│   ├── exceptions.py            # MplusException 异常体系
│   └── main.py                  # FastAPI 应用入口
├── frontend/                    # 前端应用（React 18 + TypeScript）
│   ├── src/
│   │   ├── components/          # 通用 UI 组件
│   │   │   ├── Layout.tsx               # 全局布局（导航栏、侧边栏）
│   │   │   ├── MarkdownRenderer.tsx     # Markdown 渲染
│   │   │   ├── SimulationResultModal.tsx # 模拟结果弹窗
│   │   │   ├── PlatformSelect.tsx       # 平台选择器
│   │   │   ├── ModelSelect.tsx          # 模型选择器
│   │   │   ├── PlatformIcons.tsx        # 平台图标
│   │   │   ├── TagInput.tsx             # 标签输入
│   │   │   ├── Modal.tsx                # 模态框
│   │   │   ├── Toast.tsx                # 消息提示
│   │   │   └── Loading.tsx              # 加载状态
│   │   ├── hooks/               # 自定义 Hooks
│   │   │   └── useChat.ts              # WebSocket 实时对话 Hook
│   │   ├── pages/               # 页面组件
│   │   │   ├── HomePage.tsx            # 首页
│   │   │   ├── BrainstormPage.tsx      # 头脑风暴
│   │   │   ├── TopicsPage.tsx          # 选题管理
│   │   │   ├── SimulationPage.tsx      # 模拟预测
│   │   │   ├── AccountsPage.tsx        # 平台账号管理
│   │   │   └── SettingsPage.tsx        # 系统设置
│   │   ├── services/            # API 服务
│   │   │   └── api.ts                  # Axios API 客户端
│   │   ├── stores/              # 状态管理
│   │   │   └── appStore.ts            # Zustand 全局状态
│   │   ├── App.tsx              # 根组件（路由配置）
│   │   └── main.tsx             # 应用入口
│   ├── vite.config.ts           # Vite 构建配置
│   ├── tsconfig.json            # TypeScript 配置
│   ├── tailwind.config.js       # Tailwind CSS 配置
│   └── package.json             # 前端依赖
├── config/                      # 运行时配置
│   └── app_options.yaml             # UI 下拉选项配置
├── skills/                      # Agent Skills（平台画像与模拟技能）
│   └── social-media/
│       ├── platforms/               # 6 大平台画像定义（Markdown）
│       ├── prompts/                 # 模拟角色提示词
│       └── rubrics/                 # 评估校准标准
├── scripts/                     # 脚本工具
│   ├── build.sh                     # 生产环境构建脚本
│   ├── start.sh                     # 开发环境启动脚本
│   └── init_db.py                   # 数据库初始化脚本
├── tui/                         # TUI 终端管理界面（Rich）
│   └── main.py                      # TUI 入口
├── data/                        # 数据目录（SQLite 数据库、模拟结果）
├── pyproject.toml               # Poetry 项目配置
└── .env.example                 # 环境变量模板
```

### 前端路由

| 路径 | 页面 |
|------|------|
| `/` | 首页 |
| `/brainstorm` | 头脑风暴（新建会话） |
| `/brainstorm/:sessionId` | 头脑风暴（继续会话） |
| `/topics` | 选题管理 |
| `/simulation` | 模拟预测 |
| `/simulation/:topicId` | 选题模拟 |
| `/accounts` | 平台账号管理 |
| `/settings` | 系统设置 |

## 核心架构

### 头脑风暴 AI 对话流程

```
用户输入 → WebSocket → BrainstormService
                            │
                   ┌────────┼────────┐
                   │        │        │
              搜索意图分析  记忆加载  平台画像注入
                   │        │        │
                   └────────┼────────┘
                            │
                     CAMEL ChatAgent
                      (流式响应)
                            │
                   ┌────────┼────────┐
                   │        │        │
              选题就绪度   自动标题   阶段提醒
                评估       生成      注入
                   │        │        │
                   └────────┼────────┘
                            │
                     选题智能提取
                    (TopicExtractor)
```

**核心能力：**
- **CAMEL ChatAgent**: 基于 CAMEL-AI 框架的有状态对话智能体，支持多轮交互和上下文记忆
- **智能搜索**: LLM 判断搜索意图 → Anspire API 联网搜索 → LLM 筛选相关结果 → 注入对话上下文
- **平台画像驱动**: 根据用户选择的目标平台，自动加载平台画像（算法机制、爆款特征、用户偏好等）注入提示词
- **选题提取**: 对话达到一定深度后，使用独立模型调用从对话中提取结构化选题信息
- **阶段提醒**: 根据对话轮次动态注入引导策略，推动对话从发散走向收敛

### 模拟预测流程

```
选题输入 → SimulationService → RippleAdapter → Ripple CAS 引擎
                                                     │
                                    ┌────────────────┼────────────────┐
                                    │                │                │
                              Star Agents       Sea Agents      Omniscient
                              (意见领袖)        (普通用户)      (全视者裁决)
                                    │                │                │
                                    └────────────────┼────────────────┘
                                                     │
                                              Deliberation
                                             (合议庭评审)
                                                     │
                                              ReportService
                                            (解读报告生成)
```

## 技术栈

| 层级 | 技术 |
|------|------|
| **后端** | Python 3.11+, FastAPI, async SQLAlchemy, aiosqlite, Pydantic, WebSocket |
| **前端** | React 18, TypeScript, Vite, Tailwind CSS, Zustand, Recharts, react-markdown |
| **数据库** | SQLite（异步访问，aiosqlite） |
| **AI/LLM** | OpenAI API（及兼容：DeepSeek、通义千问、豆包等）, Claude API, Azure OpenAI |
| **Agent 框架** | [CAMEL](https://github.com/camel-ai/camel) ^0.2.0 — ChatAgent, ModelFactory, 工具链 |
| **模拟引擎** | [Ripple](https://github.com/xyskywalker/Ripple) — CAS 社会行为预测引擎 |
| **联网搜索** | Anspire Open API — 热点趋势搜索 |
| **TUI 管理** | Rich — 终端管理界面 |
| **包管理** | Poetry（后端）, npm（前端） |

## 支持的平台

| 平台 | 代码 | 画像 | 说明 |
|------|------|------|------|
| 小红书 | `xiaohongshu` | ✅ | 种草社区，年轻女性为主 |
| 抖音 | `douyin` | ✅ | 短视频平台，用户覆盖面最广 |
| 微博 | `weibo` | ✅ | 社交媒体，热搜舆论场 |
| B站 | `bilibili` | ✅ | 视频社区，Z世代深度内容 |
| 知乎 | `zhihu` | ✅ | 知识问答，高知用户群体 |
| 微信公众号 | `wechat` | ✅ | 订阅媒体，私域流量中枢 |

每个平台均包含完整画像数据（9 大维度）：平台概览、用户画像、内容生态、算法机制、互动特征、商业化特征、创作者生态、平台术语表、模拟参数参考。

## API 接口一览

| 模块 | 端点 | 说明 |
|------|------|------|
| 系统 | `GET /api/health` | 健康检查 |
| 系统 | `GET /api/app-options` | 应用选项配置 |
| 系统 | `GET /api/settings/status` | 系统状态检查 |
| 模型配置 | `GET/POST /api/model-configs` | 模型配置 CRUD |
| 模型配置 | `GET/PUT/DELETE /api/model-configs/{id}` | 单个模型配置操作 |
| 模型配置 | `PUT /api/model-configs/{id}/default` | 设为默认模型 |
| 模型配置 | `PUT /api/model-configs/{id}/fast-task` | 设为快速任务模型 |
| 模型配置 | `POST /api/model-configs/{id}/test` | 测试模型连接 |
| 搜索配置 | `GET/PUT/DELETE /api/search-config` | 联网搜索配置管理 |
| 搜索配置 | `POST /api/search-config/test` | 测试搜索配置 |
| 搜索 | `POST /api/web-search` | 统一搜索入口 |
| 对话 | `WebSocket /ws/chat/{session_id}` | 实时 AI 对话 |
| 会话 | `GET/POST /api/sessions` | 会话列表 / 创建 |
| 会话 | `GET/PUT/DELETE /api/sessions/{id}` | 会话详情 / 更新 / 删除 |
| 选题 | `GET/POST /api/topics` | 选题列表 / 创建 |
| 选题 | `GET/PUT/DELETE /api/topics/{id}` | 选题详情 / 更新 / 删除 |
| 选题 | `GET /api/topics/{id}/export` | 选题导出 |
| 模拟 | `POST /api/simulations` | 启动模拟 |
| 模拟 | `GET /api/simulations/running` | 运行中模拟状态 |
| 模拟 | `GET /api/simulations/{id}` | 查询模拟结果 |
| 模拟 | `GET /api/simulations/{id}/progress` | 模拟进度 |
| 模拟 | `POST /api/simulations/{id}/cancel` | 取消模拟 |
| 模拟 | `DELETE /api/simulations/{id}` | 删除模拟 |
| 模拟 | `GET /api/simulations/{id}/files` | 模拟文件列表 |
| 模拟 | `GET /api/simulations/{id}/download/{type}` | 下载模拟文件 |
| 模拟 | `GET /api/topics/{topicId}/simulations` | 选题模拟历史 |
| 平台 | `GET /api/platforms` | 平台列表 |
| 账号 | `GET/POST /api/accounts` | 账号列表 / 创建 |

## 模型支持

- **OpenAI 兼容**: 支持 OpenAI 官方及所有兼容 API（DeepSeek、通义千问、豆包、零一万物等），自动适配 Chat Completions 和 Responses API
- **Claude**: 支持 Anthropic 官方模型
- **Azure-OpenAI**: 支持微软 Azure 平台上的 OpenAI 模型
- **双模型配置**: 支持设置默认模型（用于对话）和快速任务模型（用于标题生成、就绪度评估等轻量任务）

## 截图预览

<details>
<summary>点击展开截图</summary>

> 首页展示、头脑风暴、选题管理、模拟预测等页面截图...

</details>

## 核心框架

MPlus 的 AI 能力基于以下核心开源框架构建：

### 🐫 CAMEL — Agent 核心框架

<p>
  <a href="https://github.com/camel-ai/camel">
    <img src="https://img.shields.io/badge/GitHub-camel--ai/camel-blue?logo=github" alt="CAMEL">
  </a>
  <img src="https://img.shields.io/github/stars/camel-ai/camel?style=social" alt="Stars">
</p>

[CAMEL](https://github.com/camel-ai/camel)（Communicative Agents for "Mind" Exploration of Large Language Model Society）是首个也是最优秀的大语言模型多智能体框架，由 CAMEL-AI 开源社区维护。MPlus 基于 CAMEL 构建了头脑风暴对话、选题生成、内容分析等核心 AI Agent 能力：

- **多智能体协作**: 支持多个 AI 智能体之间的动态通信与协作
- **有状态记忆**: 智能体具备上下文记忆能力，支持多步交互和记忆持久化
- **丰富的工具集成**: 内置搜索、数据处理等工具链支持，MPlus 扩展了 Anspire 搜索工具
- **多模型适配**: 通过 ModelFactory 兼容 OpenAI、Claude、Azure OpenAI 等多种 LLM 后端

### 🌊 Ripple — CAS 社会行为预测引擎

<p>
  <a href="https://github.com/xyskywalker/Ripple">
    <img src="https://img.shields.io/badge/GitHub-xyskywalker/Ripple-blue?logo=github" alt="Ripple">
  </a>
</p>

[Ripple](https://github.com/xyskywalker/Ripple) 是基于复杂自适应系统（CAS）理论的社会行为预测引擎，通过多类型 LLM Agent（Star/Sea/Omniscient）模拟社交媒体中内容的传播动力学。MPlus 集成 Ripple 作为模拟预测引擎：

- **波纹传播模型**: 模拟内容发布后在社交网络中的逐波传播过程
- **多角色 Agent**: Star Agent（意见领袖）、Sea Agent（普通用户）、Omniscient（全视者裁决）
- **合议庭评审**: 多轮 Deliberation 机制，由多角色评审团对模拟结果进行深度讨论和共识决策
- **解读报告**: 自动生成包含传播分析、数据预测和运营建议的完整解读报告

### 🏝️ OASIS — 社交模拟引擎（理论基础）

<p>
  <a href="https://github.com/camel-ai/oasis">
    <img src="https://img.shields.io/badge/GitHub-camel--ai/oasis-blue?logo=github" alt="OASIS">
  </a>
  <img src="https://img.shields.io/github/stars/camel-ai/oasis?style=social" alt="Stars">
</p>

[OASIS](https://github.com/camel-ai/oasis)（Open Agent Social Interaction Simulations）是 CAMEL-AI 开源的社交媒体模拟器，能够利用大语言模型智能体模拟大规模用户行为。MPlus 的模拟预测设计受 OASIS 启发，在其社交模拟理论基础上构建了 Ripple 引擎。

## 致谢

MPlus 的开发离不开以下优秀开源项目的支持：

- **[CAMEL-AI](https://www.camel-ai.org/)** — 感谢 CAMEL-AI 开源社区提供的 [CAMEL](https://github.com/camel-ai/camel) 多智能体框架，为 MPlus 的 AI Agent 能力提供了坚实的底层支撑。CAMEL 是首个大语言模型多智能体框架，其论文发表于 NeurIPS 2023。[[论文]](https://arxiv.org/abs/2303.17760)
- **[OASIS](https://github.com/camel-ai/oasis)** — 感谢 CAMEL-AI 开源社区提供的 OASIS 社交模拟引擎，为 MPlus 的模拟预测设计提供了理论基础和灵感。[[论文]](https://arxiv.org/abs/2411.11581)

如果您在学术研究中使用了 MPlus，请同时引用上述项目：

```bibtex
@inproceedings{li2023camel,
  title={CAMEL: Communicative Agents for "Mind" Exploration of Large Language Model Society},
  author={Li, Guohao and Hammoud, Hasan Abed Al Kader and Itani, Hani and Khizbullin, Dmitrii and Ghanem, Bernard},
  booktitle={Thirty-seventh Conference on Neural Information Processing Systems},
  year={2023}
}

@misc{yang2024oasis,
  title={OASIS: Open Agent Social Interaction Simulations with One Million Agents},
  author={Ziyi Yang and Zaibin Zhang and Zirui Zheng and Yuxian Jiang and Ziyue Gan and Zhiyu Wang and Zijian Ling and Jinsong Chen and Martz Ma and Bowen Dong and Prateek Gupta and Shuyue Hu and Zhenfei Yin and Guohao Li and Xu Jia and Lijun Wang and Bernard Ghanem and Huchuan Lu and Chaochao Lu and Wanli Ouyang and Yu Qiao and Philip Torr and Jing Shao},
  year={2024},
  eprint={2411.11581},
  archivePrefix={arXiv},
  primaryClass={cs.CL}
}
```

## License

AGPL-3.0 License — 详见 [LICENSE](LICENSE) 文件
