import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import express, { type Request, type Response, type Router } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull, OAuthTokens, OAuthTokenRevocationRequest } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  AccessDeniedError, InvalidClientMetadataError, InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError, ServerError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { Db } from '../../infrastructure/db.js';
import { newSecretToken, sha256Hex } from '../../infrastructure/ids.js';
import type { Scope } from '../../contracts/common.js';

/**
 * OAuth 2.1 authorization server for the hosted MCP endpoint (authorization code + PKCE S256, dynamic client
 * registration, rotating refresh tokens). It does not invent a second identity model: every grant resolves to one
 * existing Capsule customer + api_client, and a token can never carry more scope than that api_client holds.
 *
 * The only "user login" is an owner passcode held in a Render secret file. This is a single-owner demo gate:
 * whoever can complete the consent page may spend through the bounded payer, so the passcode is the root of trust.
 */

/** Scopes a hosted-MCP token may carry. `purchases:fund` and `evidence:read` are never grantable here. */
export const HOSTED_MCP_SCOPES = ['offers:read', 'quotes:write', 'purchases:write', 'purchases:read'] as const satisfies readonly Scope[];

/** Redirect URIs ChatGPT (and the OpenAI platform) use for connector OAuth. Anything else is refused at registration. */
const BUILTIN_REDIRECTS: Array<string | RegExp> = [
  'https://chatgpt.com/connector_platform_oauth_redirect',
  /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/,
  'https://platform.openai.com/apps-manage/oauth',
];

export interface HostedOAuthOptions {
  db: Db;
  /** Canonical public origin, e.g. https://token2049-origins.onrender.com (the OAuth issuer). */
  issuer: URL;
  /** Canonical MCP resource URL, e.g. https://token2049-origins.onrender.com/mcp (the token audience). */
  resource: URL;
  /** Owner passcode (secret file contents). Must be at least 16 characters. */
  ownerPasscode: string;
  /** Demo identity every grant resolves to. */
  customerId: string;
  apiClientId: string;
  /** Exact additional redirect URIs allowed at registration (https only). */
  extraRedirectUris?: string[];
  accessTtlSeconds?: number;
  refreshTtlSeconds?: number;
  maxClients?: number;
  now?: () => Date;
}

const sameResource = (a: string | URL, b: string | URL) => String(a).replace(/\/$/, '') === String(b).replace(/\/$/, '');
const hashOf = (secret: string) => sha256Hex(secret);

function equalSecrets(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class HostedOAuth implements OAuthServerProvider {
  private readonly now: () => Date;
  private readonly accessTtl: number;
  private readonly refreshTtl: number;
  private readonly redirectAllow: Array<string | RegExp>;
  private failures: number[] = [];
  readonly clientsStore: OAuthRegisteredClientsStore;

  constructor(private readonly o: HostedOAuthOptions) {
    if (o.ownerPasscode.length < 16) throw new Error('owner passcode must contain at least 16 characters');
    if (o.issuer.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(o.issuer.hostname)) throw new Error('issuer must be https');
    this.now = o.now ?? (() => new Date());
    this.accessTtl = o.accessTtlSeconds ?? 3600;
    this.refreshTtl = o.refreshTtlSeconds ?? 30 * 86400;
    this.redirectAllow = [...BUILTIN_REDIRECTS, ...(o.extraRedirectUris ?? [])];
    this.clientsStore = {
      getClient: (id) => this.getClient(id),
      registerClient: (c) => this.registerClient(c),
    };
  }

  private iso(offsetSeconds = 0): string {
    return new Date(this.now().getTime() + offsetSeconds * 1000).toISOString();
  }

  private redirectAllowed(uri: string): boolean {
    return this.redirectAllow.some((a) => (typeof a === 'string' ? a === uri : a.test(uri)));
  }

  /* ---------------- clients ---------------- */

  private async getClient(id: string): Promise<OAuthClientInformationFull | undefined> {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(id)) return undefined;
    const row = await this.o.db.get<{ metadata_json: string }>('SELECT metadata_json FROM oauth_clients WHERE client_id = $1', id);
    return row ? (JSON.parse(row.metadata_json) as OAuthClientInformationFull) : undefined;
  }

  private async registerClient(c: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'> & { client_id?: string; client_id_issued_at?: number }): Promise<OAuthClientInformationFull> {
    if (!c.redirect_uris?.length || c.redirect_uris.length > 5) throw new InvalidClientMetadataError('between 1 and 5 redirect_uris are required');
    for (const uri of c.redirect_uris) {
      if (!this.redirectAllowed(String(uri))) throw new InvalidClientMetadataError('redirect_uri is not allowed for this server');
    }
    if (c.grant_types && !c.grant_types.includes('authorization_code')) throw new InvalidClientMetadataError('authorization_code grant is required');
    const count = (await this.o.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM oauth_clients'))?.n ?? 0;
    if (count >= (this.o.maxClients ?? 200)) throw new InvalidClientMetadataError('client registration limit reached');
    // Public PKCE clients only: no client secret is ever issued or stored.
    const { client_secret: _s, client_secret_expires_at: _e, ...rest } = c as Record<string, unknown>;
    const client = {
      ...rest,
      client_id: c.client_id ?? newSecretToken('t2o_cid').slice(0, 44),
      client_id_issued_at: c.client_id_issued_at ?? Math.floor(this.now().getTime() / 1000),
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    } as OAuthClientInformationFull;
    await this.o.db.run('INSERT INTO oauth_clients(client_id, metadata_json, created_at) VALUES ($1,$2,$3)', client.client_id, JSON.stringify(client), this.iso());
    return client;
  }

  /* ---------------- identity ---------------- */

  /** The one customer + api_client every grant maps to. Created lazily; its own bearer secret is random and never disclosed. */
  private async ensureIdentity(): Promise<void> {
    const at = this.iso();
    await this.o.db.tx(async () => {
      await this.o.db.run('INSERT INTO customers(id, display_name, created_at) VALUES ($1,$2,$3) ON CONFLICT(id) DO NOTHING', this.o.customerId, 'Hosted MCP demo customer', at);
      await this.o.db.run(
        'INSERT INTO api_clients(id, customer_id, channel, label, token_hash, scopes_json, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING',
        this.o.apiClientId, this.o.customerId, 'mcp', 'Hosted MCP (OAuth)', hashOf(newSecretToken('t2o_unused')), JSON.stringify(HOSTED_MCP_SCOPES), at,
      );
    });
    const client = await this.o.db.get<{ customer_id: string; revoked_at: string | null }>('SELECT customer_id, revoked_at FROM api_clients WHERE id = $1', this.o.apiClientId);
    if (!client || client.customer_id !== this.o.customerId) throw new ServerError('hosted identity is misconfigured');
    if (client.revoked_at) throw new AccessDeniedError('this access has been revoked by the operator');
  }

  private async identityScopes(): Promise<Set<string>> {
    const row = await this.o.db.get<{ scopes_json: string }>('SELECT scopes_json FROM api_clients WHERE id = $1', this.o.apiClientId);
    const allowed = new Set<string>(HOSTED_MCP_SCOPES);
    return new Set((JSON.parse(row?.scopes_json ?? '[]') as string[]).filter((s) => allowed.has(s)));
  }

  /* ---------------- authorize / consent ---------------- */

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const resource = params.resource ?? this.o.resource;
    if (!sameResource(resource, this.o.resource)) throw new InvalidTargetError('resource must be this MCP server');
    const supported = new Set<string>(HOSTED_MCP_SCOPES);
    const scopes = params.scopes?.length ? params.scopes : [...HOSTED_MCP_SCOPES];
    if (scopes.some((s) => !supported.has(s))) throw new InvalidScopeError('unsupported scope requested');
    const id = randomBytes(32).toString('base64url');
    await this.o.db.run(
      'INSERT INTO oauth_auth_requests(id_hash, client_id, redirect_uri, code_challenge, scopes_json, state, resource, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      hashOf(id), client.client_id, params.redirectUri, params.codeChallenge, JSON.stringify([...new Set(scopes)]), params.state ?? null, this.o.resource.href, this.iso(600),
    );
    // Opportunistic pruning keeps the tables small without a scheduler.
    const cutoff = this.iso(-86400);
    await this.o.db.run('DELETE FROM oauth_auth_requests WHERE expires_at < $1', cutoff);
    await this.o.db.run('DELETE FROM oauth_codes WHERE expires_at < $1', cutoff);
    await this.o.db.run('DELETE FROM oauth_tokens WHERE expires_at < $1', cutoff);
    this.page(res, 200, this.consentHtml(id, client, scopes, params.redirectUri));
  }

  private page(res: Response, status: number, html: string): void {
    res.status(status)
      .set({
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
      })
      .send(html);
  }

  private consentHtml(requestId: string, client: OAuthClientInformationFull, scopes: string[], redirectUri: string, error?: string): string {
    const name = escapeHtml(client.client_name ?? 'An MCP client');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize Capsule</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:3rem auto;padding:0 1rem;color:#111}h1{font-size:1.3rem}code{background:#eee;padding:.1rem .3rem;border-radius:.25rem}
input{width:100%;padding:.6rem;margin:.4rem 0 1rem;box-sizing:border-box;font-size:1rem}button{padding:.6rem 1.2rem;font-size:1rem;margin-right:.5rem}.err{color:#b00020}.note{color:#555;font-size:.9rem}</style></head>
<body><h1>Connect ${name} to Capsule</h1>
<p><strong>${name}</strong> is asking to search offers, create quotes and place <strong>sandbox/testnet</strong> purchases through Capsule on behalf of the hosted demo account.</p>
<p>Permissions: ${scopes.map((s) => `<code>${escapeHtml(s)}</code>`).join(' ')}</p>
<p class="note">The approval will be sent to <code>${escapeHtml(new URL(redirectUri).origin)}</code>. Only approve if you started this connection yourself.</p>
<p class="note">Payments use a bounded Cardano Preprod test wallet. Every purchase still needs your explicit approval in the chat. No real funds are involved.</p>
${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/oauth/consent" autocomplete="off"><input type="hidden" name="request_id" value="${escapeHtml(requestId)}">
<label>Owner passcode<input type="password" name="passcode" required autocomplete="off"></label>
<button type="submit" name="decision" value="approve">Approve</button><button type="submit" name="decision" value="deny" formnovalidate>Deny</button></form></body></html>`;
  }

  /** `POST /oauth/consent`: owner passcode check, then single-use authorization code via redirect. */
  consentRouter(): Router {
    const router = express.Router();
    router.post('/oauth/consent', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
      void this.consent(req, res).catch(() => this.page(res, 500, '<!doctype html><title>Error</title><p>Authorization failed. Start again from the client.</p>'));
    });
    return router;
  }

  private throttled(): boolean {
    const cutoff = this.now().getTime() - 15 * 60_000;
    this.failures = this.failures.filter((t) => t > cutoff);
    return this.failures.length >= 5;
  }

  private async consent(req: Request, res: Response): Promise<void> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestId = typeof body.request_id === 'string' ? body.request_id : '';
    const passcode = typeof body.passcode === 'string' ? body.passcode : '';
    const decision = body.decision === 'deny' ? 'deny' : 'approve';
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(requestId)) return this.page(res, 400, '<!doctype html><title>Error</title><p>Invalid authorization request.</p>');
    // Failed attempts are throttled globally (a single owner); the proxy IP is not a usable per-client key.
    if (this.throttled()) return this.page(res, 429, '<!doctype html><title>Too many attempts</title><p>Too many failed passcode attempts. Try again in 15 minutes.</p>');

    const row = await this.o.db.get<{ client_id: string; redirect_uri: string; code_challenge: string; scopes_json: string; state: string | null; resource: string; expires_at: string; consumed_at: string | null }>(
      'SELECT client_id, redirect_uri, code_challenge, scopes_json, state, resource, expires_at, consumed_at FROM oauth_auth_requests WHERE id_hash = $1', hashOf(requestId));
    if (!row || row.consumed_at || row.expires_at <= this.iso()) return this.page(res, 400, '<!doctype html><title>Error</title><p>This authorization request expired. Start again from the client.</p>');
    const client = await this.getClient(row.client_id);
    if (!client) return this.page(res, 400, '<!doctype html><title>Error</title><p>Unknown client.</p>');
    const scopes = JSON.parse(row.scopes_json) as string[];

    const redirect = (params: Record<string, string>) => {
      const u = new URL(row.redirect_uri);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      if (row.state) u.searchParams.set('state', row.state);
      // RFC 9207 issuer identification lets the client bind the response to this server.
      u.searchParams.set('iss', this.o.issuer.origin);
      res.set({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }).redirect(302, u.href);
    };

    if (decision === 'deny') {
      await this.o.db.run('UPDATE oauth_auth_requests SET consumed_at = $1 WHERE id_hash = $2 AND consumed_at IS NULL', this.iso(), hashOf(requestId));
      return redirect({ error: 'access_denied', error_description: 'The owner denied the request' });
    }
    if (!equalSecrets(passcode, this.o.ownerPasscode)) {
      this.failures.push(this.now().getTime());
      return this.page(res, 401, this.consentHtml(requestId, client, scopes, row.redirect_uri, 'Incorrect passcode.'));
    }
    try {
      await this.ensureIdentity();
    } catch (e) {
      if (e instanceof AccessDeniedError) return redirect({ error: 'access_denied', error_description: 'access revoked by the operator' });
      throw e;
    }
    const claimed = await this.o.db.run('UPDATE oauth_auth_requests SET consumed_at = $1 WHERE id_hash = $2 AND consumed_at IS NULL', this.iso(), hashOf(requestId));
    if (!claimed.changes) return this.page(res, 400, '<!doctype html><title>Error</title><p>This authorization request was already used.</p>');
    const code = randomBytes(32).toString('base64url');
    await this.o.db.run(
      'INSERT INTO oauth_codes(code_hash, client_id, redirect_uri, code_challenge, scopes_json, resource, customer_id, api_client_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      hashOf(code), row.client_id, row.redirect_uri, row.code_challenge, row.scopes_json, row.resource, this.o.customerId, this.o.apiClientId, this.iso(300),
    );
    redirect({ code });
  }

  /* ---------------- token endpoint ---------------- */

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    const row = await this.o.db.get<{ code_challenge: string; expires_at: string; used_at: string | null }>(
      'SELECT code_challenge, expires_at, used_at FROM oauth_codes WHERE code_hash = $1 AND client_id = $2', hashOf(code), client.client_id);
    if (row?.used_at) {
      // A spent code is being presented again: whatever it already produced is compromised.
      await this.o.db.run('UPDATE oauth_tokens SET revoked_at = $1 WHERE grant_id = $2 AND revoked_at IS NULL', this.iso(), hashOf(code));
    }
    if (!row || row.used_at || row.expires_at <= this.iso()) throw new InvalidGrantError('authorization code is invalid or expired');
    return row.code_challenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
    const at = this.iso();
    const claimed = await this.o.db.get<{ redirect_uri: string; scopes_json: string; resource: string; customer_id: string; api_client_id: string }>(
      'UPDATE oauth_codes SET used_at = $1 WHERE code_hash = $2 AND client_id = $3 AND used_at IS NULL AND expires_at > $1 RETURNING redirect_uri, scopes_json, resource, customer_id, api_client_id',
      at, hashOf(code), client.client_id);
    if (!claimed) {
      // Replay of a spent code: revoke whatever it already produced.
      await this.o.db.run('UPDATE oauth_tokens SET revoked_at = $1 WHERE grant_id = $2 AND revoked_at IS NULL', at, hashOf(code));
      throw new InvalidGrantError('authorization code is invalid, expired or already used');
    }
    if (!redirectUri || redirectUri !== claimed.redirect_uri) throw new InvalidGrantError('redirect_uri does not match the authorization request');
    if (resource && !sameResource(resource, claimed.resource)) throw new InvalidTargetError('resource does not match the authorization request');
    return this.issue({ grantId: hashOf(code), clientId: client.client_id, customerId: claimed.customer_id, apiClientId: claimed.api_client_id, scopes: JSON.parse(claimed.scopes_json) as string[], resource: claimed.resource });
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL): Promise<OAuthTokens> {
    const at = this.iso();
    const row = await this.o.db.get<{ grant_id: string; client_id: string; customer_id: string; api_client_id: string; scopes_json: string; resource: string; expires_at: string; revoked_at: string | null }>(
      "SELECT grant_id, client_id, customer_id, api_client_id, scopes_json, resource, expires_at, revoked_at FROM oauth_tokens WHERE token_hash = $1 AND kind = 'refresh'", hashOf(refreshToken));
    if (!row || row.client_id !== client.client_id) throw new InvalidGrantError('refresh token is invalid');
    if (row.revoked_at) {
      // A rotated token is being replayed: treat the whole grant as compromised.
      await this.o.db.run('UPDATE oauth_tokens SET revoked_at = $1 WHERE grant_id = $2 AND revoked_at IS NULL', at, row.grant_id);
      throw new InvalidGrantError('refresh token is invalid');
    }
    if (row.expires_at <= at) throw new InvalidGrantError('refresh token expired');
    if (resource && !sameResource(resource, row.resource)) throw new InvalidTargetError('resource does not match the grant');
    const granted = JSON.parse(row.scopes_json) as string[];
    if (scopes?.length && scopes.some((s) => !granted.includes(s))) throw new InvalidScopeError('requested scope exceeds the original grant');
    const rotated = await this.o.db.run("UPDATE oauth_tokens SET revoked_at = $1 WHERE token_hash = $2 AND kind = 'refresh' AND revoked_at IS NULL", at, hashOf(refreshToken));
    if (!rotated.changes) throw new InvalidGrantError('refresh token is invalid');
    return this.issue({ grantId: row.grant_id, clientId: client.client_id, customerId: row.customer_id, apiClientId: row.api_client_id, scopes: scopes?.length ? scopes : granted, resource: row.resource });
  }

  private async issue(g: { grantId: string; clientId: string; customerId: string; apiClientId: string; scopes: string[]; resource: string }): Promise<OAuthTokens> {
    const identity = await this.o.db.get<{ revoked_at: string | null }>('SELECT revoked_at FROM api_clients WHERE id = $1 AND customer_id = $2', g.apiClientId, g.customerId);
    if (!identity || identity.revoked_at) throw new InvalidGrantError('access has been revoked');
    const allowed = await this.identityScopes();
    const scopes = g.scopes.filter((s) => allowed.has(s));
    if (!scopes.length) throw new InvalidScopeError('no grantable scope remains');
    const access = newSecretToken('t2o_oat');
    const refresh = newSecretToken('t2o_ort');
    const at = this.iso();
    const insert = 'INSERT INTO oauth_tokens(token_hash, kind, grant_id, client_id, customer_id, api_client_id, scopes_json, resource, expires_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)';
    await this.o.db.tx(async () => {
      await this.o.db.run(insert, hashOf(access), 'access', g.grantId, g.clientId, g.customerId, g.apiClientId, JSON.stringify(scopes), g.resource, this.iso(this.accessTtl), at);
      await this.o.db.run(insert, hashOf(refresh), 'refresh', g.grantId, g.clientId, g.customerId, g.apiClientId, JSON.stringify(scopes), g.resource, this.iso(this.refreshTtl), at);
    });
    return { access_token: access, token_type: 'Bearer', expires_in: this.accessTtl, refresh_token: refresh, scope: scopes.join(' ') };
  }

  /* ---------------- resource server side ---------------- */

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const at = this.iso();
    const row = await this.o.db.get<{ client_id: string; customer_id: string; api_client_id: string; scopes_json: string; resource: string; expires_at: string; revoked_at: string | null; client_revoked_at: string | null }>(
      "SELECT t.client_id, t.customer_id, t.api_client_id, t.scopes_json, t.resource, t.expires_at, t.revoked_at, a.revoked_at AS client_revoked_at FROM oauth_tokens t JOIN api_clients a ON a.id = t.api_client_id WHERE t.token_hash = $1 AND t.kind = 'access'",
      hashOf(token));
    if (!row || row.revoked_at || row.client_revoked_at || row.expires_at <= at) throw new InvalidTokenError('invalid or expired access token');
    return {
      token, clientId: row.client_id, scopes: JSON.parse(row.scopes_json) as string[], expiresAt: Math.floor(Date.parse(row.expires_at) / 1000),
      resource: new URL(row.resource), extra: { customerId: row.customer_id, apiClientId: row.api_client_id },
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const row = await this.o.db.get<{ grant_id: string; kind: string }>('SELECT grant_id, kind FROM oauth_tokens WHERE token_hash = $1 AND client_id = $2', hashOf(request.token), client.client_id);
    if (!row) return;
    // Revoking a refresh token ends the whole grant; revoking an access token ends just that token.
    if (row.kind === 'refresh') await this.o.db.run('UPDATE oauth_tokens SET revoked_at = $1 WHERE grant_id = $2 AND revoked_at IS NULL', this.iso(), row.grant_id);
    else await this.o.db.run('UPDATE oauth_tokens SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL', this.iso(), hashOf(request.token));
  }
}

