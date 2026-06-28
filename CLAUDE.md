# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Start server:** `npm start` (port 5173)
- **Dev mode:** `npm run dev` (node --watch)
- **Run tests:** `npm test` (node --test tests/*.test.js)
- **Initialize samples:** `node src/scripts/initSamples.js` (writes sample packages to DB if empty)
- **Node requirement:** >= 25.0.0 (for built-in `node:sqlite`)

## Architecture Overview

**鲁班AI系统** is an AI-native software creation platform. Users describe apps in natural language, the system generates structured software packages (`.sgpkg`), and a runtime renders them immediately.

### Stack
- **Backend:** Node.js HTTP server (no framework), SQLite via `node:sqlite`
- **Frontend:** Vanilla JS SPA (no React), hyperscript-like DOM helpers
- **AI:** OpenAI-compatible API streaming, with local Mock AI fallback when no API key

### Directory Structure

```
src/
  server.js          — HTTP server entry point, routing, rate limiting
  storage/
    db.js            — SQLite layer, migrations (v1 → v2), Supabase backup
  models/
    app.js           — App CRUD (create, read, update, delete)
    session.js       — AI session CRUD + settings access
    record.js        — Record CRUD
  routes/
    ai.js            — AI API: SSE chat streaming, sessions, confirm
    app.js           — App API: list, create, generate, import
    runtime.js       — Runtime data API: records, entities, fields, relations
    settings.js      — Settings API
  ai/
    service.js       — OpenAI streaming client, package generation from prompt
    agent.js         — Planning prompts, intent understanding (legacy flow)
    registry.js      — Tool registration and discovery (auto-imports tools/)
    samplePackages.js— 30+ offline fallback packages (keyword-matched)
    mockPatch.js     — Mock AI patch generation (no-API-key mode)
    tools/           — Tool handlers (create-app, add-field, add-entity, etc.)
  core/
    packageProtocol.js — .sgpkg validation, patch application, field type defs
    ids.js           — UUID generation, slug/normalize helpers
    formula.js       — Formula engine: tokenizer, parser, AST evaluator, caching, select label resolution
    contract.js      — Protocol constants & metadata registry (FIELD_TYPES, PAGE_TYPES, ACTION_TYPES, PATCH_OPS, etc.)
    fieldTypeHelpers.js — Semantic field-type helpers (isChoiceField, isRelationField, isTemporalField, etc.)
  services/
    operations.js    — Field/entity/relation CRUD operations
    actions.js       — Built-in action runner
  scripts/
    initSamples.js   — Sample data initializer
  utils/
    export.js        — CSV & Markdown record export
    importData.js    — File import (CSV/XLSX) row parsing
    xlsx.js          — XLSX export via minimal XML builder
    zip.js           — .sgpkg zip packaging/unpacking
public/
  index.html         — SPA entry point
  app.js             — Main state, routing, topbar, event listeners
  app-home/          — Home page: app list/grid, AI assistant drawer trigger
  app-runtime/       — Runtime: data tables, forms, views, sidebar, cell editing
  ai-assistant/      — AI assistant chat drawer: SSE streaming, tool cards, session mgmt
  common/            — Shared: DOM helpers (h), API client, toast, modal, localStorage
```

### Data Flow

1. User describes an app → `POST /api/ai/chat` (SSE)
2. Server builds system prompt with app schema context → streams OpenAI response
3. AI may invoke tools (`create_app`, `add_field`, `add_entity`, etc.) — high-risk tools require user confirmation
4. Tool results feed back into the conversation loop (up to 20 iterations)
5. On `message_end`, frontend fires `ai-message-end` event → `loadApps()` re-renders home
6. AI sessions persist with messages + execution logs in SQLite

### Protocol Constants & Metadata Layer

**`src/core/contract.js`** is the single source of truth for protocol constants:

- `FIELD_TYPES` — registry with metadata per field type (id, label, category, flags like `isChoiceType`, `isRelationType`, `isFormulaType`, etc.)
- `PAGE_TYPES` — page/table/link/dashboard with flags like `hasPageSize`
- `ACTION_TYPES` — all 10 action types with labels and descriptions
- `PATCH_OPS` — all 14 patch operations with labels and descriptions
- `TABLE_VIEW_TYPES` — list/quadrant/gantt
- `SELECT_COLORS` — color palette array (backward-compatible)

**`src/core/fieldTypeHelpers.js`** provides semantic helpers for readable field-type checks:

```js
import { isChoiceField, isRelationField, isFormulaField, isTemporalField } from '../core/fieldTypeHelpers.js';

// Instead of:
if (field.type === 'select' || field.type === 'multiSelect')

// Write:
if (isChoiceField(field))
```

**Guidelines for field type checks:**

- Use helpers for **semantic category** checks: choice, relation, formula, temporal, file-like, text-like, numeric
- Keep **specific single-type** branches as-is: `field.type === 'number'`, `field.type === 'url'`, `field.type === 'ai'`
- Do NOT chase zero `field.type ===` — readability over dogmatism
- formula field `.resultType` is a separate domain — do NOT mix with `FIELD_TYPES`

Available helpers: `isChoiceField`, `isSingleChoiceField`, `isMultiChoiceField`, `isRelationField`, `isFormulaField`, `isNumericField`, `isDateField`, `isDateTimeField`, `isTemporalField`, `isFileLikeField`, `isTextLikeField`. All accept `{ type: '...' }` or `'...'` string directly.

### Software Package Protocol (.sgpkg)

A zip containing: `manifest.json`, `schema.json` (entities + fields), `ui.json` (pages + views), `actions.json`, `prompts.json`. The `preparePackage()` function validates and normalizes packages. Patches are applied via `applyPatch()` for iterative modification.

### AI System

Two modes:
- **OpenAI mode:** Configure API key in settings. Uses streaming chat completions with tool calls.
  - `generatePackageFromPrompt()` sends prompt to OpenAI → returns generated package
  - On API failure, throws error (no silent fallback) — the tool handler surfaces the error to the user
- **Mock mode:** No API key = local fallback. `generatePackageFromPrompt()` immediately returns `pickSamplePackage()`, which keyword-matches against 30+ scenarios and falls back to `createBudgetPackage()` (家庭记账本).

The `create_app` tool handler calls `generatePackageFromPrompt()` → validates result → creates app. When mock mode returns an unrelated sample, unrelated tables can appear. This is a known issue.

AI tools: `create_app`, `add_entity`, `add_field`, `add_relation`, `add_page`, `add_view`, `create_view`, `add_record`, `add_action`, `update_entity`, `update_field`, `update_record`, `remove_entity`, `remove_field`, `remove_page`, `delete_record`, `design_form`, `query_data`, `clear_sessions`.

Legacy planning: `src/ai/agent.js` contains `understandAgentRequest()` (intent detection) and `buildPlanningPrompt()` — used by the old generate-plan-then-execute flow. The current SSE chat flow (`handleAiApi` → `streamOpenAI`) replaces this.

### Database Schema (SQLite, WAL mode)

- `apps` — app definitions (JSON blobs for schema/ui/actions/prompts)
- `records` — user data records (JSON blob per record, entityId for partitioning)
- `record_relations` — cross-entity relation links
- `ai_sessions` — chat sessions (type: 'create' | 'modify')
- `ai_messages` — chat messages per session
- `ai_execution_logs` — tool execution logs per session
- `settings` — key-value settings (AI API config, etc.)

### Key Frontend Patterns

- DOM creation via `h(tag, attrs, children)` — lightweight hyperscript
- State in `state` object (imported from `app.js`)
- AI assistant rendered as a floating drawer, toggled by `renderAssistantDrawer()` / `removeAssistantDrawer()`
- Session history merging: `sessionHistoryEntries()` interleaves messages and tool logs by timestamp

### Known Issues / Recent Fixes

- **Session loading race condition:** `renderAssistantDrawer()` now always calls `sessionManager.load()` even when the drawer already exists (fix at line 230).
- **Silent error handling:** `onSwitch` callback now shows `toast()` on HTTP/session errors instead of swallowing them.
- **Tool log input mismatch:** `completedToolLogs()` now checks `hasOwnInput` before consuming the pending-input queue.
- **FormulaError class missing:** `FormulaError` was used in `formula.js` but never defined, causing ReferenceErrors on invalid formula expressions. Now exported as a proper Error subclass.
- **Unrelated table fallback:** When AI generation fails, `pickSamplePackage()` defaults to 家庭记账本 with no homework management keywords. To fix: add keywords to `samplePackages.js` or improve `generatePackageFromPrompt()` fallback logic in `create-app.js`.
- **Record q-search limited for selects:** `listRecords({q})` uses SQL `LIKE` on `dataJson`, but select values are stored as option IDs (not labels). The JS post-filter resolves labels correctly but may miss records if SQL pre-filter strips them. To fix: add a label-aware SQL filter or remove the SQL pre-filter.
