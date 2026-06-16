## ADDED Requirements

### Requirement: Runtime actions show meaningful icons
The system SHALL display appropriate icons alongside text labels for primary software detail page actions, including topbar AI assistant, settings, table add, import, bulk delete, filter, sort, group, field settings, form view, export, quick add row, and view creation actions.

#### Scenario: User scans table actions
- **WHEN** a user opens a software detail page with a table page
- **THEN** the table toolbar actions display compact icons paired with their existing text labels

#### Scenario: User scans topbar actions
- **WHEN** a user views the software detail page topbar
- **THEN** the AI assistant and settings actions display icons paired with readable labels

### Requirement: Table toolbar actions are visually grouped
The system SHALL group table toolbar actions by task type and show visual separators between groups without changing action behavior.

#### Scenario: Table toolbar renders grouped actions
- **WHEN** a table page toolbar is displayed
- **THEN** add/import/delete actions, view rule actions, structure/configuration actions, and export actions are visually separated into distinct groups

#### Scenario: Existing table actions remain functional
- **WHEN** a user clicks any grouped toolbar action
- **THEN** the same modal, menu, or operation opens as before the visual grouping change

### Requirement: AI assistant remains in the topbar
The system SHALL keep the AI assistant entry in the topbar rather than moving it to a bottom-right floating avatar.

#### Scenario: User opens a wide table
- **WHEN** a software detail page contains a horizontally scrollable table
- **THEN** no AI assistant control overlays the bottom-right table scrollbar area

#### Scenario: Assistant drawer is open
- **WHEN** the AI assistant drawer is open
- **THEN** the topbar AI assistant button indicates the active/open state

### Requirement: Runtime layout remains compact and responsive
The system SHALL preserve a compact runtime layout while allowing toolbar controls to wrap or stack gracefully when horizontal space is limited.

#### Scenario: Desktop table layout
- **WHEN** the software detail page has enough horizontal space
- **THEN** toolbar action groups and search controls remain in a single compact control area above the table

#### Scenario: Narrow layout
- **WHEN** the software detail page has limited horizontal space
- **THEN** toolbar controls remain readable and do not overlap the table, sidebar, or each other

### Requirement: Visual polish does not change data behavior
The system SHALL preserve existing data, view, export, import, selection, and assistant behaviors while changing button visuals and layout.

#### Scenario: User performs existing table workflow
- **WHEN** a user adds records, imports data, filters, sorts, groups, configures fields, opens form view, or exports data from the polished toolbar
- **THEN** each workflow behaves the same as before the visual polish change
