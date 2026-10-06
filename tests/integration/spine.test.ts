import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startHarness, createFundablePurchase, retailIntent, retailFulfillment, type Harness } from '../support/harness.js';
import { trialBalance, accountBalance, Accounts, cryptoAsset, fiatAsset } from '../../src/core/journal.js';
import { capacitySnapshot } from '../../src/core/capacity.js';
import { FIXTURE_ASSET, FIXTURE_NETWORK } from '../support/fixtures.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../../src/infrastructure/db.js';
import { ManualClock } from '../../src/infrastructure/clock.js';

const ASSET = cryptoAsset(FIXTURE_NETWORK, FIXTURE_ASSET);

function assertBalanced(h: Harness) {
  for (const [asset, sum] of trialBalance(h.gw.db)) expect(sum, `asset ${asset}`).toBe(0n);
}

describe('commerce spine (local fixtures)', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness();
  });
  afterEach(async () => {
    await h.close();
  });

  it('happy path: quote -> 402 -> verified funding -> worker executes once -> receipt', async () => {
    const { purchase, required } = await createFundablePurchase(h);
    expect(purchase.state).toBe('awaiting_funding');
    expect(purchase.fundingInstructions.options[0].amount.amountBaseUnits).toBe('49990000'); // 49.99 USD @ 6 dp
    expect(h.retail.executeCalls).toBe(0);

    const challenge = await h.call('POST', `/v1/purchases/${purchase.purchaseId}/fund`, { token: h.alice.token });
    expect(challenge.status).toBe(402);
    expect(challenge.headers.get('payment-required')).toBeTruthy();
    expect(challenge.body.accepts[0].amount).toBe(required);

    const funded = await h.call('POST', `/v1/purchases/${purchase.purchaseId}/fund`, {
      token: h.alice.token,
      headers: { 'payment-signature': `fixture:tx1:${required}` },
    });
    expect(funded.status).toBe(202);
    expect(funded.body.purchase.state).toBe('funded_queued');
    // No merchant spend in the request path.
    expect(h.retail.executeCalls).toBe(0);

    await h.gw.worker.tick();
    expect(h.retail.executeCalls).toBe(1);
    const got = await h.call('GET', `/v1/purchases/${purchase.purchaseId}`, { token: h.alice.token });
    expect(got.body.purchase.state).toBe('succeeded');
    expect(got.body.purchase.commerceStatus).toBe('confirmed');
    expect(got.body.purchase.reservation.status).toBe('consumed');
    const receipt = got.body.purchase.receipt;
    expect(receipt.evidenceMode).toBe('local_fixture');
    expect(receipt.limitations[0]).toMatch(/LOCAL FIXTURE/);
    expect(receipt.funding[0].transferReference).toBe('tx1');

    assertBalanced(h);
    expect(accountBalance(h.gw.db, Accounts.cryptoTreasury, ASSET)).toBe(49_990_000n);
    expect(accountBalance(h.gw.db, Accounts.customerPrepayment, ASSET)).toBe(0n);
    expect(-accountBalance(h.gw.db, Accounts.cardPayable, fiatAsset('USD', 2))).toBe(4999n);
    // Capacity: consumed reservation moved to card payable, not double counted.
    const cap = capacitySnapshot(h.gw.db, 'USD')!;
    expect(cap.reservedMinor).toBe(0n);
    expect(cap.availableMinor).toBe(20000n - 4999n);

    const events = await h.call('GET', `/v1/purchases/${purchase.purchaseId}/events`, { token: h.alice.token });
    const types = events.body.events.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['purchase.created', 'funding.confirmed', 'execution.started', 'execution.succeeded', 'receipt.issued']));
  });

  it('no funding / bad funding cannot buy', async () => {
    const { purchase, required } = await createFundablePurchase(h);
    await h.gw.worker.tick();
    expect(h.retail.executeCalls).toBe(0);
    const short = await h.call('POST', `/v1/purchases/${purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:tx-short:${BigInt(required) - 1n}` } });
    expect(short.status).toBe(402);
    expect(short.body.error.code).toBe('payment_invalid');
    const wrongAsset = await h.call('POST', `/v1/purchases/${purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:tx-asset:${required}:confirmed:lovelace` } });
    expect(wrongAsset.body.error.code).toBe('payment_invalid');
    const wrongPayee = await h.call('POST', `/v1/purchases/${purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:tx-payee:${required}:confirmed:${FIXTURE_ASSET}:addr_test1attacker` } });
    expect(wrongPayee.body.error.code).toBe('payment_invalid');
    const malformed = await h.call('POST', `/v1/purchases/${purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': 'funded=true' } });
    expect(malformed.body.error.code).toBe('payment_invalid');
    await h.gw.worker.tick();
    expect(h.retail.executeCalls).toBe(0);
    assertBalanced(h);
    expect(accountBalance(h.gw.db, Accounts.cryptoTreasury, ASSET)).toBe(0n);
  });

  it('replayed proof cannot fund a second purchase', async () => {
    const a = await createFundablePurchase(h);
    const b = await createFundablePurchase(h);
    const ok = await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:txR:${a.required}` } });
    expect(ok.status).toBe(202);
    const replay = await h.call('POST', `/v1/purchases/${b.purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:txR:${b.required}` } });
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('payment_replayed');
    await h.gw.worker.tick();
    expect(h.retail.executeCalls).toBe(1);
    assertBalanced(h);
  });

  it('second payment to an already funded purchase is refused before verification/settlement', async () => {
    const a = await createFundablePurchase(h);
    await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:t1:${a.required}` } });
    const before = h.funding.verifyCalls;
    const again = await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:t2:${a.required}` } });
    expect(again.status).toBe(409);
    expect(h.funding.verifyCalls).toBe(before);
  });

  it('overpayment: excess recorded as unapplied refundable obligation', async () => {
    const a = await createFundablePurchase(h);
    const over = (BigInt(a.required) + 1_000_000n).toString();
    await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:tOver:${over}` } });
    assertBalanced(h);
    expect(-accountBalance(h.gw.db, Accounts.customerUnapplied, ASSET)).toBe(1_000_000n);
    expect(-accountBalance(h.gw.db, Accounts.customerPrepayment, ASSET)).toBe(BigInt(a.required));
  });

  it('idempotent purchase creation: same key same body returns same purchase; different body conflicts', async () => {
    const s = await h.call('POST', '/v1/offers/search', { token: h.alice.token, body: { intent: retailIntent() } });
    const q = await h.call('POST', '/v1/quotes', { token: h.alice.token, body: { offerId: s.body.offers[0].offerId, fulfillment: retailFulfillment } });
    const quote = q.body.quote;
    const body = { quoteId: quote.quoteId, approval: { maxTotal: quote.payablePrincipal, quoteDigest: quote.digest }, fundingRail: 'cardano' };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => h.call('POST', '/v1/purchases', { token: h.alice.token, headers: { 'idempotency-key': 'same-key-123' }, body })),
    );
    const ids = new Set(results.map((r) => r.body.purchase?.purchaseId));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(ids.size).toBe(1);
    const conflict = await h.call('POST', '/v1/purchases', {
      token: h.alice.token,
      headers: { 'idempotency-key': 'same-key-123' },
      body: { ...body, approval: { ...body.approval, maxTotal: { currency: 'USD', amountMinor: '9999', scale: 2 } } },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('idempotency_conflict');
    const otherKey = await h.call('POST', '/v1/purchases', { token: h.alice.token, headers: { 'idempotency-key': 'other-key-456' }, body });
    expect(otherKey.status).toBe(409);
    expect(otherKey.body.error.code).toBe('conflict');
    expect(h.gw.db.get<{ n: number }>('SELECT COUNT(*) n FROM reservations')!.n).toBe(1);
  });

  it('concurrent workers/ticks never execute twice', async () => {
    const a = await createFundablePurchase(h);
    await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:tc:${a.required}` } });
    await Promise.all([h.gw.worker.tick(), h.gw.worker.tick(), h.gw.worker.tick()]);
    expect(h.retail.executeCalls).toBe(1);
    expect(h.gw.db.get<{ n: number }>("SELECT COUNT(*) n FROM journal_entries WHERE kind = 'merchant_payment_simulated_card'")!.n).toBe(1);
  });

  it('unknown outcome keeps exposure, never re-executes, reconciles via readback', async () => {
    h.retail.behavior = 'unknown_then_succeed';
    const a = await createFundablePurchase(h);
    await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:tu:${a.required}` } });
    await h.gw.worker.tick();
    let p = (await h.call('GET', `/v1/purchases/${a.purchase.purchaseId}`, { token: h.alice.token })).body.purchase;
    expect(p.state).toBe('unresolved');
    expect(p.reservation.status).toBe('held_unresolved');
    expect(capacitySnapshot(h.gw.db, 'USD')!.reservedMinor).toBe(4999n);
    h.clock.advance(20_000);
    await h.gw.worker.tick();
    p = (await h.call('GET', `/v1/purchases/${a.purchase.purchaseId}`, { token: h.alice.token })).body.purchase;
    expect(p.state).toBe('succeeded');
    expect(h.retail.executeCalls).toBe(1);
    expect(h.retail.retrieveCalls).toBeGreaterThanOrEqual(1);
    assertBalanced(h);
  });

  it('thrown network error is unknown (not a definite failure); no release, no refund implied', async () => {
    h.retail.behavior = 'throw_unknown';
    const a = await createFundablePurchase(h);
    await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:tt:${a.required}` } });
    await h.gw.worker.tick();
    const p = (await h.call('GET', `/v1/purchases/${a.purchase.purchaseId}`, { token: h.alice.token })).body.purchase;
    expect(p.state).toBe('unresolved');
    expect(p.reservation.status).toBe('held_unresolved');
  });

  it('adapter claiming success with a held/unpaid order is not a completed purchase', async () => {
    h.retail.behavior = 'held_only';
    const a = await createFundablePurchase(h);
    await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:th:${a.required}` } });
    await h.gw.worker.tick();
    const p = (await h.call('GET', `/v1/purchases/${a.purchase.purchaseId}`, { token: h.alice.token })).body.purchase;
    expect(p.state).toBe('unresolved');
    expect(p.receipt).toBeNull();
    expect(h.gw.db.get<{ n: number }>("SELECT COUNT(*) n FROM journal_entries WHERE kind = 'merchant_payment_simulated_card'")!.n).toBe(0);
  });

  it('definite failure releases capacity; funds stay a refundable prepayment liability', async () => {
    h.retail.behavior = 'fail';
    const a = await createFundablePurchase(h);
    await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:tf:${a.required}` } });
    await h.gw.worker.tick();
    const p = (await h.call('GET', `/v1/purchases/${a.purchase.purchaseId}`, { token: h.alice.token })).body.purchase;
    expect(p.state).toBe('failed');
    expect(p.reservation.status).toBe('released');
    expect(-accountBalance(h.gw.db, Accounts.customerPrepayment, ASSET)).toBe(BigInt(a.required));
    const types = (await h.call('GET', `/v1/purchases/${a.purchase.purchaseId}/events`, { token: h.alice.token })).body.events.map((e: { type: string }) => e.type);
    expect(types).toContain('refund.due');
  });

  it('terms changed at execution requires renewed authority', async () => {
    h.retail.behavior = 'terms_changed';
    const a = await createFundablePurchase(h);
    await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:tq:${a.required}` } });
    await h.gw.worker.tick();
    const p = (await h.call('GET', `/v1/purchases/${a.purchase.purchaseId}`, { token: h.alice.token })).body.purchase;
    expect(p.state).toBe('requires_reauthorization');
  });

  it('quote expiry: unfunded purchase expires and releases capacity; expired quote cannot be funded', async () => {
    const a = await createFundablePurchase(h);
    h.clock.advance(16 * 60_000);
    const late = await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:tl:${a.required}` } });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('quote_expired');
    const p = (await h.call('GET', `/v1/purchases/${a.purchase.purchaseId}`, { token: h.alice.token })).body.purchase;
    expect(p.state).toBe('expired');
    expect(p.reservation.status).toBe('released');
  });

  it('funded but quote expired before execution: no execution, renewed authority required', async () => {
    const a = await createFundablePurchase(h);
    await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:tx:${a.required}` } });
    h.clock.advance(16 * 60_000);
    await h.gw.worker.tick();
    expect(h.retail.executeCalls).toBe(0);
    const p = (await h.call('GET', `/v1/purchases/${a.purchase.purchaseId}`, { token: h.alice.token })).body.purchase;
    expect(p.state).toBe('requires_reauthorization');
  });

  it('insufficient simulated capacity fails safely', async () => {
    h.retail.price = { currency: 'USD', amountMinor: '25000', scale: 2 };
    const s = await h.call('POST', '/v1/offers/search', { token: h.alice.token, body: { intent: retailIntent('30000') } });
    const q = await h.call('POST', '/v1/quotes', { token: h.alice.token, body: { offerId: s.body.offers[0].offerId, fulfillment: retailFulfillment } });
    const quote = q.body.quote;
    const p = await h.call('POST', '/v1/purchases', { token: h.alice.token, headers: { 'idempotency-key': 'cap-key-0001' }, body: { quoteId: quote.quoteId, approval: { maxTotal: quote.payablePrincipal, quoteDigest: quote.digest } } });
    expect(p.status).toBe(422);
    expect(p.body.error.code).toBe('insufficient_capacity');
  });

  it('spend ceiling and approval bounds are enforced', async () => {
    const s = await h.call('POST', '/v1/offers/search', { token: h.alice.token, body: { intent: retailIntent('1000') } });
    const q = await h.call('POST', '/v1/quotes', { token: h.alice.token, body: { offerId: s.body.offers[0].offerId, fulfillment: retailFulfillment } });
    expect(q.status).toBe(422);
    expect(q.body.error.code).toBe('spend_limit_exceeded');

    const s2 = await h.call('POST', '/v1/offers/search', { token: h.alice.token, body: { intent: retailIntent() } });
    const q2 = await h.call('POST', '/v1/quotes', { token: h.alice.token, body: { offerId: s2.body.offers[0].offerId, fulfillment: retailFulfillment } });
    const quote = q2.body.quote;
    const low = await h.call('POST', '/v1/purchases', { token: h.alice.token, headers: { 'idempotency-key': 'approval-low-1' }, body: { quoteId: quote.quoteId, approval: { maxTotal: { currency: 'USD', amountMinor: '100', scale: 2 }, quoteDigest: quote.digest } } });
    expect(low.body.error.code).toBe('spend_limit_exceeded');
    const wrongDigest = await h.call('POST', '/v1/purchases', { token: h.alice.token, headers: { 'idempotency-key': 'approval-dig-1' }, body: { quoteId: quote.quoteId, approval: { maxTotal: quote.payablePrincipal, quoteDigest: 'sha256:' + '0'.repeat(64) } } });
    expect(wrongDigest.body.error.code).toBe('quote_changed');
  });

  it('customer isolation: bob cannot read, quote, buy or fund alice resources', async () => {
    const a = await createFundablePurchase(h);
    const read = await h.call('GET', `/v1/purchases/${a.purchase.purchaseId}`, { token: h.bob.token });
    expect(read.status).toBe(404);
    const ev = await h.call('GET', `/v1/purchases/${a.purchase.purchaseId}/events`, { token: h.bob.token });
    expect(ev.status).toBe(404);
    const fund = await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h.bob.token, headers: { 'payment-signature': `fixture:tb:${a.required}` } });
    expect(fund.status).toBe(404);
    const buy = await h.call('POST', '/v1/purchases', { token: h.bob.token, headers: { 'idempotency-key': 'bob-steals-1' }, body: { quoteId: a.quote.quoteId, approval: { maxTotal: a.quote.payablePrincipal, quoteDigest: a.quote.digest } } });
    expect(buy.status).toBe(404);
    const quoteRead = await h.call('GET', `/v1/quotes/${a.quote.quoteId}`, { token: h.bob.token });
    expect(quoteRead.status).toBe(404);
  });

  it('authentication and validation errors use the single error shape', async () => {
    const none = await h.call('POST', '/v1/offers/search', { body: { intent: retailIntent() } });
    expect(none.status).toBe(401);
    expect(none.body.error).toMatchObject({ code: 'unauthenticated' });
    expect(none.body.error.requestId).toBeTruthy();
    const bad = await h.call('POST', '/v1/offers/search', { token: 'nope' });
    expect(bad.status).toBe(401);
    const invalid = await h.call('POST', '/v1/offers/search', { token: h.alice.token, body: { intent: { category: 'retail', quantity: 0 } } });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('invalid_request');
    const noIdem = await h.call('POST', '/v1/purchases', { token: h.alice.token, body: { quoteId: 'quo_ABCDEFGHIJKLMNOP', approval: { maxTotal: { currency: 'USD', amountMinor: '1', scale: 2 }, quoteDigest: 'x' } } });
    expect(noIdem.status).toBe(400);
    const unknownRoute = await h.call('GET', '/v1/nope', { token: h.alice.token });
    expect(unknownRoute.status).toBe(404);
    expect(unknownRoute.body.error.code).toBe('not_found');
  });

  it('unready route fails clearly with no fallback', async () => {
    h.retail.readinessStatus = 'MISSING_CONFIG';
    const s = await h.call('POST', '/v1/offers/search', { token: h.alice.token, body: { intent: retailIntent() } });
    expect(s.status).toBe(503);
    expect(s.body.error.code).toBe('route_unavailable');
  });

  it('there is no public mark-funded / mark-paid route', async () => {
    const a = await createFundablePurchase(h);
    for (const path of [`/v1/purchases/${a.purchase.purchaseId}/mark-funded`, `/v1/purchases/${a.purchase.purchaseId}/mark-paid`, '/v1/admin/balance']) {
      const r = await h.call('POST', path, { token: h.alice.token, body: {} });
      expect(r.status).toBe(404);
    }
    const lie = await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h.alice.token, body: { funded: true, txHash: 'abc' } });
    expect(lie.status).toBe(402); // body claims are ignored; challenge returned
  });

  it('submitted (unconfirmed) funding does not execute until confirmed', async () => {
    const a = await createFundablePurchase(h);
    h.funding.confirmResult = 'submitted';
    const r = await h.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:ts:${a.required}:submitted` } });
    expect(r.status).toBe(202);
    expect(r.body.purchase.paymentState).toBe('submitted');
    await h.gw.worker.tick();
    expect(h.retail.executeCalls).toBe(0);
    assertBalanced(h);
    expect(accountBalance(h.gw.db, Accounts.cryptoTreasury, ASSET)).toBe(0n);
    h.funding.confirmResult = 'confirmed';
    h.clock.advance(40_000);
    await h.gw.worker.tick();
    await h.gw.worker.tick();
    expect(h.retail.executeCalls).toBe(1);
    assertBalanced(h);
  });
});

describe('restart durability', () => {
  it('crash mid-execution: restart reconciles, never re-executes; state survives', async () => {
    const dir = mkdtempSync(join(tmpdir(), 't2o-'));
    const dbPath = join(dir, 'gw.db');
    const clock = new ManualClock();
    const h1 = await startHarness({ dbPath, clock });
    const a = await createFundablePurchase(h1);
    await h1.call('POST', `/v1/purchases/${a.purchase.purchaseId}/fund`, { token: h1.alice.token, headers: { 'payment-signature': `fixture:tr:${a.required}` } });
    h1.retail.block();
    const inflight = h1.gw.worker.tick(); // attempt persisted, provider call hangs
    await new Promise((r) => setTimeout(r, 50));
    expect(h1.retail.executeCalls).toBe(1);
    // "crash": abandon process state without applying the result
    await h1.close();
    h1.gw.db.close();

    const db2 = new Db(dbPath);
    const h2 = await startHarness({ db: db2, clock });
    // The provider actually accepted the order before the crash.
    h2.retail.orders.set(`${a.purchase.purchaseId}:1`, { ref: `FIX-${a.purchase.purchaseId}:1`, paid: true });
    clock.advance(130_000); // lease expiry
    h2.gw.worker.recoverLeases();
    await h2.gw.worker.tick();
    h2.clock.advance(20_000);
    await h2.gw.worker.tick();
    const p = (await h2.call('GET', `/v1/purchases/${a.purchase.purchaseId}`, { token: h1.alice.token })).body.purchase;
    expect(p.state).toBe('succeeded');
    expect(h2.retail.executeCalls).toBe(0); // never re-executed after restart
    expect(h2.retail.retrieveCalls).toBeGreaterThanOrEqual(1);
    for (const [, sum] of trialBalance(db2)) expect(sum).toBe(0n);
    h1.retail.unblock();
    await inflight.catch(() => undefined);
    await h2.close();
  });
});
