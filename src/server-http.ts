import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { EbaySellerApi } from '@/api/index.js';
import {
  getConfiguredEnvironment,
  getDefaultScopes,
  getEbayConfig,
  getOAuthAuthorizationUrl,
  type EbayEnvironment,
} from '@/config/environment.js';
import { getToolDefinitions, executeTool } from '@/tools/index.js';
import { getVersion } from '@/utils/version.js';
import { serverLogger } from '@/utils/logger.js';
import { MultiUserAuthStore } from '@/auth/multi-user-store.js';

const CONFIG = {
  host: process.env.MCP_HOST || '0.0.0.0',
  port: Number(process.env.PORT || process.env.MCP_PORT || 3000),
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  adminApiKey: process.env.ADMIN_API_KEY || '',
};

const authStore = new MultiUserAuthStore();

function getServerBaseUrl(): string {
  return CONFIG.publicBaseUrl || `http://localhost:${CONFIG.port}`;
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!CONFIG.adminApiKey) {
    res.status(500).json({ error: 'ADMIN_API_KEY is not configured' });
    return;
  }
  const header = req.headers['x-admin-api-key'];
  if (header !== CONFIG.adminApiKey) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

async function createUserScopedApi(userId: string, environment: EbayEnvironment): Promise<EbaySellerApi> {
  const api = new EbaySellerApi(getEbayConfig(environment), { userId, environment });
  await api.initialize();
  return api;
}

async function createApp(): Promise<express.Application> {
  const app = express();
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const projectRoot = join(__dirname, '..');

  app.use(cors({ origin: '*', exposedHeaders: ['Mcp-Session-Id'] }));
  app.use(express.json());
  app.use(helmet({ xPoweredBy: false }));
  app.use('/icons', express.static(join(projectRoot, 'public', 'icons')));

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      serverLogger.info(`${req.method} ${req.path} -> ${res.statusCode}`, { durationMs: Date.now() - start });
    });
    next();
  });

  const serverUrl = getServerBaseUrl();
  const iconBaseUrl = `${serverUrl}/icons`;

  app.get('/', (_req, res) => {
    res.json({
      name: 'ebay-mcp',
      version: getVersion(),
      mode: 'multi-user-hosted',
      oauth_start: `${serverUrl}/oauth/start?env=${getConfiguredEnvironment()}`,
      mcp_endpoint: `${serverUrl}/mcp`,
    });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString(), version: getVersion() });
  });

  app.get('/oauth/start', async (req, res) => {
    try {
      const environment = ((typeof req.query.env === 'string' ? req.query.env : undefined) || getConfiguredEnvironment()) as EbayEnvironment;
      const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : undefined;
      const ebayConfig = getEbayConfig(environment);
      if (!ebayConfig.clientId || !ebayConfig.clientSecret || !ebayConfig.redirectUri) {
        res.status(500).json({ error: `Missing eBay configuration for ${environment}` });
        return;
      }
      const stateRecord = await authStore.createOAuthState(environment, returnTo);
      const oauthUrl = getOAuthAuthorizationUrl(
        ebayConfig.clientId,
        ebayConfig.redirectUri,
        environment,
        ['https://api.ebay.com/oauth/api_scope'],
        undefined,
        stateRecord.state
      );
      res.redirect(oauthUrl);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/oauth/callback', async (req, res) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code : undefined;
      const state = typeof req.query.state === 'string' ? req.query.state : undefined;
      const oauthError = typeof req.query.error === 'string' ? req.query.error : undefined;
      const errorDescription = typeof req.query.error_description === 'string' ? req.query.error_description : undefined;

      if (oauthError) {
        res.status(400).send(`<h1>OAuth failed</h1><p>${htmlEscape(errorDescription || oauthError)}</p>`);
        return;
      }
      if (!code || !state) {
        res.status(400).send('<h1>Missing code or state</h1>');
        return;
      }

      const stateRecord = await authStore.consumeOAuthState(state);
      if (!stateRecord) {
        res.status(400).send('<h1>Invalid or expired OAuth state</h1>');
        return;
      }

      const environment = stateRecord.environment;
      const userId = randomUUID();
      const api = await createUserScopedApi(userId, environment);
      const oauthClient = api.getAuthClient().getOAuthClient();
      const tokenData = await oauthClient.exchangeCodeForToken(code);
      const session = await authStore.createSession(userId, environment);

      res.status(200).send(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>eBay MCP Connected</title></head>
  <body style="font-family: sans-serif; max-width: 720px; margin: 40px auto; line-height: 1.5;">
    <h1>eBay account connected</h1>
    <p>Your ${htmlEscape(environment)} account has been connected successfully.</p>
    <p><strong>User ID:</strong> <code>${htmlEscape(userId)}</code></p>
    <p><strong>Session Token:</strong></p>
    <pre style="white-space: pre-wrap; word-break: break-all; background: #f5f5f5; padding: 12px; border-radius: 8px;">${htmlEscape(session.sessionToken)}</pre>
    <p>Use this in your MCP client as:</p>
    <pre style="background: #f5f5f5; padding: 12px; border-radius: 8px;">Authorization: Bearer ${htmlEscape(session.sessionToken)}</pre>
    <p><strong>Scopes granted:</strong> ${htmlEscape(tokenData.scope || '')}</p>
  </body>
</html>`);
    } catch (error) {
      res.status(500).send(`<h1>OAuth callback failed</h1><pre>${htmlEscape(error instanceof Error ? error.message : String(error))}</pre>`);
    }
  });

  app.get('/admin/session/:sessionToken', requireAdmin, async (req, res) => {
    const session = await authStore.getSession(req.params.sessionToken);
    if (!session) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(session);
  });

  app.post('/admin/session/:sessionToken/revoke', requireAdmin, async (req, res) => {
    await authStore.revokeSession(req.params.sessionToken);
    res.json({ ok: true, revoked: true });
  });

  app.delete('/admin/session/:sessionToken', requireAdmin, async (req, res) => {
    await authStore.deleteSession(req.params.sessionToken);
    res.json({ ok: true, deleted: true });
  });

  const transports = new Map<string, StreamableHTTPServerTransport>();

  const authenticateSession = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'missing_session_token' });
      return;
    }
    const sessionToken = authHeader.slice('Bearer '.length).trim();
    const session = await authStore.getSession(sessionToken);
    if (!session || session.revokedAt) {
      res.status(401).json({ error: 'invalid_session_token' });
      return;
    }
    await authStore.touchSession(sessionToken);
    (req as express.Request & { userContext?: { userId: string; environment: EbayEnvironment; sessionToken: string } }).userContext = {
      userId: session.userId,
      environment: session.environment,
      sessionToken,
    };
    next();
  };

  async function createMcpServer(userId: string, environment: EbayEnvironment): Promise<McpServer> {
    const api = await createUserScopedApi(userId, environment);
    const server = new McpServer({
      name: 'ebay-mcp',
      version: getVersion(),
      title: 'eBay API MCP Server',
      websiteUrl: 'https://github.com/YosefHayim/ebay-mcp',
      icons: [
        { src: `${iconBaseUrl}/16x16.png`, mimeType: 'image/png', sizes: ['16x16'] },
        { src: `${iconBaseUrl}/32x32.png`, mimeType: 'image/png', sizes: ['32x32'] },
        { src: `${iconBaseUrl}/48x48.png`, mimeType: 'image/png', sizes: ['48x48'] },
      ],
    });

    const tools = getToolDefinitions();
    for (const toolDef of tools) {
      server.registerTool(
        toolDef.name,
        { description: toolDef.description, inputSchema: toolDef.inputSchema },
        async (args: Record<string, unknown>) => {
          try {
            const result = await executeTool(api, toolDef.name, args);
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
          } catch (error) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) }],
              isError: true,
            };
          }
        }
      );
    }
    return server;
  }

  const mcpPostHandler = async (req: express.Request, res: express.Response): Promise<void> => {
    const userContext = (req as express.Request & { userContext?: { userId: string; environment: EbayEnvironment } }).userContext;
    if (!userContext) {
      res.status(401).json({ error: 'missing_user_context' });
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports.set(newSessionId, transport);
          serverLogger.info('New MCP session initialized', { sessionId: newSessionId, userId: userContext.userId });
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
      };

      const server = await createMcpServer(userContext.userId, userContext.environment);
      await server.connect(transport);
    } else {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID provided' }, id: null });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  };

  const handleSessionRequest = async (req: express.Request, res: express.Response): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'invalid_session', error_description: 'Invalid or missing session ID' });
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  };

  app.post('/mcp', authenticateSession, mcpPostHandler);
  app.get('/mcp', authenticateSession, handleSessionRequest);
  app.delete('/mcp', authenticateSession, handleSessionRequest);

  return app;
}

async function main() {
  try {
    const app = await createApp();
    const server = app.listen(CONFIG.port, CONFIG.host, () => {
      const serverUrl = getServerBaseUrl();
      console.log(`Server running at ${serverUrl}`);
      console.log(`OAuth start: ${serverUrl}/oauth/start?env=production`);
      console.log(`OAuth start sandbox: ${serverUrl}/oauth/start?env=sandbox`);
      console.log(`MCP endpoint: ${serverUrl}/mcp`);
    });

    process.on('SIGINT', () => {
      server.close(() => process.exit(0));
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
