## Context

表单视图（Form View）设计器是软件工厂中的一个模态弹窗，允许用户配置新增/编辑记录表单的字段排列和列数。当前存在四个问题：

1. 左侧"已使用字段"列表与右侧预览区展示同一批字段，信息重复
2. textarea 预览仅显示短文本"多行文本"，高度仅 33px，而实际表单 textarea 为 92px
3. 拖拽排序时无任何视觉反馈，用户不知道字段将插入何处
4. 预览使用 div+静态文本，与实际表单的 input/textarea/select 等真实控件差异大

所有改动集中在 `public/app.js` 的 `openFormLayoutModal` 函数和 `public/styles.css`。

## Goals / Non-Goals

**Goals:**
- 消除左侧"已使用字段"与预览区的信息冗余
- 预览区 textarea 展示真实高度的多行示例文本
- 拖拽时源字段半透明 + 目标位置蓝色插入线
- 预览区渲染 disabled 的真实表单控件（复用 `inputForField`）
- 预览区输入元素不阻挡拖拽事件
- 表单弹窗与表格内编辑使用同一套选择器组件（select/multiSelect/relation），达到视觉和行为一致

**Non-Goals:**
- 不改动后端、API、数据库
- 不改动字段编辑器（`openFieldEditModal`）
- 不新增字段类型

## Decisions

### Decision 1: Preview renders `inputForField` + disabled instead of div+text

**Chosen**: 复用 `inputForField(field, sampleFieldValue(field))` 生成真实 input/textarea/select，设 `disabled=true`。

**Alternatives considered**:
- **div + 文本的增强版**：为 textarea 加大高度、select 加 ▼ 三角 — 维护成本高，需要手动同步两套渲染逻辑
- **iframe 内嵌实际表单**：太重，模态嵌套复杂

**Rationale**：
- 自动继承 `inputForField` 的未来改动，维护成本趋近于零
- textarea 自动获得 `min-height: 92px`（来自全局 CSS）
- select/checkbox 等控件视觉完全一致
- `disabled` 可以保证预览不可交互但不影响样式

**Edge case handling**:
- **file/image**: `<input type="file" disabled>` 在浏览器中灰显，可接受；也可 fallback 到 div 显示文件名
- **relation**: `inputForField` 内部调用 `recordsFor()`，预览时记录正常加载则 OK，否则显示空 select 亦不影响功能

### Decision 2: Drag placeholder uses page-nav pattern

**Chosen**: 复用页面导航的拖拽模式 — `is-dragging`/`drop-before`/`drop-after` CSS 类 + `::before`/`::after` 伪元素。

**Rationale**:
- 已有实现可验证，代码模式一致
- `::before`/`::after` 不占用 DOM 元素，不影响布局
- `position: relative` + 绝对定位的 2px 蓝线视觉清晰

### Decision 3: Remove used-field list entirely

**Chosen**: 左栏只保留「列数选择」和「未使用字段」，移除「已使用字段」和上移/下移按钮。

**Rationale**:
- 预览区已支持拖拽排序和移除，功能完全覆盖列表
- 消除信息冗余，设计器更简洁
- 蓝线指示器 + 源字段半透明 = 比按钮更直观的排序体验

### Decision 4: Extract shared choice widget for select/multiSelect/relation

**Chosen**: 创建 `createChoiceWidget(field, value, onChange)` 函数，替代 `inputForField` 中 select/multiSelect/relation 分支的 `<select>` 渲染，同时替代表格编辑中的 `openCellChoiceDropdown`。

```
createChoiceWidget(field, value, onChange)
  │
  ├→ 返回 DOM 元素（widget 容器）
  ├→ 展示已选项为彩色 pill 标签
  ├→ 点击展开下拉选项面板
  ├→ 支持单选/多选
  └→ 变化时调用 onChange(newValue)
      │
      ├─ inputForField 中调用 → 替代 <select>
      └─ startCellEdit  中调用 → 替代 openCellChoiceDropdown
```

**接口设计**:

```javascript
function createChoiceWidget(field, value, onChange) {
  // 1. 创建显示区：选中项的 pill 标签 + 展开按钮
  // 2. 创建下拉区：选项列表 + 颜色标签 + 单选/多选逻辑
  // 3. 返回顶层容器元素
}
```

**如何整合到现有代码**:

```
改动前:
  inputForField(field, value)
    ├→ select/multiSelect/relation → return <select>
    └→ 其他 → return <input>/<textarea>/etc

  startCellEdit(cell, record, field)
    └→ select/multiSelect/relation → openCellChoiceDropdown()
    └→ 其他 → inputForField()

改动后:
  inputForField(field, value)
    ├→ select/multiSelect/relation → return createChoiceWidget()  ← 替代 <select>
    └→ 其他 → return <input>/<textarea>/etc  (不变)

  startCellEdit(cell, record, field)
    ├→ select/multiSelect/relation → return createChoiceWidget()  ← 替代 openCellChoiceDropdown
    └→ 其他 → inputForField()  (不变)
```

**`openCellChoiceDropdown` 的生命周期管理**:
- `openCellChoiceDropdown` 不再需要——它原来的职责（定位、打开/关闭、保存）全部由 `createChoiceWidget` 内的自管理 dropdown + `onChange` 回调覆盖
- 表格编辑中的 `closeCellChoiceDropdown`、`positionCellChoiceDropdown`、`renderCellChoiceEditor`、`saveCellChoiceDropdown` 等辅助函数可以一并清理

**Alternatives considered**:
- **方向A：只改 inputForField，不动表格** — 表格仍用旧的 `openCellChoiceDropdown`，代码路径仍然是两套，日后修改需要同步两处
- **方向B：统一用原生 `<select>`** — 改动最小，但丢失颜色标签、多选标签等现有功能

**Rationale**:
- 提取后一处改两处同步，维护成本最低
- `createChoiceWidget` 作为纯函数，不依赖 DOM 上下文（cell/modal），可测试
- 颜色标签、多选管理等功能在表单弹窗中同样有价值

## Risks / Trade-offs

- **[Risk] 预览 input 阻挡拖拽事件**: disabled 元素不触发鼠标事件，但为保险在预览区输入元素上加 `pointer-events: none`
- **[Risk] relation 字段预览无数据**: `recordsFor()` 依赖 `state.records`，预览时若未加载显示空 select，可接受
- **[Trade-off] 移除上移/下移按钮**: 依赖拖拽操作，对不熟悉拖拽的用户可能略有不适应，但蓝线指示器可以降低学习成本
