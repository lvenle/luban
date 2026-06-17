## ADDED Requirements

### Requirement: Record CRUD
The system SHALL provide functions for listing, creating, updating, and deleting records.

#### Scenario: List records with search
- **WHEN** `listRecords(appId, { entityId, q })` is called with a keyword
- **THEN** records matching the keyword in any text field are returned

#### Scenario: Create record with relation split
- **WHEN** `createRecord(appId, entityId, data)` is called
- **THEN** a record is inserted, relation fields are split into `record_relations`, and dataJson excludes relation fields

#### Scenario: Update record
- **WHEN** `updateRecord(recordId, data)` is called
- **THEN** the record data is updated; if data is unchanged, updatedAt is NOT modified

#### Scenario: Delete record with constraint check
- **WHEN** `deleteRecord(recordId)` is called
- **THEN** if the record is referenced, a 409 error with reference details is thrown; if `force=true`, cascade delete

### Requirement: Record relations
The system SHALL provide relation get/set operations.

#### Scenario: Get record relations
- **WHEN** `getRecordRelations(recordId, fieldId)` is called
- **THEN** related records for that field are returned

#### Scenario: Update record relations
- **WHEN** `updateRecordRelations(recordId, fieldId, targetRecordIds)` is called
- **THEN** relations are replaced with the new set of target IDs

### Requirement: Relation options
The system SHALL provide `listRelationOptions(appId, sourceEntityId, fieldId, keyword)` for searching relation options.

#### Scenario: Search relation options
- **WHEN** `listRelationOptions` is called with a keyword
- **THEN** matching records from the target entity are returned
