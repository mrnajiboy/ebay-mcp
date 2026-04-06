import { describe, expect, it } from 'vitest';
import { validationRunRequestSchema } from '@/validation/schemas.js';
import type { ValidationRunRequest } from '@/validation/types.js';
import {
  buildResolvedBrowseQueryPlan,
  buildResolvedRedditQueryPlan,
  buildResolvedSoldQueryPlan,
  buildResolvedTwitterQueryPlan,
  buildResolvedValidationQueryPlan,
  buildResolvedYouTubeQueryPlan,
} from '@/validation/providers/query-utils.js';

function createRequest(
  queryContext: ValidationRunRequest['validation']['queryContext']
): ValidationRunRequest {
  return {
    validationId: 'val_123',
    runType: 'manual',
    cadence: 'Off',
    timestamp: '2026-04-06T00:00:00.000Z',
    item: {
      recordId: 'rec_123',
      name: 'BTS ARIRANG Limited Album',
      variation: ['Limited'],
      itemType: ['Album'],
      releaseType: ['Album'],
      releaseDate: null,
      releasePeriod: [],
      availability: [],
      wholesalePrice: null,
      supplierNames: [],
      canonicalArtists: ['BTS'],
      relatedAlbums: ['ARIRANG'],
    },
    validation: {
      validationType: 'Album Validation',
      buyDecision: 'Hold',
      automationStatus: 'Manual',
      autoCheckEnabled: false,
      dDay: null,
      artistTier: 'A',
      initialBudget: null,
      reserveBudget: null,
      queryContext,
      currentMetrics: {
        avgWatchersPerListing: null,
        preOrderListingsCount: null,
        twitterTrending: false,
        youtubeViews24hMillions: null,
        redditPostsCount7d: null,
        marketPriceUsd: null,
        avgShippingCostUsd: null,
        competitionLevel: null,
        marketPriceTrend: 'Stable',
        day1Sold: null,
        day2Sold: null,
        day3Sold: null,
        day4Sold: null,
        day5Sold: null,
        daysTracked: null,
      },
    },
  };
}

describe('resolved validation query plans', () => {
  it('keeps Direct Query overrides exclusive across providers', () => {
    const request = createRequest({
      directQueryActive: true,
      queryScope: 'Direct Query',
      resolvedSearchQuery: 'test',
    });

    const resolvedPlans = [
      buildResolvedBrowseQueryPlan(request),
      buildResolvedSoldQueryPlan(request),
      buildResolvedTwitterQueryPlan(request),
      buildResolvedYouTubeQueryPlan(request),
      buildResolvedRedditQueryPlan(request),
      buildResolvedValidationQueryPlan(request),
    ];

    for (const plan of resolvedPlans) {
      expect(plan.queryPlan).toEqual([{ family: 'resolved_query_context', query: 'test' }]);
    }
  });

  it('still prepends fallback candidates when the resolved query is not an exclusive direct override', () => {
    const request = createRequest({
      directQueryActive: false,
      queryScope: 'Album Query',
      resolvedSearchQuery: 'test',
    });

    const plan = buildResolvedBrowseQueryPlan(request);

    expect(plan.queryPlan[0]).toEqual({ family: 'resolved_query_context', query: 'test' });
    expect(plan.queryPlan.length).toBeGreaterThan(1);
    expect(plan.queryPlan.some((candidate) => candidate.family !== 'resolved_query_context')).toBe(
      true
    );
  });
});

describe('validation query context schema', () => {
  it('accepts directQueryActive in the request payload', () => {
    const parsed = validationRunRequestSchema.parse(
      createRequest({
        directQueryActive: true,
        queryScope: 'Direct Query',
        resolvedSearchQuery: 'test',
      })
    );

    expect(parsed.validation.queryContext?.directQueryActive).toBe(true);
  });
});
