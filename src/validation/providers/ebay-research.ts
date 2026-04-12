import axios from 'axios';
import { createKVStore, type KVStore } from '@/auth/kv-store.js';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface EbayResearchListingRow {
  title: string;
  itemId: string | null;
  url: string | null;
  listingPriceUsd?: number | null;
  shippingUsd?: number | null;
  watchers?: number | null;
  promoted?: boolean | null;
  startDate?: string | null;
}

export interface EbayResearchSoldRow {
  title: string;
  itemId: string | null;
  url: string | null;
  avgSoldPriceUsd?: number | null;
  avgShippingUsd?: number | null;
  totalSold?: number | null;
  totalRevenueUsd?: number | null;
  lastSoldDate?: string | null;
}

export interface EbayResearchResponse {
  active: {
    avgListingPriceUsd: number | null;
    listingPriceMinUsd: number | null;
    listingPriceMaxUsd: number | null;
    avgShippingUsd: number | null;
    freeShippingPct: number | null;
    totalActiveListings: number | null;
    promotedListingsPct: number | null;
    avgWatchersPerListing: number | null;
    watcherCoverageCount: number | null;
    listingRows: EbayResearchListingRow[];
  };
  sold: {
    avgSoldPriceUsd: number | null;
    soldPriceMinUsd: number | null;
    soldPriceMaxUsd: number | null;
    avgShippingUsd: number | null;
    freeShippingPct: number | null;
    sellThroughPct: number | null;
    totalSold: number | null;
    totalSellers: number | null;
    totalItemSalesUsd: number | null;
    soldRows: EbayResearchSoldRow[];
  };
  debug: {
    query: string;
    activeEndpointUrl: string;
    soldEndpointUrl: string;
    fetchedAt: string;
    modulesSeen: string[];
    pageErrors: string[];
    authState: 'authenticated' | 'missing' | 'expired' | 'unavailable';
    sessionStrategy: 'env_cookies' | 'kv_store' | 'storage_state' | 'playwright_profile' | 'none';
    notes: string[];
  };
}

export interface FetchEbayResearchOptions {
  marketplace?: string;
  dayRange?: number;
  timezone?: string;
  startDate?: number;
  endDate?: number;
  offset?: number;
  limit?: number;
}

interface ResearchCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  secure?: boolean;
}

interface ParsedResearchModule {
  raw: unknown;
  moduleName: string;
}

interface ResearchTabFetchResult {
  modules: ParsedResearchModule[];
  modulesSeen: string[];
  pageErrors: string[];
  responseStatus: number;
  cacheKey: string;
  cacheEligible: boolean;
}

interface ResearchCacheEntry {
  expiresAt: number;
  value: ResearchTabFetchResult;
}

interface ResearchAuthState {
  cookies: ResearchCookie[];
  authState: 'authenticated' | 'missing' | 'expired' | 'unavailable';
  sessionStrategy: 'env_cookies' | 'kv_store' | 'storage_state' | 'playwright_profile' | 'none';
  notes: string[];
}

interface PersistedResearchSession {
  cookies: ResearchCookie[];
  updatedAt: string;
  expiresAt: string | null;
  marketplace: string;
  source: ResearchAuthState['sessionStrategy'];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAY_RANGE = 90;
const DEFAULT_MARKETPLACE = 'EBAY-US';
const DEFAULT_TIMEZONE = process.env.EBAY_RESEARCH_TIMEZONE?.trim() ?? 'Asia/Seoul';
const DEFAULT_LIMIT = 50;
const ACTIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SOLD_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const RESEARCH_ENDPOINT = 'https://www.ebay.com/sh/research/api/search';
const RESEARCH_STORAGE_STATE_PATH =
  process.env.EBAY_RESEARCH_STORAGE_STATE_PATH?.trim() ?? '.ebay-research/storage-state.json';
const RESEARCH_PROFILE_DIR =
  process.env.EBAY_RESEARCH_PROFILE_DIR?.trim() ?? '.ebay-research/profile';
const RESEARCH_COOKIE_CACHE_TTL_MS = 5 * 60 * 1000;
const RESEARCH_SESSION_KEY_PREFIX = 'ebay-research:session';
const RESEARCH_SESSION_FALLBACK_TTL_S = 30 * 24 * 60 * 60;

const researchResponseCache = new Map<string, ResearchCacheEntry>();
let researchAuthCache: {
  expiresAt: number;
  value: ResearchAuthState;
} | null = null;
let researchSessionStoreSingleton: KVStore | null | undefined;

export class EbayResearchAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EbayResearchAuthError';
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compactComparableText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function getResearchSessionStore(): KVStore | null {
  if (researchSessionStoreSingleton !== undefined) {
    return researchSessionStoreSingleton;
  }

  try {
    researchSessionStoreSingleton = createKVStore();
  } catch {
    researchSessionStoreSingleton = null;
  }

  return researchSessionStoreSingleton;
}

function getResearchSessionKey(marketplace: string): string {
  const environment = (process.env.EBAY_ENVIRONMENT ?? 'production').trim() || 'production';
  return `${RESEARCH_SESSION_KEY_PREFIX}:${environment}:${marketplace}`;
}

function getResearchAuthFingerprint(authState: ResearchAuthState): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        authState: authState.authState,
        sessionStrategy: authState.sessionStrategy,
        cookieHeader: buildCookieHeader(authState.cookies),
      })
    )
    .digest('hex');
}

function getResearchTabCacheKey(
  query: string,
  tabName: 'ACTIVE' | 'SOLD',
  options: Required<FetchEbayResearchOptions>,
  authState: ResearchAuthState
): string {
  return JSON.stringify({
    query,
    tabName,
    marketplace: options.marketplace,
    dayRange: options.dayRange,
    startDate: options.startDate,
    endDate: options.endDate,
    offset: options.offset,
    limit: options.limit,
    authFingerprint: getResearchAuthFingerprint(authState),
  });
}

function setResearchResponseCache(
  cacheKey: string,
  tabName: 'ACTIVE' | 'SOLD',
  value: ResearchTabFetchResult
): void {
  researchResponseCache.set(cacheKey, {
    expiresAt: Date.now() + (tabName === 'ACTIVE' ? ACTIVE_CACHE_TTL_MS : SOLD_CACHE_TTL_MS),
    value,
  });
}

function getCookieExpiryMs(cookies: ResearchCookie[]): number | null {
  const nowSeconds = Date.now() / 1000;
  const expiriesMs = cookies
    .map((cookie) => cookie.expires ?? null)
    .filter((expires): expires is number => typeof expires === 'number' && expires > nowSeconds)
    .map((expires) => expires * 1000);

  return expiriesMs.length > 0 ? Math.min(...expiriesMs) : null;
}

async function readResearchSessionFromKv(
  marketplace: string
): Promise<PersistedResearchSession | null> {
  const store = getResearchSessionStore();
  if (!store) {
    return null;
  }

  return await store.get<PersistedResearchSession>(getResearchSessionKey(marketplace));
}

async function persistResearchSessionToKv(
  marketplace: string,
  cookies: ResearchCookie[],
  source: ResearchAuthState['sessionStrategy']
): Promise<void> {
  const store = getResearchSessionStore();
  if (!store || cookies.length === 0) {
    return;
  }

  const expiryMs = getCookieExpiryMs(cookies);
  const ttlSeconds = expiryMs
    ? Math.max(
        60,
        Math.min(RESEARCH_SESSION_FALLBACK_TTL_S, Math.floor((expiryMs - Date.now()) / 1000))
      )
    : RESEARCH_SESSION_FALLBACK_TTL_S;

  await store.put(
    getResearchSessionKey(marketplace),
    {
      cookies,
      updatedAt: new Date().toISOString(),
      expiresAt: expiryMs ? new Date(expiryMs).toISOString() : null,
      marketplace,
      source,
    } satisfies PersistedResearchSession,
    ttlSeconds
  );
}

async function deleteResearchSessionFromKv(marketplace: string): Promise<void> {
  const store = getResearchSessionStore();
  if (!store) {
    return;
  }

  try {
    await store.delete(getResearchSessionKey(marketplace));
  } catch {
    // Ignore KV invalidation failures so auth diagnostics can still surface.
  }
}

function toAbsolutePath(pathValue: string): string {
  return pathValue.startsWith('/') ? pathValue : resolve(process.cwd(), pathValue);
}

function extractDisplayText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => extractDisplayText(entry))
      .filter((entry) => entry.length > 0)
      .join(' ')
      .trim();
  }

  if (!isRecord(value)) {
    return '';
  }

  const textSpans = value.textSpans;
  if (Array.isArray(textSpans)) {
    return textSpans
      .map((entry) =>
        isRecord(entry) ? extractDisplayText(entry.text) || extractDisplayText(entry) : ''
      )
      .filter((entry) => entry.length > 0)
      .join('')
      .trim();
  }

  for (const key of [
    'text',
    'label',
    'title',
    'value',
    'formattedValue',
    'displayValue',
    'subtitle',
  ]) {
    const nested = extractDisplayText(value[key]);
    if (nested.length > 0) {
      return nested;
    }
  }

  return '';
}

function collectDisplayTexts(value: unknown, bucket: string[] = [], limit = 80): string[] {
  if (bucket.length >= limit) {
    return bucket;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      bucket.push(trimmed);
    }
    return bucket;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    bucket.push(String(value));
    return bucket;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectDisplayTexts(entry, bucket, limit);
      if (bucket.length >= limit) {
        break;
      }
    }
    return bucket;
  }

  if (!isRecord(value)) {
    return bucket;
  }

  const text = extractDisplayText(value);
  if (text.length > 0) {
    bucket.push(text);
  }

  for (const nestedValue of Object.values(value)) {
    collectDisplayTexts(nestedValue, bucket, limit);
    if (bucket.length >= limit) {
      break;
    }
  }

  return bucket;
}

function getObjectPath(source: unknown, path: string[]): unknown {
  let current: unknown = source;

  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function parseNumberLike(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/,/g, '').replace(/\s+/g, ' ').trim();
  if (/^free shipping$/i.test(normalized)) {
    return 0;
  }

  const numberPattern = /-?\d+(?:\.\d+)?/u;
  const match = numberPattern.exec(normalized);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? round(parsed) : null;
}

function parseCurrencyValue(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  if (/free shipping/i.test(value)) {
    return 0;
  }

  return parseNumberLike(value.replace(/\$/g, '').replace(/\+/g, ''));
}

function parsePercentValue(value: string | null | undefined): number | null {
  return parseNumberLike(value?.replace(/%/g, '') ?? null);
}

function parseRange(value: string | null | undefined): {
  min: number | null;
  max: number | null;
} {
  if (!value) {
    return { min: null, max: null };
  }

  const matches = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/g) ?? [];
  const numbers = matches
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry))
    .map((entry) => round(entry));

  return {
    min: numbers[0] ?? null,
    max: numbers[1] ?? numbers[0] ?? null,
  };
}

function getModuleName(value: unknown): string {
  if (!isRecord(value)) {
    return 'UnknownModule';
  }

  const metaName = isRecord(value.meta) ? extractDisplayText(value.meta.name) : '';
  const typeName = typeof value._type === 'string' ? value._type : '';
  const explicitName = typeof value.name === 'string' ? value.name : '';
  return metaName || typeName || explicitName || 'UnknownModule';
}

function matchesLabel(value: string, labels: string[]): boolean {
  const comparable = normalizeComparableText(value);
  const compact = compactComparableText(value);

  return labels.some((label) => {
    const normalizedLabel = normalizeComparableText(label);
    const compactLabel = compactComparableText(label);
    return (
      comparable === normalizedLabel ||
      comparable.includes(normalizedLabel) ||
      normalizedLabel.includes(comparable) ||
      compact === compactLabel ||
      compact.includes(compactLabel) ||
      compactLabel.includes(compact)
    );
  });
}

function collectValueCandidates(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((entry) => collectValueCandidates(entry)));
  }

  if (!isRecord(value)) {
    return [];
  }

  const preferredKeys = [
    'value',
    'formattedValue',
    'displayValue',
    'summary',
    'metricValue',
    'range',
    'amount',
    'text',
    'subtitle',
  ];
  const preferredValues = preferredKeys.flatMap((key) => collectValueCandidates(value[key]));
  if (preferredValues.length > 0) {
    return uniqueStrings(preferredValues);
  }

  const text = extractDisplayText(value);
  return text ? [text] : [];
}

function findMetricText(root: unknown, labels: string[]): string | null {
  const matches: string[] = [];

  function walk(node: unknown): void {
    if (matches.length > 0) {
      return;
    }

    if (Array.isArray(node)) {
      for (const entry of node) {
        walk(entry);
        if (matches.length > 0) {
          return;
        }
      }
      return;
    }

    if (!isRecord(node)) {
      return;
    }

    const entries = Object.entries(node);
    let labelFound = false;

    for (const [key, value] of entries) {
      if (matchesLabel(key, labels)) {
        labelFound = true;
        break;
      }

      const text = extractDisplayText(value);
      if (text.length > 0 && matchesLabel(text, labels)) {
        labelFound = true;
        break;
      }
    }

    if (labelFound) {
      const candidates = uniqueStrings(
        entries.flatMap(([key, value]) => {
          if (matchesLabel(key, labels)) {
            return [];
          }

          const values = collectValueCandidates(value);
          return values.filter((entry) => !matchesLabel(entry, labels));
        })
      );

      const selected = candidates.find((entry) => entry.length > 0);
      if (selected) {
        matches.push(selected);
        return;
      }
    }

    for (const nestedValue of Object.values(node)) {
      walk(nestedValue);
      if (matches.length > 0) {
        return;
      }
    }
  }

  walk(root);
  return matches[0] ?? null;
}

function findResultEntries(root: unknown): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      for (const entry of node) {
        walk(entry);
      }
      return;
    }

    if (!isRecord(node)) {
      return;
    }

    const listing = node.listing;
    if (isRecord(listing)) {
      const title = extractDisplayText(getObjectPath(listing, ['title']));
      const itemId = extractDisplayText(getObjectPath(listing, ['itemId', 'value']));
      if (title.length > 0 || itemId.length > 0) {
        const dedupeKey = `${itemId}:${title}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          results.push(node);
        }
      }
    }

    for (const nestedValue of Object.values(node)) {
      walk(nestedValue);
    }
  }

  walk(root);
  return results;
}

function parsePromotedValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (!value) {
    return null;
  }

  const text = extractDisplayText(value);
  if (text.length > 0) {
    if (/^(?:-|—|–)$/u.test(text)) {
      return false;
    }
    if (/^(?:yes|true|promoted)$/i.test(text)) {
      return true;
    }
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).map((entry) => entry.toLowerCase());
    if (keys.some((entry) => /(icon|badge|tooltip|indicator|promoted)/.test(entry))) {
      return true;
    }
    return Object.keys(value).length === 0 ? false : null;
  }

  return null;
}

function parseActiveRows(module: unknown): EbayResearchListingRow[] {
  return findResultEntries(module).map((result) => {
    const title =
      extractDisplayText(getObjectPath(result, ['listing', 'title'])) || 'Untitled active listing';
    const itemId =
      extractDisplayText(getObjectPath(result, ['listing', 'itemId', 'value'])) || null;
    const url =
      extractDisplayText(getObjectPath(result, ['listing', 'title', 'action', 'URL'])) || null;
    const listingPriceText = extractDisplayText(
      getObjectPath(result, ['listingPrice', 'listingPrice'])
    );
    const shippingText = extractDisplayText(
      getObjectPath(result, ['listingPrice', 'listingShipping'])
    );
    const watchersText = extractDisplayText(getObjectPath(result, ['watchers']));

    return {
      title,
      itemId,
      url,
      listingPriceUsd: parseCurrencyValue(listingPriceText),
      shippingUsd: parseCurrencyValue(shippingText),
      watchers: parseNumberLike(watchersText),
      promoted:
        parsePromotedValue(result.promoted) ??
        parsePromotedValue(result.promotedListing) ??
        parsePromotedValue(result.promotedIndicator),
      startDate: extractDisplayText(getObjectPath(result, ['startDate'])) || null,
    };
  });
}

function parseSoldRows(module: unknown): EbayResearchSoldRow[] {
  return findResultEntries(module).map((result) => ({
    title:
      extractDisplayText(getObjectPath(result, ['listing', 'title'])) || 'Untitled sold listing',
    itemId: extractDisplayText(getObjectPath(result, ['listing', 'itemId', 'value'])) || null,
    url: extractDisplayText(getObjectPath(result, ['listing', 'title', 'action', 'URL'])) || null,
    avgSoldPriceUsd: parseCurrencyValue(
      extractDisplayText(getObjectPath(result, ['avgsalesprice', 'avgsalesprice']))
    ),
    avgShippingUsd: parseCurrencyValue(
      extractDisplayText(getObjectPath(result, ['avgshipping', 'avgshipping']))
    ),
    totalSold: parseNumberLike(extractDisplayText(getObjectPath(result, ['itemssold']))),
    totalRevenueUsd: parseCurrencyValue(extractDisplayText(getObjectPath(result, ['totalsales']))),
    lastSoldDate: extractDisplayText(getObjectPath(result, ['datelastsold'])) || null,
  }));
}

function aggregateHasUsefulValues(value: Record<string, number | null>): boolean {
  return Object.values(value).some((entry) => entry !== null);
}

function parseActiveAggregate(
  module: unknown
): Omit<
  EbayResearchResponse['active'],
  'avgWatchersPerListing' | 'watcherCoverageCount' | 'listingRows'
> {
  const listingPriceRange = parseRange(findMetricText(module, ['Listing price range']));

  return {
    avgListingPriceUsd: parseCurrencyValue(findMetricText(module, ['Avg listing price'])),
    listingPriceMinUsd: listingPriceRange.min,
    listingPriceMaxUsd: listingPriceRange.max,
    avgShippingUsd: parseCurrencyValue(findMetricText(module, ['Avg shipping'])),
    freeShippingPct: parsePercentValue(findMetricText(module, ['Free shipping'])),
    totalActiveListings: parseNumberLike(findMetricText(module, ['Total active listings'])),
    promotedListingsPct: parsePercentValue(findMetricText(module, ['Promoted listings'])),
  };
}

function parseSoldAggregate(module: unknown): Omit<EbayResearchResponse['sold'], 'soldRows'> {
  const soldPriceRange = parseRange(findMetricText(module, ['Sold price range']));

  return {
    avgSoldPriceUsd: parseCurrencyValue(findMetricText(module, ['Avg sold price'])),
    soldPriceMinUsd: soldPriceRange.min,
    soldPriceMaxUsd: soldPriceRange.max,
    avgShippingUsd: parseCurrencyValue(findMetricText(module, ['Avg shipping'])),
    freeShippingPct: parsePercentValue(findMetricText(module, ['Free shipping'])),
    sellThroughPct: parsePercentValue(findMetricText(module, ['Sell-through'])),
    totalSold: parseNumberLike(findMetricText(module, ['Total sold'])),
    totalSellers: parseNumberLike(findMetricText(module, ['Total sellers'])),
    totalItemSalesUsd: parseCurrencyValue(findMetricText(module, ['Total item sales'])),
  };
}

function buildWatcherMetrics(rows: EbayResearchListingRow[]): {
  avgWatchersPerListing: number | null;
  watcherCoverageCount: number | null;
} {
  const watcherValues = rows
    .map((row) => row.watchers)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (watcherValues.length === 0) {
    return {
      avgWatchersPerListing: null,
      watcherCoverageCount: null,
    };
  }

  const total = watcherValues.reduce((sum, value) => sum + value, 0);
  return {
    avgWatchersPerListing: round(total / watcherValues.length),
    watcherCoverageCount: watcherValues.length,
  };
}

function parseResearchModules(payload: string): ParsedResearchModule[] {
  return payload
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return [
          {
            raw: parsed,
            moduleName: getModuleName(parsed),
          },
        ];
      } catch {
        return [];
      }
    });
}

function extractPageErrors(modules: ParsedResearchModule[]): string[] {
  const errors = modules
    .filter((module) => /PageErrorModule/i.test(module.moduleName))
    .flatMap((module) => collectDisplayTexts(module.raw, [], 20))
    .filter((entry) => !/PageErrorModule/i.test(entry));

  return uniqueStrings(errors).slice(0, 10);
}

function hasUsefulResearchPayload(value: EbayResearchResponse): boolean {
  return (
    value.active.listingRows.length > 0 ||
    value.sold.soldRows.length > 0 ||
    aggregateHasUsefulValues({
      avgListingPriceUsd: value.active.avgListingPriceUsd,
      listingPriceMinUsd: value.active.listingPriceMinUsd,
      listingPriceMaxUsd: value.active.listingPriceMaxUsd,
      avgShippingUsd: value.active.avgShippingUsd,
      freeShippingPct: value.active.freeShippingPct,
      totalActiveListings: value.active.totalActiveListings,
      promotedListingsPct: value.active.promotedListingsPct,
      avgWatchersPerListing: value.active.avgWatchersPerListing,
      watcherCoverageCount: value.active.watcherCoverageCount,
    }) ||
    aggregateHasUsefulValues({
      avgSoldPriceUsd: value.sold.avgSoldPriceUsd,
      soldPriceMinUsd: value.sold.soldPriceMinUsd,
      soldPriceMaxUsd: value.sold.soldPriceMaxUsd,
      avgShippingUsd: value.sold.avgShippingUsd,
      freeShippingPct: value.sold.freeShippingPct,
      sellThroughPct: value.sold.sellThroughPct,
      totalSold: value.sold.totalSold,
      totalSellers: value.sold.totalSellers,
      totalItemSalesUsd: value.sold.totalItemSalesUsd,
    })
  );
}

function buildResearchUrl(
  query: string,
  tabName: 'ACTIVE' | 'SOLD',
  options: Required<FetchEbayResearchOptions>
): string {
  const url = new URL(RESEARCH_ENDPOINT);
  url.searchParams.set('marketplace', options.marketplace);
  url.searchParams.set('keywords', query);
  url.searchParams.set('dayRange', String(options.dayRange));
  url.searchParams.set('endDate', String(options.endDate));
  url.searchParams.set('startDate', String(options.startDate));
  url.searchParams.set('categoryId', '0');
  url.searchParams.set('offset', String(options.offset));
  url.searchParams.set('limit', String(options.limit));
  url.searchParams.set('tabName', tabName);
  url.searchParams.set('tz', options.timezone);
  url.searchParams.append('modules', 'aggregates');
  url.searchParams.append('modules', 'searchResults');
  url.searchParams.append('modules', 'resultsHeader');
  return url.toString();
}

function buildCookieHeader(cookies: ResearchCookie[]): string {
  const nowSeconds = Date.now() / 1000;
  return cookies
    .filter((cookie) => cookie.name && cookie.value)
    .filter((cookie) => !cookie.expires || cookie.expires < 0 || cookie.expires > nowSeconds)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

async function readStorageStateCookies(storageStatePath: string): Promise<ResearchCookie[] | null> {
  if (!existsSync(storageStatePath)) {
    return null;
  }

  const parsed = JSON.parse(await readFile(storageStatePath, 'utf8')) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.cookies)) {
    return null;
  }

  return parsed.cookies
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => ({
      name: typeof entry.name === 'string' ? entry.name : '',
      value: typeof entry.value === 'string' ? entry.value : '',
      domain: typeof entry.domain === 'string' ? entry.domain : undefined,
      path: typeof entry.path === 'string' ? entry.path : undefined,
      expires: typeof entry.expires === 'number' ? entry.expires : undefined,
      secure: typeof entry.secure === 'boolean' ? entry.secure : undefined,
    }))
    .filter((entry) => entry.name.length > 0 && entry.value.length > 0);
}

async function readPlaywrightProfileCookies(profileDir: string): Promise<ResearchCookie[] | null> {
  if (!existsSync(profileDir)) {
    return null;
  }

  const require = createRequire(import.meta.url);
  const playwrightModule = (() => {
    try {
      return require('playwright') as {
        chromium?: {
          launchPersistentContext: (
            userDataDir: string,
            options: Record<string, unknown>
          ) => Promise<{
            cookies: (urls?: string | string[]) => Promise<ResearchCookie[]>;
            close: () => Promise<void>;
          }>;
        };
      };
    } catch {
      return null;
    }
  })();

  if (!playwrightModule?.chromium?.launchPersistentContext) {
    return null;
  }

  const context = await playwrightModule.chromium.launchPersistentContext(profileDir, {
    headless: true,
  });

  try {
    return await context.cookies('https://www.ebay.com');
  } finally {
    await context.close();
  }
}

async function resolveResearchAuthState(marketplace: string): Promise<ResearchAuthState> {
  if (researchAuthCache && researchAuthCache.expiresAt > Date.now()) {
    return researchAuthCache.value;
  }

  const notes: string[] = [];
  const envCookiesRaw = process.env.EBAY_RESEARCH_COOKIES_JSON?.trim();

  if (envCookiesRaw) {
    try {
      const parsed = JSON.parse(envCookiesRaw) as unknown;
      const cookies = Array.isArray(parsed)
        ? parsed
            .filter((entry): entry is Record<string, unknown> => isRecord(entry))
            .map((entry) => ({
              name: typeof entry.name === 'string' ? entry.name : '',
              value: typeof entry.value === 'string' ? entry.value : '',
              domain: typeof entry.domain === 'string' ? entry.domain : undefined,
              path: typeof entry.path === 'string' ? entry.path : undefined,
              expires: typeof entry.expires === 'number' ? entry.expires : undefined,
              secure: typeof entry.secure === 'boolean' ? entry.secure : undefined,
            }))
            .filter((entry) => entry.name.length > 0 && entry.value.length > 0)
        : [];

      const value: ResearchAuthState = {
        cookies,
        authState: cookies.length > 0 ? 'authenticated' : 'missing',
        sessionStrategy: cookies.length > 0 ? 'env_cookies' : 'none',
        notes,
      };
      await persistResearchSessionToKv(marketplace, cookies, value.sessionStrategy);
      researchAuthCache = {
        expiresAt: Date.now() + RESEARCH_COOKIE_CACHE_TTL_MS,
        value,
      };
      return value;
    } catch {
      notes.push('EBAY_RESEARCH_COOKIES_JSON could not be parsed as JSON.');
    }
  }

  const persistedSession = await readResearchSessionFromKv(marketplace);
  if (persistedSession?.cookies?.length) {
    const store = getResearchSessionStore();
    const value: ResearchAuthState = {
      cookies: persistedSession.cookies,
      authState: 'authenticated',
      sessionStrategy: 'kv_store',
      notes: [
        ...notes,
        `Restored eBay Research session from ${store?.backendName ?? 'shared KV store'}.`,
      ],
    };
    researchAuthCache = {
      expiresAt: Date.now() + RESEARCH_COOKIE_CACHE_TTL_MS,
      value,
    };
    return value;
  }

  const storageStatePath = toAbsolutePath(RESEARCH_STORAGE_STATE_PATH);
  const storageStateCookies = await readStorageStateCookies(storageStatePath);
  if (storageStateCookies && storageStateCookies.length > 0) {
    const value: ResearchAuthState = {
      cookies: storageStateCookies,
      authState: 'authenticated',
      sessionStrategy: 'storage_state',
      notes,
    };
    await persistResearchSessionToKv(marketplace, storageStateCookies, value.sessionStrategy);
    researchAuthCache = {
      expiresAt: Date.now() + RESEARCH_COOKIE_CACHE_TTL_MS,
      value,
    };
    return value;
  }

  const profileDir = toAbsolutePath(RESEARCH_PROFILE_DIR);
  const profileCookies = await readPlaywrightProfileCookies(profileDir);
  if (profileCookies && profileCookies.length > 0) {
    const value: ResearchAuthState = {
      cookies: profileCookies,
      authState: 'authenticated',
      sessionStrategy: 'playwright_profile',
      notes,
    };
    await persistResearchSessionToKv(marketplace, profileCookies, value.sessionStrategy);
    researchAuthCache = {
      expiresAt: Date.now() + RESEARCH_COOKIE_CACHE_TTL_MS,
      value,
    };
    return value;
  }

  if (getResearchSessionStore() === null) {
    notes.push(
      'Shared KV store for eBay Research sessions is unavailable; using local fallback auth sources only.'
    );
  }
  if (!existsSync(storageStatePath)) {
    notes.push(`No research storage state found at ${storageStatePath}.`);
  }
  if (!existsSync(profileDir)) {
    notes.push(`No Playwright profile found at ${profileDir}.`);
  } else {
    notes.push('Playwright profile exists but cookies could not be restored.');
  }

  const value: ResearchAuthState = {
    cookies: [],
    authState: 'missing',
    sessionStrategy: 'none',
    notes,
  };
  researchAuthCache = {
    expiresAt: Date.now() + RESEARCH_COOKIE_CACHE_TTL_MS,
    value,
  };
  return value;
}

async function fetchResearchTab(
  query: string,
  tabName: 'ACTIVE' | 'SOLD',
  options: Required<FetchEbayResearchOptions>,
  authState: ResearchAuthState
): Promise<ResearchTabFetchResult> {
  const cacheKey = getResearchTabCacheKey(query, tabName, options, authState);
  const cached = researchResponseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const requestUrl = buildResearchUrl(query, tabName, options);
  const cookieHeader = buildCookieHeader(authState.cookies);
  if (!cookieHeader) {
    throw new EbayResearchAuthError(
      'Authenticated eBay Research session is not available. Bootstrap a signed-in Playwright profile or provide storage-state cookies.'
    );
  }

  const response = await axios.get<string>(requestUrl, {
    responseType: 'text',
    headers: {
      accept: 'application/json, text/plain, */*',
      cookie: cookieHeader,
      'x-requested-with': 'XMLHttpRequest',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    },
    validateStatus: (status) => status >= 200 && status < 500,
  });

  if (response.status === 401 || response.status === 403) {
    researchAuthCache = null;
    await deleteResearchSessionFromKv(options.marketplace);
    throw new EbayResearchAuthError(
      `Authenticated eBay Research session was rejected with status ${response.status}.`
    );
  }

  const modules = parseResearchModules(response.data);
  const result: ResearchTabFetchResult = {
    modules,
    modulesSeen: uniqueStrings(modules.map((module) => module.moduleName)),
    pageErrors: extractPageErrors(modules),
    responseStatus: response.status,
    cacheKey,
    cacheEligible: response.status >= 200 && response.status < 300,
  };

  return result;
}

function getDefaultFetchOptions(
  options?: FetchEbayResearchOptions
): Required<FetchEbayResearchOptions> {
  const dayRange = options?.dayRange ?? DEFAULT_DAY_RANGE;
  const endDate = options?.endDate ?? Date.now();
  const startDate = options?.startDate ?? endDate - dayRange * DAY_MS;

  return {
    marketplace: options?.marketplace ?? DEFAULT_MARKETPLACE,
    dayRange,
    timezone: options?.timezone ?? DEFAULT_TIMEZONE,
    startDate,
    endDate,
    offset: options?.offset ?? 0,
    limit: options?.limit ?? DEFAULT_LIMIT,
  };
}

export async function fetchEbayResearch(
  query: string,
  options?: FetchEbayResearchOptions
): Promise<EbayResearchResponse> {
  const normalizedQuery = query.trim();
  const resolvedOptions = getDefaultFetchOptions(options);
  const fetchedAt = new Date().toISOString();
  const activeEndpointUrl = buildResearchUrl(normalizedQuery, 'ACTIVE', resolvedOptions);
  const soldEndpointUrl = buildResearchUrl(normalizedQuery, 'SOLD', resolvedOptions);
  const authState = await resolveResearchAuthState(resolvedOptions.marketplace);

  try {
    const [activeResult, soldResult] = await Promise.all([
      fetchResearchTab(normalizedQuery, 'ACTIVE', resolvedOptions, authState),
      fetchResearchTab(normalizedQuery, 'SOLD', resolvedOptions, authState),
    ]);

    const activeAggregateModule = activeResult.modules.find((module) =>
      /ResearchAggregateModule/i.test(module.moduleName)
    )?.raw;
    const activeSearchResultsModule = activeResult.modules.find((module) =>
      /ActiveSearchResultsModule/i.test(module.moduleName)
    )?.raw;
    const soldAggregateModule = soldResult.modules.find((module) =>
      /ResearchAggregateModule/i.test(module.moduleName)
    )?.raw;
    const soldSearchResultsModule = soldResult.modules.find((module) =>
      /SearchResultsModule/i.test(module.moduleName)
    )?.raw;

    const activeAggregate = parseActiveAggregate(activeAggregateModule);
    const activeRows = parseActiveRows(activeSearchResultsModule);
    const watcherMetrics = buildWatcherMetrics(activeRows);
    const soldAggregate = parseSoldAggregate(soldAggregateModule);
    const soldRows = parseSoldRows(soldSearchResultsModule);
    const response: EbayResearchResponse = {
      active: {
        ...activeAggregate,
        avgWatchersPerListing: watcherMetrics.avgWatchersPerListing,
        watcherCoverageCount: watcherMetrics.watcherCoverageCount,
        listingRows: activeRows,
      },
      sold: {
        ...soldAggregate,
        soldRows,
      },
      debug: {
        query: normalizedQuery,
        activeEndpointUrl,
        soldEndpointUrl,
        fetchedAt,
        modulesSeen: uniqueStrings([...activeResult.modulesSeen, ...soldResult.modulesSeen]),
        pageErrors: uniqueStrings([...activeResult.pageErrors, ...soldResult.pageErrors]),
        authState: authState.authState,
        sessionStrategy: authState.sessionStrategy,
        notes: [...authState.notes],
      },
    };

    if (!hasUsefulResearchPayload(response)) {
      throw new Error(
        'eBay Research response did not include useful ACTIVE or SOLD modules after parsing.'
      );
    }

    if (
      activeResult.cacheEligible &&
      (activeAggregateModule !== undefined || activeSearchResultsModule !== undefined)
    ) {
      setResearchResponseCache(activeResult.cacheKey, 'ACTIVE', activeResult);
    }

    if (
      soldResult.cacheEligible &&
      (soldAggregateModule !== undefined || soldSearchResultsModule !== undefined)
    ) {
      setResearchResponseCache(soldResult.cacheKey, 'SOLD', soldResult);
    }

    return response;
  } catch (error) {
    if (error instanceof EbayResearchAuthError) {
      return {
        active: {
          avgListingPriceUsd: null,
          listingPriceMinUsd: null,
          listingPriceMaxUsd: null,
          avgShippingUsd: null,
          freeShippingPct: null,
          totalActiveListings: null,
          promotedListingsPct: null,
          avgWatchersPerListing: null,
          watcherCoverageCount: null,
          listingRows: [],
        },
        sold: {
          avgSoldPriceUsd: null,
          soldPriceMinUsd: null,
          soldPriceMaxUsd: null,
          avgShippingUsd: null,
          freeShippingPct: null,
          sellThroughPct: null,
          totalSold: null,
          totalSellers: null,
          totalItemSalesUsd: null,
          soldRows: [],
        },
        debug: {
          query: normalizedQuery,
          activeEndpointUrl,
          soldEndpointUrl,
          fetchedAt,
          modulesSeen: [],
          pageErrors: [],
          authState: authState.cookies.length > 0 ? 'expired' : authState.authState,
          sessionStrategy: authState.sessionStrategy,
          notes: [...authState.notes, error.message],
        },
      };
    }

    throw error;
  }
}
