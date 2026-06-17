## ADDED Requirements

### Requirement: Runtime entry
The system SHALL provide `openApp(appId, options)` and `renderRuntime()` as the entry points to app details.

#### Scenario: Open app
- **WHEN** `openApp(appId)` is called
- **THEN** app data is fetched, records are loaded, and `renderRuntime()` is called

#### Scenario: Render runtime
- **WHEN** `renderRuntime()` is called
- **THEN** the three-column layout (sidebar + workspace + assistant drawer) is rendered

### Requirement: Runtime layout
The system SHALL provide the three-column runtime layout with resizable sidebar.

#### Scenario: Sidebar resize
- **WHEN** user drags the sidebar resizer
- **THEN** sidebar width changes and is saved to localStorage

#### Scenario: Sidebar collapse
- **WHEN** user double-clicks the resizer
- **THEN** sidebar collapses/expands and state is saved

### Requirement: Page navigation
The system SHALL provide page nav items in the sidebar with drag-reorder, delete, and CRUD.

#### Scenario: Page navigation
- **WHEN** user clicks a page nav item
- **THEN** `state.currentPageId` is updated, records are loaded, and runtime re-renders

#### Scenario: Drag reorder
- **WHEN** user drags a page nav item to a new position
- **THEN** the page order is saved and runtime re-renders

### Requirement: Data table
The system SHALL provide `renderListPage(page)` as the main data table view.

#### Scenario: Table renders
- **WHEN** `renderListPage(page)` is called
- **THEN** it renders a table with headers, data rows, action buttons, and view bar

#### Scenario: Search
- **WHEN** user types in the global search input
- **THEN** records are filtered by the search query

#### Scenario: Quick add row
- **WHEN** user clicks "快速新增行"
- **THEN** a new empty record is created and table re-renders

### Requirement: View system
The system SHALL provide view tabs, view CRUD, filter/sort/group modals.

#### Scenario: Switch view
- **WHEN** user clicks a view tab
- **THEN** view is activated and table re-renders with that view's config

#### Scenario: Filter modal
- **WHEN** user opens filter modal and saves
- **THEN** the current view's filters are updated and table re-renders

#### Scenario: Sort modal
- **WHEN** user opens sort modal and saves
- **THEN** the current view's sorts are updated and table re-renders

### Requirement: Column management
The system SHALL provide resizable headers, column header context menu, and column visibility config.

#### Scenario: Column resize
- **WHEN** user drags the resize edge of a column header
- **THEN** column width changes and is saved to view config

#### Scenario: Header context menu
- **WHEN** user right-clicks a column header
- **THEN** a context menu appears with edit/hide/sort/filter/insert/delete options

### Requirement: Cell editing
The system SHALL provide inline cell editing for all field types.

#### Scenario: Text cell edit
- **WHEN** user double-clicks a text cell and types
- **THEN** the value is saved via PUT /api/apps/:id/records/:rid

#### Scenario: Select cell edit
- **WHEN** user double-clicks a select cell
- **THEN** a choice dropdown appears for selecting an option

### Requirement: Cell selection and clipboard
The system SHALL provide multi-cell range selection, copy (text and image), and paste.

#### Scenario: Cell range selection
- **WHEN** user pointerdown on one cell and drags to another
- **THEN** the range of cells is visually selected with selection classes

#### Scenario: Copy cells
- **WHEN** user presses Ctrl+C with cells selected
- **THEN** cell values are copied to clipboard as tab-separated text

#### Scenario: Paste cells
- **WHEN** user presses Ctrl+V with cells selected
- **THEN** clipboard values are parsed and saved to target cells

### Requirement: Field editor
The system SHALL provide the field settings modal for creating/editing fields.

#### Scenario: Edit field type
- **WHEN** user changes field type to "select"
- **THEN** the option editor is shown in the advanced section

#### Scenario: Edit relation field
- **WHEN** user configures a relation field
- **THEN** target entity select and display field select are shown

### Requirement: Record modal
The system SHALL provide `openRecordModal(entity, record)` for create/edit records.

#### Scenario: Create record
- **WHEN** user fills form and clicks save
- **THEN** a POST /api/apps/:id/records is sent and runtime re-renders

### Requirement: Form layout editor
The system SHALL provide the form layout modal with drag-reorder and column count.

#### Scenario: Form layout edit
- **WHEN** user drags fields to reorder and saves
- **THEN** form layout is saved to localStorage and used in record modal

### Requirement: Page types
The system SHALL provide renderers for dashboard, blank page (with cards), chart page, and editor page.

#### Scenario: Dashboard renders
- **WHEN** page.type is "dashboard"
- **THEN** stat cards are rendered with record counts

#### Scenario: Blank page renders
- **WHEN** page.type is "blank"
- **THEN** a canvas with optional page cards (stat/table/chart/pivot) is rendered

### Requirement: Settings modal
The system SHALL provide the AI settings modal (API base URL, key, model).

#### Scenario: Save settings
- **WHEN** user fills settings and clicks save
- **THEN** settings are saved via PUT /api/settings
