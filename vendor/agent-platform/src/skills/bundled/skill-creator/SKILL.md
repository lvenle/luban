---
name: skill-creator
description: Create, improve, validate, and package portable Agent Skills using the open SKILL.md convention.
---

# Skill Creator

Use this skill when a user asks to create a reusable skill, improve an existing skill package, or make a skill portable across agent platforms.

## Workflow

1. Clarify the skill's intended user, task, trigger conditions, expected result, and important safety limits. Ask only questions that materially affect the package.
2. Inspect the current project or skill package before editing. Preserve useful existing instructions, examples, scripts, and references.
3. Write a concise `SKILL.md` with YAML frontmatter containing a stable lowercase `name` and a specific `description`. The description should state both what the skill does and when it should be used.
4. Put procedural instructions in the Markdown body. Prefer actionable steps, decision points, constraints, and verification criteria over generic advice.
5. Add optional `scripts/`, `references/`, and `assets/` only when they materially help. Keep the entrypoint focused; move long reference material into files and link to those files using relative paths.
6. Do not require a platform-specific `contract.json`, proprietary metadata, fixed tool names, or undeclared runtime capabilities. Describe the desired operation and let the host Agent use capabilities it actually exposes. If a script is included, document its purpose, inputs, dependencies, and safe invocation; never assume it is executable or automatically run.
7. Do not include secrets, machine-specific paths, generated caches, or unrelated files. Keep scripts deterministic, narrowly scoped, and safe; avoid destructive actions unless the user explicitly requests them and the host authorizes them.
8. Validate the frontmatter, package paths, relative links, examples, and any script syntax using available tools. Do not claim to have executed a script unless it actually ran successfully.
9. Summarize the package contents, trigger description, assumptions, and validation performed. Keep the skill portable and deliver it as a complete directory or ZIP when requested.

## Package checklist

- `SKILL.md` exists at the package root.
- Frontmatter `name` matches the package identity and `description` is concise and discriminative.
- Instructions explain when to use the skill, the workflow, edge cases, and how to verify the result.
- Referenced files exist and paths remain inside the package.
- No platform-specific tool contract or undocumented permission is required.
- Optional scripts are not treated as trusted merely because they ship with the skill.
