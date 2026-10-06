import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startHarness, createFundablePurchase, type Harness } from '../support/harness.js';
import { createClient } from '../../src/infrastructure/auth.js';
import { FIXTURE_ASSET, FIXTURE_TREASURY } from '../support/fixtures.js';

describe('channel equivalence and Masumi seam', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness();
  });
  afterEach(async () => h.close());

  it('HTTP, MCP and Sokosumi clients of one customer hit the same core with the same isolation', async () => {
    const now = h.clock.now().toISOString();
    const mcp = await createClient(h.gw.db, { customerId: h.alice.customerId, displayName: 'Alice', channel: 'mcp', label: 'alice-mcp' }, now);
    const soko = await createClient(h.gw.db, { customerId: h.alice.customerId, displayName: 'Alice', channel: 'sokosumi', label: 'alice-soko' }, now);
    const viaHttp = await createFundablePurchase(h, h.alice.token);
    const viaSoko = await createFundablePurchase(h, soko.token, 'sokosumi:task-0001');
    for (const t of [h.alice.token, mcp.token, soko.token]) {
      const a = await h.call('GET', `/v1/purchases/${viaHttp.purchase.purchaseId}`, { token: t });
      const b = await h.call('GET', `/v1/purchases/${viaSoko.purchase.purchaseId}`, { token: t });
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
    }
    expect((await h.call('GET', `/v1/purchases/${viaSoko.purchase.purchaseId}`, { token: h.bob.token })).status).toBe(404);
    // Sokosumi retry with the same task-derived key returns the same purchase.
    const quote = viaSoko.quote;
    const retry = await h.call('POST', '/v1/purchases', {
      token: soko.token,
      headers: { 'idempotency-key': 'sokosumi:task-0001' },
      body: { quoteId: quote.quoteId, approval: { maxTotal: quote.payablePrincipal, quoteDigest: quote.digest }, fundingRail: 'cardano' },
    });
    expect(retry.body.purchase.purchaseId).toBe(viaSoko.purchase.purchaseId);
    const events = (await h.call('GET', `/v1/purchases/${viaSoko.purchase.purchaseId}/events`, { token: soko.token })).body.events;
    expect(events[0].data.channel).toBe('sokosumi');
  });

  it('fee-only evidence cannot fund a purchase', async () => {
    const a = await createFundablePurchase(h);
    const r = await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, {
      token: h.alice.token,
      headers: { 'payment-signature': `fixture:fee1:${a.required}:confirmed:${FIXTURE_ASSET}:${FIXTURE_TREASURY}:service_fee` },
    });
    expect(r.status).toBe(402);
    expect(r.body.error.code).toBe('payment_invalid');
    await h.gw.worker.tick();
    expect(h.retail.executeCalls).toBe(0);
  });

  it('a scope-limited channel cannot exceed its scopes', async () => {
    const ro = await createClient(h.gw.db, { customerId: h.alice.customerId, displayName: 'Alice', channel: 'console', label: 'ro', scopes: ['purchases:read'] }, h.clock.now().toISOString());
    const a = await createFundablePurchase(h);
    expect((await h.call('GET', `/v1/purchases/${a.purchase.purchaseId}`, { token: ro.token })).status).toBe(200);
    const fund = await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: ro.token });
    expect(fund.status).toBe(403);
    const search = await h.call('POST', '/v1/offers/search', { token: ro.token, body: { intent: { category: 'retail', query: 'x', quantity: 1, shipToCountry: 'SG', spendCeiling: { currency: 'USD', amountMinor: '1000', scale: 2 } } } });
    expect(search.status).toBe(403);
  });
});
