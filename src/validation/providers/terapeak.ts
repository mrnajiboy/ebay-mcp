import type { EbaySellerApi } from '@/api/index.js';
import type { TerapeakValidationSignals, ValidationRunRequest } from '../types.js';
import { buildResolvedValidationQueryPlan } from './query-utils.js';

export async function getTerapeakValidationSignals(
  _api: EbaySellerApi,
  request: ValidationRunRequest
): Promise<TerapeakValidationSignals> {
  await Promise.resolve();

  const { queryPlan, queryResolution } = buildResolvedValidationQueryPlan(request);
  const queryCandidates = queryPlan.map((candidate) => candidate.query);
  const currentQuery = queryCandidates[0] ?? null;
  const previousPobQuery = queryCandidates[1] ?? null;

  return {
    avgWatchersPerListing: null,
    preOrderListingsCount: null,
    marketPriceUsd: null,
    avgShippingCostUsd: null,
    competitionLevel: null,
    previousPobAvgPriceUsd: null,
    previousPobSellThroughPct: null,
    currentListingsCount: null,
    soldListingsCount: null,
    provider: 'none',
    confidence: 'Low',
    queryDebug: {
      currentQuery,
      previousPobQuery,
      selectedMode: 'combined',
      currentResultCount: null,
      previousPobResultCount: null,
      queryResolution,
      notes:
        'Terapeak/eBay research provider contract is in place, but live authenticated research retrieval is not implemented yet.',
    },
  };
}
