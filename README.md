# 鲁班 AI 系统

> **AI Native Application Platform**
> 用 AI 创建、运行、修改并持续演化软件，而不仅仅是生成代码。

**Demo：** [https://luban-byp6.onrender.com/](https://luban-byp6.onrender.com/)

---

# 项目简介

鲁班 AI 是一个面向个人、团队和业务场景的 **AI 原生软件创建平台（AI Native Application Platform）**。

它希望把"开发软件"从传统的代码工程，推进到：

> **自然语言 → AI 理解 → 软件协议（Contract）→ 软件包（Package）→ Runtime 即时运行**

用户无需编写代码，只需要描述需求，例如：

> 创建一个客户管理系统

AI 会自动生成：

- 数据模型（Schema）
- 页面（Pages）
- Dashboard（看板）
- Actions
- Prompt
- 软件包（Package）

随后 Runtime 立即运行应用。

整个应用后续仍然可以继续通过 AI 演进，例如：

- 增加字段
- 增加页面
- 创建 Dashboard
- 创建关系字段
- 增加 Action
- 调整页面布局

AI 不重新生成整个应用，而是生成 Patch，对已有软件持续修改。

---

# 系统介绍

鲁班 AI 并不是一个传统低代码平台。

它采用 **Contract First + Package Driven + AI Native** 的设计思想。

AI 首先生成统一的软件协议（Contract），再由 Runtime 根据协议即时运行应用。

整个系统围绕统一协议工作：

```
Natural Language

↓

AI

↓

Contract

↓

Package

↓

Runtime

↓

Running Application
```

这样 AI、Runtime、Package、Validation、Tests 始终使用同一套协议，避免文档、Prompt 与代码逐渐漂移。

---

# 愿景

过去的软件开发流程通常是：

需求

↓

开发

↓

上线

↓

结束

鲁班 AI 希望变成：

需求

↓

AI 创建软件

↓

立即运行

↓

持续使用

↓

持续演化

软件不再是一段代码，而是一套可以持续成长的软件资产。

每个应用都拥有：

- 完整的软件协议（Contract）
- 结构化数据模型
- 可运行页面
- Dashboard
- 内置 Action
- AI Patch 修改能力
- 本地持久化
- 软件包导入导出

最终目标是：

> **让每个人都拥有属于自己的软件，而不是适应别人开发的软件。**

---

# 核心能力

- 自然语言创建软件
- AI 持续修改已有软件
- Dashboard 看板页面
- 多实体、多表关系
- 关系字段
- 行内编辑
- 排序
- 分组
- 搜索
- CSV/XLSX 导出
- `.sgpkg` 软件包导入导出
- SQLite 本地存储
- AI 会话历史
- Runtime 即时渲染
- AI 创建、修改、启用和禁用业务规则
- 跨表字段联动与规则执行日志

## 业务规则与自由编辑

鲁班的表格始终允许像电子表格一样先创建空白记录、逐项填写和随时修改。业务规则不会把自己的依赖字段偷偷升级成表结构的必填约束。

“新增记录时”规则采用事件执行模型：

1. 新记录创建时，如果规则依赖字段尚未完整，记录正常保存，规则进入“等待条件”。
2. 用户后续编辑补齐依赖字段后，规则自动执行一次。
3. 同一规则与来源记录成功执行后，不会因为继续编辑而重复执行。
4. 来源记录后续修改或删除，不撤销、不修正已经产生的影响。
5. 规则后续修改、禁用或删除，只影响未来事件，不追溯、不补偿历史结果。
6. 规则创建前已经存在的历史记录不会被扫描或补执行。

表单使用“规则所需”提示标识依赖字段，但允许留空暂存；真正的红色必填标识只属于 Schema 明确定义的必填字段。

规则执行成功提示和执行日志会展示实际字段变化，例如“已完成‘出库扣减库存’：商品信息‘苹果’的‘当前库存’已由 100 调整为 90”，便于用户立即确认规则产生的结果。执行记录列表无需展开即可看到本次处理结果；展开后可继续查看完整业务过程和高级技术信息。

系统提示遵循“业务语言优先”：普通界面说明发生了什么、产生了什么影响以及用户下一步可以怎么做，不直接展示 Contract、Step、数据库约束、内部 ID 等技术术语。技术原文仍保留在高级信息和诊断数据中，方便开发排查。

例如“新增入库记录后增加商品库存”：空白入库行可以先保存；商品和入库数量补齐后库存增加一次。此后修改入库数量、删除入库记录或修改规则，都不会反向调整已经增加的库存。如需可逆业务，应另外设计明确的撤销或状态流转规则。

---

# 可以创建什么

适用于各种轻量业务系统，例如：

- 项目管理
- 客户管理
- CRM
- 待办事项
- 工单系统
- 库存管理
- 订单管理
- 会议纪要
- 用户访谈
- 产品需求池
- 课程反馈
- 知识库
- 内容管理
- 竞品分析
- 数据收集

---

# 界面预览

## 首页

首页是软件工厂入口。

支持：

- 创建软件
- 导入软件
- 导出软件
- 分类浏览
- AI 创建

---

## AI 助理

AI 助理负责：

- 创建应用
- 修改应用
- 添加字段
- 添加页面
- 创建 Dashboard
- 新增 Action

创建完成后即可立即运行。

---

## 软件运行页

运行页包括：

- 页面导航
- 数据管理
- Dashboard
- 搜索
- 排序
- 分组
- 导入导出
- AI 修改

整个应用可以边使用边演化。

---

# 当前架构

```
                    contract.js
               (Single Source of Truth)
                        │
        ┌───────────────┼────────────────┐
        │               │                │
 Package Protocol   AI Prompt       AI Tools
        │               │
        └───────────────┼────────────────┘
                        │
                   Runtime
                        │
        ┌───────────────┴───────────────┐
        │                               │
    Validation                      SQLite
                        │
                      Tests
```

经过 Architecture Freeze 后：

- Contract
- Package Protocol
- AI Prompt
- Validation
- Tests

已经统一使用同一份协议定义。

---

# 技术架构

当前版本尽量减少外部依赖：

- Node.js HTTP Server
- Node.js SQLite
- 原生 Browser SPA
- ES Modules
- SQLite
- ZIP 软件包

```
Browser SPA
 ├── 首页
 ├── Runtime 工作台
 ├── AI 助手
 └── 设置

Node.js Server
 ├── AI Chat (SSE)
 ├── AI Confirm
 ├── App Runtime
 ├── Record CRUD
 ├── Action Runner
 ├── Package Protocol
 ├── Import / Export
 └── Settings

SQLite
 ├── apps
 ├── records
 ├── record_relations
 ├── ai_sessions
 ├── ai_messages
 ├── ai_execution_logs
 └── settings
```

---

# Contract Layer

Contract Layer 是整个系统唯一协议来源。

位置：

```
src/core/contract.js
```

目前统一维护：

- FIELD_TYPES
- PAGE_TYPES
- TABLE_VIEW_TYPES
- ACTION_TYPES
- PATCH_OPS
- SELECT_COLORS

AI Prompt、Package Protocol、Validation、Tests 全部引用同一份 Contract。

避免协议漂移。

---

# 软件包协议

`.sgpkg` 是鲁班 AI 的软件包格式。

```
app.sgpkg

manifest.json

schema.json

ui.json

actions.json

prompts.json

sample-data.json
```

默认导出：

- 应用结构
- 页面
- Action
- Prompt

默认不导出真实业务数据。

---

# 支持的模型元素

## 字段类型

目前支持：

- text
- textarea
- richText
- number
- date
- datetime
- url
- select
- multiSelect
- relation
- image
- file
- formula
- ai

---

## 页面类型

正式支持：

- page
- table
- dashboard
- link

---

## View 类型

支持：

- list
- quadrant
- gantt

---

# AI 工作流

创建应用：

```
User

↓

POST /api/ai/chat

↓

Package

↓

Runtime

↓

Running App
```

修改应用：

```
User

↓

AI

↓

Patch

↓

Validate

↓

Apply

↓

Runtime
```

高风险操作需要用户确认后执行。

---

# 快速开始

## 环境要求

Node.js 25+

```
node -v
```

安装：

```
npm install
```

启动：

```
npm start
```

开发模式：

```
npm run dev
```

浏览器：

```
http://localhost:5173
```

---

# AI 配置

设置中可配置：

- API Base URL
- API Key
- Model

如果未配置模型，将自动使用 Mock AI。

---

# 示例 Prompt

```
帮我创建一个家庭记账本。

帮我创建一个客户管理系统。

增加一个客户等级字段。

新增一个经营分析看板。
```

---

# 测试

```
npm test
```

目前测试覆盖：

- Package Protocol
- Contract
- Dashboard
- Patch
- AI Regression
- Prompt
- SQLite
- Runtime
- HTTP API
- UI

Architecture Freeze 后：

- 文档
- Prompt
- Protocol
- Tests

保持同步。

---

# 性能基准测试

```
npm run bench
```

性能基准测试位于 `benchmarks/performance.bench.js`，使用独立 SQLite 文件 `data/bench.sqlite`，不会污染业务数据库。

覆盖场景：
- 大量记录创建（1000 / 5000 / 10000 条）
- 列表分页读取
- 搜索性能
- 关系字段选项加载
- 公式字段批量计算
- CSV / XLSX 导出
- AI 会话长历史读取

基准测试默认不因性能阈值失败，仅输出性能指标供参考。

---

# 数据目录

```
data/

db.sqlite

apps/

uploads/

exports/
```

---

# 当前限制

当前版本仍为 MVP：

- 暂不支持多用户
- 暂不支持云同步
- 不执行 AI 生成代码
- 图表仍采用轻量实现
- 暂未引入 React、Fastify、Prisma 等框架
- 页面基础 CRUD（新增/修改/删除/查询）由 Runtime 直接处理，不经过 Action
- Action 仅用于系统内置标准动作，不支持用户自定义 Action

---

# 项目定位

鲁班 AI 并不是：

- 代码生成器
- 表单生成器
- ChatBot 外壳

它更希望成为：

> **AI Native Software Platform**

让 AI 创建软件、运行软件，并持续演化软件。

---

# 已完成

- ✅ Architecture Freeze
- ✅ Contract Layer
- ✅ Dashboard 独立页面类型
- ✅ Prompt Contract 化
- ✅ Package Protocol 收口
- ✅ Semantic Field Helpers
- ✅ AI Patch
- ✅ Runtime
- ✅ SQLite Storage

---

# 设计原则

项目坚持以下原则：

- **Contract First**：协议唯一来源。
- **AI Native**：AI 是 Runtime 的一部分，而不是外挂。
- **Package Driven**：应用以 Package 为运行单位。
- **Small Evolution**：优先 Patch 演进，而不是整体重建。
- **Readable Code**：保持代码可读性，避免过度抽象。
- **Single Source of Truth**：文档、Prompt、Runtime、Tests 使用同一套协议。

---

# License

本项目采用 **GNU Affero General Public License v3.0 (AGPL-3.0)** 开源协议。
