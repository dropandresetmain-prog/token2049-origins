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
  if (!row || row.revoked_at) throw new CoreError('unauthenticated', 'invalid credentials');
  const scopes = new Set<Scope>((JSON.parse(row.scopes_json) as string[]).filter((s): s is Scope => Scope.safeParse(s).success));
  return { customerId: row.customer_id, clientId: row.id, channel: row.channel, scopes, requestId };
}
