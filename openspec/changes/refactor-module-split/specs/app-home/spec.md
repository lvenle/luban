## ADDED Requirements

### Requirement: App grid rendering
The system SHALL provide `renderHome()` that renders the app grid with categories, hero section, and category filter.

#### Scenario: Home page renders
- **WHEN** `renderHome()` is called
- **THEN** the app grid, hero section, category filter are rendered into root

### Requirement: App card
The system SHALL provide `appCard(app)` that renders a single app card with menu.

#### Scenario: Card renders with actions
- **WHEN** `appCard(app)` is called
- **THEN** it returns an article with category pill, name, description, and a floating menu with export/delete options

### Requirement: Category classification
The system SHALL provide `appCategory(app)` and `appCategories()` for automatic category classification based on app content.

#### Scenario: Category by manifest
- **WHEN** manifest.category is "客户"
- **THEN** `appCategory(app)` returns "客户"

#### Scenario: Category deduction
- **WHEN** name or description contains "记账"
- **THEN** `appCategory(app)` returns "财务"

### Requirement: Go Home navigation
The system SHALL provide `goHome()` that clears runtime state and navigates to the home page.

#### Scenario: Navigate home
- **WHEN** `goHome()` is called
- **THEN** `state.currentApp` is null, route is cleared, and `loadApps()` is called

### Requirement: Import .sgpkg modal
The system SHALL provide `openImportModal()` that opens a file picker for .sgpkg files.

#### Scenario: Import flow
- **WHEN** user selects a .sgpkg file and clicks install
- **THEN** the file is uploaded to `/api/apps/import` and `openApp(body.appId)` is called
