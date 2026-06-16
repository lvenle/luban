## ADDED Requirements

### Requirement: Remove used field list from left panel

The form layout designer SHALL remove the "已使用字段" (Used Fields) section from the left panel. Field sorting and removal SHALL be performed directly in the preview area.

#### Scenario: Left panel shows only column count and unused fields
- **WHEN** the form layout designer modal opens
- **THEN** the left panel SHALL display only the column count selector and the "未使用字段" (Unused Fields) list

#### Scenario: Fields are added via unused list
- **WHEN** user clicks [加入] (Add) on an unused field
- **THEN** the field SHALL appear in the preview and SHALL be removed from the unused list

#### Scenario: Fields are removed via preview
- **WHEN** user clicks [移除] (Remove) on a field in the preview
- **THEN** the field SHALL be removed from the preview and SHALL reappear in the unused list

### Requirement: Show textarea at actual size in preview

The form preview SHALL render `textarea` and `richText` fields with sufficient height to indicate multi-line text. The preview SHALL display at least 3 lines of sample text.

#### Scenario: Textarea preview shows multi-line content
- **WHEN** a textarea/richText field is included in the form preview
- **THEN** the preview SHALL display 3+ lines of sample text with a min-height matching the actual form textarea (92px)

#### Scenario: Textarea preview uses realistic height
- **WHEN** the form preview renders a textarea field
- **THEN** the preview container SHALL be tall enough to suggest multi-line input, matching the actual form's textarea height

### Requirement: Show drag placeholder during field reordering

The form preview SHALL provide visual feedback during drag-and-drop reordering: the dragged field SHALL become semi-transparent, and a colored insertion indicator SHALL appear at the target position.

#### Scenario: Dragged field becomes semi-transparent
- **WHEN** user starts dragging a field in the preview
- **THEN** the dragged field SHALL become semi-transparent (`opacity: 0.46`)

#### Scenario: Insertion line appears at target position
- **WHEN** user drags a field over another field in the preview
- **THEN** a brand-colored horizontal line SHALL appear above or below the target field indicating the insertion position

#### Scenario: Feedback clears after drop
- **WHEN** the drag operation ends (drop, cancel, or leave)
- **THEN** all drag-related visual classes SHALL be removed

### Requirement: Reuse inputForField for preview consistency

The form preview SHALL render each field using the same `inputForField` function used by the actual data entry form, with the generated input elements set to `disabled` for non-interactive display. This ensures preview matches the actual form.

#### Scenario: Text fields show as disabled inputs
- **WHEN** the preview renders a text/number/date/datetime/email/phone/url field
- **THEN** the preview SHALL display a disabled `<input>` element matching the actual form

#### Scenario: Select fields show as disabled selects
- **WHEN** the preview renders a select/multiSelect/relation field
- **THEN** the preview SHALL display a disabled `<select>` element with option labels

#### Scenario: Boolean fields show as disabled checkboxes
- **WHEN** the preview renders a boolean field
- **THEN** the preview SHALL display a disabled checkbox

#### Scenario: File/image fields fall back to placeholder
- **WHEN** the preview renders a file or image field
- **THEN** the preview SHALL display a disabled file input or a styled placeholder

#### Scenario: Preview inputs do not block drag events
- **WHEN** user interacts with the preview
- **THEN** disabled input elements inside preview fields SHALL have `pointer-events: none` to ensure drag events reach the parent field container

### Requirement: Unified choice widget for select/multiSelect/relation

表单弹窗和表格内编辑 SHALL 使用同一套 `createChoiceWidget` 组件渲染 select/multiSelect/relation 字段。该组件 SHALL 展示彩色 pill 标签表示已选项，点击展开下拉面板，支持单选/多选。

#### Scenario: Form modal renders choice widget instead of native select
- **WHEN** `openRecordModal` renders a select/multiSelect/relation field
- **THEN** the field SHALL display a `createChoiceWidget` with colored pill tags instead of a native `<select>`

#### Scenario: Table inline editing renders choice widget
- **WHEN** `startCellEdit` activates a select/multiSelect/relation cell
- **THEN** the cell SHALL display a `createChoiceWidget` with the same visual appearance as in the form modal

#### Scenario: Choice widget supports single selection
- **WHEN** user selects an option from a single-select widget (select or non-multiple relation)
- **THEN** the widget SHALL close the dropdown and call onChange with the selected value

#### Scenario: Choice widget supports multi selection
- **WHEN** user selects options from a multi-select widget (multiSelect or multiple relation)
- **THEN** the widget SHALL keep the dropdown open, toggle the selected state, and call onChange with the array of selected values

#### Scenario: Choice widget shows option colors
- **WHEN** a field has colored options defined
- **THEN** the widget SHALL display the option color as a background/border on pill tags

#### Scenario: Choice widget returns a DOM element
- **WHEN** `createChoiceWidget(field, value, onChange)` is called
- **THEN** it SHALL return a single DOM element that can be placed into any container (form grid or table cell)
