# luban-ai MVP — 项目架构与功能说明

## 轻依赖架构（Node.js 25+，运行时主要使用内置能力）

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Browser  (Vanilla JS SPA)                      │
│                                                                      │
│   public/index.html  (13 lines, 单一入口)                             │
│        └── <script type="module" src="app.js">                       │
│                                                                      │
│   public/app.js + app-home/app-runtime/ai-assistant 模块             │
│   public/styles.css + AI 助理样式                                    │
│                                                                      │
│   ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌───────────┐  │
│   │ Home 页  │  │ Runtime      │  │ AI 助理抽屉  │  │ 设置 Modal│  │
│   │ App 网格 │  │ 三栏布局     │  │ SSE 对话/工具│  │ AI 配置   │  │
│   │ 分类筛选 │  │ 侧栏+工作区  │  │ 行/历史记录  │  │           │  │
│   └──────────┘  └──────────────┘  └──────────────┘  └───────────┘  │
│                                                                      │
│   状态管理: 全局 state 对象 + localStorage 持久化                     │
│   路由: URLSearchParams (?app=&page=&view=) + history pushState       │
│   UI: 自定义 h(tag, attrs, children) 虚拟 DOM 辅助函数                │
│   模态: 自定义 openConfirmDialog (无 alert/confirm/prompt)            │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ HTTP REST (JSON / Binary)
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Node.js HTTP Server                               │
│                                                                      │
│   src/server.js                                                     │
│   ┌──────────┐ ┌─────────────────┐ ┌──────────────────────────┐     │
│   │ 静态文件  │ │ API Routes      │ │ Helper: sendJson/Text     │     │
│   │ / → index │ │ /api/*          │ │ /Binary, readJson/Buffer  │     │
│   │ /uploads  │ │ 30+ endpoints   │ │ saveUploadedFile          │     │
│   └──────────┘ └─────────────────┘ └──────────────────────────┘     │
│                                                                      │
│   ┌────────────┐ ┌───────────────┐ ┌────────────┐ ┌────────────┐   │
│   │ storage/db │ │ ai/service  │ │ ai/agent   │ │ services/  │   │
│   │ SQLite 层  │ │ AI + Mock     │ │ .js        │ │ .js        │   │
│   │ CRUD       │ │ 50+ 场景      │ │ Agent 逻辑 │ │ Action 执行│   │
│   │ 关系处理   │ │ Patch 生成    │ │ 意图识别   │ │ 内置 Action│   │
│   │ 导入导出   │ │ Plan 生成     │ │ 澄清/规划  │ │            │   │
│   └────────────┘ └───────────────┘ └────────────┘ └────────────┘   │
│                                                                      │
│   ┌───────────────────┐ ┌────────────┐ ┌────────┐ ┌───────────┐    │
│   │ src/packageProto  │ │ src/zip.js │ │ src/   │ │ src/sample │   │
│   │ col.js            │ │ .sgpkg     │ │ xlsx   │ │ Packages   │   │
│   │ 包校验/Patch 引擎 │ │ 读写       │ │ .js    │ │ .js        │   │
│   │ 字段/页面/Action  │ │ 零依赖 ZIP│ │ XLSX   │ │ 50+ 样本  │   │
│   │ 类型定义          │ │            │ │ 导出   │ │ 模板定义   │   │
│   └───────────────────┘ └────────────┘ └────────┘ └───────────┘    │
│                              │                                       │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  data/db.sqlite      │
                    │  (SQLite WAL Mode)   │
                    │                      │
                    │  apps table          │
                    │  records table       │
                    │  record_relations    │
                    │  ai_sessions         │
                    │  ai_messages         │
                    │  ai_execution_logs   │
                    │  settings            │
                    └─────────────────────┘
```

---

## 模块功能说明

### 1. `src/server.js` 与 `src/routes/*` — HTTP 路由与请求处理

**入口**：`npm start` → `node src/server.js`

**职责**：创建回环地址 HTTP 服务、分发静态文件，并将 App、Runtime、AI、Settings API 分发到独立路由模块。JSON 请求限制为 2 MB，上传/导入限制为 20 MB。

**API 端点分类**：

| 分类 | 端点 | 功能 |
|------|------|------|
| 健康检查 | `GET /api/health` | 服务存活检测 |
| App CRUD | `GET/POST /api/apps` | 列表 / 生成 |
| | `GET/PUT/DELETE /api/apps/:id` | 详情 / 更新元数据 / 删除 |
| | `PUT /api/apps/:id/package` | 更新完整包 |
| 导入导出 | `POST /api/apps/import` | 导入 .sgpkg |
| | `GET /api/apps/:id/export` | 导出 .sgpkg |
| | `GET /api/apps/:id/export.csv` | 导出 CSV |
| | `GET /api/apps/:id/export.xlsx` | 导出 XLSX |
| 记录 CRUD | `GET/POST /api/apps/:id/records` | 列表 / 创建 |
| | `PUT/DELETE /api/apps/:id/records/:rid` | 更新 / 删除 |
| 业务规则 | `GET /api/apps/:id/rules` | 规则列表 |
| | `GET/PATCH/DELETE /api/apps/:id/rules/:ruleId` | 详情 / 修改或启禁用 / 删除 |
| | `GET /api/apps/:id/rules/:ruleId/runs` | 单条规则执行日志 |
| | `GET /api/apps/:id/rules/:ruleId/states` | 等待条件与一次性成功状态 |
| | `GET /api/apps/:id/rule-runs` | 当前应用全部规则执行日志 |
| 关系处理 | `GET/PUT /api/apps/:id/records/:rid/relations/:fid` | 关系读写 |
| | `GET /api/apps/:id/fields/:eid/:fid/relation-options` | 关系选项 |
| 字段/表管理 | `PATCH/DELETE /api/apps/:id/fields/:eid/:fid` | 更新/删除字段 |
| | `GET/POST /api/apps/:id/tables` | 表列表/创建 |
| | `PATCH/DELETE /api/apps/:id/tables/:eid` | 更新/删除表 |
| | `DELETE /api/apps/:id/tables/:eid/records` | 清空表记录 |
| | `POST /api/apps/:id/tables/:eid/import` | 导入 CSV/XLSX |
| | `GET/POST /api/apps/:id/tables/:eid/fields` | 字段列表/创建 |
| AI 助手 | `POST /api/ai/chat` | SSE 流式对话（主要 AI 入口） |
| | `POST /api/ai/chat/confirm` | 确认高风险工具操作 |
| | `POST /api/ai/generate-options` | AI 生成 select 选项 |
| | `GET /api/ai/sessions` | 会话列表 |
| | `GET /api/ai/sessions/:id` | 会话详情（含消息和执行日志） |
| 配置 | `GET/PUT /api/settings` | AI 设置读写 |
| Action | `POST /api/apps/:id/actions/:aid/run` | 执行 Action |
| 文件 | `POST /api/apps/:id/uploads` | 上传文件 |
| AI 修改 | `POST /api/apps/:id/modify` | AI 修改应用 |

---

### 2. `src/storage/db.js` 与 `src/models/*` — 数据库与模型层

**技术**：`node:sqlite`（Node 25+ 内置）

**数据库表结构**：

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `apps` | 应用存储 | id, slug, name, manifestJson, schemaJson, uiJson, actionsJson, promptsJson, category, version |
| `records` | 记录存储 | id, appId, entityId, dataJson, createdAt, updatedAt |
| `record_relations` | 跨实体关联 | id, sourceRecordId, fieldId, targetRecordId, targetEntityId |
| `ai_sessions` | AI 会话 | id, appId, type(create/modify), status(idle/completed), createdAt, updatedAt |
| `ai_messages` | 对话消息 | id, sessionId, role(user/assistant), content, structuredContentJson, createdAt |
| `ai_execution_logs` | 执行日志 | id, sessionId, stepName, toolName, status, inputJson, outputJson, error, createdAt |
| `settings` | KV 配置 | key, value |
| `rules` | 应用业务规则 | id, appId, status, businessIntentJson, schemaMappingJson, contractJson |
| `rule_runs` | 规则执行日志 | ruleId, sourceRecordId, status, stepsJson, idempotencyKey |
| `rule_record_states` | 新增规则的一次性执行状态 | ruleId, sourceRecordId, state(waiting/success), missingFieldsJson |

**核心功能**：

- `createAppFromPackage(pkg)` — 规范化 + 校验 + 插入数据库
- `updateAppPackage(appId, pkg)` — 重新规范化校验后更新
- `listRecords(appId, { entityId, q, limit, offset })` — 支持搜索、关系水合和最多 1000 条的分页读取
- `createRecord(appId, entityId, data)` — 自动拆分关系字段写入 `record_relations`
- `updateRecord(recordId, data)` — No-op 检测（相同数据不更新 updatedAt）
- `deleteRecord(recordId, { force })` — 检查引用约束，force=true 时级联删除
- `listRelationOptions(appId, entityId, fieldId, keyword)` — 关系字段选项搜索
- `exportAppPayload(appId, dataMode)` — 导出应用结构（不含用户数据）
- `importAppPayload(payload)` — 导入应用 + 可选样本数据

**关系处理**：
- `splitRelationData()` — 从 data 中分离关系字段
- `normalizeTargetIds()` — 处理多种 ID 输入格式（数组、字符串、数字）
- `hydrateRelationValues()` — 记录查询时填充关联记录的显示值
- `getRecordRelations()` / `updateRecordRelations()` — 关系 CRUD

### 2.1 业务规则运行时 — 事件执行模型

业务规则由以下模块协作完成：

- `src/services/rule-creation.js`：将 Business Intent 编译为通用 Contract
- `src/services/rule-runtime.js`：把记录 CRUD 事件交给规则运行时，并维护等待/成功状态
- `src/services/rule-engine.js`：解释执行 Contract，事务内更新目标字段并写入执行日志
- `src/models/rule.js`：规则定义、启禁用和修改
- `src/models/rule-run.js`：不可变执行日志与幂等检查
- `src/models/rule-record-state.js`：记录“新增规则”对某条来源记录是等待还是已经成功

“新增记录时”规则的状态流如下：

```text
record.created
      │
      ├─ 依赖字段不完整 ─→ rule_record_states.waiting
      │                           │
      │                    后续 record.updated
      │                           │
      │                    再次检查规则依赖
      │                           │
      └─ 依赖字段完整 ────────────┴─→ Contract 执行
                                          │
                                          ├─ 失败：来源修改与目标修改整体回滚
                                          └─ 成功：state=success + rule_runs.success
```

关键约束：

- 只有在创建事件发生时登记过 `waiting` 的记录，后续编辑才会继续检查；因此不会追溯执行历史记录。
- `(appId, ruleId, sourceRecordId)` 是一次性状态键；成功后后续编辑不会重复执行。
- Contract 的幂等键继续作为第二层防重复保护。
- 等待状态不是失败，不写失败执行日志，也不阻止空白记录保存。
- 来源记录后续修改或删除不撤销、不修正历史影响。
- 规则修改、禁用或删除不撤销、不重算历史影响；规则修改沿用同一 ID 时，已经成功的来源记录仍视为已执行。
- 删除规则或已执行的来源记录时保留执行日志和 `success` 状态作为历史事实，不设置指向二者的级联外键；删除尚未执行的来源记录时清理其 `waiting` 状态，避免留下无效等待项。

事务边界：来源记录写入、Contract 目标更新、成功执行日志和 `success` 状态在同一 SQLite 事务中提交。业务步骤失败时整体回滚，避免只写入一半。

UI 语义：

- Schema 必填与规则依赖分离。
- 规则依赖字段显示“规则所需”提示，但允许暂存为空。
- 应用设置中的规则详情可以查看等待条件记录和最近执行日志。
- 成功结果返回结构化 `changes`（目标表、记录、业务标识 `recordLabel`、字段、操作、原值、新值）；Runtime 提示和执行日志共用该结构展示“原值 → 新值”。业务标识优先取名称、标题、编号或单号等可读字段。
- 执行记录的折叠列表直接展示本次业务结果；展开后显示完整处理步骤、字段变化和高级技术信息。旧日志没有业务标识时自动退化为表名与字段名，不影响历史记录查看。
- `GET /api/apps/:id/rules/:ruleId/states` 提供规则等待/成功状态查询。

用户消息分层：

- `public/common/messages.js` 是统一的用户语言转换层，将 Contract、Step、SQL、网络异常等技术信息转换成可理解的业务提示。
- `public/common/api.js` 在错误对象中保留 `technicalMessage` 供诊断，同时把人性化后的 `message` 提供给界面。
- `public/common/toast.js` 对所有系统提示再次做统一兜底，避免其他模块直接暴露技术语言。
- 业务规则成功提示和执行日志使用结构化 `changes` 生成业务描述，例如“商品信息‘苹果’的‘当前库存’已由 100 调整为 90”。
- 原始 Contract、步骤输入输出和技术错误仍保留在高级信息或开发者诊断数据中，不作为普通用户的首要提示。

---

### 3. `src/packageProtocol.js` — 软件包协议与 Patch 引擎

**软件包格式**（`.sgpkg` 本质是 zip 包）：

```
app.sgpkg
├── manifest.json       # 名称、版本、描述
├── schema.json         # 实体/字段定义
├── ui.json             # 页面布局定义
├── actions.json        # Action 配置
├── prompts.json        # 建议命令
└── sample-data.json    # 可选样本数据
```

**字段类型**（14 种）：

`text`, `textarea`, `number`, `date`, `datetime`, `url`, `select`, `multiSelect`, `relation`, `image`, `file`, `richText`, `formula`, `ai`

**页面类型**（4 种）：

`page`, `table`, `link`, `dashboard`

> 过去已有的别名（blank→page, list→table, chart→page 等）由 `normalizePageType()` 自动收口。dashboard 是独立类型，不走收口。

**Action 类型**（10 种）：

`ai.generateText`, `ai.rewriteText`, `ai.summarize`, `data.createRecord`, `data.updateRecord`, `data.queryRecords`, `data.deleteRecord`, `export.markdown`, `export.json`, `export.csv`

**Patch 操作**（14 种）：

`renameApp`, `updateDescription`, `addEntity`, `renameEntity`, `addField`, `updateField`, `removeField`, `addPage`, `updatePage`, `removePage`, `addAction`, `updateAction`, `removeAction`, `addSuggestedCommand`

**核心流程**：

```
applyPatch(pkg, patch)
  → normalizePatchOperation()  // 兼容 JSON Patch / 泛型 verb+target / 命名操作
  → 逐条执行操作
  → preparePackage()           // 重新规范化 + 校验
  → 返回新包
```

**校验规则**：
- 必填字段：manifest.name, schema.entities
- 字段 ID 唯一性
- 页面 ID 唯一性
- 关联字段的目标实体必须存在
- 字段类型必须在支持列表中
- 页面类型必须在支持列表中
- Action 类型必须在支持列表中
- options 颜色值必须在 `SELECT_COLORS` 中

---

### 4. `src/ai/service.js` — AI 集成与 Mock 生成器

**双模式**：

| 模式 | 条件 | 行为 |
|------|------|------|
| Mock AI | API Key 为空 | 关键词匹配 50+ 预定义场景 |
| OpenAI | API Key 已配置 | 调用 `/v1/chat/completions` |

**Mock AI 匹配逻辑**：

```
generatePackageFromPrompt(prompt, settings)
  → pickSamplePackage(prompt)
    → 关键词匹配 (如 "记账"→budget, "待办"→todo)
    → 遍历 scenarioDefinitions() 所有场景
    → 返回匹配度最高的包
```

**Mock Patch 逻辑**：

```
generatePatchFromPrompt(prompt, currentPackage, settings)
  → mockPatch(prompt, pkg)
    → 分析关键词:
      - "增加...字段/功能" → addField
      - "页面/入口/列表页/统计页" → addPage(特定类型)
      - "导出" → addAction(export.csv)
      - "总结/分析" → addAction(ai.generateText)
    → 智能推断字段类型 (从中文标签)
    → 处理特殊场景: 旅游/今日/爆款/提醒等
    → 始终有 fallback
```

**OpenAI 集成**：
- `requestChatCompletion(settings, messages)` — POST 到 OpenAI-compatible API
- `chatCompletionsUrl()` — 处理各种 endpoint 格式（含 `/v1` 自动补全）
- 25s 超时，失败重试（移除 `response_format` 重试）
- 支持 `response_format: { type: 'json_object' }`

**Plan 生成**（V2）：
- `generatePlanFromPrompt(prompt, settings, currentPackage)` — 生成结构化 Plan
- `planToPackage(plan)` — Plan 转完整包
- `validateAiPlan(plan)` — 限制检查（最多 20 表、每表 100 字段、100 关系）

---

### 5. `src/agent.js` — 遗留意图识别（旧 planning flow）

**注意：** 当前主要 AI 入口是 `POST /api/ai/chat`（SSE 流式对话），agent.js 是旧规划执行流程的遗留模块，保留用于兼容。

**意图类型**（10 种）：

`CreateApp`, `CreateTable`, `CreatePage`, `AddField`, `CreateRelation`, `ModifySchema`, `DeleteSchema`, `QuerySchema`, `AnalyzeData`, `GeneralChat`

**接口**：

- `understandAgentRequest(prompt, { app, session })` — 正则匹配中文意图，返回 `CLARIFY` / `PLAN` 状态
- `buildPlanningPrompt(prompt, opts)` — 构建 AI 规划提示词
- `describePlan(plan)` — 生成 Plan 的人类可读摘要

---

### 6. `src/actions.js` — Action 执行器（系统内置 Action）

Action 是系统内置的标准动作/应用级业务动作的底层能力，与页面 Runtime 提供的基础 CRUD 分离。

**关键说明**：
- **页面 Runtime 提供基础 CRUD**：数据表格中的新增、修改、删除、查询由 Runtime 直接处理，不经过 Action。
- **Action 是底层预留机制**：用于`data.queryRecords`、`export.csv`、`ai.generateText`等系统内置动作。
- **不支持用户自定义 Action**：当前不执行任何用户代码，不提供用户自定义 Action 能力。
- **安全性**：`runAction()`仅执行内置白名单 Action，不使用`eval`、`Function`构造器、用户上传 JS 或 shell 执行。

**调度逻辑**：

```
runAction(app, actionId)
  → 查找 action 定义
  → 按 type 分发（仅限白名单内置类型）:
    - data.queryRecords → db.listRecords()
    - export.csv → toCsv(records, entity)
    - export.json → JSON.stringify(records)
    - export.markdown → toMarkdown(records)
    - ai.generateText / ai.rewriteText / ai.summarize → 返回 Mock AI 文本
```

---

### 7. `src/zip.js` — 零依赖 ZIP 读写

- `createZip(files)` — 手动构建 ZIP 二进制（Local File Header + Central Directory + EOCD）
- `readZip(buffer)` — 解析 ZIP，支持 store/deflate 压缩
- `packageToZipPayload(pkg)` — 包 → ZIP 二进制
- `zipPayloadToPackage(buffer)` — ZIP 二进制 → 包

---

### 8. `src/xlsx.js` — 零依赖 XLSX 导出

- 构建标准 OOXML 结构：`[Content_Types].xml` / `_rels` / `xl/workbook.xml` / `xl/worksheets/sheet1.xml`
- `recordsToXlsx(records, entity)` — 记录 → XLSX 二进制
- 支持的字段类型：text, number, date, select, multiSelect, relation

---

### 9. `src/importData.js` — CSV / XLSX 导入

- `importRowsFromFile(buffer, entity, fileName)` — 自动检测格式
- `rowsFromCsv(text)` — 完整 CSV 解析（引号字段、转义）
- `rowsFromXlsx(buffer)` — 基于 zip.js + 手动 XML 解析
- `rowsToRecords(rows, entity)` — 列头 → fieldId 映射 + 值类型归一化

---

### 10. `src/samplePackages.js` — 50+ 样本包定义

**预定义模板**（4 个）：
- 家庭记账本（`createBudgetPackage`）— 收入/支出/分类/日期/备注 + 月度统计
- 待办事项（`createTodoPackage`）— 任务/截止日期/优先级/完成状态
- 公众号文章生成器（`createArticlePackage`）— 主题/目标读者/风格 → 标题/大纲/正文
- 客户管理器（`createCrmPackage`）— 客户名称/电话/来源/跟进状态/备注

**动态场景**（~45 个）：
`createScenarioPackage()` 基于 `scenarioDefinitions()` 数据生成，覆盖：库存、习惯、读书、健身、旅行、学习、发票、项目、会议、求职、菜谱、订阅、资产、缺陷、内容日历、目标、宠物、汽车、房屋、排班、志愿者、活动、课程、采购、供应商、合同、OKR、入职、工单、知识库、设备、农场、销售、会员、选题、作业、考试、实验、医疗、药品、借阅、电影、礼物、婚礼、搬家、环保、投资、房租、客服、产品、版本、巡检、质检、物流、维修、线索、训练营、咨询、保险、捐赠、档案、直播、短视频、访谈、竞品

---

### 11. 前端 `public/app.js` — SPA 核心功能

**页面渲染器**：

| 渲染函数 | 页面类型 | 功能 |
|---------|----------|------|
| `renderHome()` | 首页 | App 卡片网格 + 分类筛选 + App 内联编辑 |
| `renderRuntime()` | 运行框架 | 三栏布局（侧栏 + 工作区 + 助理抽屉） |
| `renderListPage(page)` | 列表页 | 数据表 + 视图 + 搜索/排序/筛选/分组 + 行内编辑 + 批量操作 + 汇总行 + 列管理 |
| `renderChartPage(page)` | 图表页 | 柱状图统计（按字段分组、计数/求和/平均） |
| `renderDashboardPage(page)` | 看板页 | 统计卡片网格（stat/quickAction），page.type='dashboard' 时独立调用 |
| `renderEditorPage(page)` | 编辑器页 | 回退到列表页 |
| `renderBlankPage(page)` | 白板页 | Canvas + 卡片（统计/表格/图表/透视表） |

**前端数据表功能矩阵**：

```
┌─────────────────────────────────────────────────────────────────┐
│ 数据列表功能                                                    │
├─────────────────────────────────────────────────────────────────┤
│ √ 列头右键菜单: 编辑/隐藏/复制/排序/筛选/分组/插入/删除       │
│ √ 列宽拖拽调整                                                  │
│ √ 行内编辑 (双击进入, 下拉/选择/关系/IME 合成)                 │
│ √ 行内快速新增                                                  │
│ √ 单元格范围选择 + 复制 (文本/图片)                             │
│ √ 批量删除                                                      │
│ √ 列排序 (升序/降序)                                            │
│ √ 筛选器 (文本/数字/日期/选择/多选/布尔/关系)                  │
│ √ 分组 (本周/本月/自定义)                                       │
│ √ 数值汇总行 (计数/求和/平均/最大/最小)                        │
│ √ 视图系统: 多视图/保存/切换/清除                              │
│ √ 搜索/快速搜索字段配置                                         │
│ √ 导出 CSV / XLSX (全部/选中)                                  │
│ √ 导入 CSV / XLSX                                              │
│ √ 图片/文件预览                                                 │
│ √ 关系字段: 标签显示 + 选项搜索                                │
│ √ 表单布局编辑器: 拖拽排序 + 2/3/4 列布局                      │
│ √ 字段设置编辑器: 标签/类型/选项/格式/描述/默认值              │
│ √ 序号/索引列 + 操作列 (编辑/删除)                             │
└─────────────────────────────────────────────────────────────────┘
```

**AI 助理功能**：
- SSE 流式对话（消息气泡 + 历史记录选择）
- 工具调用卡片：实时展示 AI 执行的 create_app/add_field 等操作
- 高风险工具确认弹窗（用户可确认/拒绝）
- 历史会话恢复（消息与工具日志按时间交错排序）
- 上下文感知（根据当前视图决定 contextKey）

**状态管理**：
- 全局 `state` 对象
- URL 路由同步（`URLSearchParams` + `history.pushState`）
- localStorage 持久化（视图配置、表单设计、侧栏状态）

---

## 测试用例（用于后续改动回归）

### 测试分类

```
tests/
├── protocol.test.js       # 单元: 包协议校验/Patch/zip/规范化
├── db-actions.test.js     # 单元: 数据库 CRUD/Action/导出
├── http.test.js           # 集成: HTTP API 全流程
├── scenarios.test.js      # 集成: 50+ 场景生成 + 8步修改链
├── http-scenarios.test.js # 集成: 50 场景 HTTP 运行
└── ui-features.test.js    # 源码特征: 前端功能存在性断言
```

### 测试用例清单

#### 1. 包协议测试（`protocol.test.js`）

| # | 用例 | 验证点 |
|---|------|--------|
| 1.1 | 包规范化与校验 | normalize+validate 后 manifest/entities/pages 正确 |
| 1.2 | 拒绝不支持字段类型 | type='script' → 抛异常 /类型不支持/ |
| 1.3 | 应用 Patch | addField + addSuggestedCommand → 字段存在 + 命令存在 |
| 1.4 | 拒绝重复页面 ID | 重复 page id → 抛异常 /页面 ID 重复/ |
| 1.5 | 空白页无绑定实体 | blank page 允许无 entity 字段 |
| 1.6 | 单表多 View 转多 Page | 同一实体 → 2 个 page, id 唯一 |
| 1.7 | Mock AI 添加页面 | modify 添加页面 → page.entity 正确 |
| 1.8 | .sgpkg zip 导入导出 | zip 往返后 manifest id 不变, 字段数一致 |
| 1.9 | JSON Schema 风格输入 | properties 格式 → 标准化为 entities 格式 |
| 1.10 | 泛型 Patch 操作 | add+type=field → field 存在且类型正确 |
| 1.11 | JSON Patch 风格操作 | /schema/entities/0/fields/- → 字段存在 |
| 1.12 | 选项颜色规范化 | options 字符串/对象混合 → 统一带 id/color 格式 |
| 1.13 | 关联字段目标校验 | targetEntity 不存在 → 抛异常 |

#### 2. 数据库与 Action 测试（`db-actions.test.js`）

| # | 用例 | 验证点 |
|---|------|--------|
| 2.1 | SQLite 存储与查询 | 创建记录 → 查询 (含关键词) → 数据正确 |
| 2.2 | 内置 Action 执行 | runAction(monthly_summary) → 返回文本 + 记录计数 |
| 2.3 | 默认导出不含用户数据 | exportAppPayload → sampleData 为 undefined |
| 2.4 | No-op 更新保持 updatedAt | 相同数据更新 → updatedAt 不变 |
| 2.5 | 更新不改变列表顺序 | 更新记录后列表顺序不变 |

#### 3. HTTP 集成测试（`http.test.js`）

| # | 用例 | 验证点 |
|---|------|--------|
| 3.1 | 创建 App 全流程 | generate → appId + manifest.name + logs |
| 3.2 | 修改 App 元数据 | PUT /api/apps/:id → name + category 更新 |
| 3.3 | 创建记录 | POST records → record.id 存在 |
| 3.4 | 上传文件 | POST uploads → file.name + url + GET 可访问 |
| 3.5 | 执行 Action | POST actions/run → result 包含记录计数 |
| 3.6 | 导出 XLSX | GET export.xlsx → content-type + PK 签名 |
| 3.7 | 选中记录导出 XLSX | GET export.xlsx?ids= → content-type |
| 3.8 | 导入 CSV | POST tables/import?name=.csv → importedCount=1 |
| 3.9 | 导入 XLSX | POST tables/import?name=.xlsx → importedCount=1 |
| 3.10 | AI 修改 | POST modify → 字段存在 + logs |
| 3.11 | 导出 .sgpkg | GET export → 200 + buffer |
| 3.12 | 导入 .sgpkg | POST import → 新 appId |
| 3.13 | V2 多表+关系 | 创建分类表 → 关联字段 → 记录关联 → 关系选项查询 |
| 3.14 | 关系数据显示 | records 查询 → relation 字段含 displayValue |
| 3.15 | 引用约束阻止删表 | DELETE table → 409 + details.references |
| 3.16 | 引用约束阻止清表 | DELETE records → 409 |
| 3.17 | 引用约束阻止删记录 | DELETE record → 409 |
| 3.18 | Force 级联删除 | DELETE record?force=true → 200 |
| 3.19 | 清空表记录 | DELETE records → deletedCount + 查询为空 |
| 3.20 | 删除表及级联清理 | DELETE table → 实体移除 + 关联字段清理 |
| 3.21 | 双向关联同步 | 从任一方增删关系 → 另一关系字段同步更新 |
| 3.22 | AI 会话记录 | GET sessions?appId= → 返回应用关联会话 |

#### 4. 场景生成测试（`scenarios.test.js`）

| # | 用例 | 验证点 |
|---|------|--------|
| 4.1 | 50+ 场景可生成运行 | 每个 prompt → entities>=1, fields>=4, list page, action>=1 |
| 4.2 | 50+ 场景覆盖 50+ 名称 | names.size >= 50 |
| 4.3 | 8 步连续修改链 | 8 次修改后: owner/priority/amount/chart/export/ai action 都存在 |

#### 5. HTTP 场景测试（`http-scenarios.test.js`）

| # | 用例 | 验证点 |
|---|------|--------|
| 5.1 | 50 场景: 创建 | POST generate → appId + entities>=1 + list page |
| 5.2 | 50 场景: 创建记录 | POST records → record.id 存在 |
| 5.3 | 50 场景: 搜索 | GET records?q= → 结果 = 1 |
| 5.4 | 50 场景: 执行 Action | POST action/run → result 存在 |
| 5.5 | 50 场景: CSV 导出 | GET export.csv → 200 + 包含 marker |
| 5.6 | 50 场景: AI 修改 | POST modify → 存在 date_field/acceptance_date |

#### 6. 前端特征测试（`ui-features.test.js`）

| # | 用例 | 验证点 |
|---|------|--------|
| 6.1 | 前端运行配置 | 128+ 特征断言 (appCategory, renderAssistantDrawer, 等) |
| 6.2 | CSS 样式 | 66+ 样式断言 |
| 6.3 | 禁止原生弹窗 | 无 alert() / confirm() / prompt() |
| 6.4 | 使用自定义弹窗 | 使用 openConfirmDialog |

---

## 测试运行

```bash
npm test   # node --test tests/*.test.js
```

每次改动后必须运行全部测试并确保通过。新增功能需同步补充对应分类的测试用例。
