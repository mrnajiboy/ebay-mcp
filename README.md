# eBay API MCP Server

<div align="center">

[![npm version](https://img.shields.io/npm/v/ebay-mcp)](https://www.npmjs.com/package/ebay-mcp)
[![npm downloads](https://img.shields.io/npm/dm/ebay-mcp)](https://www.npmjs.com/package/ebay-mcp)
[![Tests](https://img.shields.io/badge/tests-958%20passing-brightgreen)](tests/)
[![API Coverage](https://img.shields.io/badge/API%20coverage-100%25-success)](src/tools/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server providing AI assistants with comprehensive access to eBay's Sell APIs. Includes **325 tools** for inventory management, order fulfillment, marketing campaigns, analytics, developer tools, and more.

</div>

---

## Single-user private hosted deployment on Render

This fork supports a **single-user private hosted MCP deployment** on Render.

### What this mode does

- Runs the MCP server as a normal **Node web service** on Render
- Exposes a hosted MCP endpoint at `/mcp`
- Supports server-side eBay OAuth via:
  - `GET /oauth/start`
  - `GET /oauth/callback`
- Persists eBay tokens server-side to a file
- Refreshes user access tokens automatically using the stored refresh token

### Recommended Render setup

Create a **Web Service** on Render.

- **Runtime:** Node
- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm run start:http`

### Required environment variables

```bash
EBAY_CLIENT_ID=your-client-id
EBAY_CLIENT_SECRET=your-client-secret
EBAY_REDIRECT_URI=your-ebay-runame
EBAY_ENVIRONMENT=production
PORT=3000
PUBLIC_BASE_URL=https://your-render-service.onrender.com
EBAY_TOKEN_STORE_PATH=/var/data/ebay-user-tokens.json
EBAY_TOKEN_PERSISTENCE_MODE=file-only
```

### Important eBay configuration note

In the eBay Developer Portal, configure your app so the **RuName** you place in `EBAY_REDIRECT_URI` is associated with your hosted callback URL on Render.

Your hosted callback should be:

```text
https://your-render-service.onrender.com/oauth/callback
```

### OAuth flow for hosted mode

After deployment:

1. Open:

```text
https://your-render-service.onrender.com/oauth/start
```

2. Sign in to eBay and approve access
3. eBay redirects back to your hosted callback
4. The server exchanges the authorization code server-side
5. Tokens are stored in the configured token store path

### Render persistent disk

For reliable token persistence, attach a **persistent disk** in Render and set:

```bash
EBAY_TOKEN_STORE_PATH=/var/data/ebay-user-tokens.json
```

Without persistent disk storage, re-deploys or restarts may lose tokens.

### Hosted endpoints

- `GET /health` — health check
- `GET /status` — hosted instance status
- `GET /oauth/start` — begin eBay OAuth
- `GET /oauth/callback` — eBay OAuth callback
- `POST /mcp` — MCP endpoint
- `GET /mcp` — MCP session endpoint
- `DELETE /mcp` — MCP session endpoint

---

## Local usage

The original local STDIO workflow is still available.

```bash
npm install
npm run build
npm run setup
npm start
```

For hosted HTTP development locally:

```bash
npm run dev:http
```

---

## Environment variables

See `.env.example` for the latest hosted and local configuration options.

---

## License

MIT
