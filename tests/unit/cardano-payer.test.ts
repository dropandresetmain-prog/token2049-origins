import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { USDM_PREPROD_ASSET } from '@x402/cardano';
import type { PaymentRequired } from '@x402/core/types';
import { money } from '../../src/contracts/money.js';
import { payerLedgerPath } from '../../clients/payer/config.js';
import { generateWallet } from '../../clients/payer/wallet-generate.js';
import { assertAdaBudget } from '../../clients/payer/signer.js';
import { isTrustedBlockfrostUrl } from '../../src/funding/cardano/blockfrost.js';
import { Payer } from '../../clients/payer/payer.js';
import { loadPayerConfig } from '../../clients/payer/config.js';
import { PayerLedger } from '../../clients/payer/ledger.js';
import { createBridge } from '../../clients/payer/bridge.js';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const ID = 'pur_ABCDEFGHIJKLMNOP';
const TO = 'addr_test1qztreasury0000000000000000000000000000000000000000000000';
const NOW = new Date('2026-10-06T00:00:00Z');
const EXPIRY = '2026-10-06T00:10:00Z';
function setup(amount = '1500000') {
  const root = mkdtempSync(join(tmpdir(), 'cardano-payer-')); roots.push(root);
  const payerEnv = { PAYER_GATEWAY_URL: 'https://gateway.example.test', PAYER_GATEWAY_TOKEN_FILE: 'unused',
    PAYER_CARDANO_NETWORK: 'cardano:preprod', PAYER_CARDANO_MNEMONIC_FILE: 'unused', BLOCKFROST_PROJECT_ID: 'test-only',
    PAYER_MAX_PER_PAYMENT_BASE_UNITS: '2000000', PAYER_MAX_CUMULATIVE_BASE_UNITS: '5000000', PAYER_MAX_DAILY_BASE_UNITS: '3000000', PAYER_MAX_FEE_LOVELACE: '500000', PAYER_MAX_ADA_OUTPUT_LOVELACE: '3000000',
    PAYER_ALLOWED_ASSET_UNIT: USDM_PREPROD_ASSET, PAYER_EXPECTED_PAY_TO: TO, PAYER_LEDGER_FILE: join(root, 'ledger.json') };
  const config = loadPayerConfig(payerEnv);
  const settlement = { policy: { mode: 'scaled_testnet' as const, numerator: 1 as const, denominator: 1000 as const }, commercialPrincipal: money('USD', BigInt(amount) / 10n), commercialServiceFee: money('USD', 0n), commercialTotal: money('USD', BigInt(amount) / 10n), principalBaseUnits: amount, feeBaseUnits: '0', totalBaseUnits: amount };
  PayerLedger.initialize(config.ledgerFile);
  const entry = { scheme: 'exact', network: config.network, asset: config.allowedAsset, amount, payTo: TO, maxTimeoutSeconds: 600,
    extra: { settlement, chainDecimals: 6, assetTransferMethod: 'default', areFeesSponsored: false, confirmationPolicy: { l1Confirmations: 1 }, purchaseId: ID,
      quoteId: 'quo_ABCDEFGHIJKLMNOP', quoteDigest: 'd'.repeat(64), expiresAt: EXPIRY } };
  const challenge: PaymentRequired = { x402Version: 2, resource: { url: `${config.gatewayUrl}/v1/purchases/${ID}/fund` }, accepts: [entry] };
  const purchase = { purchaseId: ID, quoteId: 'quo_ABCDEFGHIJKLMNOP', state: 'awaiting_funding', paymentState: 'not_received',
    fundingInstructions: { expiresAt: EXPIRY, options: [{ rail: 'cardano', amount: { network: config.network, assetId: config.allowedAsset, amountBaseUnits: amount, decimals: 6 }, payTo: TO, settlement }] }, funding: [] };
  const sent: string[] = [];
  const signer = vi.fn(() => ({ getAddress: () => 'addr_test1qzpayer', buildAndSignPaymentTransaction: async () => ({ transaction: 'test-only', nonce: `${'b'.repeat(64)}#0` }) }));
  const fetchImpl: typeof fetch = async (url, init) => {
    expect(String(url).startsWith(config.gatewayUrl)).toBe(true); expect(init?.redirect).toBe('error');
    if (init?.method === 'GET') return new Response(JSON.stringify({ purchase }), { status: 200 });
    const signature = new Headers(init?.headers).get('payment-signature');
    if (!signature) return new Response('{}', { status: 402, headers: { 'payment-required': encodePaymentRequiredHeader(challenge) } });
    sent.push(signature);
    return new Response(JSON.stringify({ purchase: { ...purchase, state: 'funded_queued', funding: [{ transferReference: 'a'.repeat(64) }] } }), { status: 202 });
  };
  const ledger = new PayerLedger(config.ledgerFile);
  const deps = { config, ledger, fetchImpl, createSigner: signer, readGatewayToken: () => 'test-token', now: () => NOW, sleep: async () => {} };
  return { root, payerEnv, config, entry, challenge, purchase, sent, signer, ledger, deps };
}
describe('bounded payer', () => {
  it('signs one vetted purchase, persists it before send, and reuses the identical header on restart', async () => {
    const s = setup(); await new Payer(s.deps).pay(ID); await new Payer(s.deps).pay(ID);
    expect(s.signer).toHaveBeenCalledTimes(1); expect(s.sent).toHaveLength(2); expect(s.sent[0]).toBe(s.sent[1]);
    expect(readFileSync(s.config.ledgerFile, 'utf8')).not.toContain('test-token');
  });
  it.each(['amount', 'daily', 'cumulative', 'payee', 'resource', 'expiry', 'identity', 'method', 'version', 'shape', 'scale', 'fee_scale', 'settlement_mode', 'network', 'asset'])('refuses %s violations before touching a key', async kind => {
    const s = setup();
    if (kind === 'scale') s.entry.extra.settlement.policy.denominator = 999 as 1000;
    if (kind === 'fee_scale') s.entry.extra.settlement.feeBaseUnits = '1000000';
    if (kind === 'settlement_mode') (s.entry.extra.settlement.policy as { mode: string }).mode = 'full_notional';
    if (kind === 'network') s.entry.network = 'cardano:mainnet' as 'cardano:preprod';
    if (kind === 'asset') s.entry.asset = 'lovelace';
    if (kind === 'amount') s.config.maxPerPayment = 1n;
    if (kind === 'daily') s.config.maxDaily = 1n;
    if (kind === 'cumulative') s.config.maxCumulative = 1n;
    if (kind === 'payee') s.entry.payTo = 'addr_test1qzother';
    if (kind === 'resource') s.challenge.resource!.url = `https://attacker.example/v1/purchases/${ID}/fund`;
    if (kind === 'expiry') s.purchase.fundingInstructions.expiresAt = NOW.toISOString();
    if (kind === 'identity') s.purchase.purchaseId = 'pur_ANOTHERPURCHASE';
    if (kind === 'method') s.entry.extra.assetTransferMethod = 'script';
    if (kind === 'version') (s.challenge as unknown as { x402Version: number }).x402Version = 1;
    if (kind === 'shape') (s.challenge as unknown as { accepts: unknown }).accepts = null;
    await expect(new Payer(s.deps).pay(ID)).rejects.toThrow(); expect(s.signer).not.toHaveBeenCalled(); expect(s.sent).toEqual([]);
  });
  it('counts pending signatures from earlier days against the daily cap', async () => {
    const s = setup();
    s.ledger.upsert({ purchaseId: 'pur_OTHERPURCHASE', network: s.config.network, asset: s.config.allowedAsset, amountBaseUnits: '2000000', payTo: TO,
      status: 'signed', header: 'test-only', transferReference: null, createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-05T00:00:00Z' });
    await expect(new Payer(s.deps).pay(ID)).rejects.toThrow('daily_cap'); expect(s.signer).not.toHaveBeenCalled();
  });
  it('holds the shared ledger lock across signing and rejects a concurrent second process', async () => {
    const s = setup(); let release!: () => void;
    const hold = s.ledger.exclusive(() => new Promise<void>(r => { release = r; }));
    await expect(new Payer(s.deps).pay(ID)).rejects.toThrow('locked'); release(); await hold;
    expect(s.signer).not.toHaveBeenCalled();
  });
  it('fails closed when durable cap history is corrupt', async () => {
    const s = setup(); writeFileSync(s.config.ledgerFile, 'broken');
    await expect(new Payer(s.deps).pay(ID)).rejects.toThrow('unreadable'); expect(s.signer).not.toHaveBeenCalled();
  });
  it('retries transport loss with exactly the persisted transaction', async () => {
    const s = setup(); const base = s.deps.fetchImpl; let lost = false;
    s.deps.fetchImpl = async (url, init) => { const signature = new Headers(init?.headers).get('payment-signature');
      if (signature && !lost) { lost = true; s.sent.push(signature); throw new Error('timeout'); } return base(url, init); };
    await new Payer(s.deps).pay(ID); expect(s.signer).toHaveBeenCalledTimes(1); expect(s.sent[0]).toBe(s.sent[1]);
  });
});
describe('incidental ADA budget and provider destination', () => {
  it('refuses excessive fees or min-UTXO ADA before signing', () => {
    const s = setup();
    expect(() => assertAdaBudget(s.config, { fee: 500001n, outputs: [] }, s.config.allowedAsset)).toThrow('fee');
    expect(() => assertAdaBudget(s.config, { fee: 200000n, outputs: [{ address: TO, coin: 3000001n }] }, s.config.allowedAsset)).toThrow('ADA output');
    expect(() => assertAdaBudget(s.config, { fee: 200000n, outputs: [{ address: TO, coin: 2000000n }] }, s.config.allowedAsset)).not.toThrow();
  });
  it('restricts Blockfrost credentials to official Preprod or deliberate loopback', () => {
    expect(isTrustedBlockfrostUrl('https://cardano-preprod.blockfrost.io/api/v0')).toBe(true);
    expect(isTrustedBlockfrostUrl('http://127.0.0.1:9999/api/v0')).toBe(true);
    for (const url of ['https://attacker.example/api/v0', 'https://cardano-mainnet.blockfrost.io/api/v0', 'https://cardano-preprod.blockfrost.io/api/v0?key=secret']) {
      expect(isTrustedBlockfrostUrl(url)).toBe(false);
    }
  });
});
describe('localhost payer bridge', () => {
  it('requires bearer auth and rejects browser/host/extra URL input before payer access', async () => {
    const pay = vi.fn(async () => ({ purchase: { state: 'funded_queued' }, transferReference: 'a'.repeat(64), resumed: false }));
    const token = 'test-only-bridge-token-0123456789'; const server = createBridge({ payer: { pay }, token });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const url = `http://127.0.0.1:${address.port}/pay`;
    try {
      expect((await fetch(url, { method: 'POST', body: JSON.stringify({ purchaseId: ID }) })).status).toBe(401);
      const auth = { authorization: `Bearer ${token}` };
      expect((await fetch(url, { method: 'POST', headers: { ...auth, origin: 'https://evil.example' }, body: '{}' })).status).toBe(401);
      const hostStatus = await new Promise<number>(resolve => {
        const req = request(url, { method: 'POST', headers: { ...auth, host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode!); });
        req.end('{}');
      });
      expect(hostStatus).toBe(401);
      expect((await fetch(url, { method: 'POST', headers: auth, body: JSON.stringify({ purchaseId: ID, url: 'https://evil.example' }) })).status).toBe(400);
      expect(pay).not.toHaveBeenCalled();
      const response = await fetch(url, { method: 'POST', headers: auth, body: JSON.stringify({ purchaseId: ID }) });
      expect(response.status).toBe(200); expect(await response.text()).not.toContain(token); expect(pay).toHaveBeenCalledOnce();
    } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  });
});


describe('payer initialized ledger boundary', () => {
  it.each([undefined, '', './data/payer-ledger.json', 'relative.json', 'C:relative.json', '\u0000invalid'])('rejects missing, relative or malformed path %s', path => {
    const s = setup();
    expect(() => payerLedgerPath(path)).toThrow('PAYER_LEDGER_FILE');
    expect(() => loadPayerConfig({ ...s.payerEnv, PAYER_LEDGER_FILE: path })).toThrow('PAYER_LEDGER_FILE');
  });
  it('accepts a configured absolute existing ledger and refuses a vanished ledger before gateway or signing', async () => {
    const s = setup();
    expect(payerLedgerPath(s.config.ledgerFile)).toBe(s.config.ledgerFile);
    expect(() => s.ledger.assertReady()).not.toThrow();
    rmSync(s.config.ledgerFile);
    const fetchImpl = vi.fn(s.deps.fetchImpl);
    await expect(new Payer({ ...s.deps, fetchImpl }).pay(ID)).rejects.toThrow('reconciliation');
    expect(s.signer).not.toHaveBeenCalled(); expect(fetchImpl).not.toHaveBeenCalled();
    expect(() => new Payer({ ...s.deps, ledger: undefined })).toThrow('missing');
  });
  it('initializes empty history only with a new wallet and never resets an existing wallet history', () => {
    const root = mkdtempSync(join(tmpdir(), 'payer-setup-')); roots.push(root);
    const env = { PAYER_CARDANO_MNEMONIC_FILE: join(root, 'wallet.mnemonic'), PAYER_LEDGER_FILE: join(root, 'history.json') };
    const out = { write: vi.fn() };
    expect(() => generateWallet({ ...env, PAYER_LEDGER_FILE: './relative' }, out)).toThrow('absolute');
    generateWallet(env, out);
    const ledger = new PayerLedger(env.PAYER_LEDGER_FILE);
    expect(ledger.committed('cardano:preprod', USDM_PREPROD_ASSET)).toBe(0n);
    expect(() => generateWallet(env, out)).toThrow('overwrite');
    rmSync(env.PAYER_LEDGER_FILE);
    expect(() => generateWallet(env, out)).toThrow('reconciliation');
    expect(() => ledger.assertReady()).toThrow('missing');
    expect(JSON.stringify(out.write.mock)).not.toContain(readFileSync(env.PAYER_CARDANO_MNEMONIC_FILE, 'utf8').trim());
  });
});
