---
name: software-development
version: v1.0
description: Plan, implement, and verify software changes in an existing codebase; use for feature work, refactors, and bug fixes.
---

# Software Development

Use for implementing or changing software. For diagnosis without an implementation request, investigate and report instead of editing.

## Workflow

1. Restate the requested outcome and identify the relevant repository, application, and constraints.
2. Inspect project guidance, working-tree changes, architecture, and tests before editing. Treat uncommitted work as user-owned; preserve unrelated changes.
3. Trace the behavior through the smallest relevant code path. Share material assumptions when they could change scope.
4. Make a focused change consistent with local patterns. Avoid unrelated cleanup, broad rewrites, and new dependencies unless necessary.
5. Add or update tests for the behavior and important failure cases. Run targeted checks, then broader checks proportional to risk.
6. Review the final diff for regressions, secrets, unsafe side effects, and accidental changes. Report files changed, verification, and remaining limitations.

## Boundaries

- Do not claim tests, builds, commands, or UI interactions succeeded unless they actually ran.
- Do not overwrite or discard user data or unrelated edits.
- Ask before expanding scope into external services, destructive actions, or irreversible changes.
- Prefer observable evidence over assumptions; report uncertainty plainly.
