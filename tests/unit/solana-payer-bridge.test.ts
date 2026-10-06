import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { createBridge, listenLoopback } from '../../clients/payer/bridge.js';
import { SolanaBridgePayer, type SolanaBridgeDeps } from '../../clients/solana/bridge.js';
import { FundingSource, maskAddress } from '../../src/contracts/presentation.js';
import { NETWORK, TEST_MINT } from '../../src/funding/solana/wire.js';

const TOKEN = 'solana-bridge-token-0123456789-abcdef';
const PAYER = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const PURCHASE = 'pur_ABCDEFGHIJKLMN';
const SIGNATURE = '5j7s' + 'x'.repeat(84);
const SECRETS = { keyFile: 'C:/secret/payer-key.json', sponsorKeyFile: 'C:/secret/sponsor-key.json', tokenFile: 'C:/secret/gateway.token' };
// Only the fields the bridge reads; the rest of SolanaPayerConfig is the existing payment implementation's concern.
const config = { payer: PAYER, mint: TEST_MINT, ...SECRETS } as unknown as SolanaBridgeDeps['config'];

let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>(r => server!.close(() => r())); server = undefined; });

async function start(deps: Partial<SolanaBridgeDeps> = {}) {
  const payer = new SolanaBridgePayer({ config, ready: async () => true, ...deps });
  server = createBridge({ payer, token: TOKEN, source: () => payer.source() });
  await listenLoopback(server, 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, token: string | null = TOKEN) => {
    const res = await fetch(base + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    return { status: res.status, text, json: text ? JSON.parse(text) : null };
  };
  return { call, base };
}
const noSecrets = (text: string) => {
  for (const s of [...Object.values(SECRETS), 'payment-signature', 'secret rpc detail']) expect(text).not.toContain(s);
};

describe('Solana payer bridge', () => {
  it('serves /health without credentials and /status only with the bridge token', async () => {
    const { call } = await start();
    expect((await call('GET', '/health', undefined, null)).json).toEqual({ ok: true });
    expect((await call('GET', '/status', undefined, null)).status).toBe(401);
    expect((await call('GET', '/status', undefined, 'wrong-token-wrong-token-wrong-token')).status).toBe(401);
  });

  it('exposes a sanitized Solana FundingSource and no secret configuration', async () => {
    const { call } = await start();
    const r = await call('GET', '/status');
    expect(r.status).toBe(200);
    const source = FundingSource.parse(r.json.source);
    expect(source).toMatchObject({ rail: 'solana', network: NETWORK, assetId: TEST_MINT, publicAddress: PAYER, displayAddress: maskAddress(PAYER), readiness: 'configured' });
    noSecrets(r.text);
  });

  it('reports readiness unavailable when the protected ledger/key check fails, and refuses to pay', async () => {
    let paid = 0;
    const { call } = await start({ ready: async () => false, pay: async () => { paid++; return { status: 202, signature: SIGNATURE, header: 'h' }; } });
    expect((await call('GET', '/status')).json.source.readiness).toBe('unavailable');
    expect((await call('POST', '/pay', { purchaseId: PURCHASE })).status).toBe(500);
    expect(paid).toBe(0);
  });

  it('pays only the requested purchase and returns just the public signature', async () => {
    const seen: string[] = [];
    const { call } = await start({ pay: async (_c, id) => { seen.push(id); return { status: 202, signature: SIGNATURE, header: 'payment-signature-header-secret' }; } });
    const r = await call('POST', '/pay', { purchaseId: PURCHASE });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, payment: { transferReference: SIGNATURE } });
    expect(seen).toEqual([PURCHASE]);
    expect(r.text).not.toContain('payment-signature-header-secret');
    noSecrets(r.text);
  });

  it.each([
    [{ purchaseId: PURCHASE, amount: '1' }],
    [{ purchaseId: PURCHASE, payTo: PAYER }],
    [{ purchaseId: PURCHASE, network: NETWORK }],
    [{}], [{ purchaseId: 7 }], [{ purchaseId: 'not-a-purchase' }],
  ])('refuses caller-selected or malformed input %j without paying', async (body) => {
    let paid = 0;
    const { call } = await start({ pay: async () => { paid++; return { status: 202, signature: SIGNATURE, header: 'h' }; } });
    expect((await call('POST', '/pay', body)).status).toBe(400);
    expect(paid).toBe(0);
  });

  it.each([[409, 409, 'conflict'], [402, 422, 'payment_rejected'], [401, 422, 'payment_rejected'], [500, 502, 'gateway_unreachable'], [503, 502, 'gateway_unreachable']])('maps gateway status %i to bridge %i %s without echoing bodies', async (gateway, bridge, code) => {
    const { call } = await start({ pay: async () => ({ status: gateway, signature: SIGNATURE, header: 'h' }) });
    const r = await call('POST', '/pay', { purchaseId: PURCHASE });
    expect(r.status).toBe(bridge);
    expect(r.json.error.code).toBe(code);
    expect(r.text).not.toContain(SIGNATURE);
  });

  it('hides the reason when the payment implementation throws', async () => {
    const { call } = await start({ pay: async () => { throw new Error('secret rpc detail ' + SECRETS.keyFile); } });
    const r = await call('POST', '/pay', { purchaseId: PURCHASE });
    expect(r.status).toBe(500);
    expect(r.json.ok).toBe(false);
    noSecrets(r.text);
  });

  it('serializes concurrent payment requests', async () => {
    let active = 0, peak = 0, calls = 0;
    const { call } = await start({ pay: async () => {
      calls++; active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 20)); active--;
      return { status: 202, signature: SIGNATURE, header: 'h' };
    } });
    await Promise.all([call('POST', '/pay', { purchaseId: PURCHASE }), call('POST', '/pay', { purchaseId: 'pur_ZYXWVUTSRQPONM' }), call('POST', '/pay', { purchaseId: PURCHASE })]);
    expect(calls).toBe(3);
    expect(peak).toBe(1);
  });

  it('listens on loopback only and refuses browser-style or foreign Host requests', async () => {
    const { base } = await start();
    expect((server!.address() as AddressInfo).address).toBe('127.0.0.1');
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(base + '/status', { headers: { host: 'evil.example', authorization: `Bearer ${TOKEN}` } }, res => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject); req.end();
    });
    expect(status).toBe(401);
  });
});
