# 软件花园（Software Garden）MVP 开发规格说明书

> 给 Codex / AI 编程工具使用的完整开发说明。目标是交付一个可运行的 MVP，而不是概念 Demo。

---

## 0. 项目一句话

做一个面向个人用户的 AI 软件创造平台：用户通过自然语言描述需求，平台即时创建一个可运行的个人软件；用户可以继续对话修改它，并把创建出来的软件打包分享给别人安装使用。

核心口号：

> 人人都是软件创造者。

---

## 1. 产品背景

现在越来越多人开始用 AI 编程工具创建小软件，但普通用户仍然面临这些问题：

1. 不会搭环境。
2. 不知道怎么部署。
3. 不会维护代码。
4. 想改功能还要重新找 AI 改代码。
5. 自己创建出来的软件很难打包分享给别人。

本项目要解决的问题是：

> 用户只表达需求，不接触代码；平台负责生成、运行、修改和分享软件。

---

## 2. 产品定位

本项目不是传统低代码平台，也不是企业级后台系统。

它更像：

- Canva：普通人也能创作。
- GitHub：作品可以分享、复制、改造。
- App Store：别人可以安装使用。
- AI 助手：通过对话创建和修改软件。

MVP 阶段先不要做企业组织、复杂权限、多人协作、插件市场、云端生态。

---

## 3. 竞品与开源参考

### 3.1 NocoBase

NocoBase 是开源 AI + no-code 平台，强调 AI 不从零生成所有东西，而是在成熟基础设施和插件架构上工作。这一点值得借鉴：本项目也应该避免让 AI 每次裸写完整应用代码，而是优先生成结构化软件包。参考：NocoBase GitHub / 官网说明其定位为 open-source AI + no-code platform，并采用可组合插件。  
来源：NocoBase GitHub、官网。

### 3.2 Appsmith

Appsmith 是开源低代码平台，适合构建内部工具、管理面板、自定义业务应用，支持数据源连接、UI 搭建和 JS 自定义。它证明了“通用运行时 + 数据源 + 页面配置”的价值，但它主要面向开发者/企业内部工具，不是普通人的个人软件创造平台。

### 3.3 E2B

E2B 是开源 AI 代码沙箱，用于在安全隔离环境中运行 AI 生成代码。后续如果平台允许 AI 生成真正的 Action 代码，应参考 E2B 的沙箱思路：隔离运行、资源限制、权限控制、失败回滚。

### 3.4 OpenHands

OpenHands 是开源 AI 软件开发 Agent 平台，可执行真实工程任务。它适合作为未来“高级代码生成/自动修复/自动测试”的参考，但 MVP 不应直接做成完整 AI 编程 Agent。

---

## 4. MVP 目标

MVP 只交付一个最小闭环：

```text
用户输入一句话
↓
AI 生成一个个人软件包
↓
平台立即运行
↓
用户可以继续用对话修改
↓
用户可以导出分享
↓
别人可以导入安装
```

MVP 必须支持 4 个典型案例：

1. 家庭记账本
2. ToDoList
3. 公众号文章生成器
4. 客户管理器

注意：这些案例不要写死。它们只是验收用例，必须通过同一套生成机制实现。

---

## 5. MVP 不做什么

第一版不要实现：

- 企业组织架构
- 部门/角色/权限体系
- 多用户协作
- 在线应用市场
- 复杂审批流
- 复杂插件系统
- 云同步
- 支付系统
- 手机原生 App
- 大型代码沙箱
- 完整 IDE
- AI 自动修复全部 bug

---

## 6. 技术路线总原则

### 6.1 第一优先：结构化生成，不裸写完整应用

用户创建软件时，AI 不直接生成完整 React/Vue 项目，而是生成一个结构化软件包：

```text
Software Package
├── manifest.json       软件基本信息
├── schema.json         数据结构
├── ui.json             页面结构
├── actions.json        动作定义
├── prompts.json        AI 提示词能力
└── assets/             图标等资源
```

平台通过 Runtime Engine 解释这些 JSON，并立即运行。

### 6.2 第二优先：需要复杂能力时，用 Action

例如“公众号文章生成器”需要 AI 写作、标题优化、排版输出，不只是表单 CRUD。

MVP 中 Action 先不要执行任意代码，而是支持几类安全动作：

- ai.generateText
- ai.rewriteText
- ai.summarize
- data.createRecord
- data.updateRecord
- data.queryRecords
- export.markdown
- export.json
- export.csv

后续版本再支持沙箱代码。

### 6.3 第三优先：软件可打包分享

每个软件可以导出为 `.sgpkg` 文件，本质是 zip 包。

别人导入后，可以安装到自己的空间，并继续修改。

---

## 7. 推荐技术栈

为了让 Codex 快速交付，建议采用单体应用。

### 7.1 前端

- React
- Vite
- TypeScript
- Ant Design 或 shadcn/ui，二选一；为了快速开发，优先 Ant Design
- React Router
- Zustand 或 Redux Toolkit，优先 Zustand

### 7.2 后端

- Node.js
- Fastify 或 Express，优先 Fastify
- TypeScript
- SQLite
- Prisma ORM

### 7.3 AI 接入

- OpenAI-compatible API
- 配置项：baseUrl、apiKey、model
- 默认不内置真实 Key，由用户在设置页面填写

### 7.4 文件存储

本地目录：

```text
/data
  /apps
  /uploads
  /exports
  /db.sqlite
```

### 7.5 开发方式

Monorepo：

```text
software-garden/
├── package.json
├── apps/
│   ├── web/
│   └── server/
├── packages/
│   ├── shared/
│   └── runtime/
├── data/
└── README.md
```

---

## 8. 核心概念模型

### 8.1 User

MVP 只有单用户模式，不需要登录。

预留用户字段，但不实现登录。

### 8.2 SoftwareApp

用户创建出来的一个个人软件。

例如：家庭记账本、ToDoList、公众号文章生成器。

### 8.3 SoftwarePackage

一个可导入导出的软件包。

包含 manifest、schema、ui、actions、prompts。

### 8.4 Record

软件里的数据记录。

比如记账本中的一笔支出、ToDoList 中的一条任务。

### 8.5 Action

软件里的动作能力。

例如：生成文章、优化标题、导出 Markdown、统计支出。

### 8.6 Conversation

用户与平台 AI 的对话记录。

用于创建软件、修改软件、解释软件。

---

## 9. 数据库设计

使用 SQLite + Prisma。

### 9.1 apps 表

```prisma
model App {
  id          String   @id @default(cuid())
  slug        String   @unique
  name        String
  description String?
  icon        String?
  manifestJson String
  schemaJson   String
  uiJson       String
  actionsJson  String
  promptsJson  String?
  version     String   @default("1.0.0")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  records     Record[]
}
```

### 9.2 records 表

```prisma
model Record {
  id        String   @id @default(cuid())
  appId     String
  dataJson  String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  app       App      @relation(fields: [appId], references: [id], onDelete: Cascade)
}
```

### 9.3 conversations 表

```prisma
model Conversation {
  id        String   @id @default(cuid())
  appId     String?
  title     String?
  messagesJson String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### 9.4 settings 表

```prisma
model Setting {
  key       String @id
  valueJson String
  updatedAt DateTime @updatedAt
}
```

---

## 10. 软件包协议 V1

### 10.1 manifest.json

```json
{
  "packageVersion": "1.0",
  "id": "budget-book",
  "name": "家庭记账本",
  "description": "记录收入、支出、分类和月度统计。",
  "icon": "wallet",
  "version": "1.0.0",
  "author": "local-user",
  "createdBy": "ai",
  "tags": ["finance", "personal"]
}
```

### 10.2 schema.json

```json
{
  "entities": [
    {
      "id": "transaction",
      "name": "账目",
      "fields": [
        {
          "id": "type",
          "label": "类型",
          "type": "select",
          "required": true,
          "options": ["收入", "支出"]
        },
        {
          "id": "amount",
          "label": "金额",
          "type": "number",
          "required": true
        },
        {
          "id": "category",
          "label": "分类",
          "type": "select",
          "options": ["餐饮", "交通", "购物", "工资", "其他"]
        },
        {
          "id": "date",
          "label": "日期",
          "type": "date",
          "required": true
        },
        {
          "id": "note",
          "label": "备注",
          "type": "textarea"
        }
      ]
    }
  ]
}
```

### 10.3 支持字段类型

MVP 支持：

```text
text
textarea
number
date
datetime
select
multiSelect
boolean
image
file
richText
```

### 10.4 ui.json

```json
{
  "home": {
    "layout": "dashboard",
    "cards": [
      {
        "type": "stat",
        "title": "本月支出",
        "entity": "transaction",
        "operation": "sum",
        "field": "amount",
        "filter": {
          "type": "支出"
        }
      },
      {
        "type": "quickAction",
        "title": "新增账目",
        "action": "openCreateForm",
        "entity": "transaction"
      }
    ]
  },
  "pages": [
    {
      "id": "transaction-list",
      "title": "账目列表",
      "type": "list",
      "entity": "transaction",
      "features": ["create", "edit", "delete", "search", "export"]
    },
    {
      "id": "transaction-chart",
      "title": "分类统计",
      "type": "chart",
      "entity": "transaction",
      "chart": {
        "type": "pie",
        "groupBy": "category",
        "value": "amount"
      }
    }
  ]
}
```

### 10.5 actions.json

```json
{
  "actions": [
    {
      "id": "monthly_summary",
      "name": "生成月度总结",
      "type": "ai.generateText",
      "input": {
        "records": "transaction"
      },
      "prompt": "根据这些账目数据，生成一段简洁的月度收支总结，指出主要支出类别和节省建议。"
    }
  ]
}
```

### 10.6 prompts.json

```json
{
  "systemPrompt": "你是这个软件的助手，负责帮助用户使用和改进该软件。",
  "suggestedCommands": [
    "增加一个字段",
    "生成本月总结",
    "添加一个统计页面"
  ]
}
```

---

## 11. AI 生成流程

### 11.1 创建软件

用户输入：

```text
帮我创建一个家庭记账本，可以记录收入、支出、分类、日期和备注，并能统计每月支出。
```

后端调用 AI，要求 AI 只返回 JSON：

```json
{
  "manifest": {},
  "schema": {},
  "ui": {},
  "actions": {},
  "prompts": {}
}
```

后端必须做：

1. JSON parse。
2. Zod schema 校验。
3. 字段 id 规范化。
4. slug 去重。
5. 保存到 apps 表。
6. 返回 appId。

### 11.2 修改软件

用户在某个软件内输入：

```text
增加一个旅游预算功能。
```

AI 输入必须包含当前软件包 JSON。

AI 输出 Patch，而不是整包重写。

Patch 格式：

```json
{
  "summary": "增加旅游预算字段和统计页面",
  "operations": [
    {
      "op": "addField",
      "entity": "transaction",
      "field": {
        "id": "travel_budget",
        "label": "是否计入旅游预算",
        "type": "boolean"
      }
    },
    {
      "op": "addPage",
      "page": {
        "id": "travel-budget-chart",
        "title": "旅游预算统计",
        "type": "chart",
        "entity": "transaction",
        "chart": {
          "type": "bar",
          "groupBy": "date",
          "value": "amount"
        }
      }
    }
  ]
}
```

后端应用 Patch，重新校验完整软件包，保存新版本。

### 11.3 支持的 Patch 操作

MVP 支持：

```text
renameApp
updateDescription
addEntity
renameEntity
addField
updateField
removeField
addPage
updatePage
removePage
addAction
updateAction
removeAction
addSuggestedCommand
```

---

## 12. 后端 API 设计

### 12.1 App API

#### GET /api/apps

返回所有软件。

#### GET /api/apps/:id

返回单个软件详情。

#### POST /api/apps/generate

请求：

```json
{
  "prompt": "帮我创建一个家庭记账本..."
}
```

返回：

```json
{
  "appId": "xxx",
  "app": {}
}
```

#### POST /api/apps/:id/modify

请求：

```json
{
  "prompt": "增加一个旅游预算功能"
}
```

返回：

```json
{
  "summary": "已增加旅游预算功能",
  "app": {}
}
```

#### DELETE /api/apps/:id

删除软件。

---

### 12.2 Record API

#### GET /api/apps/:appId/records

支持 query：

```text
?q=关键词&page=1&pageSize=20
```

#### POST /api/apps/:appId/records

新增记录。

#### PUT /api/apps/:appId/records/:recordId

修改记录。

#### DELETE /api/apps/:appId/records/:recordId

删除记录。

#### GET /api/apps/:appId/export.csv

导出 CSV。

---

### 12.3 Action API

#### POST /api/apps/:appId/actions/:actionId/run

执行 Action。

返回：

```json
{
  "result": "..."
}
```

---

### 12.4 Package API

#### GET /api/apps/:appId/export

导出 `.sgpkg` 文件。

#### POST /api/apps/import

上传 `.sgpkg` 文件并安装。

---

### 12.5 Settings API

#### GET /api/settings

获取 AI 配置。

#### PUT /api/settings

保存 AI 配置。

字段：

```json
{
  "ai": {
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "",
    "model": "gpt-4.1-mini"
  }
}
```

---

## 13. 前端页面设计

### 13.1 首页：我的软件花园

核心元素：

- 顶部标题：软件花园
- 副标题：一句话，创造属于你的软件
- 中央输入框：今天想创造什么？
- 按钮：立即创造
- 下方卡片：我的软件

软件卡片展示：

- 图标
- 名称
- 简介
- 最近更新时间
- 打开按钮
- 更多菜单：导出、删除

### 13.2 创建过程页 / 弹窗

用户提交 prompt 后展示：

```text
正在理解你的需求...
正在设计数据结构...
正在生成页面...
正在安装软件...
```

成功后跳转到软件运行页。

### 13.3 软件运行页

布局：

```text
左侧：软件页面菜单
中间：动态页面
右侧：AI 修改助手，可折叠
```

左侧菜单来自 ui.json pages。

中间根据 page.type 渲染：

- list
- form
- detail
- dashboard
- chart
- editor

右侧 AI 助手输入：

```text
想怎么改这个软件？
```

### 13.4 动态列表页

功能：

- 搜索
- 新增
- 编辑
- 删除
- 导出 CSV
- 字段列自动生成

### 13.5 动态表单页

根据字段类型生成组件。

字段校验：

- required
- number
- date
- select options

### 13.6 动态图表页

MVP 支持：

- stat 数字卡片
- bar chart
- pie chart

可使用 Recharts。

### 13.7 导入软件页

用户上传 `.sgpkg`。

展示软件包信息：

- 名称
- 描述
- 版本
- 包含页面
- 包含数据结构

按钮：安装。

### 13.8 设置页

配置 AI：

- API Base URL
- API Key
- Model
- 测试连接按钮

---

## 14. Runtime Engine 设计

Runtime Engine 负责把软件包变成可运行软件。

### 14.1 组件映射

字段类型到组件：

```text
text -> Input
textarea -> TextArea
number -> InputNumber
date -> DatePicker
datetime -> DatePicker showTime
select -> Select
multiSelect -> Select mode=multiple
boolean -> Switch
image -> Upload image
file -> Upload file
richText -> 富文本编辑器，MVP 可先用 TextArea 替代
```

### 14.2 页面类型到组件

```text
list -> DynamicListPage
form -> DynamicFormPage
dashboard -> DynamicDashboardPage
chart -> DynamicChartPage
editor -> DynamicEditorPage
```

### 14.3 数据存储策略

MVP 用 records.dataJson 存任意数据。

优点：

- 新软件立即生效
- 不需要动态建表
- 导入导出简单

缺点：

- 复杂查询性能一般

MVP 接受该限制。

---

## 15. AI 提示词要求

### 15.1 创建软件 System Prompt

```text
你是 Software Garden 的软件设计助手。你的任务是把用户的自然语言需求转换成一个可运行的软件包 JSON。

重要规则：
1. 只输出 JSON，不要输出 Markdown。
2. 不要生成代码。
3. 必须包含 manifest、schema、ui、actions、prompts 五个顶层字段。
4. schema 中必须至少包含一个 entity。
5. ui 中必须至少包含一个 list 页面。
6. 字段 id 必须使用英文小写下划线。
7. 字段 label 使用用户语言。
8. 不要创建危险动作，不要访问本地文件系统，不要请求系统权限。
9. 如果用户需求不完整，合理补全一个可用的最小软件。
```

### 15.2 修改软件 System Prompt

```text
你是 Software Garden 的软件进化助手。用户会要求修改一个已有软件。你的任务是输出 Patch JSON，而不是完整软件包。

重要规则：
1. 只输出 JSON，不要输出 Markdown。
2. 顶层包含 summary 和 operations。
3. operations 只能使用系统支持的 Patch 操作。
4. 不要删除用户已有数据字段，除非用户明确要求。
5. 修改应保持软件可运行。
6. 优先做最小变更。
```

---

## 16. 安全设计

MVP 不执行 AI 生成的任意 JS/Python 代码。

所有 AI 输出都必须：

1. JSON parse。
2. Zod 校验。
3. 白名单字段。
4. 白名单 action type。
5. 禁止 HTML script 注入。
6. 前端渲染所有用户内容时转义。

Action 限制：

- 只能执行平台内置 Action。
- AI 只配置 Action 参数。
- 不允许 AI 创建任意网络请求。
- 不允许 AI 读取本地任意文件。

---

## 17. 打包分享设计

### 17.1 导出格式

`.sgpkg` 是 zip 文件。

结构：

```text
app.sgpkg
├── manifest.json
├── schema.json
├── ui.json
├── actions.json
├── prompts.json
├── sample-data.json 可选
└── assets/
```

### 17.2 导出规则

导出时让用户选择：

- 只导出软件结构
- 导出软件结构 + 示例数据
- 导出软件结构 + 全部数据

MVP 默认只导出软件结构。

### 17.3 导入规则

导入时：

1. 解压到临时目录。
2. 校验 manifest/schema/ui/actions。
3. 如果 slug 冲突，自动追加后缀。
4. 安装到 apps 表。
5. 返回新 appId。

---

## 18. 验收用例

### 18.1 家庭记账本

输入：

```text
帮我创建一个家庭记账本，可以记录收入、支出、分类、日期、备注，并统计每月支出。
```

验收：

- 自动创建软件。
- 有账目列表。
- 可以新增一笔支出。
- 可以搜索记录。
- 可以看到分类/金额统计。
- 可以导出 CSV。
- 可以继续说“增加旅游预算功能”，系统能添加字段或页面。

### 18.2 ToDoList

输入：

```text
帮我创建一个待办事项工具，可以记录任务、截止日期、优先级、完成状态。
```

验收：

- 有任务列表。
- 可以新增任务。
- 可以修改完成状态。
- 可以按关键词搜索。
- 可以增加“今日任务”页面。

### 18.3 公众号文章生成器

输入：

```text
帮我创建一个公众号文章生成器，可以输入主题、目标读者、文章风格，然后生成文章标题、大纲和正文。
```

验收：

- 有文章生成表单。
- 有文章记录列表。
- 有 AI 生成文章 Action。
- 可以保存生成结果。
- 可以导出 Markdown。
- 可以继续说“增加爆款标题分析”，系统能添加一个 AI Action。

### 18.4 客户管理器

输入：

```text
帮我创建一个客户管理器，记录客户姓名、电话、来源、跟进状态、备注。
```

验收：

- 有客户列表。
- 可以新增、编辑、删除。
- 可以按状态筛选。
- 可以导出 CSV。
- 可以继续增加“跟进提醒日期”。

---

## 19. 开发任务拆分

### Phase 1：项目骨架

任务：

1. 创建 monorepo。
2. 创建 web + server。
3. 接入 SQLite + Prisma。
4. 实现基础 API。
5. 实现前端路由。

验收：

- `npm install` 成功。
- `npm run dev` 同时启动前后端。
- 首页可访问。

### Phase 2：软件包协议与 Runtime

任务：

1. 定义 TypeScript 类型。
2. 定义 Zod 校验。
3. 实现 DynamicListPage。
4. 实现 DynamicFormPage。
5. 实现 DynamicDashboardPage。
6. 实现 DynamicChartPage。

验收：

- 手写一个家庭记账本 JSON，可以正常运行。

### Phase 3：AI 创建软件

任务：

1. 设置页配置 AI。
2. 实现 `/api/apps/generate`。
3. 实现 AI JSON 输出解析。
4. 实现创建过程 UI。

验收：

- 输入一句话可以生成家庭记账本。

### Phase 4：AI 修改软件

任务：

1. 实现 Patch 协议。
2. 实现 Patch apply。
3. 实现 `/api/apps/:id/modify`。
4. 实现软件右侧 AI 修改助手。

验收：

- 可以对已有软件说“增加一个字段”。
- 可以对已有软件说“增加一个统计页面”。

### Phase 5：Action 系统

任务：

1. 实现内置 Action runner。
2. 支持 ai.generateText。
3. 支持 export.markdown。
4. 支持 data.queryRecords。

验收：

- 公众号文章生成器可以生成文章。
- 家庭记账本可以生成月度总结。

### Phase 6：导入导出

任务：

1. 实现 `.sgpkg` zip 导出。
2. 实现 `.sgpkg` 导入。
3. 前端导入导出 UI。

验收：

- 导出一个软件包。
- 删除本地软件。
- 重新导入可运行。

---

## 20. README 要求

Codex 必须生成 README.md，包含：

1. 项目简介。
2. 技术栈。
3. 安装方法。
4. 启动方法。
5. AI 配置方法。
6. 示例 prompt。
7. 软件包导入导出说明。
8. MVP 限制。

---

## 21. 代码质量要求

1. 全部使用 TypeScript。
2. 不允许 any 泛滥。
3. 后端 API 必须有错误处理。
4. AI 输出必须校验后才能保存。
5. 前端必须有 loading 和 error 状态。
6. 所有主要函数加简短注释。
7. 不要硬编码 OpenAI Key。
8. 不要把用户数据上传到第三方，除非用户主动触发 AI 功能。

---

## 22. 推荐目录结构

```text
software-garden/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   ├── runtime/
│   │   │   ├── api/
│   │   │   └── store/
│   │   └── package.json
│   └── server/
│       ├── src/
│       │   ├── routes/
│       │   ├── services/
│       │   ├── ai/
│       │   ├── package/
│       │   ├── runtime/
│       │   └── db/
│       ├── prisma/
│       └── package.json
├── packages/
│   ├── shared/
│   │   ├── src/types.ts
│   │   ├── src/schema.ts
│   │   └── src/patch.ts
│   └── runtime/
├── data/
├── README.md
└── package.json
```

---

## 23. 最终交付物

Codex 最终应交付：

1. 可运行源码。
2. README.md。
3. 示例软件包：
   - 家庭记账本
   - ToDoList
   - 公众号文章生成器
   - 客户管理器
4. 自动初始化脚本。
5. 至少一个 `.sgpkg` 导出示例。

---

## 24. 一句话总结给开发者

这个项目的核心不是写很多固定功能，而是写一个“软件运行时”。

AI 负责把用户需求变成软件包 JSON。

Runtime 负责把软件包 JSON 变成可运行软件。

用户通过对话让软件不断成长，并能把软件包分享给别人。

