import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { Db } from '../../infrastructure/db.js';
import type { McpConfig } from '../mcp/config.js';
import { sendJson, serveMcpPost } from '../mcp/http.js';
import type { HostedMcpConfig } from './config.js';
import { HOSTED_MCP_SCOPES, HostedOAuth } from './oauth.js';

export interface HostedMcpMount {
  path: string;
  router: Router;
  auth: false;
  beforeJson: true;
}

const rpcError = (res: Response, status: number, code: number, message: string) => sendJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null });

/** Exact-match authority check: only the configured public host (never X-Forwarded-Host, never wildcards). */
export function hostAllowed(hostHeader: string | undefined, publicUrl: URL): boolean {
  return !!hostHeader && hostHeader.toLowerCase() === publicUrl.host.toLowerCase();
}

/** Non-browser callers send no Origin; a browser-style caller must come from the public origin or an explicitly allowed one. */
export function originAllowed(origin: string | undefined, publicUrl: URL, allowed: string[]): boolean {
  if (origin === undefined) return true;
  return origin === publicUrl.origin || allowed.includes(origin);
}

// The SDK rate limiters key on req.ip; behind the platform proxy that is one shared address, so the limits act as global
// flood protection. Header validation is disabled because we deliberately do not trust forwarded headers.
const limiter = (max: number, windowMs: number) => ({ windowMs, max, validate: false as const });

/**
 * Mount the hosted MCP endpoint and its OAuth 2.1 authorization server on the gateway's own Express app, so the
 * platform keeps exactly one public listener. Returns routers for the gateway's extraRouters list.
 */
export function createHostedMcp(opts: { db: Db; config: HostedMcpConfig; fetch?: typeof fetch; now?: () => Date }): { mounts: HostedMcpMount[]; oauth: HostedOAuth } {
  const { config } = opts;
  const issuer = new URL(config.publicUrl.origin);
  const resource = new URL('/mcp', issuer);
  const oauth = new HostedOAuth({
    db: opts.db, issuer, resource, ownerPasscode: config.ownerPasscode, customerId: config.customerId, apiClientId: config.apiClientId,
    extraRedirectUris: config.extraRedirectUris, ...(opts.now ? { now: opts.now } : {}),
  });
  const metadataUrl = getOAuthProtectedResourceMetadataUrl(resource);
  const scopesSupported = [...HOSTED_MCP_SCOPES];

  const root = express.Router();
  // Authorization server + protected-resource metadata (RFC 8414 / RFC 9728), authorize, token, register, revoke.
  root.use(mcpAuthRouter({
    provider: oauth, issuerUrl: issuer, resourceServerUrl: resource, scopesSupported, resourceName: 'Capsule commerce gateway (sandbox)',
    authorizationOptions: { rateLimit: limiter(60, 15 * 60_000) },
    tokenOptions: { rateLimit: limiter(60, 15 * 60_000) },
    clientRegistrationOptions: { rateLimit: limiter(30, 60 * 60_000) },
    revocationOptions: { rateLimit: limiter(60, 15 * 60_000) },
  }));
  // Clients that probe the unsuffixed well-known URL get the same document.
  root.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.set('cache-control', 'no-store').json({
      resource: resource.href, authorization_servers: [issuer.href], scopes_supported: scopesSupported, resource_name: 'Capsule commerce gateway (sandbox)',
    });
  });
  root.use(oauth.consentRouter());

  const guard = (req: Request, res: Response, next: NextFunction) => {
    if (!hostAllowed(req.headers.host, config.publicUrl) || !originAllowed(req.headers.origin, config.publicUrl, config.allowedOrigins)) {
      return rpcError(res, 403, -32000, 'forbidden host or origin');
    }
    next();
  };
  const bearer = requireBearerAuth({ verifier: oauth, requiredScopes: [], resourceMetadataUrl: metadataUrl, expectedResource: resource });

  const mcp = express.Router();
  mcp.all('/', guard, (req, res, next) => {
    if (req.method !== 'POST') {
      // Stateless mode: no server-initiated stream and no session to delete.
      res.setHeader('allow', 'POST');
      return rpcError(res, 405, -32000, 'method not allowed');
    }
    bearer(req, res, next);
  }, (req, res) => {
    const token = (req as Request & { auth?: { token: string } }).auth?.token;
    if (!token) return rpcError(res, 401, -32001, 'unauthenticated');
    // The caller's own scoped OAuth token is passed through to the gateway contract; no shared gateway key exists here.
    const toolConfig: McpConfig = {
      gatewayUrl: config.gatewayUrl,
      gatewayToken: token,
      bridgeTimeoutMs: 100_000,
      ...(config.cardanoBridge ? { bridges: { cardano: config.cardanoBridge } } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    };
    void serveMcpPost(toolConfig, req, res, { hosted: { resourceMetadataUrl: metadataUrl } }).catch(() => {
      if (!res.headersSent) rpcError(res, 500, -32603, 'internal error');
    });
  });

  return {
    oauth,
    mounts: [
      { path: '/', router: root, auth: false, beforeJson: true },
      { path: '/mcp', router: mcp, auth: false, beforeJson: true },
    ],
  };
}
