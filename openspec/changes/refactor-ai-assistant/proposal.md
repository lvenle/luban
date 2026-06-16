## Why

当前 AI 助理交互模式落后：非流式请求、patch diff 确认卡片、10 种硬编码意图正则、mock 回退、14 个全局状态变量、600 行代码嵌入 app.js。用户需要等待两次 API 调用并手动点击确认才能完成一个操作，体验割裂。

## What Changes

1. **流式 SSE 对话**：废弃 `POST /api/ai/plan` + `POST /api/ai/execute` 两步模式，改为单条 SSE 连接 `POST /api/ai/chat`，流式传输 content_delta / tool_use / tool_result / tool_confirm / message_end 等结构化事件
2. **工具驱动**：所有 Schema/Page/Data 操作封装为 OpenAI function calling 工具（约 15-20 个），由 AI 自主调用，不再依赖硬编码意图检测
3. **风险分级**：低风险工具自动执行，高风险（新建/删除）操作暂停流等待用户确认
4. **不涉及 mock**：始终使用真实 OpenAI-compatible API
5. **前端模块化**：AI 助理代码从 app.js 拆分到 `public/ai-assistant/` 目录下多个模块（ChatView、SSEClient、ToolDisplay、StreamRenderer、SessionManager）
6. **状态简化**：14 个助理状态变量缩减为 4 个
7. ****BREAKING** **：废弃 `POST /api/ai/plan`、`POST /api/ai/sessions/:id/execute`、`POST /api/ai/sessions/:id/revise`、`POST /api/ai/sessions/:id/cancel` 端点
8. **移除** `applyAssistantConfigIntent`、`designCurrentForm` 等所有本地交互函数

## Capabilities

### New Capabilities
- `streaming-chat`: SSE 流式对话端点，支持 content_delta / tool_use / tool_result / tool_confirm 事件
- `tool-registry`: 后端工具注册表，支持自发现、风险分级、自动执行和高风险确认
- `modular-ai-ui`: 前端 AI 助理模块化，拆分 ChatView / SSEClient / ToolDisplay / StreamRenderer / SessionManager

### Modified Capabilities
- `ai-session`: 会话管理复用现有 SQLite sessions/messages/logs 表

## Impact

- **public/app.js**: 移除约 600 行 AI 助理代码（renderAssistantDrawer、submitAssistantPrompt、requestAiPlan、executeAiPlan 及相关函数）
- **public/ai-assistant/**: 新增 5 个模块文件
- **public/styles.css**: 移除 AI 助理相关 CSS（约 300 行），移至 ai-assistant/ 目录
- **src/routes/ai.js**: 重写，废弃旧端点，新增 `POST /api/ai/chat` SSE 端点
- **src/ai.js**: 重写，移除 mock 路径，纯 OpenAI function calling
- **src/agent.js**: 移除（意图检测 + 澄清引擎不再需要）
- **src/mockPatch.js**: 移除
