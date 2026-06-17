## ADDED Requirements

### Requirement: App management routes
The system SHALL provide REST endpoints for app management in a separate module.

#### Scenario: List apps
- **WHEN** `GET /api/apps` is received
- **THEN** respond with `{ apps: listApps() }`

#### Scenario: Generate app from prompt
- **WHEN** `POST /api/apps/generate` with `{ prompt }` is received
- **THEN** an app is generated via AI and created, respond with `{ appId, app, logs }`

#### Scenario: Import .sgpkg
- **WHEN** `POST /api/apps/import` with binary or JSON is received
- **THEN** the package is imported and respond with `{ appId, app }`

#### Scenario: Delete app
- **WHEN** `DELETE /api/apps/:id` is received
- **THEN** the app is deleted and respond with `{ ok: true }`
