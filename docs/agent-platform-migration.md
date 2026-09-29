# 鲁班统一 Agent 底座迁移

依据工作区根目录 `UNIFIED_AGENT_PLATFORM_ARCHITECTURE.md` 的阶段4执行。目标不是改写鲁班业务 Runtime，而是将模型调用、Agent Loop、Tool 调度、取消、确认和运行事件迁移到底座，同时保留 Contract、Package、Rule、Record 和 SQLite 的产品所有权。

## 迁移边界

- 底座：模型 Provider、Agent Loop、Tool Registry、Run Event、取消、超时和通用日志机制。
- 鲁班：`contract.js`、`.sgpkg`、业务校验、事务、Rule Runtime、Record CRUD、确认界面和会话状态。
- 产品工具只能通过 `LubanToolProvider` 注册；底座不得导入鲁班数据库或业务模块。
- 当前应用 ID 由产品上下文绑定，模型参数不能切换到其他应用。
- 高风险工具必须经过鲁班现有确认入口，Prompt 不能授权。

## 分阶段切换

1. `LubanToolProvider` 将旧工具映射到 `luban.*` 命名空间。
2. `luban-app-builder` Agent 包随鲁班发布。
3. `/api/ai/platform-chat` 作为旁路入口；原 `/api/ai/chat` 保持默认不变。
4. 对应用创建、Schema 修改、删除确认、工具日志、取消和错误做双路审计。
5. 差异收口后将产品 UI 默认切到统一 Runtime。
6. 默认入口稳定后删除 `stream-openai.js` 和 `chat.js` 中重复的模型/Tool Loop。

## 当前已知差异

- 旧入口会合并可批处理的同类 Tool Call；统一 Agent Loop 暂未实现鲁班产品级合并策略。
- 旁路已复用现有确认 API，但尚未加入 UI 可见的 Runtime 切换和差异报告页。
- 结构化一次性生成、非聊天 AI 字段和业务规则意图接口仍走旧的非流式调用，后续应改用底座 Provider，但不与聊天切换混在一个步骤删除。

## 第一检查点验证

- `tests/agent-platform-adapter.test.js`：RuntimeConfig脱敏、Agent包Prompt、工具命名空间、当前应用绑定、高风险确认和共享Agent Loop通过。
- Agent包 `manifest.sha256` 全部通过。
- 使用本机临时SQLite与Mock OpenAI SSE服务调用 `/api/ai/platform-chat`，收到统一Runtime的流式正文和 `message_end`，响应未泄露测试密钥。
- 全量测试为223项中221通过；两项失败与迁移前基线一致，分别是过时的Rule路由结构正则和既有前端循环依赖。
