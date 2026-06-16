## 1. Backend: Tool registry and auto-discovery

- [x] 1.1 Create `src/ai/tools/` directory and `src/ai/registry.js` with `registry.register()` and auto-discovery (scan directory on startup)
- [x] 1.2 Create `src/ai/tools/add-entity.js` — create table
- [x] 1.3 Create `src/ai/tools/remove-entity.js` — delete table (risk: high)
- [x] 1.4 Create `src/ai/tools/add-field.js` — add field to entity
- [x] 1.5 Create `src/ai/tools/update-field.js` — modify field
- [x] 1.6 Create `src/ai/tools/remove-field.js` — delete field (risk: high)
- [x] 1.7 Create `src/ai/tools/add-relation.js` — create relation between entities
- [x] 1.8 Create `src/ai/tools/add-page.js` — create page (list/chart/dashboard)
- [x] 1.9 Create `src/ai/tools/remove-page.js` — delete page (risk: high)
- [x] 1.10 Create `src/ai/tools/add-action.js` — add button/action to table
- [x] 1.11 Create `src/ai/tools/design-form.js` — configure form layout (client-side)
- [x] 1.12 Create `src/ai/tools/create-view.js` — create table view (client-side)
- [x] 1.13 Create `src/ai/tools/query-data.js` — query records
- [x] 1.14 Create `src/ai/tools/add-record.js` — create record
- [x] 1.15 Create `src/ai/tools/update-record.js` — update record
- [x] 1.16 Create `src/ai/tools/delete-record.js` — delete record (risk: high)

## 2. Backend: SSE chat endpoint

- [x] 2.1 Implement `POST /api/ai/chat` SSE endpoint in `src/routes/ai.js`
- [x] 2.2 Implement OpenAI function calling loop (stream → collect tool_calls → execute → continue)
- [x] 2.3 Implement risk gating: tool_confirm event + `POST /api/ai/chat/confirm` endpoint
- [x] 2.4 Implement session persistence (save messages/logs to DB on message_end)
- [x] 2.5 Implement SSE keepalive (ping every 30s to prevent timeout)
- [x] 2.6 Mark old endpoints as deprecated (`POST /api/ai/plan`, `/execute`, `/revise`, `/cancel`)

## 3. Backend: Remove old AI code

- [ ] 3.1 Remove `src/agent.js` (intent detection + clarification engine)
- [ ] 3.2 Remove `src/mockPatch.js` (mock patch generation)
- [ ] 3.3 Clean up `src/ai.js`: remove mock paths, keep only OpenAI helper
- [ ] 3.4 Update `src/server.js` routing: remove old AI route references

## 4. Frontend: SSEClient and StreamRenderer

- [x] 4.1 Create `public/ai-assistant/SSEClient.js` — SSE connection management with event dispatch and reconnection
- [x] 4.2 Create `public/ai-assistant/StreamRenderer.js` — incremental text rendering with blinking cursor

## 5. Frontend: ToolDisplay

- [x] 5.1 Create `public/ai-assistant/ToolDisplay.js` — tool call card rendering (pending → result) and confirmation modal for high-risk tools

## 6. Frontend: ChatView and SessionManager

- [x] 6.1 Create `public/ai-assistant/ChatView.js` — message list, input area, quick commands, auto-scroll
- [x] 6.2 Create `public/ai-assistant/SessionManager.js` — session create/switch/history
- [x] 6.3 Create `public/ai-assistant/index.js` — entry point, export `renderAssistantDrawer`

## 7. Frontend: Integrate into app.js

- [x] 7.1 Simplify state variables: remove 12 old assistant vars, keep `assistantOpen`
- [x] 7.2 Import renderAssistantDrawer/setAppId from ai-assistant module
- [x] 7.3 Remove ~1068 lines of old AI assistant code from app.js

## 8. Styles and cleanup

- [x] 8.1 Create `public/ai-assistant/style.css` with AI assistant styles (ported from styles.css)
- [ ] 8.2 Remove AI assistant CSS (~300 lines) from `public/styles.css`
- [x] 8.3 Run tests and verify full flow (5/5 pass)
