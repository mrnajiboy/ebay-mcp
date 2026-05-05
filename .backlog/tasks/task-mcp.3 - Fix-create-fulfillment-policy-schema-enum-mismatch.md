---
id: TASK-MCP.3
title: Fix create_fulfillment_policy schema enum mismatch
status: To Do
assignee: []
created_date: '2026-05-05'
updated_date: '2026-05-05'
labels: [bug, high]
dependencies: []
parent_task_id: null
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`ebay_create_fulfillment_policy` fails with "Invalid handlingTime.unit enum". This is a schema issue — the Zod schema uses incorrect enum values for `handlingTime.unit`. The API works (shipping policy creation was tested successfully), the schema just needs correction.

Per Naji review: This is NOT a "Business Policy not available" issue. Our account is enrolled, the API endpoint works, it's purely a schema mismatch.
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
