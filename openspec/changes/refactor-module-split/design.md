## Context

### 当前状态

```
public/app.js (4419行)          src/server.js (474行)
│ 状态+boot+工具 (300行)         │  GET/POST/PUT/DELETE /api/apps/* (全部路由)
│ 首页(app-home) (100行)        │  静态文件服务
│ 运行时(app-runtime) (4000行)   │
│   ├─ 布局/侧栏                 src/db.js (597行)
│   ├─ 页面导航                   │  app CRUD + record CRUD + session CRUD + settings
│   ├─ 数据表格 (1500行)          │  全部在一个文件
│   ├─ 字段编辑器
│   ├─ 记录弹窗                   src/aiSession.js (139行)
│   ├─ 页面类型                    │  会话 CRUD（本应合并到 db.js）
│   └─ 设置
├─ ai-assistant/ (已拆)
```

### 约束

- 零外部依赖（纯 JS + Node 内置模块）
- `node:sqlite` 数据库，WAL 模式
- 前端 ES module，无打包器
- AI 助理模块已拆出（`public/ai-assistant/` 6 文件模式），是本重构的范式参考

## Goals / Non-Goals

**Goals:**
- `public/app.js` 从 4419 行减至 ~250 行
- `src/server.js` 从 474 行减至 ~100 行
- `src/db.js` 拆出 `models/` 层（app, record, session）
- 前端和后端都按"应用管理"和"应用详情"两个领域拆分
- 所有拆出模块有清晰的 index.js 导出接口
- 每个模块文件不超过 500 行
- 全程 `npm test` 保持通过

**Non-Goals:**
- 不改 UI 布局和交互行为
- 不改 API 签名和响应格式
- 不改数据库 schema
- 不引入新的外部依赖
- 不新增功能

## Decisions

### Decision 1: 模块粒度

前端遵循 AI 助理的已有模式：扁平目录 + `index.js` 导出 + 每个文件一个职责。

| 粒度规则 | 说明 |
|---------|------|
| 每个模块目录有 `index.js` 作为入口 | 类似 `ai-assistant/index.js` |
| 纯工具函数不拆分太细 | `common/` 下 5 个文件（dom/api/modal/toast/storage） |
| 数据表格内部不再嵌套子目录 | `DataTable.js` 作为表格主入口，辅助函数在同一级 |

后端遵循 Express 风格路由 + 数据模型分离：

| 层 | 职责 | 文件 |
|----|------|------|
| `routes/` | HTTP 请求处理、参数校验、响应 | 每领域一个文件 |
| `models/` | SQLite 查询封装 | 每实体一个文件 |
| `server.js` | 路由挂载 + 静态文件 | 精简到只做 mux 分发 |

### Decision 2: 前端的依赖方向

```
app.js (状态+启动)
  ├── common/          ← 纯函数，零状态依赖
  ├── app-home/        ← 只依赖 common/ + ai-assistant/
  └── app-runtime/     ← 依赖 common/ + ai-assistant/ + app-home/（仅 goHome）
```

- `common/` 不能引用任何其他模块
- `app-home/` 不能引用 `app-runtime/`
- `app-runtime/` 可以引用 `app-home/`（`goHome()` 是导航）
- `app-runtime/` 内部模块之间通过 `state` 对象共享数据（不做消息总线）

### Decision 3: 后端的依赖方向

```
server.js (路由分发)
  ├── routes/app.js        → models/app.js
  ├── routes/runtime.js    → models/app.js, models/record.js, operations.js
  ├── routes/settings.js   → db.js (getSetting/setSetting)
  └── routes/ai.js (已有)  → models/session.js, ai.js
```

- `routes/` 不能直接操作 SQLite，必须通过 `models/` 或 `operations.js`
- `models/` 不能引用 `routes/` 或 `operations.js`
- `operations.js` 可以引用 `models/app.js` 和 `models/record.js`

### Decision 4: 状态共享

前端 `state` 对象保留在 `app.js` 中，不迁移。各模块通过 `import` 获取 `state` 引用（JS 模块是引用传值，所有模块共享同一对象）。

```javascript
// app.js
export const state = { apps: [], currentApp: null, ... };

// app-runtime/DataTable.js
import { state } from '../app.js';
```

这是最简洁的方式，与 AI 助理模块共享 `state` 的模式一致。

### Decision 5: 测试策略

`ui-features.test.js` 目前直接读 `public/app.js` 做字符串匹配。拆完后修改为：

```javascript
const appJs = readFileSync('public/app.js', 'utf8');
const homeIndex = readFileSync('public/app-home/index.js', 'utf8');
const runtimeIndex = readFileSync('public/app-runtime/index.js', 'utf8');
// 按函数归属拆分断言
```

每拆完一步就运行 `npm test` 确保通过，不积压到最后。

### Decision 6: 搬移顺序

先前端工具层 → 后端 models → 后端 routes → 前端 app-home → 前端 app-runtime。

这是最低风险的顺序：工具层无业务逻辑，后端 model 从 db.js 搬出不改接口，前端 app-home 独立不依赖 runtime。

## Risks / Trade-offs

- **[Risk] 前端 ES module 加载延迟**: 拆成 20+ 文件意味着浏览器要发 20+ 个 HTTP 请求 → 现有架构已是 `script type="module"`，每个 import 就是一次请求，重构不改变这一事实。App 启动后所有文件会被浏览器缓存，影响可接受。
- **[Risk] `state` 对象耦合**: 所有模块都 import 同一个 `state`，一改全局影响 → 这是现有架构的既有约束，不是新引入的。保持现状。
- **[Risk] 全局事件需要跨模块引用**: `copy`/`paste`/`pointermove` 等全局监听器在 `app.js` 中，需要 import `CellSelection.js` 的函数 → 这是合理的：事件绑定在 app.js，处理逻辑在模块中。
- **[Trade-off] 后端不引入 DI/注入**: 直接 import 静态函数，不引入 IoC 容器 → 代码库规模适合静态导入。
- **[Trade-off] UI 功能测试改为多文件匹配**: 重构后测试的字符串匹配逻辑更复杂，但更精确反映了代码分布。
