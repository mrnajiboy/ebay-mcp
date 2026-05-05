import { z } from 'zod';
import type { ToolDefinition } from '../tool-definitions.js';

export const browseTools: ToolDefinition[] = [
  {
    name: 'ebay_get_suggestions',
    description:
      'Get listing/product suggestions based on search query. Returns relevant item summaries with pricing and shipping info from the eBay Browse API.',
    inputSchema: {
      query: z.string().describe('Search query for product suggestions'),
      marketplaceId: z
        .string()
        .default('EBAY_US')
        .describe('Marketplace ID (default: EBAY_US)'),
      limit: z.number().default(20).describe('Number of suggestions to return (default: 20)'),
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'object' },
      },
    },
    annotations: {
      title: 'Get Suggestions',
      readOnlyHint: true,
    },
    _meta: {
      category: 'browse',
      version: '1.0.0',
    },
  },
  {
    name: 'ebay_search_products',
    description:
      'Search the eBay product catalog by query. Supports category filtering, sorting, and price filtering. Uses the eBay Browse API.',
    inputSchema: {
      query: z.string().describe('Search query for products'),
      marketplaceId: z.string().describe('Marketplace ID (e.g., EBAY_US)'),
      categoryId: z.string().optional().describe('Filter by category ID'),
      limit: z.number().default(20).describe('Results to return (1-200, default: 20)'),
      sort: z
        .enum(['bestMatch', 'newlyListed'])
        .optional()
        .describe('Sort order (default: bestMatch)'),
      filter: z
        .string()
        .optional()
        .describe('Filter expression (e.g., price:[300..800],priceCurrency:USD)'),
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'object' },
      },
    },
    annotations: {
      title: 'Search Products',
      readOnlyHint: true,
    },
    _meta: {
      category: 'browse',
      version: '1.0.0',
    },
  },
  {
    name: 'ebay_get_item_specifics',
    description:
      'Get required and optional item specifics (aspects) for a given category. Use this to understand what fields are needed for listing in a category. This is an alias to ebay_get_item_aspects_for_category.',
    inputSchema: {
      categoryTreeId: z.string().describe('Category tree ID'),
      categoryId: z.string().describe('Category ID'),
    },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'object' },
      },
    },
    annotations: {
      title: 'Get Item Specifics',
      readOnlyHint: true,
    },
    _meta: {
      category: 'browse',
      version: '1.0.0',
    },
  },
];
