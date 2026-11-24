---
name: spreadsheet-analysis
version: v1.0
description: Analyze, validate, transform, and create spreadsheets; use for Excel and delimited-data tasks involving formulas, tables, or charts.
---

# Spreadsheet Analysis

## Workflow

1. Identify the file, sheets, relevant ranges, intended question, units, and whether formulas or displayed values are authoritative.
2. Inspect workbook dimensions, headers, data types, formulas, hidden content, merged cells, filters, and representative rows before analysis.
3. Validate assumptions: missing values, duplicates, inconsistent units, date formats, outliers, and formula errors.
4. Calculate from observed data. Explain transformations and formulas; preserve source values and workbook structure where possible.
5. For edits, work on a copy unless overwrite is explicitly authorized. Preserve formulas, styles, validations, named ranges, and charts that remain relevant.
6. Reopen or recalculate the output where possible; verify key cells, totals, formulas, and chart references. Summarize findings and caveats.

## Boundaries

- Never fabricate values or present estimates as source data.
- Do not replace formulas with static values unless requested.
- Treat macros and external links as untrusted; do not execute them without authorization.
- For large workbooks, narrow analysis to relevant sheets and ranges and state the scope.
