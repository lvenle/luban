## ADDED Requirements

### Requirement: SSE streaming chat endpoint

The system SHALL provide a `POST /api/ai/chat` endpoint that accepts a JSON body with `sessionId`, `appId`, and `message`, and returns a Server-Sent Events (SSE) stream.

#### Scenario: Client sends message and receives structured events
- **WHEN** client sends `POST /api/ai/chat` with `{ message: "添加状态字段", appId: "app_xxx", sessionId: "ais_xxx" }`
- **THEN** server SHALL respond with `Content-Type: text/event-stream` and stream events

#### Scenario: Stream includes content_delta events
- **WHEN** AI generates text response
- **THEN** server SHALL emit `event: content_delta\ndata: {"content":"..."}\n\n` for each text chunk

#### Scenario: Stream includes tool_use event when AI calls a tool
- **WHEN** AI decides to call a tool
- **THEN** server SHALL emit `event: tool_use\ndata: {"id":"call_xxx","name":"add_field","arguments":{...}}\n\n`

#### Scenario: Stream includes tool_result after tool execution
- **WHEN** a tool finishes execution
- **THEN** server SHALL emit `event: tool_result\ndata: {"id":"call_xxx","status":"success","output":"..."}\n\n`

#### Scenario: Stream includes tool_confirm for high-risk tools
- **WHEN** AI calls a high-risk tool (create/delete)
- **THEN** server SHALL emit `event: tool_confirm\ndata: {"id":"call_xxx","name":"...","arguments":{...}}\n\n` and WAIT for client confirmation before executing

#### Scenario: Stream ends with message_end
- **WHEN** AI finishes responding after all tool calls
- **THEN** server SHALL emit `event: message_end\ndata: {}\n\n`

#### Scenario: Client confirms a high-risk tool
- **WHEN** client receives `tool_confirm` and sends `POST /api/ai/chat/confirm` with `{ sessionId, toolCallId, confirmed: true }`
- **THEN** server SHALL execute the tool and continue the stream

#### Scenario: Client rejects a high-risk tool
- **WHEN** client sends `POST /api/ai/chat/confirm` with `{ sessionId, toolCallId, confirmed: false }`
- **THEN** server SHALL notify AI of rejection and continue the stream

### Requirement: Session persistence

The chat endpoint SHALL persist all messages and tool calls to the existing `ai_sessions`, `ai_messages`, and `ai_execution_logs` tables.

#### Scenario: User and assistant messages are persisted
- **WHEN** a conversation turn completes
- **THEN** the user message and all assistant content (text + tool calls + results) SHALL be saved to `ai_messages`

#### Scenario: Session status reflects completion
- **WHEN** the stream ends normally
- **THEN** the session status SHALL be set to `completed`
