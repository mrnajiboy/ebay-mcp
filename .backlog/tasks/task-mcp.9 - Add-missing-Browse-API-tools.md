---
id: TASK-MCP.9
title: Add missing Browse API tools
status: To Do
assignee: []
created_date: '2026-05-05'
updated_date: '2026-05-05'
labels: [feature]
dependencies: []
parent_task_id: null
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per Naji review: Add these missing MCP endpoints based on eBay Browse API reference:

- `ebay_get_suggestions` — Get listing/product suggestions
- `ebay_search_products` — Search product catalog
- `ebay_get_item_specifics` — Get required/optional item specifics for categories

These tools don't exist in current MCP build. Feature requests based on eBay API reference.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- SECTION:ACCEPTANCE:BEGIN -->
- All three tools registered and functional
- Zod schemas match eBay Browse API reference
- Tools return structured data usable for listing creation and validation
<!-- SECTION:ACCEPTANCE:END -->

## Priority

<!-- SECTION:PRIORITY:BEGIN -->
Feature request — prioritize based on operational need
<!-- SECTION:PRIORITY:END -->
