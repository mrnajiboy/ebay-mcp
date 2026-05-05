import { getBaseUrl } from '@/config/environment.js';
import type { EbayApiClient } from '@/api/client.js';

export interface BrowseItemSummary {
  title?: string;
  price?: { value?: string };
  shippingOptions?: { shippingCost?: { value?: string } }[];
}

export interface BrowseSearchResponse {
  total?: number;
  itemSummaries?: BrowseItemSummary[];
}

/**
 * Browse API - Search and browse eBay product catalog
 * Based on: eBay Buy Browse API
 * Base endpoint: /buy/browse/v1
 */
export class BrowseApi {
  constructor(private client: EbayApiClient) {}

  /**
   * Search the eBay product catalog by query.
   * Supports category filtering, sorting, and price filtering.
   */
  async searchProducts(
    query: string,
    options?: {
      marketplaceId?: string;
      categoryId?: string;
      limit?: number;
      sort?: string;
      filter?: string;
      aspectFilter?: string;
    }
  ): Promise<BrowseSearchResponse> {
    const environment = this.client.getConfig().environment;
    const browseUrl = new URL(
      '/buy/browse/v1/item_summary/search',
      getBaseUrl(environment)
    ).toString();

    const params: Record<string, string | number> = { q: query };
    if (options?.categoryId) params.category_ids = options.categoryId;
    if (options?.limit) params.limit = options.limit;
    if (options?.sort) params.sort = options.sort;
    if (options?.filter) params.filter = options.filter;
    if (options?.aspectFilter) params.aspect_filter = options.aspectFilter;

    return await this.client.getWithFullUrl<BrowseSearchResponse>(browseUrl, params);
  }

  /**
   * Get listing/product suggestions based on search query.
   * Returns relevant item summaries with pricing and shipping info.
   */
  async getSuggestions(
    query: string,
    options?: {
      marketplaceId?: string;
      limit?: number;
    }
  ): Promise<BrowseSearchResponse> {
    return await this.searchProducts(query, {
      marketplaceId: options?.marketplaceId,
      limit: options?.limit ?? 20,
      sort: 'bestMatch',
    });
  }
}
