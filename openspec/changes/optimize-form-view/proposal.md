## Why

表单视图（Form View）设计器的预览与实际表单存在多处视觉和交互差异，导致用户无法"所见即所得"地配置表单布局。同时，左侧"已使用字段"列表与右侧预览区展示同一批字段，信息冗余且占用空间。拖拽排序时缺乏视觉反馈，体验生硬。

## What Changes

1. **移除"已使用字段"列表**：左侧面板只保留"未使用字段"和列数选择器，字段排序和移除全部在预览区完成
2. **多行文本按实际大小预览**：textarea/richText 在预览中展示 3 行内容，高度对齐实际表单的 92px
3. **拖动排序展示占位指示**：拖拽时源字段半透明、目标位置显示蓝色插入线
4. **预览与实际表单一致**：预览区复用 `inputForField` 生成真实输入元素并 disabled，而非 div+文本占位

## Capabilities

### New Capabilities
- `form-layout-designer`: 表单布局设计器的 UI/UX 优化，包括预览一致性、拖拽体验改进、界面简化

### Modified Capabilities

<!-- No existing capabilities are changing -- this is purely a UI optimization of the form layout editor. -->

## Impact

- **public/app.js**: `openFormLayoutModal` 重写，`sampleFieldValue` 修改，`bindFormFieldDrag` 增强
- **public/styles.css**: 新增拖拽占位相关样式，调整预览区样式
- 仅前端改动，无后端/API/数据库影响
