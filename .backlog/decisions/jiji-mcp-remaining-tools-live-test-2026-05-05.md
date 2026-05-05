# JiJi MCP Remaining Tools Live Test — 2026-05-05

## Summary

JiJi executed live dummy-data testing for the remaining eBay MCP listing/offer tools requested before n8n sync. The hosted MCP tool wrapper timed out from JiJi's runtime, so the underlying eBay API behavior was isolated using the Upstash Redis source-of-truth OAuth token and direct eBay API calls. No credential values were printed or documented.

Test time: 2026-05-05 22:00 KST
Tester: JiJi
Marketplace: EBAY_US
Inventory location used: `seoul-warehouse` with country `KR`
Business policies used:
- Fulfillment policy: `259198453013`
- Payment policy: `259198675013`
- Return policy: `259198703013`

## Important Transport Finding

The configured MCP tool calls from JiJi timed out:
- `ebay_get_token_status` -> `TimeoutError`
- `ebay_get_user` -> `TimeoutError`
- `ebay_get_inventory_items` -> `TimeoutError`

Because direct eBay API calls succeeded with the same source-of-truth token, the likely issue is in the hosted MCP wrapper/transport/session path, not eBay OAuth itself.

## Dummy Data Created

Two Inventory API dummy offer/listing flows were created to test publish/end and publish/withdraw/delete paths.

Created offers:
- `161546272011` for SKU `HEMCP05052152PUBEND`
- `161546284011` for SKU `HEMCP05052152PUBWD`

Published listings:
- `178107350213`
- `178107350302`

Cleanup completed:
- Listing `178107350213` ended successfully via Trading API `EndFixedPriceItem`
- Listing `178107350302` withdrawn successfully via Inventory API offer withdraw
- Offer `161546284011` deleted successfully
- Offer `161546272011` deleted successfully after ending listing

No dummy live listing was intentionally left active.

## Tool Results

### `ebay_publish_offer`

Result: PASS, with category-specific required aspects.

First attempt failed with eBay validation:

```text
The item specific Release Title is missing. Add Release Title to this listing, enter a valid value, and then try again.
```

After updating inventory item product aspects to include:
- `Release Title`
- `Artist`
- `Format`
- `Genre`
- `Type`

Publishing succeeded:
- SKU `HEMCP05052152PUBEND` -> listing `178107350213`
- SKU `HEMCP05052152PUBWD` -> listing `178107350302`

Conclusion: TASK-MCP.7's XML transform fix appears functionally valid. Remaining publish blockers are normal eBay category-required item specifics and should be handled through taxonomy/aspects validation before publishing.

### `ebay_get_offer`

Result: PASS.

Direct offer retrieval by offerId returned offer details successfully:
- `161546272011` -> SKU `HEMCP05052152PUBEND`
- `161546284011` -> SKU `HEMCP05052152PUBWD`

### `ebay_get_offers`

Result: PARTIAL PASS.

Findings:
- Query by SKU works: `/sell/inventory/v1/offer?sku=<SKU>&limit=10`
- Query without SKU fails for this account/tool path with:

```text
This is an invalid value for a SKU. Only alphanumeric characters can be used for SKUs, and their length must not exceed 50 characters
```

Recommendation: update MCP schema/docs so `get_offers` either requires `sku` for our operating path, or implement a true all-offers listing strategy if eBay supports it under different parameters. Current behavior should not be treated as a generic list-all tool.

### `ebay_withdraw_offer`

Result: PASS.

Offer `161546284011` was withdrawn successfully after publishing listing `178107350302`.

### `ebay_delete_offer`

Result: PASS.

Deleted offers successfully:
- `161546284011` after withdraw
- `161546272011` after ending its listing

### `ebay_get_active_listings`

Result: PASS.

Trading API `GetMyeBaySelling` returned success. After publish, active listings were visible and contained the expected listing IDs.

Before publish: active listings clean slate / zero.
After publish: active listings included the dummy listing.

### `ebay_get_listing`

Result: PASS.

Trading API `GetItem` returned `Ack=Success` for:
- `178107350213`
- `178107350302`

### `ebay_revise_listing`

Result: FAIL for Inventory API listings; current MCP tool is the wrong API path.

Trading API `ReviseFixedPriceItem` returned:

```text
Inventory-based listing management is not currently supported by this tool. Please refer to the tool used to create this listing.
```

Conclusion: This is not an XML transform bug. Listings created through Inventory API offers cannot be revised through Trading API `ReviseFixedPriceItem`. For Hankuk Expo's modern Inventory API flow, revise/update should happen via:
- `update_offer` for offer-level fields such as price, quantity, policies, listing description
- `createOrReplaceInventoryItem` or a dedicated update inventory tool for inventory/product data
- possibly `bulk_update_price_quantity` for price/quantity changes

Recommendation: add a new backlog task for an Inventory API-compatible revise/update listing tool, or explicitly document that `ebay_revise_listing` is only for Trading API-created fixed-price listings.

### `ebay_end_listing`

Result: PASS.

Trading API `EndFixedPriceItem` successfully ended dummy listing `178107350213`.

## Follow-up Tests Still Recommended

These are safe/valuable before n8n sync:

1. Hosted MCP transport/session timeout debugging
   - Confirm whether timeouts are agent-runtime-specific or server-wide.
   - Test with raw MCP HTTP client using session token if available.

2. Inventory-native revise/update flow
   - Test `ebay_update_offer` on an unpublished and/or published Inventory API offer.
   - Test `ebay_bulk_update_price_quantity` for price/quantity operations.
   - Test existing create/replace inventory item as an update path.

3. Taxonomy/aspects preflight
   - For category `176984` Music > CDs, retrieve required item aspects and ensure publish payload contains them.
   - This would prevent the `Release Title` publish failure in n8n.

4. Cleanup verification
   - Re-run active listings after cleanup and ensure no dummy live listings remain.

## Backlog Implications

- TASK-MCP.7 should remain Done, with a validation note: publish works after required category aspects are present.
- Create/update a task for `get_offers` no-SKU behavior.
- Create/update a task for Inventory API-compatible revise/update listing behavior.
- TASK-MCP.10 should be expanded: operationally, this is also the path for revising Inventory API listings.
- Add a task for hosted MCP wrapper timeouts from JiJi runtime.
