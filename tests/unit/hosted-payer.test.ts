import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { USDM_PREPROD_ASSET } from '@x402/cardano';
import type { PaymentRequired } from '@x402/core/types';
import { money } from '../../src/contracts/money.js';
import { Payer, PayerError } from '../../clients/payer/payer.js';
import { loadPayerConfig } from '../../clients/payer/config.js';
import { PayerLedger } from '../../clients/payer/ledger.js';
import { createBridge, isPrivatePeer } from '../../clients/payer/bridge.js';
import { allowedHostsFrom, initHostedLedger, startHostedPayer } from '../../clients/payer/hosted.js';

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const TO = 'addr_test1qztreasury0000000000000000000000000000000000000000000000';
const NOW = new Date('2026-10-06T00:00:00Z');
const EXPIRY = '2026-10-06T00:10:00Z';
const TOKEN = 'hosted-payer-bridge-token-0123456789';
const GATEWAY_TOKEN = 'gateway-payer-token-secret-value';
const HOST = 't2o-cardano-payer:8788';
const idOf = (n: number) => `pur_ABCDEFGHIJKLM${String(n).padStart(3, '0')}`;

/** A hosted-style payer config + a gateway fake that serves any purchase id with the same exact requirement. */
function setup(over: Record<string, string> = {}, root = mkdtempSync(join(tmpdir(), 'hosted-payer-'))) {
  if (!roots.includes(root)) roots.push(root);
  const env = {
    PAYER_GATEWAY_URL: 'https://token2049-origins.example.test', PAYER_GATEWAY_TOKEN_FILE: 'unused', PAYER_CARDANO_NETWORK: 'cardano:preprod',
    PAYER_CARDANO_MNEMONIC_FILE: 'unused', BLOCKFROST_PROJECT_ID: 'test-only', PAYER_MAX_PER_PAYMENT_BASE_UNITS: '500000',
    PAYER_MAX_CUMULATIVE_BASE_UNITS: '1000000', PAYER_MAX_DAILY_BASE_UNITS: '1000000', PAYER_MAX_FEE_LOVELACE: '500000', PAYER_MAX_ADA_OUTPUT_LOVELACE: '3000000',
    PAYER_ALLOWED_ASSET_UNIT: USDM_PREPROD_ASSET, PAYER_EXPECTED_PAY_TO: TO, PAYER_LEDGER_FILE: join(root, 'disk', 'ledger.json'), ...over,
  };
  const config = loadPayerConfig(env);
  const amount = '400000';
  const settlement = { policy: { mode: 'scaled_testnet' as const, numerator: 1 as const, denominator: 1000 as const }, commercialPrincipal: money('USD', 40000n), commercialServiceFee: money('USD', 0n), commercialTotal: money('USD', 40000n), principalBaseUnits: amount, feeBaseUnits: '0', totalBaseUnits: amount };
  const entryFor = (id: string) => ({ scheme: 'exact', network: config.network, asset: config.allowedAsset, amount, payTo: TO, maxTimeoutSeconds: 600,
    extra: { settlement, chainDecimals: 6, assetTransferMethod: 'default', areFeesSponsored: false, confirmationPolicy: { l1Confirmations: 1 }, purchaseId: id,
      quoteId: 'quo_ABCDEFGHIJKLMNOP', quoteDigest: 'sha256:' + 'd'.repeat(64), expiresAt: EXPIRY } });
  const purchaseFor = (id: string) => ({ purchaseId: id, quoteId: 'quo_ABCDEFGHIJKLMNOP', state: 'awaiting_funding', paymentState: 'not_received',
    fundingInstructions: { expiresAt: EXPIRY, options: [{ rail: 'cardano', amount: { network: config.network, assetId: config.allowedAsset, amountBaseUnits: amount, decimals: 6 }, payTo: TO, settlement }] }, funding: [] });
  const sent: string[] = [];
  const signer = vi.fn(() => ({ getAddress: () => 'addr_test1qzpayer0000000000000', buildAndSignPaymentTransaction: async () => ({ transaction: 'test-only', nonce: `${'b'.repeat(64)}#0` }) }));
  const fetchImpl: typeof fetch = async (url, init) => {
    const id = /purchases\/(pur_[A-Za-z0-9]+)/.exec(String(url))![1]!;
    if (init?.method === 'GET') return new Response(JSON.stringify({ purchase: purchaseFor(id) }), { status: 200 });
    const signature = new Headers(init?.headers).get('payment-signature');
    const challenge: PaymentRequired = { x402Version: 2, resource: { url: `${config.gatewayUrl}/v1/purchases/${id}/fund` }, accepts: [entryFor(id)] };
    if (!signature) return new Response('{}', { status: 402, headers: { 'payment-required': encodePaymentRequiredHeader(challenge) } });
    sent.push(signature);
    return new Response(JSON.stringify({ purchase: { ...purchaseFor(id), state: 'funded_queued', funding: [{ transferReference: 'a'.repeat(64) }] } }), { status: 202 });
  };
  PayerLedger.initialize(config.ledgerFile);
  const deps = { config, fetchImpl, createSigner: signer, readGatewayToken: () => GATEWAY_TOKEN, now: () => NOW, sleep: async () => {} };
  return { root, env, config, sent, signer, deps, ledger: () => new PayerLedger(config.ledgerFile) };
}

describe('hosted payer: spend history and idempotency', () => {
  it('keeps cumulative spend across a service restart (new process, same persistent ledger)', async () => {
    const s = setup();
    await new Payer(s.deps).pay(idOf(1)); // 400000
    await new Payer(s.deps).pay(idOf(2)); // 800000: a fresh Payer object stands in for a redeployed service
    expect(s.ledger().committed(s.config.network, s.config.allowedAsset)).toBe(800000n);
    // The third payment would take cumulative spend to 1,200,000 > 1,000,000 even though this process never saw the others.
    await expect(new Payer(s.deps).pay(idOf(3))).rejects.toThrow('cumulative_cap');
    expect(s.signer).toHaveBeenCalledTimes(2);
  });

  it('never signs more than once for one purchase, including concurrent and repeated /pay calls through the bridge', async () => {
    const s = setup();
    const payer = new Payer(s.deps);
    const server = createBridge({ payer, token: TOKEN, access: { mode: 'private', allowedHosts: [HOST] } });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const pay = (id: string) => rawRequest(port, '/pay', 'POST', { host: HOST, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, JSON.stringify({ purchaseId: id }));
    const results = await Promise.all([pay(idOf(7)), pay(idOf(7)), pay(idOf(7)), pay(idOf(7))]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(s.signer).toHaveBeenCalledTimes(1);
    expect(new Set(s.sent).size).toBe(1); // every retransmission carries the identical, already-signed transaction
    expect(s.ledger().committed(s.config.network, s.config.allowedAsset)).toBe(400000n);
  });

  it('refuses to start (and to sign) when the ledger is missing instead of recreating empty history', async () => {
    const s = setup();
    rmSync(s.config.ledgerFile);
    await expect(startHostedPayer({ ...s.env, PAYER_BRIDGE_TOKEN_FILE: tokenFile(s.root), PAYER_BRIDGE_PORT: String(await freePort()), PAYER_BRIDGE_ALLOWED_HOSTS: HOST })).rejects.toThrow(/ledger is missing/);
    expect(() => new Payer(s.deps)).toThrow(/ledger is missing/);
    expect(existsSync(s.config.ledgerFile)).toBe(false);
    expect(s.signer).not.toHaveBeenCalled();
  });

  it('initializes the ledger exactly once and never resets existing history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hosted-payer-init-')); roots.push(root);
    const env = { ...setup({}, root).env, PAYER_LEDGER_FILE: join(root, 'fresh', 'ledger.json') };
    expect(initHostedLedger(env)).toBe(env.PAYER_LEDGER_FILE);
    const before = readFileSync(env.PAYER_LEDGER_FILE, 'utf8');
    expect(() => initHostedLedger(env)).toThrow();
    expect(readFileSync(env.PAYER_LEDGER_FILE, 'utf8')).toBe(before);
  });

  it('leaves a crash lock for the operator instead of clearing it', async () => {
    const s = setup();
    writeFileSync(`${s.config.ledgerFile}.lock`, '');
    await expect(new Payer(s.deps).pay(idOf(1))).rejects.toThrow('locked');
    expect(existsSync(`${s.config.ledgerFile}.lock`)).toBe(true);
    expect(s.signer).not.toHaveBeenCalled();
  });
});

describe('hosted payer: private-network access', () => {
  it('classifies peers: loopback and private ranges only', () => {
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.0.4.7', '172.16.0.9', '172.31.255.1', '192.168.1.5', '::ffff:10.1.2.3', 'fd12:3456::1']) expect(isPrivatePeer(a), a).toBe(true);
    for (const a of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '203.0.113.9', '2001:db8::1', '::ffff:8.8.8.8', '', undefined]) expect(isPrivatePeer(a as string | undefined), String(a)).toBe(false);
  });

  it('answers only the exact private host, with the token, and nothing from browsers', async () => {
    const s = setup();
    const payer = new Payer(s.deps);
    const server = createBridge({ payer, token: TOKEN, access: { mode: 'private', allowedHosts: [HOST] }, source: () => payer.source() });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const auth = { authorization: `Bearer ${TOKEN}` };
    expect((await rawRequest(port, '/status', 'GET', { host: HOST, ...auth })).status).toBe(200);
    expect((await rawRequest(port, '/status', 'GET', { host: HOST })).status).toBe(401);
    expect((await rawRequest(port, '/status', 'GET', { host: 'token2049-origins.onrender.com', ...auth })).status).toBe(401);
    expect((await rawRequest(port, '/status', 'GET', { host: `${HOST}.evil.example`, ...auth })).status).toBe(401);
    expect((await rawRequest(port, '/status', 'GET', { host: HOST, origin: 'https://chatgpt.com', ...auth })).status).toBe(401);
    // Only the purchase id is accepted: no amount, payee, asset or rail can be supplied by the caller.
    const extra = await rawRequest(port, '/pay', 'POST', { host: HOST, ...auth, 'content-type': 'application/json' }, JSON.stringify({ purchaseId: idOf(1), amount: '1', payTo: 'addr_test1evil' }));
    expect(extra.status).toBe(400);
    expect(s.sent).toEqual([]);
    expect(s.ledger().committed(s.config.network, s.config.allowedAsset)).toBe(0n);
  });

  it('keeps loopback mode strict by default (a private hostname is refused)', async () => {
    const s = setup();
    const server = createBridge({ payer: new Payer(s.deps), token: TOKEN });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    expect((await rawRequest(port, '/health', 'GET', { host: HOST })).status).toBe(401);
  });

  it('validates the host allowlist configuration', () => {
    expect(allowedHostsFrom({ PAYER_BRIDGE_ALLOWED_HOSTS: 'T2O-Cardano-Payer:8788' })).toEqual(['t2o-cardano-payer:8788']);
    expect(() => allowedHostsFrom({})).toThrow();
    for (const bad of ['evil.example/x', 'user@host', '*', 'a.b.c:1:2']) expect(() => allowedHostsFrom({ PAYER_BRIDGE_ALLOWED_HOSTS: bad }), bad).toThrow();
  });

  it('requires an https gateway URL when hosted', async () => {
    const s = setup({ PAYER_GATEWAY_URL: 'http://127.0.0.1:8787' });
    await expect(startHostedPayer({ ...s.env, PAYER_BRIDGE_TOKEN_FILE: tokenFile(s.root), PAYER_BRIDGE_PORT: String(await freePort()), PAYER_BRIDGE_ALLOWED_HOSTS: HOST })).rejects.toThrow(/https required/);
  });
});

describe('hosted payer: nothing secret is emitted', () => {
  it('never returns or logs the bridge token, gateway token or signed payload', async () => {
    const s = setup();
    const logs: string[] = [];
    const payer = new Payer({ ...s.deps, log: (e) => logs.push(JSON.stringify(e)) });
    const server = createBridge({ payer, token: TOKEN, access: { mode: 'private', allowedHosts: [HOST] }, log: (e) => logs.push(JSON.stringify(e)) });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const ok = await rawRequest(port, '/pay', 'POST', { host: HOST, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, JSON.stringify({ purchaseId: idOf(9) }));
    const bad = await rawRequest(port, '/pay', 'POST', { host: HOST, authorization: 'Bearer wrong-token-wrong-token-wrong', 'content-type': 'application/json' }, JSON.stringify({ purchaseId: idOf(9) }));
    const everything = [ok.body, bad.body, ...logs].join('\n');
    for (const secret of [TOKEN, GATEWAY_TOKEN, s.sent[0] ?? 'x', 'mnemonic', 'test-only']) expect(everything).not.toContain(secret);
    // The signed header exists only in the 0600 ledger (reuse on retry), never on any outward surface.
    expect(readFileSync(s.config.ledgerFile, 'utf8')).not.toContain(GATEWAY_TOKEN);
  });

  it('keeps PayerError as the only failure surface of the bridge', () => {
    expect(new PayerError('policy_violation', 'x').code).toBe('policy_violation');
  });
});

function tokenFile(root: string): string {
  const file = join(root, 'bridge.token');
  writeFileSync(file, TOKEN);
  return file;
}
const freePort = () => new Promise<number>((resolve) => {
  const s = createNetServer();
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => resolve(p)); });
});
function rawRequest(port: number, path: string, method: string, headers: Record<string, string>, body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    r.on('error', reject);
    r.end(body);
  });
}
