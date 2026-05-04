import type { EbayApiClient } from '../client.js';
import { getBaseUrl } from '@/config/environment.js';
import axios from 'axios';

/**
 * Commerce Media API (v1_beta) - Upload and manage images via eBay Picture Services
 * Based on: https://developer.ebay.com/api-docs/commerce/media/resources/image/from_url/methods
 */
export class MediaApi {
  private readonly basePath = '/commerce/media/v1';

  constructor(private client: EbayApiClient) {}

  private async getAccessToken(): Promise<string> {
    return await this.client.getOAuthClient().getAccessToken();
  }

  private getMediaBaseUrl(): string {
    const env = this.client.getConfig().environment;
    return getBaseUrl(env);
  }

  /**
   * Upload an image from a public URL to eBay Picture Services.
   *
   * Steps:
   * 1. POST /commerce/media/v1/image/from_url to create the image
   * 2. GET /commerce/media/v1/image/{imageId} to retrieve the hosted URL
   *
   * Supported formats: JPG, GIF, PNG, BMP, TIFF, AVIF, HEIC, WEBP
   * Max file size: 10MB per image
   *
   * @param imageUrl - Public URL of the image to upload
   * @param description - Optional description for the image
   * @returns Object with image ID and eBay-hosted image URL
   */
  async createImageFromUrl(
    imageUrl: string,
    description?: string
  ): Promise<{ id: string; imageUrl: string; description?: string }> {
    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new Error('imageUrl is required and must be a string');
    }

    const token = await this.getAccessToken();
    const baseUrl = this.getMediaBaseUrl();

    try {
      // Step 1: Create image from URL
      const body = { imageUrl };
      if (description) {
        Object.assign(body, { description });
      }

      const createResponse = await axios.post(
        `${baseUrl}${this.basePath}/image/from_url`,
        body,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          timeout: 30000,
        }
      );

      // Extract image ID from response body or Location header
      const responseData = createResponse.data as Record<string, unknown>;
      let imageId =
        typeof responseData.id === 'string'
          ? responseData.id
          : createResponse.headers['location']?.split('/').pop();

      if (!imageId) {
        throw new Error('No image ID returned from create endpoint');
      }

      // Step 2: Fetch image details to get the eBay-hosted URL
      return await this.getImage(imageId);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        const message =
          typeof data === 'object' && data !== null && 'errors' in data
            ? ((data as any).errors as any[])?.[0]?.longMessage ||
              ((data as any).errors as any[])?.[0]?.message ||
              error.message
            : error.message;
        throw new Error(
          `Failed to upload image from URL (status ${status}): ${message}`,
          { cause: error }
        );
      }
      throw new Error(
        `Failed to upload image from URL: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  /**
   * Get image details including the eBay-hosted URL.
   *
   * @param imageId - The image ID returned from createImageFromUrl
   * @returns Image details including hosted URL
   */
  async getImage(imageId: string): Promise<{ id: string; imageUrl: string; description?: string }> {
    if (!imageId || typeof imageId !== 'string') {
      throw new Error('imageId is required and must be a string');
    }

    const token = await this.getAccessToken();
    const baseUrl = this.getMediaBaseUrl();

    try {
      const response = await axios.get(`${baseUrl}${this.basePath}/image/${imageId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
        timeout: 30000,
      });

      const data = response.data as Record<string, unknown>;
      return {
        id: data.id as string,
        imageUrl: data.imageUrl as string,
        description: typeof data.description === 'string' ? (data.description as string) : undefined,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;
        const message =
          typeof data === 'object' && data !== null && 'errors' in data
            ? ((data as any).errors as any[])?.[0]?.longMessage ||
              ((data as any).errors as any[])?.[0]?.message ||
              error.message
            : error.message;
        throw new Error(
          `Failed to get image details (status ${status}): ${message}`,
          { cause: error }
        );
      }
      throw new Error(
        `Failed to get image details: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }
}
