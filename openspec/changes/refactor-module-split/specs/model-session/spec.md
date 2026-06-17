## ADDED Requirements

### Requirement: AI session CRUD
The system SHALL provide functions for creating, listing, getting, and updating AI sessions.

#### Scenario: Create session
- **WHEN** `createAiSession({ appId, status })` is called
- **THEN** a new session row is inserted and the session object is returned

#### Scenario: List sessions by app
- **WHEN** `listAiSessions({ appId })` is called
- **THEN** sessions for that app are returned with message counts

#### Scenario: Get session with messages
- **WHEN** `getAiSession(id)` is called
- **THEN** the session with associated messages and execution logs is returned

### Requirement: AI messages
The system SHALL provide message CRUD within sessions.

#### Scenario: Add message
- **WHEN** `addAiMessage(sessionId, role, content, structuredContent)` is called
- **THEN** a message is inserted with the given role and content

#### Scenario: Clear sessions
- **WHEN** `clearAiSessions(appId, excludeSessionId)` is called
- **THEN** all sessions for the app (except the excluded one) are deleted

### Requirement: Execution logs
The system SHALL provide execution log recording for AI tool calls.

#### Scenario: Add execution log
- **WHEN** `addAiExecutionLog(sessionId, stepName, status, { toolName, input, output })` is called
- **THEN** an execution log entry is inserted
