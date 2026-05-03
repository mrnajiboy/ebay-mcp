# eBay MCP Server — Patch Proposal: Fix ebay_create_listing XML Generation

## Problem

`ebay_create_listing` fails with either:
- "Input data is invalid" (MCP schema validation rejects flat fields)
- "Schema XML request error" (fast-xml-parser generates invalid XML from nested objects)

Root cause: The tool uses `z.record(z.string(), z.unknown())` which accepts any input but doesn't validate structure. When the input reaches `client-trading.ts`, it's passed directly to `fast-xml-parser`'s XMLBuilder, which doesn't properly handle eBay Trading API's nested XML structure requirements.

## Files to Change

1. `src/tools/definitions/trading.ts` — Add proper input schema
2. `src/api/client-trading.ts` — Fix XML generation for Trading API
3. `src/api/trading/trading.ts` — Add item transformation logic

## Proposed Patch

### 1. Add Input Schema (src/tools/definitions/trading.ts)

```typescript
// Replace:
item: z.record(z.string(), z.unknown()).describe('Item details object...')

// With:
item: z.object({
  Title: z.string(),
  PrimaryCategory: z.object({ CategoryID: z.string() }),
  StartPrice: z.object({ value: z.string(), currencyID: z.string() }).or(z.string()),
  ConditionID: z.number().or(z.string()),
  Country: z.string(),
  Currency: z.string(),
  DispatchTimeMax: z.number().or(z.string()),
  ListingDuration: z.string(),
  ListingType: z.literal('FixedPriceItem'),
  Quantity: z.number().or(z.string()),
  SKU: z.string(),
  // Optional fields
  Subtitle: z.string().optional(),
  Description: z.string().optional(),
  PicturesDetails: z.object({
    GalleryType: z.string().optional(),
    PictureURL: z.array(z.string()),
  }).optional(),
  ShippingDetails: z.object({
    ShippingServiceOptions: z.object({
      ShippingServicePriority: z.string().optional(),
      ShippingServiceID: z.string(),
      ShippingServiceCost: z.object({ value: z.string(), currencyID: z.string() }).or(z.string()),
      ShippingType: z.string(),
    }),
  }).optional(),
  ReturnPolicy: z.object({
    ReturnsAcceptedOption: z.string(),
    ReturnsWithinOption: z.string(),
    Description: z.string(),
  }).optional(),
}).describe('Trading API item object with eBay-specific field structure.')
```

### 2. Fix XML Generation (src/api/client-trading.ts)

The XMLBuilder from fast-xml-parser needs explicit structure hints. Add a transform function:

```typescript
private transformItemForXML(item: Record<string, unknown>): Record<string, unknown> {
  const transformed: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(item)) {
    if (key === 'PrimaryCategory' && typeof value === 'object') {
      // Ensure nested structure
      transformed[key] = { CategoryID: (value as any).CategoryID };
    } else if (key === 'StartPrice' && typeof value === 'object') {
      // StartPrice needs currencyID as attribute
      const sp = value as { value: string; currencyID?: string };
      transformed[key] = {
        '#text': sp.value,
        '@_currencyID': sp.currencyID || 'USD',
      };
    } else if (key === 'ShippingDetails' && typeof value === 'object') {
      // Shipping details need proper nesting
      transformed[key] = this.transformShippingDetails(value as any);
    } else {
      transformed[key] = value;
    }
  }
  
  return transformed;
}

private transformShippingDetails(sd: any): Record<string, unknown> {
  const options = sd.ShippingServiceOptions || {};
  return {
    ShippingServiceOptions: {
      ...(options.ShippingServicePriority && { ShippingServicePriority: options.ShippingServicePriority }),
      ShippingServiceID: options.ShippingServiceID,
      ShippingServiceCost: typeof options.ShippingServiceCost === 'string' 
        ? options.ShippingServiceCost 
        : { '#text': options.ShippingServiceCost.value, '@_currencyID': options.ShippingServiceCost.currencyID || 'USD' },
      ShippingType: options.ShippingType,
    },
  };
}
```

### 3. Update execute() to use transform (src/api/client-trading.ts)

```typescript
// In createListing():
async createListing(item: Record<string, unknown>): Promise<Record<string, unknown>> {
  const transformed = this.transformItemForXML(item);
  return await this.client.execute('AddFixedPriceItem', { Item: transformed });
}
```

## Alternative: Skip Trading API for New Listings

Since the eBay Catalog API (`ebay_create_inventory_item`) works perfectly, consider:

1. **Deprecate ebay_create_listing** — mark as deprecated, recommend Catalog API + offers
2. **Add ebay_create_offer with policy setup** — guide users through Business Policy setup
3. **Document direct API fallback** — provide curl examples for Trading API (see ebay-direct-api skill)

## Testing

After patch, test with:
```bash
# 1. Create inventory item (should work)
ebay_create_inventory_item({ sku: "HE-TEST", inventoryItem: {...} })

# 2. Create listing (should now work)
ebay_create_listing({ item: {
  Title: "Test Album",
  PrimaryCategory: { CategoryID: "15032" },
  StartPrice: { value: "34.99", currencyID: "USD" },
  ConditionID: 1000,
  Country: "US",
  Currency: "USD",
  DispatchTimeMax: 3,
  ListingDuration: "GMS",
  ListingType: "FixedPriceItem",
  Quantity: 1,
  SKU: "HE-TEST"
}})
```

## Related

- Backlog: TASK-MCP.1 (Fix ebay_create-listing-XML-generation)
- Subtasks: TASK-MCP.1.1 (input schema), TASK-MCP.1.2 (XML generation fix)
- Fallback skill: ebay-direct-api (direct curl examples)
