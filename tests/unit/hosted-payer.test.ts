import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { USDM_PREPROD_ASSET } from '@x402/cardano';
import type { PaymentRequired } from '@x402/core/types';
import { money } from '../../src/contracts/money.js';
import { Payer } from '../../clients/payer/payer.js';
import { loadPayerConfig } from '../../clients/payer/config.js';
import { PgPayerLedger } from '../../clients/payer/pg-ledger.js';
import { createBridge } from '../../clients/payer/bridge.js';
import { allowedHostsFrom, deriveWalletAddress, startHostedPayer } from '../../clients/payer/hosted.js';
import type { Db } from '../../src/infrastructure/db.js';
import { createTestDb, newTestSchema } from '../support/database.js';

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const TO = 'addr_test1qztreasury0000000000000000000000000000000000000000000000';
const WALLET = 'addr_test1qzpayer0000000000000';
const NOW = new Date('2026-10-06T00:00:00Z');
const EXPIRY = '2026-10-06T00:10:00Z';
const TOKEN = 'hosted-payer-bridge-token-0123456789';
const GATEWAY_TOKEN = 'gateway-payer-token-secret-value';
const HOST = 't2o-cardano-payer.onrender.test';
const idOf = (n: number) => `pur_ABCDEFGHIJKLM${String(n).padStart(3, '0')}`;
// A syntactically valid BIP39 test vector (never funded; public knowledge). Used only to exercise real offline address derivation.
const TEST_MNEMONIC = `${'abandon '.repeat(23)}art`;

/** Payer config + gateway fake serving any purchase id with the same exact requirement. Ledger is supplied per payer instance. */
function fixture(over: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hosted-payer-')); roots.push(root);
  const env = {
    PAYER_GATEWAY_URL: 'https://token2049-origins.example.test', PAYER_GATEWAY_TOKEN_FILE: 'unused', PAYER_CARDANO_NETWORK: 'cardano:preprod',
    PAYER_CARDANO_MNEMONIC_FILE: 'unused', BLOCKFROST_PROJECT_ID: 'test-only', PAYER_MAX_PER_PAYMENT_BASE_UNITS: '500000',
    PAYER_MAX_CUMULATIVE_BASE_UNITS: '1000000', PAYER_MAX_DAILY_BASE_UNITS: '1000000', PAYER_MAX_FEE_LOVELACE: '500000', PAYER_MAX_ADA_OUTPUT_LOVELACE: '3000000',
    PAYER_ALLOWED_ASSET_UNIT: USDM_PREPROD_ASSET, PAYER_EXPECTED_PAY_TO: TO, PAYER_WALLET_ADDRESS: WALLET, ...over,
  };
  const config = loadPayerConfig(env, { ledger: 'external' });
  const amount = '400000';
  const settlement = { policy: { mode: 'scaled_testnet' as const, numerator: 1 as const, denominator: 1000 as const }, commercialPrincipal: money('USD', 40000n), commercialServiceFee: money('USD', 0n), commercialTotal: money('USD', 40000n), principalBaseUnits: amount, feeBaseUnits: '0', totalBaseUnits: amount };
  const entryFor = (id: string) => ({ scheme: 'exact', network: config.network, asset: config.allowedAsset, amount, payTo: TO, maxTimeoutSeconds: 600,
    extra: { settlement, chainDecimals: 6, assetTransferMethod: 'default', areFeesSponsored: false, confirmationPolicy: { l1Confirmations: 1 }, purchaseId: id,
      quoteId: 'quo_ABCDEFGHIJKLMNOP', quoteDigest: 'sha256:' + 'd'.repeat(64), expiresAt: EXPIRY } });
  const purchaseFor = (id: string) => ({ purchaseId: id, quoteId: 'quo_ABCDEFGHIJKLMNOP', state: 'awaiting_funding', paymentState: 'not_received',
    fundingInstructions: { expiresAt: EXPIRY, options: [{ rail: 'cardano', amount: { network: config.network, assetId: config.allowedAsset, amountBaseUnits: amount, decimals: 6 }, payTo: TO, settlement }] }, funding: [] });
  const sent: string[] = [];
  const onSign: Array<() => Promise<void>> = [];
  let failSigning = false;
  let loseFirstSend = false;
  const control = { failSigning: () => { failSigning = true; }, okSigning: () => { failSigning = false; }, loseFirstSend: () => { loseFirstSend = true; } };
  const signer = vi.fn(() => ({ getAddress: () => WALLET, buildAndSignPaymentTransaction: async () => {
    for (const hook of onSign) await hook();
    if (failSigning) throw new Error('wallet exploded with secret-looking detail');
    return { transaction: 'test-only', nonce: `${'b'.repeat(64)}#0` };
  } }));
  const fetchImpl: typeof fetch = async (url, init) => {
    const id = /purchases\/(pur_[A-Za-z0-9]+)/.exec(String(url))![1]!;
    if (init?.method === 'GET') return new Response(JSON.stringify({ purchase: purchaseFor(id) }), { status: 200 });
    const signature = new Headers(init?.headers).get('payment-signature');
    const challenge: PaymentRequired = { x402Version: 2, resource: { url: `${config.gatewayUrl}/v1/purchases/${id}/fund` }, accepts: [entryFor(id)] };
    if (!signature) return new Response('{}', { status: 402, headers: { 'payment-required': encodePaymentRequiredHeader(challenge) } });
    sent.push(signature);
    if (loseFirstSend) { loseFirstSend = false; throw new Error('connection lost'); }
    return new Response(JSON.stringify({ purchase: { ...purchaseFor(id), state: 'funded_queued', funding: [{ transferReference: 'a'.repeat(64) }] } }), { status: 202 });
  };
  const deps = { config, fetchImpl, createSigner: signer, readGatewayToken: () => GATEWAY_TOKEN, now: () => NOW, sleep: async () => {}, maxAttempts: 2 };
  /** A "process": its own database pool + ledger + payer, sharing the same schema (the same Postgres). */
  const boot = async (schema: string, db?: Db) => {
    const d = db ?? await createTestDb(schema);
    const ledger = await PgPayerLedger.open(d, { network: config.network, address: WALLET });
    return { db: d, ledger, payer: new Payer({ ...deps, ledger }) };
  };
  return { root, env, config, sent, signer, onSign, control, deps, boot };
}

const rows = (db: Db) => db.all<any>('SELECT * FROM hosted_payer_ledger ORDER BY purchase_id');

describe('PostgreSQL payer ledger', () => {
  it('keeps cumulative spend across a restart (new process, new pool, same database)', async () => {
    const f = fixture(); const schema = newTestSchema();
    const a = await f.boot(schema);
    await a.payer.pay(idOf(1)); // 400000
    const b = await f.boot(schema); // a redeployed / woken-up payer
    await b.payer.pay(idOf(2)); // 800000
    expect(await b.ledger.committed(f.config.network, f.config.allowedAsset)).toBe(800000n);
    const c = await f.boot(schema);
    await expect(c.payer.pay(idOf(3))).rejects.toThrow('cumulative_cap'); // 1,200,000 > 1,000,000 although this process saw nothing
    expect(f.signer).toHaveBeenCalledTimes(2);
    expect((await rows(c.db)).map((r) => r.status)).toEqual(['accepted', 'accepted']);
  });

  it('persists the per-payment cap and the daily cap from durable history', async () => {
    const f = fixture({ PAYER_MAX_PER_PAYMENT_BASE_UNITS: '300000' });
    const a = await f.boot(newTestSchema());
    await expect(a.payer.pay(idOf(1))).rejects.toMatchObject({ code: 'policy_violation', retrySafe: true });
    expect(f.signer).not.toHaveBeenCalled();
    expect(await rows(a.db)).toEqual([]);
    const g = fixture({ PAYER_MAX_DAILY_BASE_UNITS: '500000', PAYER_MAX_CUMULATIVE_BASE_UNITS: '5000000' });
    const schema = newTestSchema();
    await (await g.boot(schema)).payer.pay(idOf(1));
    await expect((await g.boot(schema)).payer.pay(idOf(2))).rejects.toThrow('daily_cap');
  });

  it('reserves the spend BEFORE signing and stores the exact header before it is sent', async () => {
    const f = fixture(); const a = await f.boot(newTestSchema());
    let during: any;
    f.onSign.push(async () => { during = await rows(a.db); });
    await a.payer.pay(idOf(1));
    expect(during).toHaveLength(1);
    expect(during[0]).toMatchObject({ purchase_id: idOf(1), status: 'signing', header: null, amount_base_units: '400000', pay_to: TO, payer_address: WALLET });
    const [after] = await rows(a.db);
    expect(after).toMatchObject({ status: 'accepted', header: f.sent[0], transfer_reference: 'a'.repeat(64) });
  });

  it('resends the identical signed payload after a lost response and a restart, never signing twice', async () => {
    const f = fixture(); const schema = newTestSchema();
    f.control.loseFirstSend();
    const a = await f.boot(schema);
    const single = new Payer({ ...f.deps, maxAttempts: 1, ledger: a.ledger }); // one attempt: the lost response ends this run
    await expect(single.pay(idOf(1))).rejects.toMatchObject({ retrySafe: false });
    expect(f.sent.length).toBeGreaterThanOrEqual(1);
    const stored = (await rows(a.db))[0];
    expect(stored.header).toBe(f.sent[0]);
    const b = await f.boot(schema); // restart
    await b.payer.pay(idOf(1));
    expect(f.signer).toHaveBeenCalledTimes(1);
    expect(new Set(f.sent).size).toBe(1);
    expect((await rows(b.db))[0].status).toBe('accepted');
  });

  it('serializes concurrent calls, within one process and across overlapping processes, with at most one signing', async () => {
    const f = fixture(); const schema = newTestSchema();
    const a = await f.boot(schema), b = await f.boot(schema); // two overlapping deploys on the same database
    const results = await Promise.all([a.payer.pay(idOf(7)), b.payer.pay(idOf(7)), a.payer.pay(idOf(7)), b.payer.pay(idOf(7))]);
    expect(results).toHaveLength(4);
    expect(f.signer).toHaveBeenCalledTimes(1);
    expect(new Set(f.sent).size).toBe(1);
    expect(await rows(a.db)).toHaveLength(1);
    expect(await a.ledger.committed(f.config.network, f.config.allowedAsset)).toBe(400000n);
  });

  it('fails closed on an unfinished signing attempt instead of signing again', async () => {
    const f = fixture(); const a = await f.boot(newTestSchema());
    const now = NOW.toISOString();
    await a.db.run("INSERT INTO hosted_payer_ledger(purchase_id, payer_address, network, asset, amount_base_units, pay_to, status, header, created_at, updated_at) VALUES ($1,$2,$3,$4,'400000',$5,'signing',NULL,$6,$6)",
      idOf(5), WALLET, f.config.network, f.config.allowedAsset, TO, now); // a crash left this reservation
    await expect(a.payer.pay(idOf(5))).rejects.toMatchObject({ code: 'conflict', retrySafe: false });
    expect(f.signer).not.toHaveBeenCalled();
    expect(f.sent).toEqual([]);
    // Its reservation still counts against the cap, so it can never be silently exceeded.
    expect(await a.ledger.committed(f.config.network, f.config.allowedAsset)).toBe(400000n);
    // Other purchases are not blocked by it (within the remaining cap).
    await a.payer.pay(idOf(6));
    expect(f.sent).toHaveLength(1);
  });

  it('releases only the unsent reservation after an in-process signing failure, so a retry can sign once', async () => {
    const f = fixture(); const a = await f.boot(newTestSchema());
    f.control.failSigning();
    await expect(a.payer.pay(idOf(1))).rejects.toMatchObject({ retrySafe: true });
    expect(await rows(a.db)).toEqual([]);
    f.control.okSigning();
    await a.payer.pay(idOf(1));
    expect(f.signer).toHaveBeenCalledTimes(2);
    expect((await rows(a.db))).toHaveLength(1);
  });

  it('refuses to bind to a ledger that belongs to a different wallet, and never rewrites history', async () => {
    const f = fixture(); const schema = newTestSchema();
    const a = await f.boot(schema);
    await a.payer.pay(idOf(1));
    await expect(PgPayerLedger.open(a.db, { network: f.config.network, address: 'addr_test1qzsomeoneelse000000000' })).rejects.toThrow(/different wallet identity/);
    await expect(PgPayerLedger.open(a.db, { network: 'cardano:mainnet', address: WALLET })).rejects.toThrow(/different wallet identity/);
    expect(await rows(a.db)).toHaveLength(1);
    // Re-opening with the same identity is idempotent (deploys and restarts do this every time).
    await PgPayerLedger.open(a.db, { network: f.config.network, address: WALLET });
    await PgPayerLedger.open(a.db, { network: f.config.network, address: WALLET });
    expect(await a.db.all('SELECT * FROM hosted_payer_identity')).toHaveLength(1);
  });

  it('enforces immutability in the database itself', async () => {
    const f = fixture(); const a = await f.boot(newTestSchema());
    await a.payer.pay(idOf(1));
    await expect(a.db.run("UPDATE hosted_payer_ledger SET amount_base_units = '1'")).rejects.toThrow(/immutable/);
    await expect(a.db.run("UPDATE hosted_payer_ledger SET pay_to = 'addr_test1evil'")).rejects.toThrow(/immutable/);
    await expect(a.db.run("UPDATE hosted_payer_ledger SET header = 'other'")).rejects.toThrow(/immutable/);
    await expect(a.db.run("UPDATE hosted_payer_ledger SET status = 'signed'")).rejects.toThrow(/backwards/);
    await expect(a.db.run('DELETE FROM hosted_payer_ledger')).rejects.toThrow(/cannot be deleted/);
    await expect(a.db.run("UPDATE hosted_payer_identity SET public_address = 'x'")).rejects.toThrow(/permanent/);
    await expect(a.db.run('DELETE FROM hosted_payer_identity')).rejects.toThrow(/permanent/);
    expect(await rows(a.db)).toHaveLength(1);
  });
});

describe('hosted payer start-up (free web service, no disk)', () => {
  const startEnv = async (over: Record<string, string> = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'hosted-start-')); roots.push(root);
    const mnemonic = join(root, 'payer.mnemonic'); const bridge = join(root, 'bridge-token');
    writeFileSync(mnemonic, TEST_MNEMONIC); writeFileSync(bridge, TOKEN);
    const f = fixture({ PAYER_CARDANO_MNEMONIC_FILE: mnemonic });
    const address = deriveWalletAddress(f.config);
    return { env: { ...f.env, PAYER_CARDANO_MNEMONIC_FILE: mnemonic, PAYER_WALLET_ADDRESS: address, PAYER_BRIDGE_TOKEN_FILE: bridge, PAYER_BRIDGE_ALLOWED_HOSTS: HOST, PAYER_GATEWAY_URL: 'https://token2049-origins.onrender.com', ...over } as NodeJS.ProcessEnv, address };
  };

  it('starts, binds the ledger identity to the expected wallet, and serves only /health, /status and /pay', async () => {
    const { env, address } = await startEnv();
    const db = await createTestDb();
    const h = await startHostedPayer(env, { db, port: await freePort() });
    servers.push(h.server);
    const port = (h.server.address() as AddressInfo).port;
    expect((await rawRequest(port, '/health', 'GET', {})).status).toBe(200);
    const status = await rawRequest(port, '/status', 'GET', { host: HOST, 'x-forwarded-proto': 'https', authorization: `Bearer ${TOKEN}` });
    expect(status.status).toBe(200);
    expect(JSON.parse(status.body).source).toMatchObject({ rail: 'cardano', network: 'cardano:preprod', publicAddress: address, readiness: 'configured' });
    expect(await db.all('SELECT public_address FROM hosted_payer_identity')).toEqual([{ public_address: address }]);
    expect((await rawRequest(port, '/mnemonic', 'GET', { host: HOST, 'x-forwarded-proto': 'https', authorization: `Bearer ${TOKEN}` })).status).toBe(404);
  });

  it('refuses a mnemonic whose address is not the configured wallet', async () => {
    const { env } = await startEnv({ PAYER_WALLET_ADDRESS: 'addr_test1qzsomeoneelse000000000' });
    await expect(startHostedPayer(env, { db: await createTestDb(), port: 0 })).rejects.toThrow(/does not match PAYER_WALLET_ADDRESS/);
  });

  it('refuses a database that already holds a different wallet identity', async () => {
    const { env } = await startEnv();
    const db = await createTestDb();
    await PgPayerLedger.open(db, { network: 'cardano:preprod', address: 'addr_test1qzhistoricwallet0000000' });
    await expect(startHostedPayer(env, { db, port: 0 })).rejects.toThrow(/different wallet identity/);
  });

  it('does not accept a file ledger, an http gateway, or a missing wallet address', async () => {
    const db = await createTestDb();
    await expect(startHostedPayer((await startEnv({ PAYER_LEDGER_FILE: join(tmpdir(), 'x.json') })).env, { db, port: 0 })).rejects.toThrow('PAYER_LEDGER_FILE');
    await expect(startHostedPayer((await startEnv({ PAYER_GATEWAY_URL: 'http://127.0.0.1:8787' })).env, { db, port: 0 })).rejects.toThrow(/https required/);
    await expect(startHostedPayer((await startEnv({ PAYER_WALLET_ADDRESS: '' })).env, { db, port: 0 })).rejects.toThrow('PAYER_WALLET_ADDRESS');
  });

  it('validates the public host allowlist', () => {
    expect(allowedHostsFrom({ PAYER_BRIDGE_ALLOWED_HOSTS: 'T2O-Cardano-Payer.onrender.com' })).toEqual(['t2o-cardano-payer.onrender.com']);
    expect(() => allowedHostsFrom({})).toThrow();
    for (const bad of ['payer', 'evil.example/x', 'user@host.example', '*', 'a.b:8080', 'https://x.example']) expect(() => allowedHostsFrom({ PAYER_BRIDGE_ALLOWED_HOSTS: bad }), bad).toThrow();
  });
});

describe('hosted payer: public bridge access', () => {
  async function bridge(opts: { now?: () => number; maxRequestsPerMinute?: number; maxFailuresPerMinute?: number } = {}) {
    const f = fixture(); const a = await f.boot(newTestSchema());
    const server = createBridge({ payer: a.payer, token: TOKEN, access: { mode: 'hosted', allowedHosts: [HOST], ...opts }, source: () => a.payer.source() });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return { f, a, port: (server.address() as AddressInfo).port };
  }
  const good = { host: HOST, 'x-forwarded-proto': 'https', authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

  it('requires https, the exact host, no Origin, and the bearer token', async () => {
    const { port } = await bridge();
    expect((await rawRequest(port, '/status', 'GET', good)).status).toBe(200);
    expect((await rawRequest(port, '/status', 'GET', { ...good, 'x-forwarded-proto': 'http' })).status).toBe(401);
    expect((await rawRequest(port, '/status', 'GET', { ...good, 'x-forwarded-proto': undefined as any })).status).toBe(401);
    expect((await rawRequest(port, '/status', 'GET', { ...good, host: 'token2049-origins.onrender.com' })).status).toBe(401);
    expect((await rawRequest(port, '/status', 'GET', { ...good, host: `${HOST}.evil.example` })).status).toBe(401);
    expect((await rawRequest(port, '/status', 'GET', { ...good, origin: 'https://chatgpt.com' })).status).toBe(401);
    expect((await rawRequest(port, '/status', 'GET', { ...good, authorization: undefined as any })).status).toBe(401);
    expect((await rawRequest(port, '/status', 'GET', { ...good, authorization: 'Bearer wrong-token-wrong-token-wrong' })).status).toBe(401);
    expect((await rawRequest(port, '/pay', 'POST', { ...good, authorization: 'Bearer wrong-token-wrong-token-wrong' }, JSON.stringify({ purchaseId: idOf(1) }))).status).toBe(401);
  });

  it('answers the platform health probe without proxy headers and reveals nothing', async () => {
    const { port } = await bridge();
    const res = await rawRequest(port, '/health', 'GET', {});
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('accepts only a purchaseId: no caller-controlled amount, payee, asset, network or rail', async () => {
    const { f, a, port } = await bridge();
    for (const extra of [{ amount: '1' }, { payTo: 'addr_test1evil' }, { asset: 'lovelace' }, { network: 'cardano:mainnet' }, { rail: 'solana' }, { maxTotal: '999' }]) {
      const res = await rawRequest(port, '/pay', 'POST', good, JSON.stringify({ purchaseId: idOf(1), ...extra }));
      expect(res.status, JSON.stringify(extra)).toBe(400);
    }
    expect((await rawRequest(port, '/pay', 'POST', good, JSON.stringify({}))).status).toBe(400);
    expect((await rawRequest(port, '/pay', 'POST', good, '[]')).status).toBe(400);
    expect((await rawRequest(port, '/pay', 'POST', good, 'not json')).status).toBe(400);
    expect((await rawRequest(port, '/pay', 'POST', good, JSON.stringify({ purchaseId: 'x'.repeat(5000) }))).status).toBeGreaterThanOrEqual(400);
    expect(f.sent).toEqual([]);
    expect(await rows(a.db)).toEqual([]);
  });

  it('pays the canonical requirement for a valid purchaseId once, however often it is called', async () => {
    const { f, a, port } = await bridge();
    const rs = await Promise.all([1, 2, 3].map(() => rawRequest(port, '/pay', 'POST', good, JSON.stringify({ purchaseId: idOf(9) }))));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(f.signer).toHaveBeenCalledTimes(1);
    expect(new Set(f.sent).size).toBe(1);
    expect(await rows(a.db)).toHaveLength(1);
  });

  it('rate-limits floods and locks out repeated failed authentication, then recovers', async () => {
    let clock = 1_000_000;
    const { port } = await bridge({ now: () => clock, maxRequestsPerMinute: 1000, maxFailuresPerMinute: 4 });
    for (let i = 0; i < 4; i++) expect((await rawRequest(port, '/status', 'GET', { ...good, authorization: 'Bearer wrong-token-wrong-token-wrong' })).status).toBe(401);
    // Locked out: even the correct token is refused until the window passes.
    expect((await rawRequest(port, '/status', 'GET', good)).status).toBe(429);
    clock += 61_000;
    expect((await rawRequest(port, '/status', 'GET', good)).status).toBe(200);

    let c2 = 5_000_000;
    const flood = await bridge({ now: () => c2, maxRequestsPerMinute: 5, maxFailuresPerMinute: 100 });
    for (let i = 0; i < 5; i++) expect((await rawRequest(flood.port, '/status', 'GET', good)).status).toBe(200);
    const limited = await rawRequest(flood.port, '/status', 'GET', good);
    expect(limited.status).toBe(429);
    c2 += 61_000;
    expect((await rawRequest(flood.port, '/status', 'GET', good)).status).toBe(200);
  });

  it('never returns or logs the bridge token, gateway token, mnemonic detail or signed payload', async () => {
    const f = fixture(); const a = await f.boot(newTestSchema());
    const logs: string[] = [];
    const payer = new Payer({ ...f.deps, ledger: a.ledger, log: (e) => logs.push(JSON.stringify(e)) });
    const server = createBridge({ payer, token: TOKEN, access: { mode: 'hosted', allowedHosts: [HOST] }, log: (e) => logs.push(JSON.stringify(e)) });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const ok = await rawRequest(port, '/pay', 'POST', good, JSON.stringify({ purchaseId: idOf(9) }));
    f.control.failSigning();
    const failed = await rawRequest(port, '/pay', 'POST', good, JSON.stringify({ purchaseId: idOf(10) }));
    expect(failed.status).toBeGreaterThanOrEqual(400);
    const everything = [ok.body, failed.body, ...logs].join('\n');
    for (const secret of [TOKEN, GATEWAY_TOKEN, f.sent[0] ?? 'x', 'secret-looking detail', 'mnemonic', 'test-only']) expect(everything).not.toContain(secret);
  });
});

const freePort = () => new Promise<number>((resolve) => {
  const s = createNetServer();
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => resolve(p)); });
});
function rawRequest(port: number, path: string, method: string, headers: Record<string, string | undefined>, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const clean = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined)) as Record<string, string>;
    const r = request({ host: '127.0.0.1', port, path, method, headers: clean }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    r.on('error', reject);
    r.end(body);
  });
}
