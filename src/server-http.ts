/**
 * eBay API MCP Server with HTTP Transport.
 *
 * Hosted mode for single-user private deployments on Render:
 * - Streamable HTTP MCP transport
 * - Health and status endpoints
 * - Server-side eBay OAuth start/callback flow
 * - Bearer-token auth can still be enabled for MCP endpoints via OAUTH_ENABLED
 */

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { EbaySellerApi } from '@/api/index.js';
import {
  getEbayConfig,
  getDefaultScopes,
  validateEnvironmentConfig,
  getOAuthAuthorizationUrl,
} from '@/config/environment.js';
import { getToolDefinitions, executeTool } from '@/tools/index.js';
import { TokenVerifier } from '@/auth/token-verifier.js';
import { createBearerAuthMiddleware } from '@/auth/oauth-middleware.js';
import { createMetadataRouter, getProtectedResourceMetadataUrl } from '@/auth/oauth-metadata.js';
import { getVersion } from '@/utils/version.js';
import { serverLogger } from '@/utils/logger.js';

const CONFIG = {
  host: process.env.MCP_HOST || '0.0.0.0',
  port: Number(process.env.PORT || process.env.MCP_PORT || 3000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  authEnabled: process.env.OAUTH_ENABLED === 'true',
  oauth: {
    authServerUrl: process.env.OAUTH_AUTH_SERVER_URL ?? 'http://localhost:8080/realms/master',
    clientId: process.env.OAUTH_CLIENT_ID,
    clientSecret: process.env.OAUTH_CLIENT_SECRET,
    requiredScopes: (process.env.OAUTH_REQUIRED_SCOPES || 'mcp:tools')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    useIntrospection: process.env.OAUTH_USE_INTROSPECTION !== 'false',
  },
};

function getServerBaseUrl(): string {
  if (CONFIG.publicBaseUrl) {
    return CONFIG.publicBaseUrl;
  }
  return `http://localhost:${CONFIG.port}`;
}

function getAuthServerMetadataUrl(): string {
  const baseUrl = CONFIG.oauth.authServerUrl;
  if (baseUrl.includes('/realms/')) {
    return `${baseUrl}/.well-known/openid-configuration`;
  }
  return `${baseUrl}/.well-known/oauth-authorization-server`;
}

async function createHostedApi(): Promise<EbaySellerApi> {
  const api = new EbaySellerApi(getEbayConfig());
  await api.initialize();
  return api;
}

async function createApp(): Promise<express.Application> {
  const app = express();
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectRoot = join(__dirname, '..');

  app.use(
    cors({
      origin: '*',
      exposedHeaders: ['Mcp-Session-Id'],
    })
  );
  app.use(express.json());
  app.use(helmet({ xPoweredBy: false }));

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      serverLogger.info(`${req.method} ${req.path} -> ${res.statusCode}`, { durationMs: duration });
    });
    next();
  });

  const serverUrl = getServerBaseUrl();
  const iconBaseUrl = `${serverUrl}/icons`;
  app.use('/icons', express.static(join(projectRoot, 'public', 'icons')));

  const ebayConfig = getEbayConfig();
  const metadataRouter = createMetadataRouter({
    resourceServerUrl: serverUrl,
    authServerMetadata: getAuthServerMetadataUrl(),
    scopesSupported: CONFIG.oauth.requiredScopes,
    resourceDocumentation: 'https://github.com/YosefHayim/ebay-mcp',
    resourceName: 'eBay API MCP Server',
    ebayEnvironment: ebayConfig.environment,
    ebayScopes: getDefaultScopes(ebayConfig.environment),
  });
  app.use(metadataRouter);

  app.get('/', (_req, res) => {
    res.json({
      name: 'ebay-mcp',
      version: getVersion(),
      mode: 'single-user-private-hosted',
      mcp_endpoint: `${serverUrl}/mcp`,
      oauth_start_url: `${serverUrl}/oauth/start`,
      health_url: `${serverUrl}/health`,
    });
  });

  app.get('/health', async (_req, res) => {
    try {
      const api = await createHostedApi();
      const tokenInfo = api.getTokenInfo();
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: getVersion(),
        mode: 'single-user-hosted',
        oauth_enabled: CONFIG.authEnabled,
        has_user_token: tokenInfo.hasUserToken,
        has_app_token: tokenInfo.hasAppAccessToken,
      });
    } catch (error) {
      res.status(500).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/status', async (_req, res) => {
    try {
      const api = await createHostedApi();
      const tokenInfo = api.getTokenInfo();
      res.json({
        name: 'ebay-mcp',
        version: getVersion(),
        mode: 'single-user-private-hosted',
        environment: ebayConfig.environment,
        token_store_path: process.env.EBAY_TOKEN_STORE_PATH || '.ebay-user-tokens.json',
        has_user_token: tokenInfo.hasUserToken,
        has_app_token: tokenInfo.hasAppAccessToken,
        oauth_start_url: `${serverUrl}/oauth/start`,
        callback_url: `${serverUrl}/oauth/callback`,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/oauth/start', (_req, res) => {
    try {
      if (!ebayConfig.clientId || !ebayConfig.clientSecret) {
        res.status(500).json({ error: 'Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET' });
        return;
      }
      if (!ebayConfig.redirectUri) {
        res.status(500).json({
          error:
            'Missing EBAY_REDIRECT_URI. Set this to your eBay RuName configured for your hosted callback.',
        });
        return;
      }

      const state = randomUUID();
      const oauthUrl = getOAuthAuthorizationUrl(
        ebayConfig.clientId,
        ebayConfig.redirectUri,
        ebayConfig.environment,
        getDefaultScopes(ebayConfig.environment),
        ebayConfig.locale,
        state
      );

      res.redirect(oauthUrl);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/oauth/callback', async (req, res) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code : undefined;
      const error = typeof req.query.error === 'string' ? req.query.error : undefined;
      const errorDescription =
        typeof req.query.error_description === 'string' ? req.query.error_description : undefined;

      if (error) {
        res.status(400).json({
          error,
          error_description: errorDescription || 'Authorization declined or failed',
        });
        return;
      }

      if (!code) {
        res.status(400).json({
          error: 'missing_code',
          error_description: 'No authorization code was returned by eBay.',
        });
        return;
      }

      const api = await createHostedApi();
      const oauthClient = api.getAuthClient().getOAuthClient();
      const tokenData = await oauthClient.exchangeCodeForToken(code);

      res.status(200).json({
        status: 'ok',
        message: 'eBay authorization completed and tokens were stored server-side.',
        expires_in: tokenData.expires_in,
        refresh_token_expires_in: tokenData.refresh_token_expires_in,
        scope: tokenData.scope,
      });
    } catch (callbackError) {
      res.status(500).json({
        error: 'token_exchange_failed',
        error_description:
          callbackError instanceof Error ? callbackError.message : String(callbackError),
      });
    }
  });

  let authMiddleware: express.RequestHandler | undefined;

  if (CONFIG.authEnabled) {
    const tokenVerifier = new TokenVerifier({
      authServerMetadata: getAuthServerMetadataUrl(),
      clientId: CONFIG.oauth.clientId,
      clientSecret: CONFIG.oauth.clientSecret,
      expectedAudience: serverUrl,
      requiredScopes: CONFIG.oauth.requiredScopes,
      useIntrospection: CONFIG.oauth.useIntrospection,
    });

    await tokenVerifier.initialize();
    authMiddleware = createBearerAuthMiddleware({
      verifier: tokenVerifier,
      resourceMetadataUrl: getProtectedResourceMetadataUrl(serverUrl),
      realm: 'ebay-mcp',
    });
  }

  const transports = new Map<string, StreamableHTTPServerTransport>();

  async function createMcpServer(): Promise<McpServer> {
    const api = await createHostedApi();
    const server = new McpServer({
      name: 'ebay-mcp',
      version: getVersion(),
      title: 'eBay API MCP Server',
      websiteUrl: 'https://github.com/YosefHayim/ebay-mcp',
      icons: [
        { src: `${iconBaseUrl}/16x16.png`, mimeType: 'image/png', sizes: ['16x16'] },
        { src: `${iconBaseUrl}/32x32.png`, mimeType: 'image/png', sizes: ['32x32'] },
        { src: `${iconBaseUrl}/48x48.png`, mimeType: 'image/png', sizes: ['48x48'] },
        { src: `${iconBaseUrl}/128x128.png`, mimeType: 'image/png', sizes: ['128x128'] },
        { src: `${iconBaseUrl}/256x256.png`, mimeType: 'image/png', sizes: ['256x256'] },
        { src: `${iconBaseUrl}/512x512.png`, mimeType: 'image/png', sizes: ['512x512'] },
        { src: `${iconBaseUrl}/1024x1024.png`, mimeType: 'image/png', sizes: ['1024x1024'] },
      ],
    });

    const tools = getToolDefinitions();
    for (const toolDef of tools) {
      server.registerTool(
        toolDef.name,
        {
          description: toolDef.description,
          inputSchema: toolDef.inputSchema,
        },
        async (args: Record<string, unknown>) => {
          try {
            const result = await executeTool(api, toolDef.name, args);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return {
              content: [
                { type: 'text' as const, text: JSON.stringify({ error: errorMessage }, null, 2) },
              ],
              isError: true,
            };
          }
        }
      );
    }

    return server;
  }

  const mcpPostHandler = async (req: express.Request, res: express.Response): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports.set(newSessionId, transport);
          serverLogger.info('New MCP session initialized', { sessionId: newSessionId });
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
          serverLogger.info('MCP session closed', { sessionId: transport.sessionId });
        }
      };

      const server = await createMcpServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: No valid session ID provided',
        },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  };

  const handleSessionRequest = async (
    req: express.Request,
    res: express.Response
  ): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({
        error: 'invalid_session',
        error_description: 'Invalid or missing session ID',
      });
      return;
    }

    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  };

  app.post('/mcp', ...(authMiddleware ? [authMiddleware, mcpPostHandler] : [mcpPostHandler]));
  app.get('/mcp', ...(authMiddleware ? [authMiddleware, handleSessionRequest] : [handleSessionRequest]));
  app.delete('/mcp', ...(authMiddleware ? [authMiddleware, handleSessionRequest] : [handleSessionRequest]));

  return app;
}

async function main() {
  try {
    console.log('Starting eBay API MCP Server (hosted HTTP mode)...');
    console.log();

    const validation = validateEnvironmentConfig();
    if (validation.warnings.length > 0) {
      console.log('Environment Configuration Warnings:');
      validation.warnings.forEach((warning) => console.log(`  • ${warning}`));
      console.log();
    }

    if (!validation.isValid) {
      console.error('Environment Configuration Errors:');
      validation.errors.forEach((error) => console.error(`  • ${error}`));
      console.error('\nPlease fix the configuration errors and restart the server.\n');
      process.exit(1);
    }

    console.log('Configuration:');
    console.log(`Host: ${CONFIG.host}`);
    console.log(`Port: ${CONFIG.port}`);
    console.log(`Public Base URL: ${getServerBaseUrl()}`);
    console.log(`OAuth Enabled: ${CONFIG.authEnabled}`);

    const app = await createApp();
    const server = app.listen(CONFIG.port, CONFIG.host, () => {
      const serverUrl = getServerBaseUrl();
      console.log('Server is running!');
      console.log();
      console.log(`Root: ${serverUrl}/`);
      console.log(`Status: ${serverUrl}/status`);
      console.log(`Health: ${serverUrl}/health`);
      console.log(`OAuth Start: ${serverUrl}/oauth/start`);
      console.log(`OAuth Callback: ${serverUrl}/oauth/callback`);
      console.log(`MCP endpoint: ${serverUrl}/mcp`);
      console.log();
    });

    process.on('SIGINT', () => {
      console.log('\nShutting down...');
      server.close(() => {
        console.log('✓ Server closed');
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('Fatal error starting server:', error);
    process.exit(1);
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
const modulePath = resolve(fileURLToPath(import.meta.url));
if (entryPath && modulePath === entryPath) {
  await main();
}
