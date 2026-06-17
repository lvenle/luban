## ADDED Requirements

### Requirement: DOM helper functions
The SHALL provide `h(tag, attrs, children)` function that creates DOM elements imperatively, matching the existing implementation in app.js.

#### Scenario: Element creation with attributes
- **WHEN** `h('div', { class: 'foo', text: 'bar' })` is called
- **THEN** it returns a `<div class="foo">` with text content "bar"

#### Scenario: Event binding
- **WHEN** `h('button', { onclick: handler })` is called
- **THEN** the handler is registered via `addEventListener('click', handler)`

### Requirement: SVG icon helpers
The system SHALL provide `svgIcon()`, `svgPath()`, `svgLine()`, `uiIcon()`, and `buttonLabel()` functions matching the existing implementations.

#### Scenario: UI icon renders
- **WHEN** `uiIcon('assistant')` is called
- **THEN** it returns a inline SVG element with the assistant icon paths

### Requirement: HTTP API client
The system SHALL provide `api(path, options)` function wrapping `fetch()` with JSON parsing and error handling.

#### Scenario: Successful JSON response
- **WHEN** `api('/api/apps')` resolves
- **THEN** it returns the parsed JSON body

#### Scenario: Error response
- **WHEN** the server returns non-2xx status
- **THEN** it throws an Error with `error.message`, `.status`, and optional `.details`

### Requirement: Toast notification
The system SHALL provide `toast(message)` showing a temporary notification.

#### Scenario: Toast appears and auto-removes
- **WHEN** `toast('hello')` is called
- **THEN** a toast element is appended to body and removed after ~3200ms

### Requirement: Confirm dialog
The system SHALL provide `openConfirmDialog({ title, message, confirmText, danger, onConfirm })` matching the existing implementation.

#### Scenario: Confirmation
- **WHEN** user clicks confirm button
- **THEN** `onConfirm` is called and backdrop is removed

### Requirement: Config modal
The system SHALL provide `openConfigModal(title, content, actions)` for filter/sort/group modals.

#### Scenario: Config modal renders
- **WHEN** `openConfigModal` is called
- **THEN** a modal with title, content, and action buttons is rendered

### Requirement: Text modal
The system SHALL provide `openTextModal(title, text)` for showing read-only text.

#### Scenario: Text modal renders
- **WHEN** `openTextModal` is called
- **THEN** a modal with a read-only textarea is rendered

### Requirement: LocalStorage helpers
The system SHALL provide `readStorage(key, fallback)`, `writeStorage(key, value)`, `storageKey(scope, suffix)`, and `globalStorageKey(scope)` matching the existing implementations.

#### Scenario: Storage round-trip
- **WHEN** data is written with `writeStorage` and read with `readStorage`
- **THEN** the returned value matches the written value
