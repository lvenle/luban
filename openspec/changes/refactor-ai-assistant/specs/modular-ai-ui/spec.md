## ADDED Requirements

### Requirement: Modular frontend structure

The AI assistant frontend code SHALL be split into separate module files under `public/ai-assistant/`, loaded as ES modules.

#### Scenario: Modules are individually importable
- **WHEN** the application loads
- **THEN** each module file SHALL be a valid ES module with explicit imports/exports

### Requirement: ChatView renders messages

`ChatView.js` SHALL render the message list, input area, quick command chips, and handle scroll-to-bottom on new messages.

#### Scenario: ChatView renders message list
- **WHEN** ChatView receives a message array
- **THEN** it SHALL render each message as a bubble with avatar, timestamp, and content

#### Scenario: ChatView renders streaming text
- **WHEN** ChatView receives content_delta events
- **THEN** it SHALL append tokens incrementally to the current assistant message with a blinking cursor

### Requirement: SSEClient manages streaming connection

`SSEClient.js` SHALL manage the EventSource connection, handle reconnection, and dispatch events to registered callbacks.

#### Scenario: SSEClient connects and receives events
- **WHEN** SSEClient connects to POST /api/ai/chat
- **THEN** it SHALL parse each SSE event and call the corresponding registered callback (onContent, onToolUse, onToolResult, onToolConfirm, onEnd, onError)

#### Scenario: SSEClient handles disconnection
- **WHEN** the connection drops unexpectedly
- **THEN** SSEClient SHALL attempt to reconnect with exponential backoff

### Requirement: ToolDisplay renders tool calls

`ToolDisplay.js` SHALL render tool call cards inline in the conversation. Each card shows tool name, arguments, execution status, and result.

#### Scenario: ToolDisplay shows pending tool call
- **WHEN** a `tool_use` event is received
- **THEN** a collapsible card SHALL appear showing tool name and arguments with a spinner

#### Scenario: ToolDisplay shows completed tool
- **WHEN** a `tool_result` event follows a `tool_use`
- **THEN** the card SHALL update with status icon (✅ success / ❌ error) and result summary

#### Scenario: ToolDisplay shows confirmation dialog
- **WHEN** a `tool_confirm` event is received
- **THEN** a modal dialog SHALL appear showing the tool name, arguments, and [确认] / [拒绝] buttons

### Requirement: StreamRenderer handles incremental text

`StreamRenderer.js` SHALL manage incremental text rendering for streaming assistant messages, supporting markdown and code blocks.

#### Scenario: StreamRenderer appends text tokens
- **WHEN** a `content_delta` event arrives
- **THEN** StreamRenderer SHALL append the token to the current assistant message element

#### Scenario: StreamRenderer shows typing indicator
- **WHEN** streaming is active
- **THEN** a blinking cursor SHALL appear at the end of the current message

### Requirement: SessionManager handles chat sessions

`SessionManager.js` SHALL manage session lifecycle: create, list, switch, and delete sessions.

#### Scenario: SessionManager creates new session
- **WHEN** user clicks "新建会话"
- **THEN** a new session is created and the message list is cleared

#### Scenario: SessionManager switches sessions
- **WHEN** user selects a session from the history dropdown
- **THEN** that session's messages are loaded and displayed
