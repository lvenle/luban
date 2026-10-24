# 鲁班接入共享 AI Runtime

实施日期：2026-10-13。基于 `ai_work/luban` 新版与当前 `agent-platform` 源码。

## 最终边界

鲁班与 AI工作台复用同一套底座实现，使用各自的实例、数据库、服务生命周期和工具策略。鲁班不需要安装或启动 AI工作台，也不连接固定 5190 服务。

鲁班原有页面、应用包协议、页面渲染、记录与关系管理、规则事务、业务定时任务继续由鲁班负责。此次仅调整系统设置的默认选项及底座入口地址，不更换业务页面。

```text
Electron 主进程
  ├─ 鲁班本地 HTTP 服务 → 原有页面、产品 SSE API
  └─ 鲁班独立底座实例 → 随机端口管理 API 与共享 Vue 控制台

鲁班产品 API
  → 会话适配器（提示词、应用上下文、确认、SSE 兼容）
  → startProductRun / RunService（同进程 SDK）
  → 模型、Skills、知识检索、配置快照与执行审计
  → 本次运行专用的 LubanToolProvider
  → 原有鲁班业务服务与 SQLite 事务
```

模型连接、连接参数、Agent 参数、轮数和超时由底座解析。Agent 的 Skills 和知识库绑定进入同一条 RunService 执行链。非对话生成也使用 RunService，并将工具许可收窄为空，禁止生成选项或字段内容时执行业务操作。

每个请求独立注册带 appId/pageId 的产品工具实现，产品上下文不写入共享注册表。Agent 授权、产品白名单及工具停用开关继续生效。高风险操作仍使用现有确认弹窗；取消清理等待中的确认。已有产品会话 ID 通过底座映射到内部会话，旧历史无需搬迁即可继续显示；新运行同时保留底座审计。

## 运行与配置

开发启动：`npm start`。首次启动创建鲁班自己的底座。系统设置默认打开“底座设置”，后台入口读取服务返回的实际地址。不要手工启动 5190。

桌面启动：`npm run desktop`。Electron 主进程先初始化业务数据库与底座，再启动产品服务；退出时停止业务任务、取消并排空底座运行、关闭服务与数据库。

| 内容 | 桌面默认目录 |
|---|---|
| 原有业务数据 | Electron `app.getPath('userData')`，沿用原路径 |
| 底座数据 | `userData/agent-runtime` |
| 工作目录 | 操作系统文档目录下的 `Luban` |

开发默认使用 `data/agent-runtime` 和 `data/workspace`。部署可设置 `LUBAN_DATA_DIR`、`LUBAN_PLATFORM_INSTANCE_DIR`、`LUBAN_WORKSPACE_DIR`。兼容显式 `AGENT_PLATFORM_INSTANCE_DIR`，但拒绝默认混用其他产品的实例。

只在新实例没有连接时，迁移鲁班自身旧 AI 设置中的模型连接和密钥；不读取或复制 AI工作台的实例。此前只在共享底座配置过模型的用户，应在鲁班独立底座重新配置。原有业务数据、会话和旧设置不删除。

默认创建 `luban-app-builder` 并绑定产品工具。种子提示词只在创建时写入，后续用户修改不会被覆盖。产品必要提示与每次业务上下文以运行级上下文注入。产品默认使用 Agent 草稿配置，显式 `agentVersion` 可选择底座已发布版本。

默认不安装文件、Shell 或微信原生工具。MCP 管理能力来自底座；执行 MCP 工具还需要产品宿主明确将对应工具纳入白名单并绑定到 Agent，可通过 `createLubanPlatformService({ allowedTools: [...] })` 扩展。默认仅开放鲁班业务工具、时间和受限记忆能力。

桌面产品 API 与后台控制台都要求由 Electron 注入的本地令牌。开发模式的后台在回环地址运行，并遵循鲁班账号登录状态；远程 Web 部署不通过这个本机控制台入口管理。

## 独立打包

```sh
npm run desktop:pack  # macOS arm64 应用目录
npm run desktop:dmg  # macOS arm64 DMG
npm run desktop:win  # Windows x64 安装包，需在 Windows 环境验证
```

构建先执行 `ui:build:admin` 生成后台专用 Vue 控制台，再将 `admin-dist` 作为包内控制台。前台首页、会话、微信、知识采集和客户管理组件及相关逻辑不进入产物；后台只保留模型、Agent、技能、知识库、工具、MCP、任务和运行记录，没有“返回应用”入口。鲁班自己的业务前台继续保留。然后只复制底座源码、构建后的控制台与依赖锁文件，生成私有 Runtime tarball。发布暂存目录为 `.desktop-runtime`。底座依赖通过 shrinkwrap 锁定，应用携带所需依赖；本地源码软链接不会进入发布包。

`runtime-manifest.json` 记录底座版本与 tarball SHA-256。实例、密钥、开发数据和微信原生辅助不进入包。当前 SDK 尚未独立发布到包仓库，发行来源是已验证的本地底座快照。

测试应用：`release/runtime/mac-arm64/鲁班高级版.app`。沿用鲁班原有未配置正式签名的构建设置；此次不申请、更换证书或提交公证。

## 验证

- 鲁班：245 项测试全部通过，包含原业务规则、事务、关系、页面功能及新增 Runtime 测试。
- 底座：466 项测试全部通过。
- 新增覆盖：并发应用隔离、产品会话映射、用户提示词保留、模型参数与运行限制、Skills 与知识来源、工具拒绝与停用、取消和超时、关闭时排空、控制台认证、无工具生成。
- macOS 打包验证：使用包内 Electron 与 app.asar，在临时独立数据目录启动产品和底座；后台 Vue 与产品设置 API 可访问；未授权请求被拒绝；随机端口与正常退出确认通过。
- 打包验证使用模拟模型，没有进行真实模型业务验收。Windows 构建入口已提供，但未在 Windows 上构建或运行。
