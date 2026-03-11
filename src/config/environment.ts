import { config } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { EbayConfig } from '@/types/ebay.js';
import type { Implementation } from '@modelcontextprotocol/sdk/types.js';
import { LocaleEnum } from '@/types/ebay-enums.js';
import { getVersion } from '@/utils/version.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '../../.env'), quiet: true });

interface ScopeDefinition {
  Scope: string;
  Description: string;
}

interface EbaySecretConfigEntry {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

interface EbaySecretConfigFile {
  production?: EbaySecretConfigEntry;
  sandbox?: EbaySecretConfigEntry;
}

export type EbayEnvironment = 'production' | 'sandbox';

function readSecretConfigFile(): EbaySecretConfigFile | null {
  const configFile = process.env.EBAY_CONFIG_FILE;
  if (!configFile || !existsSync(configFile)) {
    return null;
  }

  try {
    const raw = readFileSync(configFile, 'utf-8');
    return JSON.parse(raw) as EbaySecretConfigFile;
  } catch (error) {
    console.error('Failed to load EBAY_CONFIG_FILE:', error);
    return null;
  }
}

function getSecretConfigForEnvironment(environment: EbayEnvironment): EbaySecretConfigEntry | null {
  const secretConfig = readSecretConfigFile();
  return secretConfig?.[environment] ?? null;
}

function getProductionScopes(): string[] {
  try {
    const scopesPath = join(__dirname, '../../docs/auth/production_scopes.json');
    const scopesData = readFileSync(scopesPath, 'utf-8');
    const scopes: ScopeDefinition[] = JSON.parse(scopesData);
    const uniqueScopes = new Set<string>();
    scopes.forEach((item) => {
      if (item.Scope) {
        uniqueScopes.add(item.Scope);
      }
    });
    return Array.from(uniqueScopes);
  } catch (error) {
    console.error('Failed to load production scopes:', error);
    return ['https://api.ebay.com/oauth/api_scope'];
  }
}

function getSandboxScopes(): string[] {
  try {
    const scopesPath = join(__dirname, '../../docs/auth/sandbox_scopes.json');
    const scopesData = readFileSync(scopesPath, 'utf-8');
    const scopes: ScopeDefinition[] = JSON.parse(scopesData);
    const uniqueScopes = new Set<string>();
    scopes.forEach((item) => {
      if (item.Scope) {
        uniqueScopes.add(item.Scope);
      }
    });
    return Array.from(uniqueScopes);
  } catch (error) {
    console.error('Failed to load sandbox scopes:', error);
    return ['https://api.ebay.com/oauth/api_scope'];
  }
}

export function getDefaultScopes(environment: EbayEnvironment): string[] {
  return environment === 'production' ? getProductionScopes() : getSandboxScopes();
}

export function getConfiguredEnvironment(): EbayEnvironment {
  const env = process.env.EBAY_ENVIRONMENT || process.env.EBAY_DEFAULT_ENVIRONMENT || 'production';
  return env === 'sandbox' ? 'sandbox' : 'production';
}

export function validateScopes(
  scopes: string[],
  environment: EbayEnvironment
): { warnings: string[]; validScopes: string[] } {
  const validScopes = getDefaultScopes(environment);
  const validScopeSet = new Set(validScopes);
  const warnings: string[] = [];
  const requestedValidScopes: string[] = [];

  scopes.forEach((scope) => {
    if (validScopeSet.has(scope)) {
      requestedValidScopes.push(scope);
    } else {
      const otherEnvironment = environment === 'production' ? 'sandbox' : 'production';
      const otherScopes = getDefaultScopes(otherEnvironment);
      if (otherScopes.includes(scope)) {
        warnings.push(
          `Scope "${scope}" is only available in ${otherEnvironment} environment, not in ${environment}.`
        );
      } else {
        warnings.push(`Scope "${scope}" is not recognized for ${environment} environment.`);
      }
      requestedValidScopes.push(scope);
    }
  });

  return { warnings, validScopes: requestedValidScopes };
}

export function validateEnvironmentConfig(): {
  isValid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  const environment = getConfiguredEnvironment();
  const configForEnv = getSecretConfigForEnvironment(environment);

  if (!configForEnv) {
    if (!process.env.EBAY_CLIENT_ID) {
      errors.push('Missing eBay client ID for selected environment');
    }
    if (!process.env.EBAY_CLIENT_SECRET) {
      errors.push('Missing eBay client secret for selected environment');
    }
    if (!process.env.EBAY_REDIRECT_URI) {
      warnings.push('EBAY_REDIRECT_URI is not set for selected environment.');
    }
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
  };
}

export function getEbayConfig(environmentOverride?: EbayEnvironment): EbayConfig {
  const environment = environmentOverride ?? getConfiguredEnvironment();
  const secretConfig = getSecretConfigForEnvironment(environment);

  const fallbackClientId =
    environment === 'production'
      ? process.env.EBAY_PRODUCTION_CLIENT_ID || process.env.EBAY_CLIENT_ID || ''
      : process.env.EBAY_SANDBOX_CLIENT_ID || process.env.EBAY_CLIENT_ID || '';

  const fallbackClientSecret =
    environment === 'production'
      ? process.env.EBAY_PRODUCTION_CLIENT_SECRET || process.env.EBAY_CLIENT_SECRET || ''
      : process.env.EBAY_SANDBOX_CLIENT_SECRET || process.env.EBAY_CLIENT_SECRET || '';

  const fallbackRedirectUri =
    environment === 'production'
      ? process.env.EBAY_PRODUCTION_REDIRECT_URI || process.env.EBAY_REDIRECT_URI
      : process.env.EBAY_SANDBOX_REDIRECT_URI || process.env.EBAY_REDIRECT_URI;

  return {
    clientId: secretConfig?.clientId || fallbackClientId,
    clientSecret: secretConfig?.clientSecret || fallbackClientSecret,
    redirectUri: secretConfig?.redirectUri || fallbackRedirectUri,
    marketplaceId: (process.env.EBAY_MARKETPLACE_ID ?? '').trim() || 'EBAY_US',
    contentLanguage: (process.env.EBAY_CONTENT_LANGUAGE ?? '').trim() || 'en-US',
    environment,
    accessToken: process.env.EBAY_USER_ACCESS_TOKEN ?? '',
    refreshToken: process.env.EBAY_USER_REFRESH_TOKEN ?? '',
    appAccessToken: process.env.EBAY_APP_ACCESS_TOKEN ?? '',
  };
}

export function getBaseUrl(environment: EbayEnvironment): string {
  return environment === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com';
}

export function getIdentityBaseUrl(environment: EbayEnvironment): string {
  return environment === 'production' ? 'https://apiz.ebay.com' : 'https://apiz.sandbox.ebay.com';
}

export function getAuthUrl(environment: EbayEnvironment): string;
export function getAuthUrl(
  clientId: string,
  redirectUri: string | undefined,
  environment: EbayEnvironment,
  locale?: LocaleEnum,
  prompt?: 'login' | 'consent',
  responseType?: 'code',
  state?: string,
  scopes?: string[]
): string;
export function getAuthUrl(
  clientIdOrEnvironment: string,
  redirectUri?: string,
  environment?: EbayEnvironment,
  locale: LocaleEnum = LocaleEnum.en_US,
  prompt: 'login' | 'consent' = 'login',
  responseType: 'code' = 'code',
  state?: string,
  scopes?: string[]
): string {
  if (
    arguments.length === 1 &&
    (clientIdOrEnvironment === 'production' || clientIdOrEnvironment === 'sandbox')
  ) {
    return `${getBaseUrl(clientIdOrEnvironment as EbayEnvironment)}/identity/v1/oauth2/token`;
  }

  const clientId = clientIdOrEnvironment;
  const env = environment ?? 'sandbox';
  const scope = getDefaultScopes(env);

  if (!(clientId && redirectUri)) {
    console.error('clientId and redirectUri are required.');
    return '';
  }

  const authBase = env === 'production' ? 'https://auth.ebay.com' : 'https://auth.sandbox.ebay.com';
  const scopeList = scopes?.join('%20') || scope.join('%20');
  const authorizeParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: responseType,
    prompt,
    locale,
    ...(state ? { state } : {}),
  });

  return `${authBase}/oauth2/authorize?${authorizeParams.toString()}&scope=${scopeList}`;
}

export function getOAuthAuthorizationUrl(
  clientId: string,
  redirectUri: string,
  environment: EbayEnvironment,
  scopes?: string[],
  locale?: string,
  state?: string
): string {
  const authBase =
    environment === 'production' ? 'https://auth.ebay.com' : 'https://auth.sandbox.ebay.com';
  const scopeList = (scopes && scopes.length > 0 ? scopes : getDefaultScopes(environment)).join('%20');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    ...(locale ? { locale } : {}),
    ...(state ? { state } : {}),
  });
  return `${authBase}/oauth2/authorize?${params.toString()}&scope=${scopeList}`;
}

const iconUrl = (size: string): string => {
  const url = new URL(`../../public/icons/${size}.png`, import.meta.url);
  const path = fileURLToPath(url);
  if (!existsSync(path)) {
    console.warn(`[eBay MCP] Icon not found at ${path}.`);
  }
  return url.toString();
};

export const mcpConfig: Implementation = {
  name: 'eBay API Model Context Protocol Server',
  version: getVersion(),
  title: 'eBay API Model Context Protocol Server',
  websiteUrl: 'https://github.com/YosefHayim/ebay-mcp',
  icons: [
    { src: iconUrl('16x16'), mimeType: 'image/png', sizes: ['16x16'] },
    { src: iconUrl('32x32'), mimeType: 'image/png', sizes: ['32x32'] },
    { src: iconUrl('48x48'), mimeType: 'image/png', sizes: ['48x48'] },
    { src: iconUrl('128x128'), mimeType: 'image/png', sizes: ['128x128'] },
    { src: iconUrl('256x256'), mimeType: 'image/png', sizes: ['256x256'] },
    { src: iconUrl('512x512'), mimeType: 'image/png', sizes: ['512x512'] },
    { src: iconUrl('1024x1024'), mimeType: 'image/png', sizes: ['1024x1024'] },
  ],
};
