declare const process: {
  env: Record<string, string | undefined>;
};

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const axiosGetMock = vi.fn();
const kvGetMock = vi.fn();
const kvPutMock = vi.fn();
const kvDeleteMock = vi.fn();
const existsSyncMock = vi.fn<(path?: string) => boolean>(() => false);
const readFileMock = vi.fn();

vi.mock('axios', () => ({
  default: {
    get: axiosGetMock,
  },
  isAxiosError: () => false,
}));

vi.mock('@/auth/kv-store.js', () => ({
  createKVStore: () => ({
    backendName: 'memory',
    get: kvGetMock,
    put: kvPutMock,
    delete: kvDeleteMock,
  }),
}));

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}));

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
}));

function buildActivePayload(): string {
  return JSON.stringify({
    _type: 'ActiveSearchResultsModule',
    results: [
      {
        listing: {
          title: 'ATEEZ GOLDEN HOUR active',
          itemId: { value: 'active-1' },
        },
        listingPrice: {
          listingPrice: '$10.00',
          listingShipping: '$2.00',
        },
        watchers: '3',
        promoted: true,
        startDate: '2026-04-01T00:00:00.000Z',
      },
    ],
  });
}

function buildSoldPayload(): string {
  return JSON.stringify({
    _type: 'SearchResultsModule',
    results: [
      {
        listing: {
          title: 'ATEEZ GOLDEN HOUR sold',
          itemId: { value: 'sold-1' },
        },
        avgsalesprice: {
          avgsalesprice: '$12.00',
        },
        avgshipping: {
          avgshipping: '$1.00',
        },
        itemssold: '2',
        totalsales: '$24.00',
        datelastsold: '2026-04-10T00:00:00.000Z',
      },
    ],
  });
}

describe('fetchEbayResearch()', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-12T00:00:00.000Z'));
    axiosGetMock.mockReset();
    kvGetMock.mockReset();
    kvPutMock.mockReset();
    kvDeleteMock.mockReset();
    existsSyncMock.mockReset();
    readFileMock.mockReset();
    existsSyncMock.mockReturnValue(false);
    kvGetMock.mockResolvedValue(null);
    kvPutMock.mockResolvedValue(undefined);
    kvDeleteMock.mockResolvedValue(undefined);
    delete process.env.EBAY_RESEARCH_STORAGE_STATE_PATH;
    delete process.env.EBAY_RESEARCH_PROFILE_DIR;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.EBAY_RESEARCH_COOKIES_JSON;
  });

  it('re-fetches research tabs when the authenticated cookie set changes', async () => {
    process.env.EBAY_RESEARCH_COOKIES_JSON = JSON.stringify([
      { name: 'sid', value: 'cookie-a', domain: '.ebay.com', path: '/' },
    ]);

    const { fetchEbayResearch } = await import('../../../src/validation/providers/ebay-research.js');

    axiosGetMock
      .mockResolvedValueOnce({ status: 200, data: buildActivePayload() })
      .mockResolvedValueOnce({ status: 200, data: buildSoldPayload() });

    await fetchEbayResearch('ATEEZ GOLDEN HOUR');
    expect(axiosGetMock).toHaveBeenCalledTimes(2);

    axiosGetMock.mockClear();
    vi.advanceTimersByTime(6 * 60 * 1000);
    process.env.EBAY_RESEARCH_COOKIES_JSON = JSON.stringify([
      { name: 'sid', value: 'cookie-b', domain: '.ebay.com', path: '/' },
    ]);

    axiosGetMock
      .mockResolvedValueOnce({ status: 200, data: buildActivePayload() })
      .mockResolvedValueOnce({ status: 200, data: buildSoldPayload() });

    await fetchEbayResearch('ATEEZ GOLDEN HOUR');
    expect(axiosGetMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache transient non-2xx research responses', async () => {
    process.env.EBAY_RESEARCH_COOKIES_JSON = JSON.stringify([
      { name: 'sid', value: 'cookie-a', domain: '.ebay.com', path: '/' },
    ]);

    const { fetchEbayResearch } = await import('../../../src/validation/providers/ebay-research.js');

    axiosGetMock
      .mockResolvedValueOnce({
        status: 429,
        data: JSON.stringify({ _type: 'PageErrorModule', message: 'Rate limited' }),
      })
      .mockResolvedValueOnce({
        status: 429,
        data: JSON.stringify({ _type: 'PageErrorModule', message: 'Rate limited' }),
      });

    await expect(fetchEbayResearch('ATEEZ GOLDEN HOUR')).rejects.toThrow(
      'eBay Research response did not include useful ACTIVE or SOLD modules after parsing.'
    );

    axiosGetMock.mockClear();
    axiosGetMock
      .mockResolvedValueOnce({ status: 200, data: buildActivePayload() })
      .mockResolvedValueOnce({ status: 200, data: buildSoldPayload() });

    const response = await fetchEbayResearch('ATEEZ GOLDEN HOUR');

    expect(axiosGetMock).toHaveBeenCalledTimes(2);
    expect(response.active.listingRows).toHaveLength(1);
    expect(response.sold.soldRows).toHaveLength(1);
  });

  it('invalidates a rejected KV session so later auth sources can be used', async () => {
    kvGetMock
      .mockResolvedValueOnce({
        cookies: [{ name: 'sid', value: 'cookie-a', domain: '.ebay.com', path: '/' }],
        updatedAt: '2026-04-10T00:00:00.000Z',
        expiresAt: null,
        marketplace: 'EBAY-US',
        source: 'kv_store',
      })
      .mockResolvedValueOnce(null);

    const { fetchEbayResearch } = await import('../../../src/validation/providers/ebay-research.js');

    axiosGetMock
      .mockResolvedValueOnce({
        status: 403,
        data: JSON.stringify({ _type: 'PageErrorModule', message: 'Forbidden' }),
      })
      .mockResolvedValueOnce({
        status: 403,
        data: JSON.stringify({ _type: 'PageErrorModule', message: 'Forbidden' }),
      });

    const firstResponse = await fetchEbayResearch('ATEEZ GOLDEN HOUR');

    expect(firstResponse.debug.authState).toBe('expired');
    expect(firstResponse.debug.sessionStrategy).toBe('kv_store');
    expect(kvDeleteMock.mock.calls.length).toBeGreaterThan(0);

    existsSyncMock.mockImplementation((path?: string) =>
      typeof path === 'string' && path.includes('.ebay-research/storage-state.json')
    );
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        cookies: [{ name: 'sid', value: 'cookie-b', domain: '.ebay.com', path: '/' }],
      })
    );
    axiosGetMock.mockResolvedValueOnce({ status: 200, data: buildActivePayload() }).mockResolvedValueOnce({
      status: 200,
      data: buildSoldPayload(),
    });

    const secondResponse = await fetchEbayResearch('ATEEZ GOLDEN HOUR');

    expect(secondResponse.debug.sessionStrategy).toBe('storage_state');
    expect(secondResponse.active.listingRows).toHaveLength(1);
    expect(secondResponse.sold.soldRows).toHaveLength(1);
  });
});
