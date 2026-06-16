## ADDED Requirements

### Requirement: Tool registry with auto-discovery

The system SHALL provide a tool registry where each tool self-registers with name, description, OpenAI function schema, risk level, and handler function. Tools SHALL be auto-discovered by scanning the `src/ai/tools/` directory.

#### Scenario: Tool registers with complete metadata
- **WHEN** a tool file defines `registry.register({ name, description, risk, schema, handler })`
- **THEN** the tool SHALL be available for AI invocation

#### Scenario: Tools are discovered automatically
- **WHEN** the server starts
- **THEN** ALL `.js` files in `src/ai/tools/` SHALL be imported and their registered tools collected

### Requirement: Tool risk levels

Each tool SHALL have a `risk` property: `"low"` (auto-execute) or `"high"` (require user confirmation). High-risk operations include creating and deleting entities, fields, pages, records.

#### Scenario: Low-risk tool executes automatically
- **WHEN** AI calls a low-risk tool
- **THEN** the server SHALL execute it immediately and emit `tool_result`

#### Scenario: High-risk tool pauses for confirmation
- **WHEN** AI calls a high-risk tool
- **THEN** the server SHALL emit `tool_confirm` and pause execution until client responds

### Requirement: Tool definitions for schema operations

The system SHALL provide tools for all schema operations:

- `add_entity(name, description)` — create table
- `update_entity(entity_id, name, description)` — rename table
- `remove_entity(entity_id)` — delete table (high risk)
- `add_field(entity_id, name, type, options?, required?)` — add field
- `update_field(entity_id, field_id, updates)` — modify field
- `remove_field(entity_id, field_id)` — delete field (high risk)
- `add_relation(source_entity, target_entity, ...)` — create relation

#### Scenario: add_field tool creates a field
- **WHEN** AI calls `add_field({ entity_id: "orders", name: "status", type: "select", options: ["待处理","已完成"] })`
- **THEN** a new field SHALL be added to the entity and the tool result contains the field ID

### Requirement: Tool definitions for page operations

The system SHALL provide tools for page operations:

- `add_page(entity_id, title, type)` — create list/chart/dashboard page
- `remove_page(page_id)` — delete page (high risk)
- `add_action(entity_id, type, config)` — add button/action to table
- `design_form(entity_id, field_order, columns)` — configure form layout
- `create_view(entity_id, name, config)` — create table view

### Requirement: Tool definitions for data operations

The system SHALL provide tools for data operations:

- `query_data(entity_id, filters?, limit?)` — query records
- `add_record(entity_id, data)` — create record
- `update_record(record_id, data)` — update record
- `delete_record(record_id)` — delete record (high risk)
