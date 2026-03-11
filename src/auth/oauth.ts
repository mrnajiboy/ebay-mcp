import axios from 'axios';
import { getBaseUrl, getDefaultScopes } from '@/config/environment.js';
import type {
  EbayAppAccessTokenResponse,
  EbayConfig,
  EbayUserToken,
  StoredTokenData,
} from '@/types/ebay.js';
import { LocaleEnum } from '@/types/ebay-enums.js';
import dotenv from 'dotenv';
import stringify from 'dotenv-stringify';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { authLogger } from '@/utils/logger.js';
import { EbayTokenStore } from '@/auth/token-store.js';

function updateEnvFile(updates: Record<string, string>): void {
  try {
    if (process.env.EBAY_TOKEN_PERSISTENCE_MODE === 'file-only') {
      return;
    }

    const envPath = join(process.cwd(), '.env');
    const existingEnv = existsSync(envPath) ? dotenv.parse(readFileSync(envPath, 'utf-8')) : {};
    const mergedEnv = { ...existingEnv, ...updates };
    const safeEnvContent = stringify(mergedEnv);
    writeFileSync(envPath, safeEnvContent, 'utf-8');
  } catch (_error) {
    // Silent failure by design for MCP usage.
  }
}

export class EbayOAuthClient {
  private appAccessToken: string | null = null;
  private appAccessTokenExpiry = 0;
  private userTokens: StoredTokenData | null = null;
  private tokenStore = new EbayTokenStore();

  constructor(private config: EbayConfig) {}

  private persistTokenState(): void {
    this.tokenStore.save({
      userTokens: this.userTokens,
      appAccessToken: this.appAccessToken,
      appAccessTokenExpiry: this.appAccessTokenExpiry,
      updatedAt: new Date().toISOString(),
    });
  }

  async initialize(): Promise<void> {
    const persisted = this.tokenStore.load();
    if (persisted?.userTokens) {
      this.userTokens = persisted.userTokens;
      this.appAccessToken = persisted.appAccessToken || null;
      this.appAccessTokenExpiry = persisted.appAccessTokenExpiry || 0;
      authLogger.info('Loaded tokens from token store', { path: this.tokenStore.getPath() });
    }

    const envRefreshToken = process.env.EBAY_USER_REFRESH_TOKEN;
    const envAccessToken = process.env.EBAY_USER_ACCESS_TOKEN;
    const envAppToken = process.env.EBAY_APP_ACCESS_TOKEN ?? '';
    const locale = this.config?.locale || LocaleEnum.en_US;

    if (!this.userTokens && envRefreshToken) {
      authLogger.info('Loading tokens from environment variables');
      const now = Date.now();
      this.userTokens = {
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        userAccessToken: envAccessToken || '',
        userRefreshToken: envRefreshToken,
        redirectUri: this.config.redirectUri,
        envAppToken,
        tokenType: 'Bearer',
        locale,
        userAccessTokenExpiry: now + 7200 * 1000,
        userRefreshTokenExpiry: now + 18 * 30 * 24 * 60 * 60 * 1000,
      };
      this.persistTokenState();
    }

    if (this.userTokens?.userRefreshToken) {
      authLogger.info('Refreshing access token using available refresh token');
      try {
        await this.refreshUserToken();
        authLogger.info('Access token refreshed successfully');
        await this.getOrRefreshAppAccessToken();
      } catch (error) {
        authLogger.error('Failed to refresh access token', {
          error: error instanceof Error ? error.message : String(error),
          hint: 'The stored EBAY_USER_REFRESH_TOKEN may be invalid or expired',
        });
      }
    }
  }

  hasUserTokens(): boolean {
    return this.userTokens !== null;
  }

  private isUserAccessTokenExpired(tokens: StoredTokenData): boolean {
    return tokens.userAccessTokenExpiry ? Date.now() >= tokens.userAccessTokenExpiry : true;
  }

  private isUserRefreshTokenExpired(tokens: StoredTokenData): boolean {
    return tokens.userRefreshTokenExpiry ? Date.now() >= tokens.userRefreshTokenExpiry : true;
  }

  async getAccessToken(): Promise<string> {
    if (this.userTokens) {
      if (!this.isUserAccessTokenExpired(this.userTokens)) {
        return this.userTokens.userAccessToken;
      }

      if (!this.isUserRefreshTokenExpired(this.userTokens)) {
        try {
          await this.refreshUserToken();
          return this.userTokens.userAccessToken;
        } catch (error) {
          authLogger.error('Failed to refresh user token, falling back to app access token', {
            error: error instanceof Error ? error.message : String(error),
          });
          throw new Error(
            'Hosted eBay user token refresh failed. Visit /oauth/start to reconnect the seller account.'
          );
        }
      }

      authLogger.error('User refresh token expired. User needs to re-authorize.');
      this.userTokens = null;
      this.persistTokenState();
      throw new Error('User authorization expired. Visit /oauth/start to reconnect the seller account.');
    }

    if (this.appAccessToken && Date.now() < this.appAccessTokenExpiry) {
      return this.appAccessToken;
    }

    await this.getOrRefreshAppAccessToken();
    return this.appAccessToken!;
  }

  setUserTokens(
    accessToken: string,
    refreshToken: string,
    accessTokenExpiry?: number,
    refreshTokenExpiry?: number
  ): void {
    const now = Date.now();
    this.userTokens = {
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      redirectUri: this.config.redirectUri,
      userAccessToken: accessToken,
      userRefreshToken: refreshToken,
      tokenType: 'Bearer',
      userAccessTokenExpiry: accessTokenExpiry ?? now + 7200 * 1000,
      userRefreshTokenExpiry: refreshTokenExpiry ?? now + 18 * 30 * 24 * 60 * 60 * 1000,
    };

    this.persistTokenState();
    updateEnvFile({
      EBAY_USER_ACCESS_TOKEN: accessToken,
      EBAY_USER_REFRESH_TOKEN: refreshToken,
    });
  }

  async getOrRefreshAppAccessToken(): Promise<string> {
    if (this.appAccessToken && Date.now() < this.appAccessTokenExpiry) {
      return this.appAccessToken;
    }

    const authUrl = `${getBaseUrl(this.config.environment)}/identity/v1/oauth2/token`;
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64'
    );
    const scopeParam = 'https://api.ebay.com/oauth/api_scope';

    try {
      const response = await axios.post<EbayAppAccessTokenResponse>(
        authUrl,
        new URLSearchParams({ grant_type: 'client_credentials', scope: scopeParam }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${credentials}`,
          },
        }
      );

      this.appAccessToken = response.data.access_token;
      this.appAccessTokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;
      this.persistTokenState();
      updateEnvFile({ EBAY_APP_ACCESS_TOKEN: this.appAccessToken });
      return this.appAccessToken;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to get app access token: ${error.response?.data?.error_description || error.message}`
        );
      }
      throw error;
    }
  }

  async exchangeCodeForToken(code: string): Promise<EbayUserToken> {
    if (!this.config.redirectUri) {
      throw new Error('Redirect URI is required for authorization code exchange');
    }

    const tokenUrl = `${getBaseUrl(this.config.environment)}/identity/v1/oauth2/token`;
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64'
    );

    try {
      const response = await axios.post(
        tokenUrl,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.config.redirectUri,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${credentials}`,
          },
        }
      );

      const tokenData: EbayUserToken = response.data;
      const now = Date.now();
      this.userTokens = {
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        redirectUri: this.config.redirectUri,
        userAccessToken: tokenData.access_token,
        userRefreshToken: tokenData.refresh_token,
        tokenType: tokenData.token_type,
        userAccessTokenExpiry: now + tokenData.expires_in * 1000,
        userRefreshTokenExpiry: now + tokenData.refresh_token_expires_in * 1000,
        scope: tokenData.scope,
      };

      this.persistTokenState();
      updateEnvFile({
        EBAY_USER_ACCESS_TOKEN: tokenData.access_token,
        EBAY_USER_REFRESH_TOKEN: tokenData.refresh_token,
      });

      return tokenData;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to exchange code for token: ${error.response?.data?.error_description || error.message}`
        );
      }
      throw error;
    }
  }

  async refreshUserToken(): Promise<void> {
    if (!this.userTokens) {
      throw new Error('No user tokens available to refresh. Visit /oauth/start to authorize.');
    }

    const authUrl = `${getBaseUrl(this.config.environment)}/identity/v1/oauth2/token`;
    const credentials = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      'base64'
    );

    try {
      const params: Record<string, string> = {
        grant_type: 'refresh_token',
        refresh_token: this.userTokens.userRefreshToken,
      };

      const response = await axios.post(authUrl, new URLSearchParams(params).toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
      });

      const tokenData: EbayUserToken = response.data;
      const now = Date.now();
      this.userTokens = {
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        redirectUri: this.config.redirectUri,
        userAccessToken: tokenData.access_token,
        userRefreshToken: tokenData.refresh_token || this.userTokens.userRefreshToken,
        tokenType: tokenData.token_type,
        userAccessTokenExpiry: now + tokenData.expires_in * 1000,
        userRefreshTokenExpiry: tokenData.refresh_token_expires_in
          ? now + tokenData.refresh_token_expires_in * 1000
          : this.userTokens.userRefreshTokenExpiry,
        scope: tokenData.scope || this.userTokens.scope,
      };

      this.persistTokenState();

      const envUpdates: Record<string, string> = {
        EBAY_USER_ACCESS_TOKEN: tokenData.access_token,
      };
      if (
        tokenData.refresh_token &&
        tokenData.refresh_token !== process.env.EBAY_USER_REFRESH_TOKEN
      ) {
        envUpdates.EBAY_USER_REFRESH_TOKEN = tokenData.refresh_token;
      }
      updateEnvFile(envUpdates);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to refresh token: ${error.response?.data?.error_description || error.message}`
        );
      }
      throw error;
    }
  }

  isAuthenticated(): boolean {
    if (this.userTokens && !this.isUserAccessTokenExpired(this.userTokens)) {
      return true;
    }
    return this.appAccessToken !== null && Date.now() < this.appAccessTokenExpiry;
  }

  clearAllTokens(): void {
    this.appAccessToken = null;
    this.appAccessTokenExpiry = 0;
    this.userTokens = null;
    this.persistTokenState();
  }

  getTokenInfo(): {
    hasUserToken: boolean;
    hasAppAccessToken: boolean;
    scopeInfo?: { tokenScopes: string[]; environmentScopes: string[]; missingScopes: string[] };
  } {
    const info: {
      hasUserToken: boolean;
      hasAppAccessToken: boolean;
      scopeInfo?: { tokenScopes: string[]; environmentScopes: string[]; missingScopes: string[] };
    } = {
      hasUserToken: this.userTokens !== null && !this.isUserAccessTokenExpired(this.userTokens),
      hasAppAccessToken: this.appAccessToken !== null && Date.now() < this.appAccessTokenExpiry,
    };

    if (this.userTokens?.scope) {
      const tokenScopes = this.userTokens.scope.split(' ');
      const environmentScopes = getDefaultScopes(this.config.environment);
      const tokenScopeSet = new Set(tokenScopes);
      const missingScopes = environmentScopes.filter((scope) => !tokenScopeSet.has(scope));
      info.scopeInfo = { tokenScopes, environmentScopes, missingScopes };
    }

    return info;
  }

  getUserTokens(): StoredTokenData | null {
    return this.userTokens;
  }

  getCachedAppAccessToken(): string | null {
    return this.appAccessToken;
  }

  getCachedAppAccessTokenExpiry(): number {
    return this.appAccessTokenExpiry;
  }
}
