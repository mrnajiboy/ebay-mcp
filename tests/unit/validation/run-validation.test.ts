import { beforeEach, describe, expect, it, vi } from 'vitest';

const getEbayValidationSignalsMock = vi.fn();
const getEbaySoldValidationSignalsMock = vi.fn();
const getTerapeakValidationSignalsMock = vi.fn();
const getSocialValidationSignalsMock = vi.fn();
const getChartValidationSignalsMock = vi.fn();
const getPreviousComebackResearchSignalsMock = vi.fn();

vi.mock('@/validation/providers/ebay.js', () => ({
  getEbayValidationSignals: getEbayValidationSignalsMock,
}));

vi.mock('@/validation/providers/ebay-sold.js', () => ({
  getEbaySoldValidationSignals: getEbaySoldValidationSignalsMock,
}));

vi.mock('@/validation/providers/terapeak.js', () => ({
  getTerapeakValidationSignals: getTerapeakValidationSignalsMock,
}));

vi.mock('@/validation/providers/social.js', () => ({
  getSocialValidationSignals: getSocialValidationSignalsMock,
}));

vi.mock('@/validation/providers/chart.js', () => ({
  getChartValidationSignals: getChartValidationSignalsMock,
}));

vi.mock('@/validation/providers/research.js', () => ({
  getPreviousComebackResearchSignals: getPreviousComebackResearchSignalsMock,
}));

describe('runValidation()', () => {
  beforeEach(() => {
    vi.resetModules();
    getEbayValidationSignalsMock.mockReset();
    getEbaySoldValidationSignalsMock.mockReset();
    getTerapeakValidationSignalsMock.mockReset();
    getSocialValidationSignalsMock.mockReset();
    getChartValidationSignalsMock.mockReset();
    getPreviousComebackResearchSignalsMock.mockReset();
  });

  it('prefers sold-provider sold velocity over research zero buckets', async () => {
    const { runValidation } = await import('../../../src/validation/run-validation.js');
 
    getEbayValidationSignalsMock.mockResolvedValue({
avgWatchersPerListing: null,
      preOrderListingsCount: null,
      marketPriceUsd: null,
      avgShippingCostUsd: null,
      competitionLevel: null,
      marketPriceTrend: 'Stable',
      ebayQuery: 'ATEEZ GOLDEN HOUR',
      queryCandidates: ['ATEEZ GOLDEN HOUR'],
      selectedQuery: 'ATEEZ GOLDEN HOUR',
      selectedQueryTier: 1,
      queryDiagnostics: [],
      selectionReason: 'test',
      errorMessage: undefined,
      responseStatus: 200,
      responseBodyExcerpt: null,
      sampleSize: 1,
      soldVelocity: {
        day1Sold: null,
        day2Sold: null,
        day3Sold: null,
        day4Sold: null,
        day5Sold: null,
        daysTracked: null,
      },
      queryResolution: {
        queryContextUsed: false,
        querySource: 'provider_fallback',
        resolvedSearchQuery: null,
        validationScope: 'album',
        queryScope: 'artist album',
      },
    });

    getEbaySoldValidationSignalsMock.mockResolvedValue({
      provider: 'ebay_sold',
      confidence: 'High',
      soldResultsCount: 8,
      soldAveragePriceUsd: 21,
      soldMedianPriceUsd: 20,
      soldMinPriceUsd: 18,
      soldMaxPriceUsd: 24,
      soldItemsSample: [],
      soldVelocity: {
        day1Sold: 3,
        day2Sold: 2,
        day3Sold: 1,
        day4Sold: 0,
        day5Sold: 0,
        daysTracked: 5,
      },
      recentSoldCount7d: 6,
      soldBucketDebug: undefined,
      query: 'ATEEZ GOLDEN HOUR',
      queryCandidates: ['ATEEZ GOLDEN HOUR'],
      queryDiagnostics: [],
      selectedQuery: 'ATEEZ GOLDEN HOUR',
      selectedQueryTier: 1,
      selectedQueryFamily: 'artist_album_core',
      broadAlbumQuery: null,
      subtypeSpecificQuery: null,
      querySelectionReason: 'test',
      responseUrl: 'https://example.test/sold',
      status: 'ok',
      errorMessage: undefined,
      queryResolution: {
        queryContextUsed: false,
        querySource: 'provider_fallback',
        resolvedSearchQuery: null,
        validationScope: 'album',
        queryScope: 'artist album',
      },
    });

    getTerapeakValidationSignalsMock.mockResolvedValue({
      avgWatchersPerListing: null,
      preOrderListingsCount: null,
      marketPriceUsd: null,
      researchSoldPriceUsd: null,
      avgShippingCostUsd: null,
      competitionLevel: null,
      previousPobAvgPriceUsd: null,
      previousPobSellThroughPct: null,
      currentListingsCount: null,
      soldListingsCount: 2,
      soldVelocity: {
        day1Sold: 0,
        day2Sold: 0,
        day3Sold: 0,
        day4Sold: 0,
        day5Sold: 0,
        daysTracked: 5,
      },
      recentSoldCount7d: 0,
      soldBucketDebug: undefined,
      provider: 'ebay_research_ui',
      confidence: 'Medium',
      queryDebug: {
        currentQuery: 'ATEEZ GOLDEN HOUR',
        previousPobQuery: null,
        selectedMode: 'current_market',
        currentResultCount: 2,
        previousPobResultCount: null,
        notes: 'test',
        queryResolution: {
          queryContextUsed: false,
          querySource: 'provider_fallback',
          resolvedSearchQuery: null,
          validationScope: 'album',
          queryScope: 'artist album',
        },
        writeSources: {
          day1Sold: 'research_sold_rows',
          day2Sold: 'research_sold_rows',
          day3Sold: 'research_sold_rows',
          day4Sold: 'research_sold_rows',
          day5Sold: 'research_sold_rows',
          daysTracked: 'research_sold_rows',
        },
      },
    });

    getSocialValidationSignalsMock.mockResolvedValue({
      twitterTrending: null,
      youtubeViews24hMillions: null,
      redditPostsCount7d: null,
      debug: undefined,
    });

    getChartValidationSignalsMock.mockReturnValue({ chartMomentum: null });
    getPreviousComebackResearchSignalsMock.mockResolvedValue({
      previousAlbumTitle: null,
      previousComebackFirstWeekSales: null,
      perplexityHistoricalContextScore: 0,
      historicalContextNotes:
        'PERPLEXITY_API_KEY is not configured. Historical context for ATEEZ GOLDEN HOUR remains unverified; rely more on live market signals.',
      confidence: 'Low',
      notes:
        'PERPLEXITY_API_KEY is not configured. Historical context for ATEEZ GOLDEN HOUR remains unverified; rely more on live market signals.',
      sources: [],
      debug: {
        providerStatus: 'unconfigured',
        parseStatus: 'unconfigured',
        query: 'ATEEZ GOLDEN HOUR',
        promptFocus: ['identify the immediately previous comeback or album release'],
        citations: [],
        sourceSnippets: [],
        resolvedPriorRelease: null,
        extractedConfidence: null,
        computedConfidence: 'Low',
        confidenceReason: null,
        scoreAssignmentReason: 'test reason',
        rawResponseText: null,
        errorMessage: null,
      },
    });

    const result = await runValidation({} as never, {
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
        releaseDate: '2026-04-20T00:00:00.000Z',
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
    });

    if (result.status !== 'ok') {
      throw new Error(`unexpected result: ${JSON.stringify(result)}`);
    }

    expect(result.writes?.day1Sold).toBe(3);
    expect(result.writes?.day2Sold).toBe(2);
    expect(result.writes?.day3Sold).toBe(1);
    expect(result.writes?.daysTracked).toBe(5);
    expect(result.writes?.perplexityHistoricalContextScore).toBeUndefined();
    expect(result.writes?.historicalContextNotes).toBeUndefined();
    expect(result.writes?.researchConfidence).toBeUndefined();
    expect((result.debug as { writeResolution: Record<string, string> }).writeResolution.day1Sold).toBe('sold');
    expect((result.debug as { writeResolution: Record<string, string> }).writeResolution.day2Sold).toBe('sold');
    expect((result.debug as { writeResolution: Record<string, string> }).writeResolution.day3Sold).toBe('sold');
    expect((result.debug as { writeResolution: Record<string, string> }).writeResolution.daysTracked).toBe('sold');
    expect(
      (result.debug as { writeResolution: Record<string, string> }).writeResolution
        .perplexityHistoricalContextScore
    ).toBe('none');
    expect((result.debug as { omittedOptionalWrites: string[] }).omittedOptionalWrites).toEqual(
      expect.arrayContaining([
        'perplexityHistoricalContextScore',
        'historicalContextNotes',
        'researchConfidence',
      ])
    );
  });
});
