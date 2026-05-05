---
id: TASK-MCP.3
title: Fix create_fulfillment_policy schema enum mismatch
status: Done
assignee:
  - '@Bruno'
created_date: '2026-05-05'
updated_date: '2026-05-05 14:35'
labels: [bug, high]
dependencies: []
parent_task_id: null
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`ebay_create_fulfillment_policy` fails with "Invalid handlingTime.unit enum". This is a schema issue — the Zod schema uses `z.nativeEnum(TimeDurationUnit)` which rejects inputs like "day" or "days" before the handler can normalize them. The handler already has `normalizeTimeUnit()` but Zod validates first.

Fix: Changed `timeDurationSchema.unit` from `z.nativeEnum(TimeDurationUnit)` to `z.string()`. Handler normalizes to valid enum before API call.

Commit: `ad1cd87`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- `ebay_create_fulfillment_policy` accepts valid `handlingTime.unit` values per eBay API reference
- Fulfillment policy creation succeeds with correct enum values
- Schema validation matches eBay Commerce API spec
<!-- SECTION:ACCEPTANCE:END -->

## Priority

<!-- SECTION:PRIORITY:BEGIN -->
High
<!-- SECTION:PRIORITY:END -->
