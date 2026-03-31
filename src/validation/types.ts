export type TrackingCadence = 'Daily' | 'Hourly' | 'Off';

export interface ValidationCurrentMetrics {
  avgWatchersPerListing: number | null;
  preOrderListingsCount: number | null;
  twitterTrending: boolean;
  youtubeViews24hMillions: number | null;
  redditPostsCount7d: number | null;
  marketPriceUsd: number | null;
  avgShippingCostUsd: number | null;
  competitionLevel: number | null;
  marketPriceTrend: string;
  day1Sold: number | null;
  day2Sold: number | null;
  day3Sold: number | null;
  day4Sold: number | null;
  day5Sold: number | null;
  daysTracked: number | null;
}

export interface ValidationRunRequest {
  validationId: string;
  runType: 'scheduled' | 'manual';
  cadence: TrackingCadence;
  timestamp: string;
  item: {
    recordId: string;
    name: string;
    variation: string[];
    itemType: string[];
    releaseType: string[];
    releaseDate: string | null;
    releasePeriod: string[];
    availability: string[];
    wholesalePrice: number | null;
    supplierNames: string[];
    canonicalArtists: string[];
    relatedAlbums: string[];
  };
  validation: {
    validationType: string;
    buyDecision: string;
    automationStatus: string;
    autoCheckEnabled: boolean;
    dDay: number | null;
    artistTier: string;
    initialBudget: number | null;
    reserveBudget: number | null;
    currentMetrics: ValidationCurrentMetrics;
  };
}

export interface EbayValidationSignals {
  avgWatchersPerListing: number | null;
  preOrderListingsCount: number | null;
  marketPriceUsd: number | null;
  avgShippingCostUsd: number | null;
  competitionLevel: number | null;
  marketPriceTrend: string;
  ebayQuery: string;
  sampleSize: number;
  soldVelocity: {
    day1Sold: number | null;
    day2Sold: number | null;
    day3Sold: number | null;
    day4Sold: number | null;
    day5Sold: number | null;
    daysTracked: number | null;
  };
}

export interface SocialValidationSignals {
  twitterTrending: boolean;
  youtubeViews24hMillions: number | null;
  redditPostsCount7d: number | null;
}

export interface ChartValidationSignals {
  chartMomentum?: string | null;
}

export interface ValidationWrites {
  avgWatchersPerListing?: number | null;
  preOrderListingsCount?: number | null;
  twitterTrending?: boolean;
  youtubeViews24hMillions?: number | null;
  redditPostsCount7d?: number | null;
  marketPriceUsd?: number | null;
  avgShippingCostUsd?: number | null;
  competitionLevel?: number | null;
  marketPriceTrend?: string;
  day1Sold?: number | null;
  day2Sold?: number | null;
  day3Sold?: number | null;
  day4Sold?: number | null;
  day5Sold?: number | null;
  daysTracked?: number | null;
  monitoringNotes?: string;
  lastDataSnapshot?: string;
  latestAiRecommendation?: string;
  latestAiConfidence?: 'High' | 'Medium' | 'Low';
  validationError?: string;
}

export interface ValidationDecision {
  buyDecision?: string;
  automationStatus?: string;
  trackingCadence?: TrackingCadence;
  shouldAutoTrack?: boolean;
  nextCheckAt?: string | null;
}

export interface ValidationRunResponse {
  status: 'ok' | 'error';
  validationId: string;
  writes?: ValidationWrites;
  decision?: ValidationDecision;
  debug?: Record<string, unknown>;
  errorCode?: string;
  message?: string;
  retryable?: boolean;
  nextCheckAt?: string | null;
}
