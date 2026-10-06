import type { Db } from './db.js';
import { newId, newSecretToken, sha256Hex } from './ids.js';
import type { ActorContext } from '../core/actor.js';
import { Scope, type Channel } from '../contracts/common.js';
import { CoreError } from '../core/errors.js';

export const ALL_CUSTOMER_SCOPES: Scope[] = ['offers:read', 'quotes:write', 'purchases:write', 'purchases:fund', 'purchases:read', 'evidence:read'];

/** Create a customer + API client. Returns the bearer token ONCE; only its hash is stored. */
export async function createClient(
  db: Db,
  opts: { customerId?: string; displayName: string; channel: Channel; label: string; scopes?: Scope[] },
  nowIso: string,
): Promise<{ customerId: string; clientId: string; token: string }> {
  const token = newSecretToken('t2o');
  const customerId = opts.customerId ?? newId('cus');
  const clientId = newId('cli');
  await db.tx(async () => {
    await db.run('INSERT INTO customers(id, display_name, created_at) VALUES ($1,$2,$3) ON CONFLICT(id) DO NOTHING', customerId, opts.displayName, nowIso);
    await db.run(
      'INSERT INTO api_clients(id, customer_id, channel, label, token_hash, scopes_json, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      clientId,
      customerId,
      opts.channel,
      opts.label,
      sha256Hex(token),
      JSON.stringify(opts.scopes ?? (opts.channel === 'mcp' ? ALL_CUSTOMER_SCOPES.filter(s => s !== 'purchases:fund') : ALL_CUSTOMER_SCOPES)),
      nowIso,
    );
  });
  return { customerId, clientId, token };
}

export async function authenticate(db: Db, authorization: string | undefined, requestId: string): Promise<ActorContext> {
  const m = /^Bearer\s+(\S+)$/.exec(authorization ?? '');
  if (!m) throw new CoreError('unauthenticated', 'bearer token required');
  const row = await db.get<{ id: string; customer_id: string; channel: Channel; scopes_json: string; revoked_at: string | null }>(
    'SELECT id, customer_id, channel, scopes_json, revoked_at FROM api_clients WHERE token_hash = $1',
    sha256Hex(m[1]!),
  );
  if (!row) return authenticateOAuthAccessToken(db, m[1]!, requestId);
  if (row.revoked_at) throw new CoreError('unauthenticated', 'invalid credentials');
  const scopes = new Set<Scope>((JSON.parse(row.scopes_json) as string[]).filter((s): s is Scope => Scope.safeParse(s).success));
  return { customerId: row.customer_id, clientId: row.id, channel: row.channel, scopes, requestId };
}

/**
 * OAuth access tokens issued by the hosted MCP authorization server resolve to the same customer/api_client identity as
 * a static client token, restricted to the (never larger) scope set recorded on the token.
 */
async function authenticateOAuthAccessToken(db: Db, token: string, requestId: string): Promise<ActorContext> {
  const row = await db.get<{ customer_id: string; api_client_id: string; channel: Channel; scopes_json: string; client_scopes_json: string; expires_at: string; revoked_at: string | null; client_revoked_at: string | null }>(
    "SELECT t.customer_id, t.api_client_id, a.channel, t.scopes_json, a.scopes_json AS client_scopes_json, t.expires_at, t.revoked_at, a.revoked_at AS client_revoked_at FROM oauth_tokens t JOIN api_clients a ON a.id = t.api_client_id WHERE t.token_hash = $1 AND t.kind = 'access'",
    sha256Hex(token),
  );
  if (!row || row.revoked_at || row.client_revoked_at || row.expires_at <= new Date().toISOString()) throw new CoreError('unauthenticated', 'invalid credentials');
  const held = new Set<string>(JSON.parse(row.client_scopes_json) as string[]);
  const scopes = new Set<Scope>((JSON.parse(row.scopes_json) as string[]).filter((s): s is Scope => Scope.safeParse(s).success && held.has(s)));
  return { customerId: row.customer_id, clientId: row.api_client_id, channel: row.channel, scopes, requestId };
}
