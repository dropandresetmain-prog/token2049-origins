import { afterEach, describe, expect, it, vi } from 'vitest';
import { startHarness, retailIntent, retailFulfillment, type Harness } from '../support/harness.js';
import { demoData, loadDemoConfig } from '../../src/demo/config.js';
import { money } from '../../src/contracts/money.js';
import { accountBalance, Accounts, cryptoAsset, fiatAsset, trialBalance } from '../../src/core/journal.js';
import { FIXTURE_ASSET, FIXTURE_NETWORK } from '../support/fixtures.js';
import { purchaseDetail, listPurchases } from '../../src/evidence/read-model.js';
import { getPurchaseRow } from '../../src/core/store.js';
import { createAtlasExecutor } from '../../src/execution/atlas/executor.js';
import { Worker } from '../../src/core/worker.js';

const originalDemo = structuredClone(demoData);
let h: Harness | undefined;
afterEach(async () => { vi.useRealTimers(); demoData.settlementPolicy = originalDemo.settlementPolicy; await h?.close(); h = undefined; });
async function quote(cents = demoData.retail.scalingExampleMinor) {
  h!.retail.price = money('USD', cents);
  const search = await h!.call('POST', '/v1/offers/search', { token: h!.alice.token, body: { intent: retailIntent('50000') } });
  const q = await h!.call('POST', '/v1/quotes', { token: h!.alice.token, body: { offerId: search.body.offers[0].offerId, fulfillment: retailFulfillment } });
  expect(q.status).toBe(201);
  return q.body.quote;
}
async function purchase(q: any, key = 'scaled-purchase-1') {
  return h!.call('POST', '/v1/purchases', { token: h!.alice.token, headers: { 'idempotency-key': key },
    body: { quoteId: q.quoteId, approval: { maxTotal: q.payablePrincipal, quoteDigest: q.digest, selectedFundingOptionId: q.fundingOptions[0]!.fundingOptionId! } } });
}

describe('scaled settlement through persisted commerce', () => {
  it('freezes 183.40 / 0.183400 across config edits, restart, funding, journals and evidence', async () => {
    h = await startHarness({ settlementPolicy: demoData.settlementPolicy });
    const q = await quote();
    const original = structuredClone(q.fundingOptions[0]);
    expect(original.amount.amountBaseUnits).toBe('183400');
    expect(original.settlement.commercialPrincipal.amountMinor).toBe('18340');
    // Change the current loaded SSOT; existing quotes must ignore its new policy.
    demoData.settlementPolicy = loadDemoConfig({ ...demoData, settlementPolicy: { mode: 'full_notional', numerator: 1, denominator: 1 } }).settlementPolicy;
    h.gw.core.deps.config.settlementPolicy = undefined;
    const p = await purchase(q);
    expect(p.status).toBe(201);
    expect(p.body.purchase.fundingRequirement).toEqual(original);
    const schema = (await h.gw.db.get<{ schema: string }>('SELECT current_schema() AS schema'))!.schema;
    const clock = h.clock;
    const token = h.alice.token;
    const id = p.body.purchase.purchaseId;
    await h.close(); await h.gw.db.close();
    h = await startHarness({ schema, clock });
    const funding = await h.call('POST', `/v1/purchases/${id}/fund`, { token, headers: { 'payment-signature': 'fixture:scaled-proof:183400' } });
    expect(funding.status).toBe(202);
    await h.gw.worker.tick();
    const done = await h.call('GET', `/v1/purchases/${id}`, { token });
    expect(done.body.purchase.state).toBe('succeeded');
    expect(done.body.purchase.fundingRequirement).toEqual(original);
    expect(done.body.purchase.receipt.fundingRequirement).toEqual(original);
    expect(done.body.purchase.receipt.principal.amountMinor).toBe('18340');
    expect(done.body.purchase.funding[0]).toMatchObject({ amountBaseUnits: '183400', evidenceMode: 'local_fixture' });
    expect(done.body.purchase.receipt.limitations.join(' ')).toContain('1:1000');
    const row = (await getPurchaseRow(h.gw.db, id))!;
    const detail = await purchaseDetail(h.gw.db, row);
    expect(detail.purchase.fundingRequirement).toEqual(original);
    expect((await listPurchases(h.gw.db, row.customer_id))[0]!.fundingRequirement).toEqual(original);
    expect(await accountBalance(h.gw.db, Accounts.merchantPurchases, fiatAsset('USD', 2))).toBe(18340n);
    expect(await accountBalance(h.gw.db, Accounts.principalApplied, cryptoAsset(FIXTURE_NETWORK, FIXTURE_ASSET))).toBe(-183400n);
    expect([...(await trialBalance(h.gw.db)).values()].every(v => v === 0n)).toBe(true);
  });
  it('scales a non-zero fee with the same frozen policy and posts 100000 / 1000 separately', async () => {
    h = await startHarness({ settlementPolicy: demoData.settlementPolicy, serviceFeeBps: 100 });
    const q = await quote('10000');
    expect(q.fundingOptions[0].settlement).toMatchObject({ principalBaseUnits: '100000', feeBaseUnits: '1000', totalBaseUnits: '101000' });
    const p = await purchase(q); const id = p.body.purchase.purchaseId;
    h.gw.core.deps.config.serviceFeeBps = 1000;
    h.gw.core.deps.config.settlementPolicy = { mode: 'full_notional', numerator: 1, denominator: 1 };
    expect((await h.call('POST', `/v1/purchases/${id}/fund`, { token: h.alice.token, headers: { 'payment-signature': 'fixture:fee-proof:101000' } })).status).toBe(202);
    await h.gw.worker.tick();
    const asset = cryptoAsset(FIXTURE_NETWORK, FIXTURE_ASSET);
    expect(await accountBalance(h.gw.db, Accounts.principalApplied, asset)).toBe(-100000n);
    expect(await accountBalance(h.gw.db, Accounts.serviceFee, asset)).toBe(-1000n);
    expect((await getPurchaseRow(h.gw.db, id))!.state).toBe('succeeded');
  });
  it('accepts the configured commercial limit and rejects one cent over it', async () => {
    h = await startHarness({ settlementPolicy: demoData.settlementPolicy });
    h.gw.core.deps.config.perPurchaseLimitMinor.USD = 18340n;
    expect((await purchase(await quote())).status).toBe(201);
    expect((await purchase(await quote('18341'), 'scaled-purchase-2')).body.error.code).toBe('spend_limit_exceeded');
  });
  it('refuses funding requirements for Atlas quotes created before its gate closed', async () => {
    h = await startHarness();
    // Use a stored fixture quote on the Atlas route, then replace only its payment guard with real Atlas.
    h.flight.price = money('USD', '10000');
    const s = await h.call('POST', '/v1/offers/search', { token: h.alice.token, body: { intent: { category: 'flight', from: 'MNL', to: 'CEB', departDate: '2030-01-01', adults: 1, spendCeiling: money('USD', '50000') } } });
    const fulfillment = { category: 'flight', contact: { familyName: 'Buyer', givenName: 'Test', email: demoData.buyer.email, mobile: '0065-00000000' }, passengers: [{ familyName: 'Buyer', givenName: 'Test', gender: 'M', birthday: '1990-01-01', nationality: 'SG', passengerType: 'adult' }] };
    const q = await h.call('POST', '/v1/quotes', { token: h.alice.token, body: { offerId: s.body.offers[0].offerId, fulfillment } });
    const fetchImpl = vi.fn(async () => { throw new Error('no provider call permitted'); });
    h.gw.core.deps.executors.set('atlas', createAtlasExecutor({}, { fetchImpl }));
    const p = await purchase(q.body.quote);
    expect(p.body.error.code).toBe('route_unavailable');
    expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM purchases'))!.n).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('logs failed database ticks without SQL detail or raw error messages', async () => {
    h = await startHarness();
    const log = vi.fn(); const worker = new Worker(h.gw.core, log);
    vi.spyOn(worker, 'recoverLeases').mockResolvedValue(0);
    vi.spyOn(worker, 'recoverOrphans').mockResolvedValue(0);
    vi.spyOn(worker, 'tick').mockRejectedValue(Object.assign(new Error('postgresql://user:secret@host provider raw response'), { code: '08006', detail: 'private' }));
    vi.useFakeTimers(); await worker.start(100);
    await vi.advanceTimersByTimeAsync(100); worker.stop();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ component: 'worker', stage: 'tick', errorCode: '08006' }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|private|postgresql|raw response/);
  });
});
