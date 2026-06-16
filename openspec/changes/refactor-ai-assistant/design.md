## Context

当前 AI 助理基于"意图检测 + patch 生成 + 用户确认 + patch 执行"的四步模式，有 10 种硬编码正则意图（agent.js）、mock 回退（mockPatch.js）、和 14 个分散的前端状态变量。整个交互是同步的、非流式的，用户需要等待两次 API 调用并手动确认 diff 才能完成操作。

重构目标是将交互模式改为标准的 agent 式对话：用户输入 → AI 流式回复 + 自主调用工具 → 结果返回对话。参考 Hermes Agent 的 tool-calling 循环和 SSE 事件流。

## Goals / Non-Goals

**Goals:**
- 单条 SSE 连接完成一轮对话（文本生成 + 工具调用 + 工具结果 + 最终回复）
- 所有 Schema/Page/Data 操作封装为 OpenAI function calling 工具
- 低风险工具自动执行，高风险（新建/删除）等待用户确认
- 前端 AI 助理代码模块化（5 个独立模块）
- 全局状态从 14 个减少到 4 个
- 始终使用真实 OpenAI API，移除 mock

**Non-Goals:**
- 不改动非 AI 的 UI 组件（表格、表单、字段编辑器等）
- 不改动数据库 schema（复用现有 sessions/messages/logs 表）
- 不涉及多模态（纯文本 + 工具调用）
- 不引入新的外部依赖

## Decisions

### Decision 1: SSE 事件协议

**Chosen**: 基于 `text/event-stream` 的自定义事件协议：

```
event: content_delta    data: {"content":"<text_chunk>"}
event: tool_use         data: {"id":"<call_id>","name":"<tool>","arguments":{...}}
event: tool_result      data: {"id":"<call_id>","status":"success|error","output":"..."}
event: tool_confirm     data: {"id":"<call_id>","name":"<tool>","arguments":{...}}
event: message_end      data: {}
event: error            data: {"message":"..."}
```

**Alternatives considered**:
- **WebSocket**: 需要升级连接，SSE 足够单向推送，客户端用 `fetch` + `ReadableStream` 更简单
- **Chunked JSON**: 每个 chunk 是自包含 JSON，但 SSE 有标准浏览器 API 支持（EventSource）

**Rationale**: SSE 是 HTTP 原生支持的推送协议。浏览器端可以用 `EventSource` 或 `fetch + ReadableStream` 消费，不需要额外库。Node.js 端只需设置 `res.writeHead(200, { 'Content-Type': 'text/event-stream' })`。

### Decision 2: 后端工具注册表

**Chosen**: 每个工具文件 `src/ai/tools/<name>.js` 通过 `registry.register()` 自注册：

```javascript
// src/ai/tools/add-field.js
registry.register({
  name: 'add_field',
  description: '为指定表添加一个新字段',
  risk: 'low',
  schema: {
    type: 'function',
    function: {
      name: 'add_field',
      description: '...',
      parameters: { type: 'object', properties: { ... }, required: [...] }
    }
  },
  handler: async (args, { app, db }) => {
    // 直接操作数据库
    return { fieldId: 'fld_xxx', ... };
  }
});
```

**Auto-discovery**: `src/ai/registry.js` 在启动时扫描 `src/ai/tools/*.js`（排除 index.js），导入所有文件，收集注册的工具。

**Risk gating**: `high` 级别工具执行前先 emit `tool_confirm`，等待客户端通过 `POST /api/ai/chat/confirm` 回复后再继续。

**Alternatives considered**:
- **中央配置文件**: 在 ai.js 中手动列出所有工具 — 每次新增工具都要改两个文件
- **前端工具定义**: 工具在浏览器端定义和注册 — 需要额外的安全审查层

**Rationale**: 自发现模式类似 Hermes Agent 的 AST 扫描，新增工具只需新建一个文件，零配置。后端执行工具直接操作数据库，不需要额外的 API 调用。

### Decision 3: OpenAI function calling 循环

**Chosen**: 一次 SSE 连接内的后端循环：

```
1. 接收客户端消息
2. 构造 messages 数组（system prompt + 历史消息 + 新消息）
3. 调用 OpenAI chat completion (stream: true)
4. 对于 stream 中的每个 chunk:
   a. 如果有 content delta → emit content_delta
   b. 如果有 delta.tool_calls → 收集完整 tool_call
5. 当 stream 结束，检查 collected tool_calls:
   a. 如果没有 → emit message_end, 结束
   b. 如果有 → 对每个 tool_call:
      - 查找注册的工具
      - 如果是 high-risk → emit tool_confirm, 等待确认
      - 执行工具 handler
      - emit tool_result
   c. 将 tool_call + tool_result 追加到 messages
   d. 回到步骤 3（继续循环）
```

这个循环会继续直到 AI 不调用任何工具，然后 emit `message_end`。

**Alternatives considered**:
- **并行工具执行**: 多个 tool_call 可以并行执行 — 但大部分 schema 操作是顺序依赖的
- **客户端驱动循环**: 前端管理 tool_call → 执行 → 送回 — 增加前端复杂度

**Rationale**: 后端驱动循环最简单。工具执行直接操作数据库（或 localStorage 的 form design），不需要前端来回传递结果。

### Decision 4: 前端模块拆分

**Chosen**: 5 个 ES module 文件，通过 `index.js` 导出统一接口：

```
public/ai-assistant/
├── index.js            # 入口：导出 renderAssistantDrawer + init
├── ChatView.js         # 消息列表渲染 + 输入框 + 快速命令
├── SSEClient.js        # SSE 连接管理 + 事件分发 + 重连
├── ToolDisplay.js      # 工具调用卡片 + 确认弹窗
├── StreamRenderer.js   # 流式文本增量渲染
└── SessionManager.js   # 会话创建/切换/历史
```

app.js 中保留的代码：
- `import { renderAssistantDrawer } from './ai-assistant/index.js'`
- 状态变量减少为：`aiSession`, `aiStreaming`, `assistantOpen`, `assistantDraft`
- `renderRuntime()` / `renderHome()` 中调用 `renderAssistantDrawer()`

**Styles**: AI 助理样式从 styles.css 移到 `public/ai-assistant/style.css`，通过 `import './style.css'` 或在 index.html 中引入。

### Decision 5: 会话管理

复用现有 `ai_sessions`、`ai_messages`、`ai_execution_logs` 表。每条 SSE 连接对应一个 session。用户消息和 AI 消息在 message_end 后批量写入，工具执行日志实时写入 execution_logs。

## Risks / Trade-offs

- **[Risk] SSE 连接超时**：长时间运行的 AI 推理可能超过负载均衡器超时 → 设置 120s 超时，发送 keepalive 事件
- **[Risk] 工具执行部分失败**：多个工具调用中某个失败 → AI 收到错误结果后决定下一步（重试/跳过/告诉用户），无需中断整个流
- **[Risk] 前端模块加载**：ES module 在旧浏览器不支持 → 项目已 Node 25+，现代浏览器都支持
- **[Trade-off] tool_confirm 阻断流**：高风险操作需要用户确认会暂停流 — 这是设计需求，也是 agent 安全的必要代价
- **[Risk] 旧端点废弃**：依赖旧 API 的外部工具需要迁移 → 旧端点标记 deprecated 并保留一个版本周期

## Migration Plan

1. 创建 `src/ai/tools/` 目录 + `registry.js`，实现工具注册和自发现
2. 实现 `POST /api/ai/chat` SSE 端点 + OpenAI function calling 循环
3. 逐个创建工具文件（schema 工具 → page 工具 → data 工具）
4. 创建 `public/ai-assistant/` 模块（SSEClient → StreamRenderer → ToolDisplay → ChatView → SessionManager → index）
5. 修改 app.js：导入新模块，移除旧代码，简化状态
6. 移动样式到 `public/ai-assistant/style.css`
7. 移除 `src/agent.js`、`src/mockPatch.js`、废弃端点
8. 测试整个流程

## Open Questions

- tool_confirm 的确认超时时间？（建议 60s，超时自动拒绝）
- streaming 内容是否要做 markdown 渲染？（建议支持基本 markdown：bold、code、list）
