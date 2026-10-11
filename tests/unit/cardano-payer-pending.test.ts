/**
 * Cardano payer contract for an uncertain settlement: ONE signed funding POST per run; every ambiguous result is
 * reconciled by read-only GETs; a 202 confirmation_pending with no funding-evidence row is accepted as pending without
 * inventing confirmation; the signed header, transaction identity and cap accounting are never touched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { USDM_PREPROD_ASSET } from '@x402/cardano';
import type { PaymentRequired } from '@x402/core/types';
import { money } from '../../src/contracts/money.js';
import { loadPayerConfig } from '../../clients/payer/config.js';
import { PayerLedger } from '../../clients/payer/ledger.js';
import { Payer } from '../../clients/payer/payer.js';
import { createBridge } from '../../clients/payer/bridge.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const ID = 'pur_ABCDEFGHIJKLMNOP';
const TO = 'addr_test1qztreasury0000000000000000000000000000000000000000000000';
const NOW = new Date('2026-10-06T00:00:00Z');
const EXPIRY = '2026-10-06T00:10:00Z';
const TX = 'a'.repeat(64);
type View = { state: string; paymentState: string; funding: Array<{ transferReference: string }> };
type PostReply = () => Response | Promise<Response>;

function setup(amount = '400000', over: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cardano-pending-')); roots.push(root);
  const config = loadPayerConfig({ PAYER_GATEWAY_URL: 'https://gateway.example.test', PAYER_GATEWAY_TOKEN_FILE: 'unused',
    PAYER_CARDANO_NETWORK: 'cardano:preprod', PAYER_CARDANO_MNEMONIC_FILE: 'unused', BLOCKFROST_PROJECT_ID: 'test-only',
    PAYER_MAX_PER_PAYMENT_BASE_UNITS: '500000', PAYER_MAX_CUMULATIVE_BASE_UNITS: '1000000', PAYER_MAX_DAILY_BASE_UNITS: '1000000',
    PAYER_MAX_FEE_LOVELACE: '500000', PAYER_MAX_ADA_OUTPUT_LOVELACE: '3000000', PAYER_ALLOWED_ASSET_UNIT: USDM_PREPROD_ASSET,
    PAYER_EXPECTED_PAY_TO: TO, PAYER_LEDGER_FILE: join(root, 'ledger.json'), ...over });
  const settlement = { policy: { mode: 'scaled_testnet' as const, numerator: 1 as const, denominator: 1000 as const }, commercialPrincipal: money('USD', 40000n), commercialServiceFee: money('USD', 0n), commercialTotal: money('USD', 40000n), principalBaseUnits: amount, feeBaseUnits: '0', totalBaseUnits: amount };
  PayerLedger.initialize(config.ledgerFile);
  const entry = { scheme: 'exact', network: config.network, asset: config.allowedAsset, amount, payTo: TO, maxTimeoutSeconds: 600,
    extra: { settlement, chainDecimals: 6, assetTransferMethod: 'default', areFeesSponsored: false, confirmationPolicy: { l1Confirmations: 1 }, purchaseId: ID,
      quoteId: 'quo_ABCDEFGHIJKLMNOP', quoteDigest: 'sha256:' + 'd'.repeat(64), expiresAt: EXPIRY } };
  const challenge: PaymentRequired = { x402Version: 2, resource: { url: `${config.gatewayUrl}/v1/purchases/${ID}/fund` }, accepts: [entry] };
  const base = { purchaseId: ID, quoteId: 'quo_ABCDEFGHIJKLMNOP', fundingInstructions: { expiresAt: EXPIRY, options: [{ rail: 'cardano', amount: { network: config.network, assetId: config.allowedAsset, amountBaseUnits: amount, decimals: 6 }, payTo: TO, settlement }] } };
  const gateway: { view: View; posts: number; challenges: number; gets: number; signatures: string[]; replies: PostReply[] } =
    { view: { state: 'awaiting_funding', paymentState: 'not_received', funding: [] }, posts: 0, challenges: 0, gets: 0, signatures: [], replies: [] };
  const viewJson = () => JSON.stringify({ purchase: { ...base, ...gateway.view } });
  const fetchImpl: typeof fetch = async (url, init) => {
    expect(String(url).startsWith(config.gatewayUrl)).toBe(true);
    if (init?.method === 'GET') { gateway.gets++; return new Response(viewJson(), { status: 200 }); }
    const signature = new Headers(init?.headers).get('payment-signature');
    if (!signature) { gateway.challenges++; return new Response('{}', { status: 402, headers: { 'payment-required': encodePaymentRequiredHeader(challenge) } }); }
    gateway.posts++; gateway.signatures.push(signature);
    const reply = gateway.replies.shift();
    if (!reply) throw new Error('unscripted funding POST');
    return reply();
  };
  const signer = vi.fn(() => ({ getAddress: () => 'addr_test1qzpayer', buildAndSignPaymentTransaction: async () => ({ transaction: 'test-only', nonce: `${'b'.repeat(64)}#0` }) }));
  const ledger = new PayerLedger(config.ledgerFile);
  const deps = { config, ledger, fetchImpl, createSigner: signer, readGatewayToken: () => 'test-token', now: () => NOW, sleep: async () => {}, maxAttempts: 3 };
  const pendingAck = () => new Response(JSON.stringify({ purchase: { ...base, state: 'awaiting_funding', paymentState: 'unknown', funding: [] }, confirmationPending: true }), { status: 202 });
  const lost: PostReply = () => { throw new Error('connection reset'); };
  const err = (status: number, code: string, message: string): PostReply => () => new Response(JSON.stringify({ error: { code, message } }), { status });
  return { config, gateway, deps, ledger, signer, pendingAck, lost, err, entry };
}
const only = (s: ReturnType<typeof setup>) => s.ledger.find(ID)!;

describe('Cardano payer: uncertain settlement stays pending', () => {
  it('accepts 202 confirmation_pending with no funding evidence, invents no confirmation, and keeps the entry signed', async () => {
    const s = setup(); s.gateway.replies.push(s.pendingAck);
    const r = await new Payer(s.deps).pay(ID);
    expect(r).toMatchObject({ pending: true, transferReference: null, resumed: false });
    expect(s.gateway.posts).toBe(1);
    expect(only(s)).toMatchObject({ status: 'signed', transferReference: null, header: s.gateway.signatures[0] });
    expect(s.ledger.committed(s.config.network, s.config.allowedAsset)).toBe(400000n);
  });

  it.each([
    ['transport loss/timeout', (s: ReturnType<typeof setup>) => s.lost],
    ['HTTP 502', (s: ReturnType<typeof setup>) => s.err(502, 'internal', 'bad gateway')],
    ['HTTP 503', (s: ReturnType<typeof setup>) => s.err(503, 'internal', 'unavailable')],
    ['HTTP 429', (s: ReturnType<typeof setup>) => s.err(429, 'rate_limited', 'slow down')],
    ['legacy payment_invalid settlement_indeterminate', (s: ReturnType<typeof setup>) => s.err(402, 'payment_invalid', 'settlement_indeterminate: retry with the identical payment header')],
  ])('after %s reconciles read-only and never sends a second funding POST', async (_name, reply) => {
    const s = setup(); s.gateway.replies.push(reply(s));
    s.gateway.view = { state: 'awaiting_funding', paymentState: 'unknown', funding: [] }; // the gateway journaled its candidate
    const r = await new Payer(s.deps).pay(ID);
    expect(r).toMatchObject({ pending: true, resumed: true });
    expect(s.gateway.posts).toBe(1); expect(s.gateway.signatures).toHaveLength(1);
    expect(s.gateway.gets).toBeGreaterThanOrEqual(2); // initial read + reconciliation read
    expect(s.signer).toHaveBeenCalledTimes(1);
    expect(only(s)).toMatchObject({ status: 'signed', header: s.gateway.signatures[0] });
  });

  it('adopts evidence the gateway published while the response was lost (accepted exactly once, same transaction)', async () => {
    const s = setup();
    // The gateway settled and published evidence, but the response never reached the payer.
    s.gateway.replies.push(() => { s.gateway.view = { state: 'funded_queued', paymentState: 'confirmed', funding: [{ transferReference: TX }] }; throw new Error('connection reset'); });
    const r = await new Payer(s.deps).pay(ID);
    expect(r).toMatchObject({ transferReference: TX, resumed: true }); expect(r.pending).toBeUndefined();
    expect(s.gateway.posts).toBe(1);
    expect(only(s)).toMatchObject({ status: 'accepted', transferReference: TX });
  });

  it('with nothing observable yet fails closed WITHOUT a second POST and keeps the signed entry counted', async () => {
    const s = setup(); s.gateway.replies.push(s.lost);
    await expect(new Payer(s.deps).pay(ID)).rejects.toMatchObject({ code: 'gateway_unreachable', retrySafe: false });
    expect(s.gateway.posts).toBe(1);
    expect(only(s)).toMatchObject({ status: 'signed', header: s.gateway.signatures[0] });
    expect(s.ledger.committed(s.config.network, s.config.allowedAsset)).toBe(400000n);
  });

  it('survives a lost response plus payer restart: no challenge, no POST, no re-sign; later evidence is adopted', async () => {
    const s = setup(); s.gateway.replies.push(s.lost);
    s.gateway.view = { state: 'awaiting_funding', paymentState: 'unknown', funding: [] };
    expect(await new Payer(s.deps).pay(ID)).toMatchObject({ pending: true });
    const header = s.gateway.signatures[0]!;
    const challengesBefore = s.gateway.challenges;

    const restarted = new Payer({ ...s.deps, ledger: new PayerLedger(s.config.ledgerFile) });
    expect(await restarted.pay(ID)).toMatchObject({ pending: true, resumed: true });
    expect(s.gateway.posts).toBe(1); expect(s.gateway.challenges).toBe(challengesBefore); expect(s.signer).toHaveBeenCalledTimes(1);
    expect(only(s)).toMatchObject({ status: 'signed', header });

    // Independent recovery later confirms the SAME transaction; the next run just adopts it.
    s.gateway.view = { state: 'funded_queued', paymentState: 'confirmed', funding: [{ transferReference: TX }] };
    const after = await new Payer({ ...s.deps, ledger: new PayerLedger(s.config.ledgerFile) }).pay(ID);
    expect(after).toMatchObject({ transferReference: TX, resumed: true });
    expect(s.gateway.posts).toBe(1); expect(s.signer).toHaveBeenCalledTimes(1);
    expect(only(s)).toMatchObject({ status: 'accepted', transferReference: TX, header });
  });

  it('treats a 409 for an already-held candidate as pending, not as a conflict', async () => {
    const s = setup();
    // The gateway already holds our candidate (e.g. an earlier response was lost) when the POST arrives.
    s.gateway.replies.push(() => { s.gateway.view = { state: 'awaiting_funding', paymentState: 'unknown', funding: [] }; return new Response(JSON.stringify({ error: { code: 'conflict', message: 'a funding transfer is already awaiting confirmation for this purchase' } }), { status: 409 }); });
    expect(await new Payer(s.deps).pay(ID)).toMatchObject({ pending: true });
    expect(s.gateway.posts).toBe(1);
    expect(only(s).status).toBe('signed');
  });

  it('never auto-resends on a facilitator outage: one POST, then an explicit re-run reuses the identical header', async () => {
    const s = setup(); s.gateway.replies.push(s.err(402, 'payment_invalid', 'facilitator_unavailable: retry with the identical payment header'), s.pendingAck);
    await expect(new Payer(s.deps).pay(ID)).rejects.toMatchObject({ code: 'gateway_unreachable', retrySafe: false });
    expect(s.gateway.posts).toBe(1);
    const header = s.gateway.signatures[0]!;
    expect(await new Payer(s.deps).pay(ID)).toMatchObject({ pending: true }); // deliberate second run
    expect(s.gateway.posts).toBe(2); expect(s.gateway.signatures[1]).toBe(header); expect(s.signer).toHaveBeenCalledTimes(1);
    expect(s.ledger.committed(s.config.network, s.config.allowedAsset)).toBe(400000n); // one reservation, never doubled
  });

  it('keeps definitive rejection as a rejection (no reconciliation, no pending)', async () => {
    const s = setup();
    s.gateway.replies.push(s.err(402, 'payment_invalid', 'facilitator rejected payment: invalid_exact_cardano_payload_input_not_available'));
    await expect(new Payer(s.deps).pay(ID)).rejects.toMatchObject({ code: 'payment_rejected' });
    expect(s.gateway.posts).toBe(1); expect(s.gateway.gets).toBe(1);
    expect(only(s).status).toBe('signed');
    const q = setup(); q.gateway.replies.push(q.err(402, 'quote_expired', 'quote expired'));
    await expect(new Payer(q.deps).pay(ID)).rejects.toMatchObject({ code: 'payment_rejected' });
  });

  it('does not double-count exposure: a pending entry counts once toward caps before and after adoption', async () => {
    const s = setup('400000', { PAYER_MAX_CUMULATIVE_BASE_UNITS: '700000' }); s.gateway.replies.push(s.pendingAck);
    await new Payer(s.deps).pay(ID);
    expect(s.ledger.committed(s.config.network, s.config.allowedAsset)).toBe(400000n);
    s.gateway.view = { state: 'funded_queued', paymentState: 'confirmed', funding: [{ transferReference: TX }] };
    await new Payer(s.deps).pay(ID);
    expect(s.ledger.committed(s.config.network, s.config.allowedAsset)).toBe(400000n);
    expect(s.ledger.daily(s.config.network, s.config.allowedAsset, NOW)).toBe(400000n);
  });

  it('bridge reports a pending outcome as success without a transferReference (schema-safe) and carries no header', async () => {
    const s = setup(); s.gateway.replies.push(s.pendingAck);
    const payer = new Payer(s.deps);
    const token = 'test-only-bridge-token-0123456789';
    const server = createBridge({ payer, token, source: () => payer.source() });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/pay`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ purchaseId: ID }) });
      const body = await res.json() as { ok: boolean; payment: Record<string, unknown> };
      expect(res.status).toBe(200); expect(body.ok).toBe(true);
      expect(body.payment).toEqual({});
      expect(JSON.stringify(body)).not.toContain(s.gateway.signatures[0]!);
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
