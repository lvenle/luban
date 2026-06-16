## Why

Software detail pages now contain many table and view actions, but most controls are text-only and sit in a long undifferentiated row. This makes common actions harder to scan, while the AI assistant currently competes with general topbar actions without a distinct visual identity.

## What Changes

- Add appropriate icons to software detail page buttons, with emphasis on table toolbar actions, topbar AI assistant, settings, view creation, export, and destructive actions.
- Group table toolbar buttons by task type and add visual separators between action groups.
- Keep the AI assistant entry in the existing topbar position to avoid blocking table horizontal scrolling, but refine it into a clearer assistant-styled button.
- Lightly polish runtime layout density and hierarchy so the view bar, table toolbar, search controls, and workspace feel more coherent.
- Preserve existing behavior, routing, keyboard flows, data operations, and drawer behavior.
- No breaking changes.

## Capabilities

### New Capabilities
- `runtime-toolbar-polish`: Covers visual affordances, grouping, and layout hierarchy for software detail page controls, including table toolbar buttons and the topbar AI assistant entry.

### Modified Capabilities
- None.

## Impact

- Affected frontend code: `public/app.js` button rendering helpers and runtime detail page render paths.
- Affected styles: `public/styles.css` button/icon layout, toolbar grouping, topbar button states, and responsive runtime layout refinements.
- Affected tests: `tests/ui-features.test.js` static/runtime feature assertions.
- No API, database, dependency, or package protocol changes are expected.
