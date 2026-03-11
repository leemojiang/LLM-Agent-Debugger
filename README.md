# LLM Agent Debugger Proxy

这是一个专为 LLM Agent 开发者设计的调试代理服务器。它作为一个透明的中间层，允许你观察、拦截、修改并实时可视化 Agent 与大模型 API 之间的所有交互。

## 核心功能

- **透明代理**：完全转发所有 HTTP 请求和响应，保持原始路径和 Header。
- **步进调试 (Step-through)**：支持“手动模式”，在请求发送到上游之前进行拦截，允许你修改 Payload。
- **SSE 实时可视化**：支持流式响应 (Server-Sent Events) 的实时展示，像对话一样观察模型输出。
- **多维视图**：提供 JSON 树状视图和 Markdown 渲染视图，方便查看结构化数据和长文本。
- **数据持久化**：使用 SQLite 记录所有历史请求，支持按 URL 或 Session ID 过滤。
- **旁路代理 (Bypass)**：支持将处理后的数据异步发送到指定的第三方地址进行记录。

## 快速开始

### 1. 配置环境

在 `.env` 文件中配置以下变量：

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

### 2. 本地开发与运行

如果你想在本地机器上运行此项目：

1. **导出代码**：在 AI Studio 菜单中选择 `Settings` -> `Export to ZIP`。
2. **解压并安装**：
   ```bash
   unzip project.zip
   cd project
   npm install
   ```
3. **配置端口**：如果你希望监听特定端口（如 `8845`），在 `.env` 中设置 `PORT=8845`。
4. **启动**：
   ```bash
   npm run dev
   ```

访问 `http://localhost:8845` (或你设置的端口) 即可进入调试界面。

### 3. 配置你的 Agent

将你的 Agent 或 LLM 客户端的 API Base URL 指向本代理服务器：
`http://localhost:3000`

## 使用指南

- **手动模式 (Manual)**：当新请求到达时，它会显示为“Pending”状态。点击请求，在左侧面板修改 JSON，然后点击 **RELEASE REQUEST** 发送。
- **自动模式 (Auto)**：请求将不经停直接转发，你可以在 UI 上实时观察交互。
- **可视化切换**：在顶部栏切换 **JSON** 或 **Markdown** 模式。Markdown 模式非常适合查看模型生成的回复。

## 部署说明 (Docker)

可以使用提供的 `Dockerfile` 进行部署：

```bash
docker build -t llm-agent-debugger .
docker run -p 3000:3000 --env-file .env llm-agent-debugger
```

## 技术栈

- **Backend**: Node.js, Express, Socket.io, Better-SQLite3
- **Frontend**: React, Tailwind CSS, Lucide Icons, Framer Motion
- **Proxy**: Custom streaming proxy with SSE support
