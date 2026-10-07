import { beforeEach, afterEach, describe, it, expect, vi, type Mock } from 'vitest';
import { startHarness, retailIntent, retailFulfillment, type Harness } from '../support/harness.js';
import { createTestDb, newTestSchema } from '../support/database.js';
import { SourceOffer, type SourceOffer as Source, type SandboxRepresentation } from '../../src/contracts/provenance.js';
import { OfferView, QuoteView, ReceiptView } from '../../src/contracts/commerce.js';
import { GlobalSandboxExecutor } from '../../src/execution/shopify/globalSandbox.js';
import { ShadowPreparer, sourceDigest } from '../../src/execution/shopify/shadow.js';
import { SANDBOX_STORE, type ShadowProduct, type ShadowAdminClient } from '../../src/execution/shopify/shadowAdmin.js';
import type { StorefrontClient } from '../../src/execution/shopify/storefront.js';
import type { GlobalCatalogClient } from '../../src/execution/shopify/globalCatalog.js';
import { RetailIntent } from '../../src/contracts/intent.js';
import { SANDBOX_BOUNDARY } from '../../src/execution/shopify/globalCatalog.js';
import { money } from '../../src/contracts/money.js';
import { PurchaseProof } from '../../src/evidence/proof.js';
import { trialBalance } from '../../src/core/journal.js';
import type { Db } from '../../src/infrastructure/db.js';
import type { ProviderQuote } from '../../src/contracts/ports.js';

const intent = RetailIntent.parse({ ...retailIntent('15000'), discovery: 'live' });
const publicationId = 'gid://shopify/Publication/300';
function source(now: string): Source {
  return SourceOffer.parse({ source: 'shopify_global_catalog', productId: 'gid://shopify/p/SyntheticKeyboard', variantId: 'gid://shopify/ProductVariant/100',
    merchantId: 'gid://shopify/Shop/200', merchantName: 'Synthetic Source Merchant', merchantUrl: 'https://merchant.example',
    productTitle: 'Synthetic Black Keyboard', variantTitle: 'Black', productUrl: 'https://merchant.example/products/keyboard?variant=100',
    observedPrice: money('USD', 5000), availability: 'available', observedAt: now, schemaVersion: '2026-08-25', evidenceMode: 'local_fixture' });
}
describe('Global discovery -> one shadow -> existing commerce core (all providers local_fixture)', () => {
  let h: Harness, schema: string, selected: Source, offerId: string;
  let product: ShadowProduct | null;
  let admin: { publicationId: string; assertSandbox: Mock<ShadowAdminClient['assertSandbox']>; find: Mock<ShadowAdminClient['find']>; create: Mock<ShadowAdminClient['create']>; publish: Mock<ShadowAdminClient['publish']> };
  let sf: { findVariants: Mock<StorefrontClient['findVariants']> };
  let catalog: { refresh: Mock<GlobalCatalogClient['refresh']>; search: Mock<GlobalCatalogClient['search']> };
  const preparer = (db?: Db) => new ShadowPreparer({ db: () => db ?? h.gw.db, admin, storefront: sf, catalog, storeDomain: SANDBOX_STORE, clock: h.clock });
  beforeEach(async () => {
    schema = newTestSchema(); h = await startHarness({ schema, settlementPolicy: { mode: 'scaled_testnet', numerator: 1, denominator: 1000 } });
    selected = source(h.clock.now().toISOString()); product = null;
    admin = { publicationId, assertSandbox: vi.fn(async () => undefined), find: vi.fn(async () => product),
      create: vi.fn(async (id: string, s: Source, digest: string) => {
        product = { id: 'gid://shopify/Product/400', title: '[CAPSULE SANDBOX] ' + s.productTitle, identity: { value: id }, digest: { value: digest },
          publishedOnPublication: false, variants: { nodes: [{ id: 'gid://shopify/ProductVariant/500', price: '50.00', inventoryItem: { tracked: false, requiresShipping: true } }] }, sellingPlanGroups: { nodes: [] } };
        return product;
      }), publish: vi.fn(async () => { product!.publishedOnPublication = true; }) };
    sf = { findVariants: vi.fn(async () => [{ variantId: 'gid://shopify/ProductVariant/500', title: '[CAPSULE SANDBOX] ' + selected.productTitle, description: '', unitPrice: money('USD', 5000) }]) };
    catalog = { refresh: vi.fn(async () => selected), search: vi.fn(async () => [{ title: selected.productTitle, description: 'Fixture discovery', indicativePrice: selected.observedPrice,
      terms: [SANDBOX_BOUNDARY], executionRef: { sourceOffer: selected, quantity: 1 }, sourceOffer: selected,
      sourceObservedAt: selected.observedAt, expiresAt: new Date(h.clock.now().getTime() + 300_000).toISOString() }]) };
    h.retail.price = money('USD', 5700);
    vi.spyOn(h.retail, 'quote').mockImplementation(async (): Promise<ProviderQuote> => ({ title: '[CAPSULE SANDBOX] ' + selected.productTitle,
      breakdown: [{ kind: 'item', label: 'Sandbox item', amount: money('USD', 5000) }, { kind: 'shipping', label: 'Sandbox shipping', amount: money('USD', 500) }, { kind: 'tax', label: 'Sandbox tax', amount: money('USD', 200) }],
      merchantTotal: money('USD', 5700), terms: ['Fixture sandbox'], fulfillmentSummary: 'Synthetic fixture', executionRef: { sku: 'SHADOW' }, expiresAt: new Date(h.clock.now().getTime() + 300_000).toISOString() }));
    h.gw.core.deps.executors.set('shopify', new GlobalSandboxExecutor(h.retail, catalog, preparer()));
    const search = await h.call('POST', '/v1/offers/search', { token: h.alice.token, body: { intent } });
    expect(search.status).toBe(200); const offer = OfferView.parse(search.body.offers[0]); offerId = offer.offerId;
    expect(offer.sourceOffer).toEqual(selected); expect(admin.create).not.toHaveBeenCalled();
  });
  afterEach(async () => { await h.close(); });
  const quote = () => h.call('POST', '/v1/quotes', { token: h.alice.token, body: { offerId, fulfillment: retailFulfillment } });
  it('uses USD throughout live discovery, source refresh and shadow preparation for an original SGD budget', async () => {
    const latest = vi.fn().mockResolvedValue({ source: 'frankfurter', from: 'USD', to: 'SGD', rate: '1.3',
      referenceDate: h.clock.now().toISOString().slice(0, 10), fetchedAt: h.clock.now().toISOString() });
    h.gw.core.deps.fx = { latest };
    const search = await h.call('POST', '/v1/offers/search', { token: h.alice.token,
      body: { intent: { ...intent, spendCeiling: money('SGD', '8000') } } });
    expect(search.status).toBe(200); offerId = search.body.offers[0].offerId;
    expect(catalog.search.mock.lastCall?.[0].spendCeiling).toEqual(money('USD', '6153'));
    const first = QuoteView.parse((await quote()).body.quote);
    expect(catalog.refresh.mock.lastCall?.[1].spendCeiling).toEqual(money('USD', '6153'));
    expect(first.merchantTotal).toEqual(money('USD', '5700'));
    expect(first.displayConversion?.convertedPayable).toEqual(money('SGD', '7410'));
    expect(first.displayConversion?.userBudget).toEqual(money('SGD', '8000'));
    expect(first.fundingOptions[0]?.amount.amountBaseUnits).toBe('57000');
    latest.mockRejectedValue(new Error('FX offline after search'));
    expect((await quote()).body.quote).toEqual(first); expect(latest).toHaveBeenCalledTimes(1);
    expect(admin.create).toHaveBeenCalledTimes(1);
  });
  it('durably prepares once on repeated calls and checks publication plus Storefront before ready', async () => {
    const first = await preparer().prepare(offerId, selected, intent);
    expect(first.sandboxRepresentation.shadowVariantId).toBe('gid://shopify/ProductVariant/500');
    expect(await preparer().prepare(offerId, selected, intent)).toEqual(first);
    expect(admin.create).toHaveBeenCalledTimes(1); expect(admin.publish).toHaveBeenCalledTimes(1); expect(sf.findVariants).toHaveBeenCalledTimes(1);
    expect((await h.gw.db.get<{ state: string }>('SELECT state FROM shopify_shadow_mappings'))?.state).toBe('ready');
  });
  it('concurrent preparation across two PostgreSQL sessions produces one mapping/product', async () => {
    const db2 = await createTestDb(schema);
    const results = await Promise.all([preparer().prepare(offerId, selected, intent), preparer(db2).prepare(offerId, selected, intent)]);
    expect(results[0]).toEqual(results[1]); expect(admin.create).toHaveBeenCalledTimes(1);
    expect((await db2.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM shopify_shadow_mappings'))?.n).toBe(1);
  });
  it('crash after provider creation but before DB mapping recovers by unique custom identity without a second create', async () => {
    const original = admin.create.getMockImplementation()!;
    admin.create.mockImplementationOnce(async (...args: Parameters<ShadowAdminClient['create']>) => { await original(...args); throw new Error('simulated_process_loss'); });
    await expect(preparer().prepare(offerId, selected, intent)).rejects.toThrow('simulated_process_loss');
    const row = await h.gw.db.get<{ state: string; representation_json: string | null }>('SELECT * FROM shopify_shadow_mappings');
    expect(row).toMatchObject({ state: 'preparing', representation_json: null });
    const db2 = await createTestDb(schema);
    await expect(preparer(db2).prepare(offerId, selected, intent)).resolves.toHaveProperty('sandboxRepresentation');
    expect(admin.create).toHaveBeenCalledTimes(1);
  });
  it.each(['not_published', 'not_visible', 'wrong_price', 'wrong_currency', 'wrong_identity', 'selling_plan'])('fails closed before ready: %s', async failure => {
    if (failure === 'not_published') admin.publish.mockImplementation(async () => undefined);
    if (failure === 'not_visible') sf.findVariants.mockResolvedValue([]);
    if (failure === 'wrong_price') sf.findVariants.mockResolvedValue([{ variantId: 'gid://shopify/ProductVariant/500', title: 'Shadow', description: '', unitPrice: money('USD', 4999) }]);
    if (failure === 'wrong_currency') sf.findVariants.mockResolvedValue([{ variantId: 'gid://shopify/ProductVariant/500', title: 'Shadow', description: '', unitPrice: money('EUR', 5000) }]);
    if (['wrong_identity', 'selling_plan'].includes(failure)) { const original = admin.create.getMockImplementation()!; admin.create.mockImplementation(async (...args: Parameters<ShadowAdminClient['create']>) => {
      await original(...args); if (failure === 'wrong_identity') product!.identity = { value: 'foreign' }; else product!.sellingPlanGroups.nodes = [{ id: 'subscription' }]; return product!;
    }); }
    await expect(preparer().prepare(offerId, selected, intent)).rejects.toThrow();
    expect((await h.gw.db.get<{ state: string }>('SELECT state FROM shopify_shadow_mappings'))?.state).toBe('preparing');
    expect(h.retail.executeCalls).toBe(0);
  });
  it('source drift, spoofing, unavailable boundary and caller ownership never provision', async () => {
    catalog.refresh.mockRejectedValueOnce(new Error('source_offer_changed'));
    await expect(preparer().prepare(offerId, selected, intent)).rejects.toThrow('source_offer_changed');
    await expect(preparer().prepare(offerId, { ...selected, observedPrice: money('USD', 4900) }, intent)).rejects.toThrow('Selected source');
    const denied = await h.call('POST', '/v1/quotes', { token: h.bob.token, body: { offerId, fulfillment: retailFulfillment } });
    expect(denied.status).toBe(404); expect(admin.create).not.toHaveBeenCalled();
  });
  it('repeated quote freezes source and sandbox totals, reuses one cart/quote, and binds digest', async () => {
    const first = QuoteView.parse((await quote()).body.quote), second = QuoteView.parse((await quote()).body.quote);
    expect(second).toEqual(first); expect(h.retail.quote).toHaveBeenCalledTimes(1);
    expect(first.sourceOffer?.observedPrice.amountMinor).toBe('5000'); expect(first.merchantTotal.amountMinor).toBe('5700');
    expect(first.breakdown.map(b => b.amount.amountMinor)).toEqual(['5000', '500', '200']);
    const persisted = await h.gw.db.get<{ execution_ref_json: string; digest: string }>('SELECT * FROM quotes');
    expect(JSON.parse(persisted!.execution_ref_json).sourceOffer).toEqual(selected); expect(persisted!.digest).toBe(first.digest);
    const changed = await h.call('POST', '/v1/quotes', { token: h.alice.token, body: { offerId, fulfillment: { ...retailFulfillment, email: 'changed@example.com' } } });
    expect(changed.status).toBe(409); h.clock.advance(300_001); expect((await quote()).status).toBe(409);
  });
  it('concurrent quote calls return one quote or actionable busy conflict, then retry returns same quote', async () => {
    const results = await Promise.all([quote(), quote()]);
    expect(results.every(r => [201, 409].includes(r.status))).toBe(true); expect(results.some(r => r.status === 201)).toBe(true);
    const q = results.find(r => r.status === 201)!.body.quote;
    expect((await quote()).body.quote.quoteId).toBe(q.quoteId); expect(admin.create).toHaveBeenCalledTimes(1); expect(h.retail.quote).toHaveBeenCalledTimes(1);
  });
  it('one purchase/order/receipt across funding and execution retries; proof separates both provenance chains', async () => {
    const q = QuoteView.parse((await quote()).body.quote);
    const body = { quoteId: q.quoteId, approval: { quoteDigest: q.digest, maxTotal: q.payablePrincipal, selectedFundingOptionId: q.fundingOptions[0]!.fundingOptionId } };
    const buy = () => h.call('POST', '/v1/purchases', { token: h.alice.token, body, headers: { 'idempotency-key': 'global-fixture-purchase' } });
    const purchases = await Promise.all([buy(), buy()]); expect(purchases.map(r => r.status)).toEqual([201, 201]);
    const id = purchases[0]!.body.purchase.purchaseId; expect(purchases[1]!.body.purchase.purchaseId).toBe(id);
    const fund = () => h.call('POST', '/v1/purchases/' + id + '/fund', { token: h.alice.token, headers: { 'payment-signature': 'fixture:global-fixture-funding:' + q.fundingOptions[0]!.amount.amountBaseUnits } });
    expect((await fund()).status).toBe(202); await h.gw.worker.tick(); await h.gw.worker.tick(); await buy();
    const purchase = (await h.call('GET', '/v1/purchases/' + id, { token: h.alice.token })).body.purchase;
    expect(purchase.state).toBe('succeeded'); expect(h.retail.executeCalls).toBe(1); expect(h.retail.orders.size).toBe(1); expect(h.funding.verifyCalls).toBe(1);
    const receipt = ReceiptView.parse(purchase.receipt); expect(receipt.sourceOffer).toEqual(selected);
    expect(receipt.sandboxExecution?.quotedTotal.amountMinor).toBe('5700'); expect(receipt.sandboxExecution?.sourceDigest).toBe(sourceDigest(selected));
    expect(receipt.funding[0]?.evidenceMode).toBe('local_fixture'); expect(receipt.limitations.join(' ')).toMatch(/SIMULATED.*no externally confirmed chain/);
    const proof = PurchaseProof.parse((await h.call('GET', '/v1/evidence/purchases/' + id + '/proof', { token: h.alice.token })).body.proof);
    expect(proof.sourceOffer?.merchantName).toBe(selected.merchantName); expect(proof.sandboxExecution?.boundary).toBe(SANDBOX_BOUNDARY);
    expect(proof.sandboxExecution?.orderReference).toBe(purchase.providerReference); expect(proof.sandboxExecution?.evidenceMode).toBe('local_fixture');
    expect(proof.timeline.find(s => s.step === 'funded')?.text).toContain('SIMULATED / LOCAL FIXTURE');
    for (const net of (await trialBalance(h.gw.db)).values()) expect(net).toBe(0n);
  });
  it('retains shadow after uncertain execution and restart/reconciliation never creates a second order', async () => {
    h.retail.behavior = 'unknown_then_succeed';
    const q = (await quote()).body.quote;
    const buy = await h.call('POST', '/v1/purchases', { token: h.alice.token, body: { quoteId: q.quoteId, approval: { quoteDigest: q.digest, maxTotal: q.payablePrincipal, selectedFundingOptionId: q.fundingOptions[0].fundingOptionId } }, headers: { 'idempotency-key': 'global-fixture-recovery' } });
    const id = buy.body.purchase.purchaseId;
    await h.call('POST', '/v1/purchases/' + id + '/fund', { token: h.alice.token, headers: { 'payment-signature': 'fixture:global-recovery:' + q.fundingOptions[0].amount.amountBaseUnits } });
    await h.gw.worker.tick(); expect(h.retail.executeCalls).toBe(1);
    expect((await h.call('GET', '/v1/purchases/' + id, { token: h.alice.token })).body.purchase.state).toBe('unresolved');
    h.gw.core.deps.executors.set('shopify', new GlobalSandboxExecutor(h.retail, catalog, preparer(await createTestDb(schema))));
    h.clock.advance(20_000); await h.gw.worker.tick();
    expect((await h.call('GET', '/v1/purchases/' + id, { token: h.alice.token })).body.purchase.state).toBe('succeeded');
    expect(h.retail.executeCalls).toBe(1); expect(admin.create).toHaveBeenCalledTimes(1); expect(product).not.toBeNull();
  });
});
