## 1. CSS: Drag visual feedback styles

- [x] 1.1 Add `.preview-field.is-dragging` (opacity 0.46)
- [x] 1.2 Add `.preview-field.drop-before::before` / `.drop-after::after` (blue insertion line)
- [x] 1.3 Add `position: relative` to `.preview-field`
- [x] 1.4 Add `pointer-events: none` rule for disabled inputs inside preview fields

## 2. Sample field values for realistic preview

- [x] 2.1 Update `sampleFieldValue` to return 3-line multi-line text for textarea/richText
- [x] 2.2 Already satisfied — `sampleFieldValue` already returns first option label for select

## 3. Remove used-field list from layout editor

- [x] 3.1 Remove `list` variable and `list.innerHTML = ''` from `renderRows`
- [x] 3.2 Remove the used-field row rendering loop (lines 3570-3580)
- [x] 3.3 Remove `h('h4', { text: '已使用字段' })` and `list` from DOM tree
- [x] 3.4 Remove `moveField` function (no longer needed without up/down buttons)
- [x] 3.5 Update modal description text

## 4. Reuse inputForField for preview consistency

- [x] 4.1 Replace `.preview-input` div + `sampleFieldValue` with `inputForField` + `disabled=true`
- [x] 4.2 Handle file/image field edge case in preview (fallback placeholder)
- [x] 4.3 Ensure `pointer-events: none` is applied to preview input elements

## 5. Drag placeholder visual feedback

- [x] 5.1 Add `is-dragging` class on `dragstart` in `bindFormFieldDrag`
- [x] 5.2 Add midpoint calculation and `drop-before`/`drop-after` classes on `dragover`
- [x] 5.3 Add cleanup on `dragleave`, `drop`, and `dragend`

## 6. Unify choice widget for select/multiSelect/relation

- [x] 6.1 Extract `createChoiceWidget(field, value, onChange)` function
- [x] 6.2 Implement visual display: colored pill tags for selected options
- [x] 6.3 Implement dropdown panel with option list and color labels
- [x] 6.4 Implement single-select mode (close on pick, onChange with single value)
- [x] 6.5 Implement multi-select mode (stay open, toggle, onChange with array)
- [x] 6.6 Integrate into `inputForField`: replace `<select>` with `createChoiceWidget`
- [x] 6.7 Integrate into `startCellEdit`: replace `openCellChoiceDropdown` with `createChoiceWidget`
- [x] 6.8 Clean up: remove `openCellChoiceDropdown`, `closeCellChoiceDropdown`, `positionCellChoiceDropdown`, `renderCellChoiceEditor`, `saveCellChoiceDropdown`, and related helpers
- [x] 6.9 Fix `bindFormFieldDrag` dragover to use local variable instead of `getData()`
