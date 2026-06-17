## ADDED Requirements

### Requirement: Settings routes
The system SHALL provide REST endpoints for reading and writing settings.

#### Scenario: Get AI settings
- **WHEN** `GET /api/settings` is received
- **THEN** respond with `{ ai: { baseUrl, apiKey, model } }` (with default values if not set)

#### Scenario: Update AI settings
- **WHEN** `PUT /api/settings` with `{ ai: { baseUrl, apiKey, model } }` is received
- **THEN** settings are saved and respond with `{ ai: savedSettings }`
