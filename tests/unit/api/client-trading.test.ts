import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import nock from 'nock';
import { TradingApiClient } from '@/api/client-trading.js';
import type { EbayApiClient } from '@/api/client.js';

function createMockRestClient(environment = 'production') {
  const mockOAuthClient = {
    getAccessToken: vi.fn().mockResolvedValue('mock_token'),
  };
  return {
    getConfig: vi.fn().mockReturnValue({ environment }),
    getOAuthClient: vi.fn().mockReturnValue(mockOAuthClient),
    _mockOAuthClient: mockOAuthClient,
  } as unknown as EbayApiClient & {
    _mockOAuthClient: { getAccessToken: ReturnType<typeof vi.fn> };
  };
}

describe('TradingApiClient', () => {
  let client: TradingApiClient;
  let mockRestClient: ReturnType<typeof createMockRestClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    nock.cleanAll();
    nock.disableNetConnect();
    mockRestClient = createMockRestClient('production');
    client = new TradingApiClient(mockRestClient);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('should send XML request with correct headers', async () => {
    const scope = nock('https://api.ebay.com')
      .post('/ws/api.dll')
      .matchHeader('X-EBAY-API-CALL-NAME', 'GetMyeBaySelling')
      .matchHeader('X-EBAY-API-SITEID', '0')
      .matchHeader('X-EBAY-API-COMPATIBILITY-LEVEL', '1451')
      .matchHeader('X-EBAY-API-IAF-TOKEN', 'mock_token')
      .matchHeader('Content-Type', 'text/xml')
      .reply(
        200,
        `<?xml version="1.0" encoding="utf-8"?>
        <GetMyeBaySellingResponse xmlns="urn:ebay:apis:eBLBaseComponents">
          <Ack>Success</Ack>
        </GetMyeBaySellingResponse>`
      );

    const result = await client.execute('GetMyeBaySelling', {});
    expect(result.Ack).toBe('Success');
    scope.done();
  });

  it('should build XML request body from params', async () => {
    const scope = nock('https://api.ebay.com')
      .post('/ws/api.dll', (body: string) => {
        return body.includes('<ItemID>12345</ItemID>');
      })
      .reply(
        200,
        `<?xml version="1.0" encoding="utf-8"?>
        <GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
          <Ack>Success</Ack>
          <Item><ItemID>12345</ItemID></Item>
        </GetItemResponse>`
      );

    const result = await client.execute('GetItem', { ItemID: '12345' });
    expect(result.Ack).toBe('Success');
    scope.done();
  });

  it('should throw on eBay error response', async () => {
    nock('https://api.ebay.com')
      .post('/ws/api.dll')
      .reply(
        200,
        `<?xml version="1.0" encoding="utf-8"?>
        <GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
          <Ack>Failure</Ack>
          <Errors>
            <ShortMessage>Invalid item ID</ShortMessage>
            <LongMessage>The item ID 99999 is invalid.</LongMessage>
            <SeverityCode>Error</SeverityCode>
          </Errors>
        </GetItemResponse>`
      );

    await expect(client.execute('GetItem', { ItemID: '99999' })).rejects.toThrow('Invalid item ID');
  });

  it('should not inject Country into partial revise listing payloads', async () => {
    const scope = nock('https://api.ebay.com')
      .post('/ws/api.dll', (body: string) => {
        expect(body).toContain('<ReviseFixedPriceItemRequest');
        expect(body).toContain('<ItemID>12345</ItemID>');
        expect(body).toContain('<Title>Updated title</Title>');
        expect(body).not.toContain('<Country>');
        return true;
      })
      .reply(
        200,
        `<?xml version="1.0" encoding="utf-8"?>
        <ReviseFixedPriceItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
          <Ack>Success</Ack>
        </ReviseFixedPriceItemResponse>`
      );

    const result = await client.execute('ReviseFixedPriceItem', {
      Item: { ItemID: '12345', Title: 'Updated title' },
    });
    expect(result.Ack).toBe('Success');
    scope.done();
  });

  it('should serialize numeric revise listing StartPrice as text instead of undefined', async () => {
    const scope = nock('https://api.ebay.com')
      .post('/ws/api.dll', (body: string) => {
        expect(body).toContain('<ReviseFixedPriceItemRequest');
        expect(body).toContain('<ItemID>12345</ItemID>');
        expect(body).toContain('<StartPrice>14.99</StartPrice>');
        expect(body).not.toContain('<StartPrice>undefined</StartPrice>');
        return true;
      })
      .reply(
        200,
        `<?xml version="1.0" encoding="utf-8"?>
        <ReviseFixedPriceItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
          <Ack>Success</Ack>
        </ReviseFixedPriceItemResponse>`
      );

    const result = await client.execute('ReviseFixedPriceItem', {
      Item: { ItemID: '12345', StartPrice: 14.99 },
    });
    expect(result.Ack).toBe('Success');
    scope.done();
  });

  it('should accept currency alias when serializing revise listing StartPrice', async () => {
    const scope = nock('https://api.ebay.com')
      .post('/ws/api.dll', (body: string) => {
        expect(body).toContain('<StartPrice currencyID="USD">14.99</StartPrice>');
        return true;
      })
      .reply(
        200,
        `<?xml version="1.0" encoding="utf-8"?>
        <ReviseFixedPriceItemResponse xmlns="urn:ebay:apis:eBLBaseComponents">
          <Ack>Success</Ack>
        </ReviseFixedPriceItemResponse>`
      );

    const result = await client.execute('ReviseFixedPriceItem', {
      Item: { ItemID: '12345', StartPrice: { value: '14.99', currency: 'USD' } },
    });
    expect(result.Ack).toBe('Success');
    scope.done();
  });

  it('should use sandbox URL for sandbox environment', () => {
    const sandboxClient = new TradingApiClient(createMockRestClient('sandbox'));
    expect(sandboxClient.getBaseUrl()).toBe('https://api.sandbox.ebay.com');
  });

  it('should use production URL for production environment', () => {
    expect(client.getBaseUrl()).toBe('https://api.ebay.com');
  });
});
