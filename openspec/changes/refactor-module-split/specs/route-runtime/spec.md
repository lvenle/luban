## ADDED Requirements

### Requirement: Runtime routes
The system SHALL provide REST endpoints for app details/runtime operations in a separate module.

#### Scenario: Get app detail
- **WHEN** `GET /api/apps/:id` is received
- **THEN** respond with `{ app: getApp(id) }`

#### Scenario: Update app metadata
- **WHEN** `PUT /api/apps/:id` with `{ name, category, description }` is received
- **THEN** metadata is updated and respond with `{ app: updatedApp }`

#### Scenario: Update app package
- **WHEN** `PUT /api/apps/:id/package` with `{ package }` is received
- **THEN** the package is saved and respond with `{ app: updatedApp }`

#### Scenario: AI modify app
- **WHEN** `POST /api/apps/:id/modify` with `{ prompt }` is received
- **THEN** AI generates a patch, applies it, and respond with `{ summary, patch, app, logs }`

#### Scenario: List records
- **WHEN** `GET /api/apps/:id/records?entity=X` is received
- **THEN** respond with `{ records: listRecords(...) }`

#### Scenario: Create record
- **WHEN** `POST /api/apps/:id/records` with `{ entityId, data }` is received
- **THEN** a record is created and respond with `{ record }`

#### Scenario: Update record
- **WHEN** `PUT /api/apps/:id/records/:rid` with `{ data }` is received
- **THEN** the record is updated and respond with `{ record }`

#### Scenario: Delete record
- **WHEN** `DELETE /api/apps/:id/records/:rid` is received
- **THEN** the record is deleted and respond with `{ ok: true }`

#### Scenario: List tables (entities)
- **WHEN** `GET /api/apps/:id/tables` is received
- **THEN** respond with `{ tables: app.schema.entities }`

#### Scenario: Create table
- **WHEN** `POST /api/apps/:id/tables` with `{ name, description }` is received
- **THEN** a table is created and respond with `{ app }`

#### Scenario: Update table
- **WHEN** `PATCH /api/apps/:id/tables/:eid` is received
- **THEN** the table metadata is updated and respond with `{ app }`

#### Scenario: Delete table with cascade
- **WHEN** `DELETE /api/apps/:id/tables/:eid` is received
- **THEN** the table and related data are deleted (or 409 if referenced) and respond with `{ app }`

#### Scenario: Clear table records
- **WHEN** `DELETE /api/apps/:id/tables/:eid/records` is received
- **THEN** all records for that entity are deleted (or 409 if referenced) and respond with `{ deletedCount, app }`

#### Scenario: Import data to table
- **WHEN** `POST /api/apps/:id/tables/:eid/import` with CSV/XLSX is received
- **THEN** records are imported and respond with `{ importedCount }`

#### Scenario: List fields
- **WHEN** `GET /api/apps/:id/tables/:eid/fields` is received
- **THEN** respond with `{ fields: entity.fields }`

#### Scenario: Create field
- **WHEN** `POST /api/apps/:id/tables/:eid/fields` with `{ field }` is received
- **THEN** a field is created and respond with `{ app }`

#### Scenario: Update field
- **WHEN** `PATCH /api/apps/:id/fields/:eid/:fid` is received
- **THEN** the field is updated and respond with `{ app }`

#### Scenario: Delete field
- **WHEN** `DELETE /api/apps/:id/fields/:eid/:fid` is received
- **THEN** the field is deleted and respond with `{ app }`

#### Scenario: Run action
- **WHEN** `POST /api/apps/:id/actions/:aid/run` is received
- **THEN** the action is executed and respond with the action result

#### Scenario: Upload file
- **WHEN** `POST /api/apps/:id/uploads` with file binary is received
- **THEN** the file is saved and respond with `{ file: { name, url, mimeType, size } }`

#### Scenario: Export app (.sgpkg)
- **WHEN** `GET /api/apps/:id/export` is received
- **THEN** respond with the .sgpkg binary attachment

#### Scenario: Export CSV
- **WHEN** `GET /api/apps/:id/export.csv?entity=X` is received
- **THEN** respond with CSV attachment

#### Scenario: Export XLSX
- **WHEN** `GET /api/apps/:id/export.xlsx?entity=X` is received
- **THEN** respond with XLSX binary attachment

#### Scenario: Get relation options
- **WHEN** `GET /api/apps/:id/fields/:eid/:fid/relation-options?keyword=X` is received
- **THEN** respond with `{ options: [...] }`

#### Scenario: Get record relations
- **WHEN** `GET /api/apps/:id/records/:rid/relations/:fid` is received
- **THEN** respond with `{ relations: [...] }`

#### Scenario: Update record relations
- **WHEN** `PUT /api/apps/:id/records/:rid/relations/:fid` with `{ targetRecordIds }` is received
- **THEN** relations are updated and respond with `{ relations }`
