# LLM Agent Debugger Proxy

[English](./README_EN.md) | 简体中文

这是一个专为 LLM Agent 开发者设计的调试代理服务器。它作为一个透明的中间层，允许你观察、拦截、修改并实时可视化 Agent 与大模型 API 之间的所有交互。

![Dashboard Preview](https://via.placeholder.com/1200x600.png?text=LLM+Agent+Debugger+Dashboard+Preview)
*项目主界面展示：实时监控、拦截编辑与流式输出可视化*

## 核心功能

- **透明代理**：完全转发所有 HTTP 请求和响应，保持原始路径和 Header。
- **步进调试 (Step-through)**：支持“手动模式”，在请求发送到上游之前进行拦截，允许你修改 Payload。
- **重放与编辑 (Edit & Replay)**：支持对历史请求进行编辑并重新发送，方便快速复现问题或测试不同 Prompt。
- **SSE 实时可视化**：支持流式响应 (Server-Sent Events) 的实时展示，像对话一样观察模型输出。
- **Token & 缓存统计**：精准解析 OpenAI/Anthropic 协议的 Token 使用情况，支持展示 **Cache Hit (缓存命中)** 和 **Cache Creation (缓存创建)** 数据。
- **多维视图**：提供 JSON 树状视图和 Markdown 渲染视图，方便查看结构化数据和长文本。
- **数据持久化**：使用 SQLite 记录所有历史请求，支持按 URL 或 Session ID 过滤。

## 技术栈

### 后端 (Backend)
- **Runtime**: Node.js (TypeScript)
- **Framework**: **Express** - 处理 HTTP 代理逻辑与静态资源服务。
- **Real-time**: **Socket.io** - 实现服务端与 UI 之间的双向实时通信。
- **Database**: **Better-SQLite3** - 高性能本地存储，记录所有交互日志。
- **Proxy**: 自研流式代理引擎，完美支持 SSE (Server-Sent Events) 转发与解析。

### 前端 (Frontend)
- **Framework**: **React 18** + **Vite**
- **Styling**: **Tailwind CSS** - 响应式、现代化暗黑风格设计。
- **Animation**: **Framer Motion** - 丝滑的列表进入与状态切换动画。
- **Icons**: **Lucide React** - 统一的图标语言。
- **Components**: 
  - `react-json-view`: 结构化 JSON 预览。
  - `react-markdown`: 实时渲染模型生成的 Markdown 内容。

## 快速开始

### 1. 配置环境

在根目录下创建 `.env` 文件（或参考 `.env.example`）：

```env
# 代理服务器监听的端口 (默认 3000)
PORT=3000

# 目标上游地址 (例如本地 LLM 代理或 OpenAI API)
UPSTREAM_URL="http://127.0.0.1:8832"

# 是否默认开启自动模式 (true/false)
AUTO_MODE="false"

# (可选) 旁路代理地址
BYPASS_URL=""
```

### 2. 本地运行

```bash
# 克隆仓库
git clone https://github.com/leemojiang/LLM-Agent-Debugger
cd LLM-Agent-Debugger

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

访问 `http://localhost:3000` 即可进入调试界面。

### 3. 配置你的 Agent

将你的 Agent 或 LLM 客户端的 API Base URL 指向本代理服务器：
`http://localhost:3000`

## 使用指南

- **手动模式 (Manual)**：当新请求到达时，它会显示为“Pending”状态。点击请求，在中间面板修改 JSON，然后点击 **RELEASE REQUEST** 发送。
- **重放 (Replay)**：选中任何历史请求，修改其 Payload 后点击 **REPLAY** 按钮，系统将发起一个新的请求副本。
- **Token 监控**：在详情面板右侧查看详细的 Token 消耗，包括输入、输出以及缓存详情。
- **可视化切换**：在顶部栏切换 **JSON** 或 **Markdown** 模式。Markdown 模式非常适合查看模型生成的回复。

## 部署说明 (Docker)

```bash
docker build -t llm-agent-debugger .
docker run -p 3000:3000 --env-file .env llm-agent-debugger
```

## 许可证

MIT License
