## 1. Icon and Button Foundations

- [x] 1.1 Add a local inline SVG icon helper for runtime UI actions without adding external dependencies.
- [x] 1.2 Add a reusable button label helper that renders icon + text with consistent markup.
- [x] 1.3 Define icon mappings for AI assistant, settings, add, import, delete, filter, sort, group, field settings, form view, export, quick add, and new view actions.

## 2. Topbar Polish

- [x] 2.1 Update the topbar AI assistant button to use the icon label helper while keeping the existing topbar position.
- [x] 2.2 Add an active/open visual state for the AI assistant topbar button when the drawer is open.
- [x] 2.3 Update the settings button to use a matching icon label treatment.

## 3. Table Toolbar Grouping

- [x] 3.1 Refactor the table action row into explicit toolbar groups for data entry, data mutation, view rules, structure/configuration, and export.
- [x] 3.2 Add icons to table toolbar actions while preserving their existing labels and click handlers.
- [x] 3.3 Add visual separators between toolbar groups without adding focusable elements or changing tab order.
- [x] 3.4 Ensure bulk delete slot, selection label, and export menu still render correctly inside the grouped toolbar.

## 4. Supporting Runtime Actions

- [x] 4.1 Add icon treatment to quick-add row and new-view controls.
- [x] 4.2 Add icon treatment to export menu trigger while preserving the existing dropdown behavior.
- [x] 4.3 Keep destructive actions visually distinct without adding red menu backgrounds.

## 5. Layout and Responsiveness

- [x] 5.1 Polish table toolbar spacing, button height, icon size, hover state, and group separator styling.
- [x] 5.2 Adjust view bar and table command row spacing so they read as a coherent table control header.
- [x] 5.3 Add responsive wrapping or stacking behavior so toolbar controls do not overlap on narrow widths.
- [x] 5.4 Confirm no AI assistant control overlays the bottom-right table scrollbar area.

## 6. Verification

- [x] 6.1 Update frontend feature assertions for icon helper, icon labels, toolbar groups, separators, and AI active state.
- [x] 6.2 Run `node --check public/app.js`.
- [x] 6.3 Run `npm test`.
- [x] 6.4 Verify the software detail page visually on desktop-width layout, including table toolbar grouping and topbar AI styling.
