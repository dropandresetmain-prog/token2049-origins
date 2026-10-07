import { afterEach, describe, expect, it, vi } from 'vitest';
import { startHarness, retailFulfillment, retailIntent, type Harness } from '../support/harness.js';
import { GlobalSandboxExecutor } from '../../src/execution/shopify/globalSandbox.js';
import { FrankfurterClient, FX_UNAVAILABLE } from '../../src/integrations/frankfurter/client.js';
import { money } from '../../src/contracts/money.js';
import { PurchaseView, QuoteView, ReceiptView } from '../../src/contracts/commerce.js';
import { digestOf } from '../../src/infrastructure/ids.js';
import { orderConfirmation, describeQuote } from '../../src/channels/mcp/tools.js';
import { createMcpServer } from '../../src/channels/mcp/server.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

let h: Harness;
afterEach(async () => { await h?.close(); vi.restoreAllMocks(); });

async function setup(feeBps = 0) {
  h = await startHarness({ serviceFeeBps: feeBps, settlementPolicy: { mode: 'scaled_testnet', numerator: 1, denominator: 1000 } });
  h.retail.price = money('USD', '4319');
  // Real Global wrapper, fixture Storefront/checkout. No network, purchase or blockchain payment.
  h.gw.core.deps.executors.set('shopify', new GlobalSandboxExecutor(h.retail, { search: vi.fn() }, null));
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{"date":"2026-10-06","base":"USD","quote":"SGD","rate":1.3}'));
  h.gw.core.deps.fx = new FrankfurterClient({ fetchImpl, now: () => new Date('2026-10-07T03:00:00Z') });
  const searchSpy = vi.spyOn(h.retail, 'search');
  const quoteSpy = vi.spyOn(h.retail, 'quote');
  const search = (budget = '6000', currency = 'SGD') => h.call('POST', '/v1/offers/search', { token: h.alice.token,
    body: { intent: { ...retailIntent(), discovery: 'controlled_catalog', spendCeiling: money(currency, budget) } } });
  const quote = (offerId: string) => h.call('POST', '/v1/quotes', { token: h.alice.token, body: { offerId, fulfillment: retailFulfillment } });
  return { fetchImpl, searchSpy, quoteSpy, search, quote };
}

describe('SGD budget with USD merchant and unchanged funding', () => {
  it('preserves original authority, freezes FX in quote/digest, and carries it through fixture funding and receipt', async () => {
    const { fetchImpl, searchSpy, quoteSpy, search, quote } = await setup();
    const s = await search(); expect(s.status).toBe(200);
    const o = s.body.offers[0];
    expect(searchSpy.mock.calls[0]?.[0].spendCeiling).toEqual(money('USD', '4615'));
    const storedOffer = await h.gw.db.get<{ intent_json: string }>('SELECT intent_json FROM offers WHERE id=$1', o.offerId);
    expect(JSON.parse(storedOffer!.intent_json).spendCeiling).toEqual(money('SGD', '6000'));
    expect(o.searchConversion.userBudget).toEqual(money('SGD', '6000'));
    // Rate availability changes after discovery; exact quote, approval and completion must never fetch again.
    fetchImpl.mockRejectedValue(new Error('FX now offline'));
    const response = await quote(o.offerId); expect(response.status).toBe(201);
    const q = QuoteView.parse(response.body.quote);
    expect(quoteSpy.mock.calls[0]?.[0].intent.spendCeiling).toEqual(money('USD', '4615'));
    expect(q.merchantTotal).toEqual(money('USD', '4319'));
    expect(q.serviceFee).toEqual(money('USD', '0'));
    expect(q.payablePrincipal).toEqual(money('USD', '4319'));
    expect(q.displayConversion?.convertedPayable).toEqual(money('SGD', '5615'));
    expect(q.displayConversion?.snapshot).toEqual(o.searchConversion.snapshot);
    expect(q.fundingOptions[0]?.settlement?.commercialTotal).toEqual(money('USD', '4319'));
    expect(q.fundingOptions[0]?.amount.amountBaseUnits).toBe('43190'); // 0.043190 tUSDM under 1:1000
    const stored = await h.gw.db.get<{ fulfillment_json: string; execution_ref_json: string }>('SELECT * FROM quotes WHERE id=$1', q.quoteId);
    const terms = { quoteId: q.quoteId, customerId: q.customerId, offerId: q.offerId, route: q.route, merchantTotal: q.merchantTotal,
      serviceFee: q.serviceFee, payable: q.payablePrincipal, displayConversion: q.displayConversion, fundingOptions: q.fundingOptions,
      fulfillment: JSON.parse(stored!.fulfillment_json), executionRef: JSON.parse(stored!.execution_ref_json), expiresAt: q.expiresAt };
    expect(digestOf(terms)).toBe(q.digest);
    expect(digestOf({ ...terms, displayConversion: { ...q.displayConversion, snapshot: { ...q.displayConversion!.snapshot, rate: '1.4' } } })).not.toBe(q.digest);
    const text = describeQuote(q, []);
    expect(text).toContain('Merchant total 43.19 USD');
    expect(text).toContain('about 56.15 SGD'); expect(text).toContain('Frankfurter, 2026-10-06'); expect(text).toContain('SGD is a budget/display reference only');
    const p = await h.call('POST', '/v1/purchases', { token: h.alice.token, headers: { 'idempotency-key': 'fx-fixture-purchase' },
      body: { quoteId: q.quoteId, approval: { maxTotal: q.payablePrincipal, quoteDigest: q.digest, selectedFundingOptionId: q.fundingOptions[0]!.fundingOptionId } } });
    expect(p.status).toBe(201); expect(PurchaseView.parse(p.body.purchase).displayConversion).toEqual(q.displayConversion);
    const id = p.body.purchase.purchaseId;
    expect((await h.call('POST', `/v1/purchases/${id}/fund`, { token: h.alice.token, headers: { 'payment-signature': 'fixture:fx-proof:43190' } })).status).toBe(202);
    // Retail completion presentation requires paid commerce, using fixture execution only.
    const execute = h.retail.execute.bind(h.retail), retrieve = h.retail.retrieve.bind(h.retail);
    vi.spyOn(h.retail, 'execute').mockImplementation(async ctx => { const r = await execute(ctx); return r.kind === 'succeeded' ? { ...r, commerceStatus: 'paid' } : r; });
    vi.spyOn(h.retail, 'retrieve').mockImplementation(async ctx => { const r = await retrieve(ctx); return r.kind === 'succeeded' ? { ...r, commerceStatus: 'paid' } : r; });
    await h.gw.worker.tick();
    const done = PurchaseView.parse((await h.call('GET', `/v1/purchases/${id}`, { token: h.alice.token })).body.purchase);
    expect(done.state).toBe('succeeded');
    const receipt = ReceiptView.parse(done.receipt);
    expect(receipt.principal).toEqual(money('USD', '4319')); expect(receipt.displayConversion).toEqual(q.displayConversion);
    expect(receipt.fundingRequirement?.settlement?.commercialTotal.currency).toBe('USD');
    expect(orderConfirmation(done)?.displayConversion).toEqual(q.displayConversion);
    const server = createMcpServer({ gatewayUrl: h.url, gatewayToken: h.alice.token });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'fx-fixture', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    try {
      const result = await client.callTool({ name: 'get_purchase', arguments: { purchaseId: id } }) as CallToolResult;
      const text = result.content.find(c => c.type === 'text')?.text;
      expect(text).toContain('ORDER CONFIRMED'); expect(text).toContain('Amount 43.19 USD');
      expect(text).toContain('reference budget equivalent (including service fee): about 56.15 SGD');
      expect(text).toContain('Frankfurter, 2026-10-06');
    } finally { await client.close(); await server.close(); }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects exact payable above original SGD ceiling, even if the item/search price fits', async () => {
    const { search, quote } = await setup(1000); // fee puts 43.19 USD over S$60
    const s = await search();
    const q = await quote(s.body.offers[0].offerId);
    expect(q.status).toBe(422); expect(q.body.error.code).toBe('spend_limit_exceeded');
    expect(q.body.error.details.displayConversion.convertedPayable).toEqual(money('SGD', '6177'));
    expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM quotes'))!.n).toBe(0);
  });

  it('accepts the exact conservative boundary and rejects the next USD cent', async () => {
    const { search, quote } = await setup();
    const s = await search(); h.retail.price = money('USD', '4615');
    expect((await quote(s.body.offers[0].offerId)).status).toBe(201);
    h.retail.price = money('USD', '4616');
    const q = await quote(s.body.offers[0].offerId);
    expect(q.body.error.code).toBe('spend_limit_exceeded');
  });

  it('filters an indicative item above the converted bound even when controlled-store fallback ignores it', async () => {
    const { search } = await setup(); h.retail.price = money('USD', '4616');
    const above = await search(); expect(above.status).toBe(200); expect(above.body.offers).toEqual([]);
    h.retail.price = money('USD', '4615'); expect((await search()).body.offers).toHaveLength(1);
  });

  it('does not call Frankfurter or add conversion fields for existing USD requests', async () => {
    const { fetchImpl, search, quote } = await setup(); fetchImpl.mockRejectedValue(new Error('must not call'));
    const s = await search('6000', 'USD');
    const q = await quote(s.body.offers[0].offerId);
    expect(q.status).toBe(201); expect(q.body.quote.displayConversion).toBeUndefined();
    expect(s.body.offers[0].searchConversion).toBeUndefined(); expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed before provider discovery when FX is unavailable', async () => {
    const { fetchImpl, searchSpy, search } = await setup(); fetchImpl.mockRejectedValue(new Error('network down'));
    const s = await search(); expect(s.status).toBe(503);
    expect(s.body.error.message).toBe(FX_UNAVAILABLE); expect(searchSpy).not.toHaveBeenCalled();
    expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM offers'))!.n).toBe(0);
  });
});
