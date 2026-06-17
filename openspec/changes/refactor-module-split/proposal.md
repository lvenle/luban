## Why

`public/app.js`（4419 行）和 `src/server.js`（474 行）是巨型单文件，应用管理（首页）和应用详情（运行时）的代码深度交织，开发体验差、合并冲突频繁、难以测试。AI 助理模块已成功拆出（6 文件模式），证明了模块化范式可行。

## What Changes

1. **前端：`common/` 工具层** — 将 `h()`, `api()`, `toast()`, `modal`, `storage` 抽出为独立模块
2. **前端：`app-home/`** — 首页应用管理（grid、分类、导入）拆为独立模块
3. **前端：`app-runtime/`** — 运行时（布局、数据表、字段编辑器、页面类型、设置）拆为 ~13 个模块
4. **后端：`models/`** — 从 `db.js` 拆分数据访问层（app、record、session 三个模型）
5. **后端：`routes/`** — 从 `server.js` 拆分路由（`app.js`、`runtime.js`、`settings.js`）
6. **后端：`server.js` 精简** — 仅保留路由分发和静态文件服务
7. **更新测试** — `ui-features.test.js` 改为多文件匹配，覆盖所有新模块
8. **无功能变更** — 纯重构，不改 UI、不改 API 签名、不改数据库 schema

## Capabilities

### New Capabilities
- `common-utils`: 前端共享工具函数（dom/api/modal/toast/storage）
- `app-home`: 应用管理首页（app 列表、分类筛选、导入）
- `app-runtime`: 应用详情运行时（布局、数据表、字段、记录、页面类型、设置）
- `model-app`: 后端应用数据访问层
- `model-record`: 后端记录数据访问层
- `model-session`: 后端 AI 会话数据访问层
- `route-app`: 后端应用管理路由
- `route-runtime`: 后端运行时 API 路由
- `route-settings`: 后端设置 API 路由

### Modified Capabilities
- *(无 — 首次建立 specs)*

## Impact

- `public/app.js`: 从 4419 行减至 ~250 行（仅保留 state、boot、路由、全局事件）
- `common/`: 新增 5 个文件
- `app-home/`: 新增 3 个文件
- `app-runtime/`: 新增 13 个文件
- `src/server.js`: 从 474 行减至 ~100 行（仅分发）
- `src/models/`: 新增 3 个文件（从 `db.js` + `aiSession.js` 搬出）
- `src/routes/`: 新增 3 个文件（从 `server.js` 搬出）
- `tests/ui-features.test.js`: 更新 ~80 处文件路径断言
- 零外部依赖变更，零数据库 schema 变更
