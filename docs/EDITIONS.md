# 鲁班版本区分

- 鲁班高级版：本工程，复用 agent-platform SDK，独立底座后台控制台。
- 鲁班标准版：`/Users/lvenle/Documents/ai_workspace/codex/luban`，保留原独立运行架构。

应用标识分别为 `ai.luban.desktop.advanced`、`ai.luban.desktop.basic`，两版可同时安装运行。

高级版桌面数据目录为用户 Application Support 下的 `luban-advanced`；首次启动时从原 `luban-ai-mvp` 复制已有数据，原目录保留。标准版继续使用原 `luban-ai-mvp` 目录。首次复制后两版数据独立，不自动同步。

macOS 应用分别为 `release/runtime/mac-arm64/鲁班高级版.app` 和标准版工程的 `release/mac-arm64/鲁班标准版.app`。签名策略沿用原设置。

## 当前架构的两种运行形态

本轮以同一业务核心提供 local 单机客户端和 enterprise Web；客户端固定使用轻量本地宿主，企业 Web 可独立运行或由组合宿主挂载到 `/luban/`。此前“高级版/标准版”是既有发行命名，不代表本轮新增两套业务实现。企业组合说明见兄弟底座仓库 `docs/enterprise-luban.md`。
