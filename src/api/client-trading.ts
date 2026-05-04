import axios from 'axios';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { EbayApiClient } from '@/api/client.js';
import { apiLogger } from '@/utils/logger.js';

const COMPAT_LEVEL = '1451';
const SITE_ID = '0';

export class TradingApiClient {
  private restClient: EbayApiClient;
  private baseUrl: string;
  private parser: XMLParser;
  private builder: XMLBuilder;

  constructor(restClient: EbayApiClient) {
    this.restClient = restClient;
    const env = restClient.getConfig().environment;
    this.baseUrl = env === 'sandbox' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';

    this.parser = new XMLParser({
      ignoreAttributes: false,
      removeNSPrefix: true,
      parseTagValue: true,
      isArray: (_name: string) => {
        const arrayTags = [
          'Item',
          'Errors',
          'Error',
          'NameValueList',
          'Value',
          'ShippingServiceOptions',
          'InternationalShippingServiceOption',
          'PaymentMethods',
          'PictureURL',
          'CompatibilityList',
          'Variation',
        ];
        return arrayTags.includes(_name);
      },
    });

    this.builder = new XMLBuilder({
      ignoreAttributes: false,
      format: true,
      suppressEmptyNode: true,
    });
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Transform a Trading API item object into a structure that fast-xml-parser
   * can serialize into valid eBay Trading API XML.
   *
   * Handles nested objects like PrimaryCategory, ShippingDetails, ReturnPolicy,
   * PicturesDetails, and ItemSpecifics that require special XML structure.
   */
  private transformItemForXML(item: Record<string, unknown>): Record<string, unknown> {
    const transformed: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(item)) {
      if (value === undefined || value === null) continue;

      switch (key) {
        case 'PrimaryCategory':
          if (typeof value === 'object') {
            transformed[key] = { CategoryID: (value as any).CategoryID };
          } else {
            transformed[key] = value;
          }
          break;

        case 'StartPrice':
          transformed[key] = this.transformPrice(value as any);
          break;

        case 'ShippingDetails':
          transformed[key] = this.transformShippingDetails(value as any);
          break;

        case 'ReturnPolicy':
          transformed[key] = this.transformReturnPolicy(value as any);
          break;

        case 'PicturesDetails':
          transformed[key] = this.transformPicturesDetails(value as any);
          break;

        case 'ItemSpecifics':
          transformed[key] = this.transformItemSpecifics(value as any);
          break;

        case 'PaymentMethods':
          // Ensure array of strings becomes array of PaymentMethod elements
          if (Array.isArray(value)) {
            transformed[key] = value;
          } else {
            transformed[key] = value;
          }
          break;

        default:
          transformed[key] = value;
          break;
      }
    }

    return transformed;
  }

  /**
   * Transform price fields that may have currency attributes.
   * eBay Trading API expects: <StartPrice currencyID="USD">34.99</StartPrice>
   */
  private transformPrice(price: string | { value: string | number; currencyID?: string }): any {
    if (typeof price === 'string') {
      return price;
    }
    // Use fast-xml-parser attribute convention: @_<attrName> for attributes, #text for content
    return {
      '#text': String(price.value),
      ...(price.currencyID && { '@_currencyID': price.currencyID }),
    };
  }

  /**
   * Transform ShippingDetails into proper nested XML structure.
   */
  private transformShippingDetails(sd: Record<string, unknown>): Record<string, unknown> {
    const transformed: Record<string, unknown> = {};

    if (sd.HandlingTime !== undefined) {
      transformed.HandlingTime = sd.HandlingTime;
    }

    if (sd.ShippingServiceOptions) {
      const options = sd.ShippingServiceOptions as Record<string, unknown>;
      const serviceOption: Record<string, unknown> = {};

      if (options.ShippingServicePriority) {
        serviceOption.ShippingServicePriority = options.ShippingServicePriority;
      }
      if (options.ShippingServiceID) {
        serviceOption.ShippingServiceID = options.ShippingServiceID;
      }
      if (options.ShippingServiceCost) {
        serviceOption.ShippingServiceCost = this.transformPrice(options.ShippingServiceCost as any);
      }
      if (options.ShippingType) {
        serviceOption.ShippingType = options.ShippingType;
      }

      transformed.ShippingServiceOptions = serviceOption;
    }

    if (sd.InternationalShippingServiceOption) {
      const intlOptions = sd.InternationalShippingServiceOption as Record<string, unknown>[];
      transformed.InternationalShippingServiceOption = intlOptions.map((option) => {
        const transformedOption: Record<string, unknown> = {};
        if (option.ShippingServicePriority) {
          transformedOption.ShippingServicePriority = option.ShippingServicePriority;
        }
        if (option.ShippingServiceID) {
          transformedOption.ShippingServiceID = option.ShippingServiceID;
        }
        if (option.ShippingServiceCost) {
          transformedOption.ShippingServiceCost = this.transformPrice(
            option.ShippingServiceCost as any
          );
        }
        if (option.ShippingType) {
          transformedOption.ShippingType = option.ShippingType;
        }
        if (option.Country) {
          transformedOption.Country = Array.isArray(option.Country)
            ? option.Country
            : [option.Country];
        }
        return transformedOption;
      });
    }

    return transformed;
  }

  /**
   * Transform ReturnPolicy into proper nested XML structure.
   */
  private transformReturnPolicy(rp: Record<string, unknown>): Record<string, unknown> {
    const transformed: Record<string, unknown> = {};

    if (rp.ReturnsAcceptedOption !== undefined) {
      transformed.ReturnsAcceptedOption = rp.ReturnsAcceptedOption;
    }
    if (rp.ReturnsWithinOption !== undefined) {
      transformed.ReturnsWithinOption = rp.ReturnsWithinOption;
    }
    if (rp.Description !== undefined) {
      transformed.Description = rp.Description;
    }
    if (rp.RefundOption !== undefined) {
      transformed.RefundOption = rp.RefundOption;
    }

    return transformed;
  }

  /**
   * Transform PicturesDetails into proper nested XML structure.
   */
  private transformPicturesDetails(pd: Record<string, unknown>): Record<string, unknown> {
    const transformed: Record<string, unknown> = {};

    if (pd.GalleryType) {
      transformed.GalleryType = pd.GalleryType;
    }
    if (pd.PictureURL) {
      const urls = pd.PictureURL as unknown[];
      transformed.PictureURL = Array.isArray(urls) ? urls : [urls];
    }

    return transformed;
  }

  /**
   * Transform ItemSpecifics into proper NameValueList XML structure.
   * eBay expects:
   * <ItemSpecifics>
   *   <NameValueList><Name>Brand</Name><Value>Nike</Value></NameValueList>
   * </ItemSpecifics>
   */
  private transformItemSpecifics(specifics: { name: string; value: string | string[] }[]): any {
    if (!Array.isArray(specifics)) return specifics;

    // eBay expects: <ItemSpecifics><NameValueList><Name>...</Name><Value>...</Value></NameValueList>...</ItemSpecifics>
    // fast-xml-parser XMLBuilder: when ItemSpecifics is in isArray list, it creates one <ItemSpecifics> per array item.
    // So we wrap each spec in { NameValueList: { Name, Value } } and return as a single object.
    // The caller (transformItemForXML) sets transformed['ItemSpecifics'] = this result.
    // To get a single <ItemSpecifics> with multiple <NameValueList>, we need to NOT return an array
    // but instead return the NameValueList array directly, and let the XMLBuilder handle it.
    // Actually: the cleanest approach is to return the array of NameValueList objects,
    // and since transformItemForXML assigns it to transformed['ItemSpecifics'], and
    // ItemSpecifics IS in the isArray list, XMLBuilder will emit multiple <ItemSpecifics>.
    // FIX: Return a single object with NameValueList array inside.
    return {
      NameValueList: specifics.map((spec) => ({
        Name: spec.name,
        Value: Array.isArray(spec.value) ? spec.value : [spec.value],
      })),
    };
  }

  async execute(
    callName: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const token = await this.restClient.getOAuthClient().getAccessToken();

    const requestTag = `${callName}Request`;
    const responseTag = `${callName}Response`;

    // Transform Item field for proper XML serialization
    const transformedParams: Record<string, unknown> = { ...params };
    if (transformedParams.Item && typeof transformedParams.Item === 'object') {
      transformedParams.Item = this.transformItemForXML(
        transformedParams.Item as Record<string, unknown>
      );
    }

    const xmlObj: Record<string, unknown> = {};
    xmlObj[requestTag] = {
      '@_xmlns': 'urn:ebay:apis:eBLBaseComponents',
      ...transformedParams,
    };

    const xmlBody = `<?xml version="1.0" encoding="utf-8"?>\n${this.builder.build(xmlObj)}`;

    apiLogger.debug(`Trading API ${callName}`, { xmlBody });

    let response;
    try {
      response = await axios.post(`${this.baseUrl}/ws/api.dll`, xmlBody, {
        headers: {
          'X-EBAY-API-SITEID': SITE_ID,
          'X-EBAY-API-COMPATIBILITY-LEVEL': COMPAT_LEVEL,
          'X-EBAY-API-CALL-NAME': callName,
          'X-EBAY-API-IAF-TOKEN': token,
          'Content-Type': 'text/xml',
        },
        timeout: 30000,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown HTTP error';
      throw new Error(`Trading API ${callName} request failed: ${message}`, { cause: error });
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = this.parser.parse(response.data) as Record<string, unknown>;
    } catch (e) {
      throw new Error(
        `Failed to parse Trading API ${callName} response: ${e instanceof Error ? e.message : String(e)}`,
        { cause: e }
      );
    }
    const result = (parsed[responseTag] || parsed) as Record<string, unknown>;

    // Log warnings without failing
    if (result.Ack === 'Warning') {
      apiLogger.warn(`Trading API ${callName} returned warnings`, {
        errors: result.Errors,
      });
    }

    // Check for eBay errors
    if (result.Ack === 'Failure' || result.Ack === 'PartialFailure') {
      const errors = result.Errors;
      const firstError = Array.isArray(errors) ? errors[0] : errors;
      const message =
        firstError?.ShortMessage || firstError?.LongMessage || 'Unknown Trading API error';
      throw new Error(message);
    }

    return result;
  }
}
