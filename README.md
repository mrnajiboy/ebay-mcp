# eBay MCP Server

Multi-user hosted eBay MCP server for Render.

## Render environment variables

```bash
PORT=3000
PUBLIC_BASE_URL=https://your-render-service.onrender.com
EBAY_CONFIG_FILE=/etc/secrets/ebay-config.json
EBAY_DEFAULT_ENVIRONMENT=production
EBAY_TOKEN_STORE_BACKEND=cloudflare-kv
CLOUDFLARE_ACCOUNT_ID=81eea59c5ce059470fcd8ac14feb68f3
CLOUDFLARE_KV_NAMESPACE_ID=979537c637044423b1527a05f2d343e4
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
ADMIN_API_KEY=your-admin-api-key
EBAY_MARKETPLACE_ID=EBAY_US
EBAY_CONTENT_LANGUAGE=en-US
EBAY_LOG_LEVEL=info
```

## Render secret file

Filename:

```text
ebay-config.json
```

Contents:

```json
{
  "production": {
    "clientId": "ROTATED_PROD_CLIENT_ID",
    "clientSecret": "ROTATED_PROD_CLIENT_SECRET",
    "redirectUri": "YOUR_PRODUCTION_RUNAME"
  },
  "sandbox": {
    "clientId": "ROTATED_SANDBOX_CLIENT_ID",
    "clientSecret": "ROTATED_SANDBOX_CLIENT_SECRET",
    "redirectUri": "YOUR_SANDBOX_RUNAME"
  }
}
```

Render will mount this at:

```text
/etc/secrets/ebay-config.json
```

## OAuth flows

Start production OAuth:

```text
/oauth/start?env=production
```

Start sandbox OAuth:

```text
/oauth/start?env=sandbox
```

After success, the callback page returns a session token.

Use it in your MCP client:

```text
Authorization: Bearer <session-token>
```

## Admin endpoints

Require header:

```text
X-Admin-API-Key: <ADMIN_API_KEY>
```

Endpoints:

- `GET /admin/session/:sessionToken`
- `POST /admin/session/:sessionToken/revoke`
- `DELETE /admin/session/:sessionToken`

## MCP endpoint

```text
POST /mcp
GET /mcp
DELETE /mcp
```
