## ADDED Requirements

### Requirement: App CRUD
The system SHALL provide functions for creating, reading, updating, and deleting apps in SQLite.

#### Scenario: Create app from package
- **WHEN** `createAppFromPackage(pkg)` is called
- **THEN** a new app row is inserted with validated package JSON, and the app object is returned

#### Scenario: List all apps
- **WHEN** `listApps()` is called
- **THEN** all app rows are returned as parsed objects

#### Scenario: Get app by ID
- **WHEN** `getApp(id)` is called
- **THEN** the app object is returned, or null if not found

#### Scenario: Update app metadata
- **WHEN** `updateAppMetadata(appId, { name, category, description })` is called
- **THEN** the app metadata is updated and updatedAt is refreshed

#### Scenario: Delete app with cascade
- **WHEN** `deleteApp(appId)` is called
- **THEN** the app and all related records/relations/sessions are deleted via CASCADE

### Requirement: App package operations
The system SHALL provide package read/write on apps.

#### Scenario: Update full package
- **WHEN** `updateAppPackage(appId, pkg)` is called
- **THEN** the package is normalized, validated, and saved; version increments

#### Scenario: Export app payload
- **WHEN** `exportAppPayload(appId, dataMode)` is called
- **THEN** a package object is returned (without sampleData in "structure" mode)

#### Scenario: Import app payload
- **WHEN** `importAppPayload(payload)` is called
- **THEN** a new app is created from the payload with a fresh ID
