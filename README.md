# 软件花园 MVP

软件花园是一个面向个人用户的 AI 软件创造平台 MVP。用户用自然语言描述需求，系统生成结构化软件包，并由 Runtime 立即运行。

这个版本采用零外部依赖实现，方便直接启动和验收：

- Node.js 内置 HTTP 服务
- Node.js 内置 `node:sqlite`
- 原生浏览器前端
- `.sgpkg` zip 软件包导入导出
- Mock AI 默认可用，配置 API Key 后可调用 OpenAI-compatible API

## 环境要求

需要 Node.js 25 或更高版本，因为本项目使用 Node 内置 SQLite。

```bash
node -v
```

## 启动

```bash
npm start
```

打开：

```text
http://localhost:5173
```

## 初始化示例

```bash
node src/initSamples.js
```

脚本会：

- 写入四个示例软件包到 `samples/`
- 生成对应 `.sgpkg`
- 如果数据库为空，把四个示例安装到本地 SQLite

## 测试

```bash
npm test
```

测试覆盖：

- 软件包协议校验
- Patch 应用
- SQLite CRUD
- Action runner
- `.sgpkg` 导入导出
- HTTP API 核心闭环

## 数据存储

默认数据目录：

```text
data/
  db.sqlite
  apps/
  uploads/
  exports/
```

应用结构保存在 `apps` 表中：

- `manifestJson`
- `schemaJson`
- `uiJson`
- `actionsJson`
- `promptsJson`

用户记录统一保存在 `records.dataJson`，并通过 `entityId` 区分实体。

## 软件包格式

`.sgpkg` 是 zip 包：

```text
app.sgpkg
├── manifest.json
├── schema.json
├── ui.json
├── actions.json
├── prompts.json
└── sample-data.json 可选
```

默认导出只包含应用结构，不包含真实用户数据。

## AI 配置

首页右上角进入“设置”，可填写：

- API Base URL
- API Key
- Model

如果 API Key 为空，系统使用本地 Mock AI，方便离线演示和验收。

## 示例 Prompt

```text
帮我创建一个家庭记账本，可以记录收入、支出、分类、日期、备注，并统计每月支出。
```

```text
帮我创建一个待办事项工具，可以记录任务、截止日期、优先级、完成状态。
```

```text
帮我创建一个公众号文章生成器，可以输入主题、目标读者、文章风格，然后生成文章标题、大纲和正文。
```

```text
帮我创建一个客户管理器，记录客户姓名、电话、来源、跟进状态、备注。
```

## MVP 限制

- 不支持多用户和登录。
- 不支持云同步。
- 不执行 AI 生成的任意代码。
- 富文本编辑器在 MVP 中用 TextArea 替代。
- 图表使用轻量原生条形展示，后续可替换为 Recharts。
- 当前实现为了可直接运行，未引入 React/Fastify/Prisma；后续工程化版本可以平滑迁移。
