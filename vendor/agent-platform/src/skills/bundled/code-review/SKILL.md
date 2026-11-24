---
name: code-review
version: v1.0
description: Review code changes for correctness, regressions, security, and missing tests; use when asked to review a diff or implementation.
---

# Code Review

Review the requested change, not the author's intent. Prioritize actionable defects over style preferences.

## Workflow

1. Identify the review base and exact changed files. Read surrounding code and relevant project guidance.
2. Trace changed behavior through callers, data boundaries, failure paths, and compatibility expectations.
3. Check correctness, security, concurrency, error handling, resource use, and whether tests cover the intended behavior.
4. Validate suspicious issues with focused tests or reproducible evidence where practical; distinguish confirmed findings from risks or questions.
5. Report findings first, ordered by severity. Each finding should give severity, file and line, concrete impact, and a concise reproduction or condition.
6. If no actionable issue is found, state that clearly and note any important unverified areas.

## Boundaries

- Do not modify files during a review unless the user separately asks for fixes.
- Do not report speculative concerns as confirmed bugs.
- Do not bury high-impact findings under formatting or naming suggestions.
- Avoid duplicating a finding or prescribing a large redesign when a small correction resolves it.
