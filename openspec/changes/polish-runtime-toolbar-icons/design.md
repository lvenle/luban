## Context

The runtime software detail page uses a sticky topbar, a left page/table sidebar, and a table workspace. The current table toolbar is a long row of text-only buttons (`+ 添加记录`, `导入`, `筛选`, `排序`, `分组`, `字段设置`, `表单视图`, `导出`) with limited visual grouping. The topbar AI assistant is also a text-only secondary button.

The product relies on wide tables and horizontal scrolling, so a bottom-right assistant avatar would conflict with table scrollbars, quick-add rows, and floating cell-copy controls. The assistant entry should remain in the topbar and receive a clearer visual treatment there.

## Goals / Non-Goals

**Goals:**
- Add consistent, lightweight icons to runtime detail page actions without introducing a new icon dependency.
- Group table toolbar actions with separators that reflect task boundaries: data entry, data mutation, view rules, structure/configuration, and export.
- Keep the AI assistant in the topbar while making it more identifiable and giving it a selected/open state.
- Improve the visual relationship between view tabs, toolbar actions, search inputs, and table content with small layout refinements.
- Preserve existing behavior, data operations, drawer behavior, selection behavior, and keyboard/mouse interactions.

**Non-Goals:**
- Move the AI assistant to a floating bottom-right avatar.
- Redesign the full application shell, home page, sidebar data model, or table engine.
- Add external icon libraries or new build tooling.
- Change API contracts, database schema, package protocol, or AI planning behavior.

## Decisions

1. **Use local inline SVG icon helpers instead of a dependency.**

   Rationale: The codebase already renders local SVG icons for page/table navigation via `pageTypeIcon()`. A small `uiIcon(name)` helper can reuse that pattern, keep assets close to rendering code, and avoid bundle/build changes.

   Alternatives considered:
   - Add a package such as Lucide: high-quality icons, but introduces dependency and build/runtime concerns for a small polish change.
   - Use emoji/text symbols: fast, but inconsistent across platforms and visually noisy in dense toolbars.

2. **Create a reusable button content helper.**

   Runtime buttons should be rendered as icon + label pairs with predictable spacing. A helper such as `buttonLabel(iconName, label)` can keep markup consistent across topbar, table toolbar, export summary, quick-add row, and view actions.

   Alternatives considered:
   - Manually place spans in each button: simpler per button, but easier to drift and harder to test consistently.

3. **Represent toolbar groups explicitly in markup.**

   The table action row should contain group wrappers rather than relying only on CSS gaps. Suggested groups:
   - Data entry: add record, quick add where applicable
   - Data import/mutation: import, bulk delete, selection label
   - View rules: filter, sort, group
   - Structure/config: field settings, form view
   - Export: export menu

   Separators should be visual only and must not interfere with tab order or click handling.

4. **Keep search controls on the toolbar but preserve responsive escape hatches.**

   On desktop, keep action groups left and search controls right to preserve current muscle memory. On narrower widths, allow toolbar rows to wrap or stack so buttons do not overflow the table panel.

   Alternatives considered:
   - Move search above actions permanently: clearer on small screens, but increases table header height and changes the current workflow more than needed.

5. **Topbar AI assistant remains a button, not an avatar.**

   The assistant should be styled as a recognizable topbar action with an icon and active state when the drawer is open. Keeping the label avoids discoverability issues.

   Alternatives considered:
   - Floating avatar: rejected because it blocks horizontal table scrolling and competes with table-local floating controls.
   - Icon-only topbar button: saves space but reduces clarity for a primary creation/modification affordance.

## Risks / Trade-offs

- **Toolbar becomes too dense after adding icons** → Keep icons small, align to a compact button height, and use group spacing/separators instead of heavy backgrounds.
- **Icons obscure meaning for less common actions** → Preserve text labels for all normal toolbar buttons; use icon-only controls only where existing UI already does so.
- **Grouped markup breaks existing selection label/export menu layout** → Treat `bulkDeleteSlot`, `selectionLabel`, and export menu as existing nodes moved into wrappers, not behavior changes.
- **Responsive wrapping may push table content down** → Scope wrapping to constrained widths and keep desktop layout single-row.
- **Topbar active AI styling may look like a primary app action** → Use a subtle assistant accent rather than a large filled CTA.

## Migration Plan

- Implement changes in frontend rendering and CSS only.
- Update frontend static assertions to verify icon helpers, toolbar group classes, separators, and topbar assistant active styling exist.
- Run syntax checks and the existing test suite.
- Rollback is straightforward by reverting the frontend rendering/style changes; no persisted data or API changes are involved.

## Open Questions

- Should the topbar AI icon be a sparkle, message bubble, or bot-like glyph? Default recommendation: sparkle/message hybrid to avoid a robotic mascot tone.
- Should export remain a separate details menu or become part of a consolidated "more" menu on narrow screens? Default recommendation: keep current export menu on desktop; consider a future responsive "more" pattern if toolbar width remains tight.
