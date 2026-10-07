import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/channels/mcp/server.js';
import { BackgroundJobs } from '../../src/channels/mcp/tools.js';
import { GatewayClient } from '../../src/channels/mcp/client.js';
import { CoreError } from '../../src/core/errors.js';
import { createClient } from '../../src/infrastructure/auth.js';
import { projectProgress } from '../../src/contracts/presentation.js';
import { startHarness, retailFulfillment, retailIntent, type Harness } from '../support/harness.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const bridgeUrl = 'http://127.0.0.1:9';

describe('MCP stalled-operation recovery', () => {
  let h: Harness;
  let gateway: GatewayClient;
  const sessions: Array<{ close(): Promise<void> }> = [];
  beforeEach(async () => { h = await startHarness(); gateway = new GatewayClient({ gatewayUrl: h.url, gatewayToken: h.alice.token }); });
  afterEach(async () => { for (const s of sessions.splice(0)) await s.close(); await h.close(); });

  async function offerAndQuote() {
    const { offers } = await gateway.searchOffers(retailIntent());
    const { quote } = await gateway.createQuote(offers[0]!.offerId, retailFulfillment);
    return { offer: offers[0]!, quote };
  }
  const args = (q: any) => ({ quoteId: q.quoteId, selectedFundingOptionId: q.fundingOptions[0].fundingOptionId, quoteDigest: q.digest, maxTotal: q.payablePrincipal });
  async function session(opts: { statusDelay?: number; payDelay?: number; retrySafe?: boolean; onPay?: () => void; background?: BackgroundJobs } = {}) {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(bridgeUrl)) return fetch(input, init);
      if (url.endsWith('/status')) {
        await sleep(opts.statusDelay ?? 0);
        return Response.json({ ok: true, source: { sourceId: 'src_' + 'a'.repeat(32), rail: 'cardano', network: 'cardano:preprod', publicAddress: 'addr_test1fixturepayer00000000', displayAddress: 'fixture payer', assetId: h.funding.acceptedAsset().assetId, readiness: 'configured' } });
      }
      opts.onPay?.();
      await sleep(opts.payDelay ?? 0);
      return Response.json({ ok: false, retrySafe: opts.retrySafe === true, error: { code: 'policy_violation', message: 'fixture refusal' } }, { status: 403 });
    };
    const server = createMcpServer({ gatewayUrl: h.url, gatewayToken: h.alice.token, fetch: fetchImpl, bridges: { cardano: { url: bridgeUrl, token: 'fixture-bridge-token-0123456789' } } }, { ...(opts.background ? { background: opts.background } : {}) });
    const [a,b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'stall-regression', version: '1' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const s = { call: async (name: string, arguments_: any) => await client.callTool({ name, arguments: arguments_ }) as any, close: async () => { await client.close(); await server.close(); } };
    sessions.push(s);
    return s;
  }

  it('bounds payer readiness and rejects an expired quote collected after completion', async () => {
    const { offer } = await offerAndQuote();
    const s = await session({ statusDelay: 100, background: new BackgroundJobs(15) });
    const request = { offerId: offer.offerId, fulfillment: retailFulfillment };
    const start = performance.now();
    expect((await s.call('create_quote', request)).structuredContent.status).toBe('quote_pending');
    expect(performance.now() - start).toBeLessThan(90);
    await sleep(160);
    h.clock.advance(60 * 60_000);
    const collected = await s.call('create_quote', request);
    expect(collected.isError).toBe(true);
    expect(collected.structuredContent.error.code).toBe('quote_expired');
  });

  it('persists a late refusal and exposes it from a fresh MCP session without resending', async () => {
    const { quote } = await offerAndQuote();
    let calls = 0;
    const s = await session({ payDelay: 100, onPay: () => calls++, background: new BackgroundJobs(30) });
    expect((await s.call('buy', args(quote))).structuredContent.status).toBe('purchase_pending');
    await expect.poll(async () => (await gateway.quotePurchase(quote.quoteId)).purchase?.paymentAttempt?.status, { timeout: 5000, interval: 25 }).toBe('failed');
    const purchase = (await gateway.quotePurchase(quote.quoteId)).purchase!;
    const fresh = await session({ onPay: () => calls++ });
    const got = await fresh.call('get_purchase', { purchaseId: purchase.purchaseId });
    expect(got.structuredContent.purchase.paymentAttempt).toMatchObject({ status: 'failed', retrySafe: false, errorCode: 'policy_violation' });
    expect(got.structuredContent.progress.stage).toBe('needs_attention');
    await fresh.call('buy', args(quote));
    expect(calls).toBe(1);
    expect(h.retail.executeCalls).toBe(0);
  });

  it('allows the same approved purchase to resume only after an explicit unsent refusal', async () => {
    const { quote } = await offerAndQuote();
    let calls = 0;
    const s = await session({ retrySafe: true, onPay: () => calls++ });
    const first = await s.call('buy', args(quote));
    const second = await s.call('buy', args(quote));
    expect(calls).toBe(2);
    expect(second.structuredContent.purchase.purchaseId).toBe(first.structuredContent.purchase.purchaseId);
    expect(second.structuredContent.purchase.paymentAttempt.attemptId).not.toBe(first.structuredContent.purchase.paymentAttempt.attemptId);
    expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM purchases'))!.n).toBe(1);
  });

  it('claims one handoff across competing clients and rejects foreign or stale completion', async () => {
    const { quote } = await offerAndQuote();
    const { quoteId: _q, ...approval } = args(quote);
    const { purchase } = await gateway.createPurchase({ quoteId: quote.quoteId, approval }, 'handoff-race');
    expect((await h.call('POST', `/v1/purchases/${purchase.purchaseId}/payment-attempt`, { token: h.alice.token, body: [] })).status).toBe(400);
    const readOnly = await createClient(h.gw.db, { customerId: h.alice.customerId, displayName: 'Alice', channel: 'console', label: 'read only', scopes: ['purchases:read'] }, h.clock.now().toISOString());
    await expect(new GatewayClient({ gatewayUrl: h.url, gatewayToken: readOnly.token }).claimPaymentAttempt(purchase.purchaseId)).rejects.toMatchObject({ code: 'forbidden' });
    const [a,b] = await Promise.all([gateway.claimPaymentAttempt(purchase.purchaseId), gateway.claimPaymentAttempt(purchase.purchaseId)]);
    expect([a,b].filter(x => x.claimed)).toHaveLength(1);
    const attempt = a.claimed ? a.attempt! : b.attempt!;
    const body = { attemptId: attempt.attemptId, status: 'failed' as const, retrySafe: false, errorCode: 'bridge_unreachable' };
    await expect(gateway.completePaymentAttempt(purchase.purchaseId, { ...body, status: 'succeeded', retrySafe: true })).rejects.toMatchObject({ code: 'invalid_request' });
    const bob = new GatewayClient({ gatewayUrl: h.url, gatewayToken: h.bob.token });
    await expect(bob.completePaymentAttempt(purchase.purchaseId, body)).rejects.toMatchObject({ code: 'not_found' });
    const sameCustomer = await createClient(h.gw.db, { customerId: h.alice.customerId, displayName: 'Alice', channel: 'mcp', label: 'other client' }, h.clock.now().toISOString());
    await expect(new GatewayClient({ gatewayUrl: h.url, gatewayToken: sameCustomer.token }).completePaymentAttempt(purchase.purchaseId, body)).rejects.toMatchObject({ code: 'conflict' });
    await gateway.completePaymentAttempt(purchase.purchaseId, body);
    await expect(gateway.completePaymentAttempt(purchase.purchaseId, body)).rejects.toMatchObject({ code: 'conflict' });
    expect((await gateway.getPurchase(purchase.purchaseId)).purchase.paymentState).toBe('not_received');
  });

  it('keeps an unfinished handoff ambiguous after reconnect and exposes overdue operator review', async () => {
    const { quote } = await offerAndQuote();
    const { quoteId: _q, ...approval } = args(quote);
    const { purchase } = await gateway.createPurchase({ quoteId: quote.quoteId, approval }, 'unfinished-handoff');
    await gateway.claimPaymentAttempt(purchase.purchaseId);
    let calls = 0;
    const fresh = await session({ onPay: () => calls++ });
    await fresh.call('buy', args(quote));
    expect(calls).toBe(0);
    h.clock.advance(11 * 60_000);
    const got = await fresh.call('get_purchase', { purchaseId: purchase.purchaseId });
    expect(got.structuredContent.progress).toMatchObject({ stage: 'needs_attention', nextAction: 'Ask the operator to reconcile the payment handoff.' });
  });

  it('shows operator attention when automatic reconciliation has exhausted its attempts', async () => {
    const { quote } = await offerAndQuote();
    const { quoteId: _id, ...approval } = args(quote);
    const { purchase } = await gateway.createPurchase({ quoteId: quote.quoteId, approval }, 'manual-review');
    await h.gw.db.run("UPDATE purchases SET state='unresolved',commerce_status='unknown' WHERE id=$1", purchase.purchaseId);
    await h.gw.db.run("INSERT INTO purchase_events(id,purchase_id,sequence,type,data_json,created_at) VALUES ('evt_MANUALTEST',$1,999,'reconciliation.manual_required','{}',$2)", purchase.purchaseId, h.clock.now().toISOString());
    const p = (await gateway.getPurchase(purchase.purchaseId)).purchase;
    expect(projectProgress(p)).toMatchObject({ stage: 'needs_attention', nextAction: 'Ask the operator to reconcile this purchase.' });
    expect(projectProgress(p).message).not.toMatch(/No further action/);
  });

  it('discloses a search-only route before asking for fulfillment', async () => {
    h.gw.core.deps.executors.set('shopify', Object.assign(h.retail, { assertPaymentAvailable: () => { throw new CoreError('route_unavailable', 'Checkout is disabled in this deployment'); } }));
    const s = await session();
    const r = await s.call('find_offers', { intent: { ...retailIntent(), discovery: 'controlled_catalog' } });
    expect(r.structuredContent.offers[0].checkout.status).toBe('search_only');
    expect(r.structuredContent.interaction.nextAction).toBe('explain_checkout_unavailable');
    expect(r.content[0].text).toContain('Do not collect fulfillment');
  });
});
