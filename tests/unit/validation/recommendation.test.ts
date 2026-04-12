import { describe, expect, it } from 'vitest';
import { buildValidationEffectiveContext } from '../../../src/validation/effective-context.js';
import { buildValidationRecommendation } from '../../../src/validation/recommendation.js';
import type {
  ChartValidationSignals,
  EbaySoldValidationSignals,
  EbayValidationSignals,
  PreviousComebackResearchSignals,
  SocialValidationSignals,
  TerapeakValidationSignals,
  ValidationRunRequest,
} from '../../../src/validation/types.js';

function buildRequest(overrides?: Partial<ValidationRunRequest>): ValidationRunRequest {
  return {
    validationId: 'val-1',
    runType: 'manual',
    cadence: 'Daily',
    timestamp: '2026-04-12T00:00:00.000Z',
    sourceContext: {
      sourceType: 'item',
      hasItem: true,
      hasEvent: false,
      itemRecordId: 'rec-item',
      eventRecordId: null,
    },
    item: {
      recordId: 'rec-item',
      name: 'ATEEZ GOLDEN HOUR',
      variation: [],
      itemType: ['Album'],
      releaseType: ['Album'],
      releaseDate: '2026-04-20',
      releasePeriod: [],
      availability: [],
      wholesalePrice: 10,
      supplierNames: [],
      canonicalArtists: ['ATEEZ'],
      relatedAlbums: ['GOLDEN HOUR'],
    },
    validation: {
      validationType: 'Standard Album',
      buyDecision: 'Watching',
      automationStatus: 'Watching',
      autoCheckEnabled: true,
      dDay: 0,
      artistTier: 'A',
      initialBudget: null,
      reserveBudget: null,
      queryContext: {
        validationScope: 'album',
        queryScope: 'artist album',
        resolvedSearchQuery: null,
      },
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
    ...overrides,
  };
}

function buildSignals(request: ValidationRunRequest): {
  ebay: EbayValidationSignals;
  sold: EbaySoldValidationSignals;
  terapeak: TerapeakValidationSignals;
  social: SocialValidationSignals;
  chart: ChartValidationSignals;
  research: PreviousComebackResearchSignals;
  effectiveContext: ReturnType<typeof buildValidationEffectiveContext>;
} {
  return {
    ebay: {
      avgWatchersPerListing: null,
      preOrderListingsCount: null,
      marketPriceUsd: null,
      avgShippingCostUsd: null,
      competitionLevel: null,
      marketPriceTrend: 'Stable',
      ebayQuery: 'ATEEZ GOLDEN HOUR',
      sampleSize: 0,
      soldVelocity: {
        day1Sold: null,
        day2Sold: null,
        day3Sold: null,
        day4Sold: null,
        day5Sold: null,
        daysTracked: null,
      },
    },
    sold: {
      provider: 'ebay_sold',
      confidence: 'Low',
      soldResultsCount: null,
      soldAveragePriceUsd: null,
      soldMedianPriceUsd: null,
      soldMinPriceUsd: null,
      soldMaxPriceUsd: null,
      soldItemsSample: [],
      soldVelocity: {
        day1Sold: null,
        day2Sold: null,
        day3Sold: null,
        day4Sold: null,
        day5Sold: null,
        daysTracked: null,
      },
      recentSoldCount7d: null,
      query: null,
      responseUrl: null,
      status: 'unavailable',
    },
    terapeak: {
      avgWatchersPerListing: null,
      preOrderListingsCount: null,
      marketPriceUsd: null,
      researchSoldPriceUsd: null,
      avgShippingCostUsd: null,
      competitionLevel: null,
      previousPobAvgPriceUsd: null,
      previousPobSellThroughPct: null,
      currentListingsCount: null,
      soldListingsCount: null,
      soldVelocity: {
        day1Sold: null,
        day2Sold: null,
        day3Sold: null,
        day4Sold: null,
        day5Sold: null,
        daysTracked: null,
      },
      recentSoldCount7d: null,
      soldBucketDebug: undefined,
      provider: 'none',
      confidence: 'Low',
      queryDebug: {},
    },
    social: {
      twitterTrending: null,
      youtubeViews24hMillions: null,
      redditPostsCount7d: null,
    },
    chart: {
      chartMomentum: null,
    },
    research: {
      previousAlbumTitle: null,
      previousComebackFirstWeekSales: null,
      confidence: 'Low',
      notes: 'test',
      sources: [],
    },
    effectiveContext: buildValidationEffectiveContext(request),
  };
}

describe('buildValidationRecommendation()', () => {
  it('pauses tracking when the resolver query is an error and no fallback tracking query exists', () => {
    const request = buildRequest({
      item: {
        recordId: 'rec-item',
        name: '',
        variation: [],
        itemType: [],
        releaseType: [],
        releaseDate: null,
        releasePeriod: [],
        availability: [],
        wholesalePrice: null,
        supplierNames: [],
        canonicalArtists: [],
        relatedAlbums: [],
      },
      validation: {
        ...buildRequest().validation,
        queryContext: {
          validationScope: 'album',
          queryScope: 'artist album',
          resolvedSearchQuery: 'Error: upstream resolver failed',
        },
      },
    });

    const recommendation = buildValidationRecommendation(request, buildSignals(request));

    expect(recommendation.shouldAutoTrack).toBe(false);
    expect(recommendation.automationStatus).toBe('Paused');
    expect(recommendation.trackingCadence).toBe('Off');
    expect(recommendation.monitoringNotes).toContain('no valid search query');
  });

  it('keeps tracking enabled when a resolver error exists but a fallback item query can still be derived', () => {
    const request = buildRequest({
      validation: {
        ...buildRequest().validation,
        queryContext: {
          validationScope: 'album',
          queryScope: 'artist album',
          resolvedSearchQuery: 'Error: upstream resolver failed',
        },
      },
    });

    const recommendation = buildValidationRecommendation(request, buildSignals(request));

    expect(recommendation.shouldAutoTrack).toBe(true);
    expect(recommendation.automationStatus).toBe('Watching');
    expect(recommendation.trackingCadence).toBe('Hourly');
  });

  it('treats authenticated research sold fallbacks as valid sold demand evidence', () => {
    const request = buildRequest();
    const signals = buildSignals(request);

    signals.terapeak = {
      ...signals.terapeak,
      marketPriceUsd: 24,
      soldListingsCount: 9,
      soldVelocity: {
        day1Sold: 2,
        day2Sold: 1,
        day3Sold: 1,
        day4Sold: 0,
        day5Sold: 0,
        daysTracked: 5,
      },
      recentSoldCount7d: 4,
      provider: 'ebay_research_ui',
      confidence: 'Medium',
      researchSoldPriceUsd: 24,
      queryDebug: {},
    };

    const recommendation = buildValidationRecommendation(request, signals);

    expect(recommendation.latestAiRecommendation).toContain('Recent sold comparables support real resale demand');
    expect(recommendation.latestAiConfidence).toBe('Medium');
    expect(recommendation.monitoringNotes).toContain('Sold-item data confirms recent transaction activity');
  });

  it('does not treat active-only research pricing as a sold comparable', () => {
    const request = buildRequest();
    const signals = buildSignals(request);

    signals.terapeak = {
      ...signals.terapeak,
      marketPriceUsd: 24,
      soldListingsCount: 9,
      soldVelocity: {
        day1Sold: 2,
        day2Sold: 1,
        day3Sold: 1,
        day4Sold: 0,
        day5Sold: 0,
        daysTracked: 5,
      },
      recentSoldCount7d: 4,
      provider: 'ebay_research_ui',
      confidence: 'Medium',
      researchSoldPriceUsd: null,
      queryDebug: {},
    };

    const recommendation = buildValidationRecommendation(request, signals);

    expect(recommendation.latestAiRecommendation).toBe(
      'Continue watching until stronger market signal appears.'
    );
    expect(recommendation.monitoringNotes).not.toContain('Sold-item data confirms recent transaction activity');
  });
});
