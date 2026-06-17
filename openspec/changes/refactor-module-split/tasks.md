## 1. 前端工具层 — common/

- [ ] 1.1 创建 `public/common/dom.js` — 搬入 `h()`, `svgIcon`, `svgPath`, `svgLine`, `uiIcon`, `buttonLabel`
- [ ] 1.2 创建 `public/common/api.js` — 搬入 `api()` 函数
- [ ] 1.3 创建 `public/common/modal.js` — 搬入 `openConfirmDialog`, `openConfigModal`, `closeTopModal`, `openTextModal`
- [ ] 1.4 创建 `public/common/toast.js` — 搬入 `toast()`
- [ ] 1.5 创建 `public/common/storage.js` — 搬入 `readStorage`, `writeStorage`, `storageKey`, `globalStorageKey`, `clampSidebarWidth`, `clamp`
- [ ] 1.6 在 `app.js` 中改为从 `common/` 导入，验证 `npm test` 通过

## 2. 后端数据访问层 — models/

- [ ] 2.1 创建 `src/models/app.js` — 从 `src/db.js` 搬入 listApps, getApp, createAppFromPackage, updateAppPackage, updateAppMetadata, deleteApp, exportAppPayload, importAppPayload
- [ ] 2.2 创建 `src/models/record.js` — 从 `src/db.js` 搬入 listRecords, createRecord, updateRecord, deleteRecord, countRecordReferences, listRelationOptions, getRecordRelations, updateRecordRelations
- [ ] 2.3 创建 `src/models/session.js` — 从 `src/aiSession.js` 搬入所有函数，同时从 `src/db.js` 搬入 getSetting, setSetting
- [ ] 2.4 精简 `src/db.js` — 仅保留 `getDb()` + `resetDbForTests()` + `migrate()` + 内部辅助函数
- [ ] 2.5 删除 `src/aiSession.js`（合并入 `models/session.js`）
- [ ] 2.6 更新所有 import 路径，验证 `npm test` 通过

## 3. 后端路由层 — routes/

- [ ] 3.1 创建 `src/routes/app.js` — 从 `src/server.js` 搬出应用管理路由（list, generate, import, delete）
- [ ] 3.2 创建 `src/routes/runtime.js` — 从 `src/server.js` 搬出运行时路由（detail, records, tables, fields, actions, modify, export, uploads, relations）
- [ ] 3.3 创建 `src/routes/settings.js` — 从 `src/server.js` 搬出设置路由（GET/PUT /api/settings）
- [ ] 3.4 精简 `src/server.js` — 只保留分发逻辑 + 静态文件服务
- [ ] 3.5 更新所有 import 路径，验证 `npm test` 通过

## 4. 前端应用管理 — app-home/

- [ ] 4.1 创建 `public/app-home/AppCard.js` — 搬入 `appCard()`, `appCategories()`, `appCategory()`
- [ ] 4.2 创建 `public/app-home/ImportModal.js` — 搬入 `openImportModal()`
- [ ] 4.3 创建 `public/app-home/index.js` — 导出 `renderHome()`, `goHome()`, `loadApps()`, 搬入 `createAppFromPrompt()`
- [ ] 4.4 从 `app.js` 移除首页相关函数，改为从 `app-home/index.js` 导入
- [ ] 4.5 验证 `npm test` 通过

## 5. 前端运行时 — app-runtime/（第一批：独立模块）

- [ ] 5.1 创建 `public/app-runtime/SettingsModal.js` — 搬入 `openSettingsModal()`
- [ ] 5.2 创建 `public/app-runtime/PageTypes.js` — 搬入 `renderDashboardPage()`, `renderChartPage()`, `renderEditorPage()`, `renderBlankPage()`, `renderPageCard()`, page card 相关函数
- [ ] 5.3 创建 `public/app-runtime/RecordModal.js` — 搬入 `openRecordModal()`, `renderFormFieldBlock()`, `removeRecord()`, `quickAddRecord()`, `bulkDeleteRecords()`, `defaultValueForField()`, `runAppAction()`
- [ ] 5.4 创建 `public/app-runtime/FieldEditor.js` — 搬入 `openFieldEditModal()`, `fieldPatchFromEditor()`, `renderOptionEditor()`, `optionEditorRow()`, `collectOptionEditorValues()`, `updateField()`, `createField()`, `duplicateField()`, `insertField()`, `deleteField()`
- [ ] 5.5 验证 `npm test` 通过

## 6. 前端运行时 — app-runtime/（第二批：布局层）

- [ ] 6.1 创建 `public/app-runtime/RuntimeFrame.js` — 搬入 sidebat 相关函数：`renderRuntime()` 中的布局部分, `renderSidebarContent()`, `toggleSidebarCollapsed()`, `startSidebarResize()`, `loadSidebarLayout()`, `saveSidebarLayout()`
- [ ] 6.2 创建 `public/app-runtime/Sidebar.js` — 搬入页面导航：`renderPageNavItem()`, `pageNavKind()`, `pageTypeIcon()`, `pageTypeLabel()`, `renderTopbarAppInfo()`, `inlineEditableText()`, `clearPageDragStyles()`, `buildBlankPage()`, `buildPageForEntity()`, `openCreatePageModal()`, `openCreateTableModal()`, `deletePage()`, `deleteTableAndData()`, `clearTableData()`, `reorderPage()`, `showDeleteTableBlocked()`, `openTextModal()`
- [ ] 6.3 创建 `public/app-runtime/index.js` — 导出 `openApp()`, `renderRuntime()`, `saveAppMetadata()`, `loadRecords()`, `loadCurrentPageRecords()`, `mergeEntityRecords()`, `packageFromCurrentApp()`, `saveCurrentPackage()`, `buildAssistantContext()`
- [ ] 6.4 从 `app.js` 移除布局/页面相关函数，改为从 `app-runtime/index.js` 导入
- [ ] 6.5 验证 `npm test` 通过

## 7. 前端运行时 — app-runtime/（第三批：数据表格核心）

- [ ] 7.1 创建 `public/app-runtime/ViewBar.js` — 搬入视图系统：`getViews()`, `setViews()`, `getCurrentView()`, `updateCurrentView()`, `normalizeView()`, `makeViewId()`, `renderViewBar()`, `renderViewMenu()`, `openViewMenu()`, `closeViewMenu()`, `startViewNameEdit()`, `createView()`, `cloneView()`, `renameView()`, `deleteView()`, `openFilterModal()`, `openSortModal()`, `openGroupModal()`, `clearCurrentViewConfig()`
- [ ] 7.2 创建 `public/app-runtime/TableHeader.js` — 搬入表头：`renderResizableHeader()`, `startColumnResize()`, `startHeaderLabelEdit()`, `openHeaderContextMenu()`, `renderTableColgroup()`, `columnWidthStyle()`, `actionColumnWidth()`, `actionColumnStyle()`, `setFieldSort()`, `hideFieldInView()`, `ensureFilterForField()`
- [ ] 7.3 创建 `public/app-runtime/TableRow.js` — 搬入行：`renderRecordRow()`, `renderSummaryRow()`, `renderNumericSummary()`, `summaryCellClass()`, `renderQuickAddRow()`, `openListConfigModal()`, `openFormLayoutModal()`
- [ ] 7.4 创建 `public/app-runtime/CellEditor.js` — 搬入单元格编辑：`startCellEdit()`, `inputForField()`, `searchInputForField()`, `valueFromInput()`, `uploadValueFromInput()`, `renderFieldValue()`, `createChoiceWidget()`, `fieldValuesEqual()`, `renderFormFieldBlock()` 的表单字段渲染
- [ ] 7.5 创建 `public/app-runtime/CellSelection.js` — 搬入范围选择和剪贴板：`startCellRangeSelection()`, `extendCellRangeSelection()`, `moveCellRangeSelection()`, `finishCellRangeSelection()`, `cellPosition()`, `updateCellRangeSelection()`, `clearCellSelectionClasses()`, `selectedCellMatrix()`, `selectedCellElements()`, `selectedCellPayload()`, `copySelectedCellsToClipboard()`, `pasteCellsFromClipboard()`, `pasteCellMatrix()`, `targetSelectionBounds()`, `fieldForCell()`, `recordForCell()`, `valueForPastedCell()`, `fieldTypesCompatible()`, `normalizePastedValue()`, `pastedSelectValue()`, `pastedMultiSelectValue()`, `pastedDateValue()`, `pastedDateTimeValue()`, `pastedRelationValue()`, `fallbackCopyText()`, `hideCellCopyToolbar()`, `showCellCopyToolbar()`, `copySelectedCellsAsImage()`, `selectedCellImageRows()`, `cellImageContent()`, `selectedCellsImageBlob()`, `drawCellImageContent()`, `drawRoundedRect()`, `isMultiCellMatrix()`, `clearActiveTableSelection()`, `clickedOutsideTableSelection()`, `selectColumnHeader()`
- [ ] 7.6 创建 `public/app-runtime/DataTable.js` — 搬入 `renderListPage()`, 以及 `renderExportMenu()`, `stretchTableToWrap()`, `tableWidthStyle()`, `exportXlsxHref()`, `exportFileName()`, `importTableData()`, `quickAddRecord()` 的表格集成部分

## 8. 前端运行时 — 汇编

- [ ] 8.1 在 `public/app-runtime/index.js` 中整合所有子模块导入和导出
- [ ] 8.2 从 `app.js` 移除所有运行时函数，改为从 `app-runtime/index.js` 导入
- [ ] 8.3 更新 `public/styles.css` — 移除 AI 助理相关样式（已在 ai-assistant/style.css），验证不丢失样式

## 9. 更新测试

- [ ] 9.1 更新 `tests/ui-features.test.js` — 从单文件匹配改为多文件匹配
- [ ] 9.2 为 `app-runtime/index.js`, `app-home/index.js` 等添加存在性断言
- [ ] 9.3 验证全部测试通过: `npm test`

## 10. 清理

- [ ] 10.1 检查 `app.js` 行数（目标 ~250 行）
- [ ] 10.2 检查 `server.js` 行数（目标 ~100 行）
- [ ] 10.3 运行全量测试: `npm test`
- [ ] 10.4 手动冒烟测试：创建 app、打开 app、增删记录、切换视图、导入导出
