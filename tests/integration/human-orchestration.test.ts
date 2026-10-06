import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, createFundablePurchase, retailIntent, retailFulfillment, type Harness } from '../support/harness.js';
import { createClient } from '../../src/infrastructure/auth.js';
import { PurchaseProof } from '../../src/evidence/proof.js';
import { FixtureFundingAdapter } from '../support/fixtures.js';
import { projectProgress } from '../../src/contracts/presentation.js';
import type { FundingAdapter } from '../../src/contracts/ports.js';

describe('human orchestration over durable commerce', () => {
  let h: Harness;
  beforeEach(async () => { h = await startHarness({ settlementPolicy: { mode: 'scaled_testnet', numerator: 1, denominator: 1000 } }); });
  afterEach(async () => h.close());
  const auth = () => ({ token: h.alice.token });
  async function quote() {
    const search = await h.call('POST', '/v1/offers/search', { ...auth(), body: { intent: retailIntent() } });
    return (await h.call('POST', '/v1/quotes', { ...auth(), body: { offerId: search.body.offers[0].offerId, fulfillment: retailFulfillment } })).body.quote;
  }
  it('HTTP returns 422 needs_input with exact paths and no supplied PII', async () => {
    const search = await h.call('POST', '/v1/offers/search', { ...auth(), body: { intent: { category: 'flight', from: 'SIN', adults: 1, spendCeiling: { currency: 'USD', amountMinor: '20000', scale: 2 } } } });
    expect(search.status).toBe(422);
    expect(search.body.error).toMatchObject({ code: 'needs_input', details: { status: 'needs_input', phase: 'search' } });
    expect(search.body.error.details.fields.map((f: any) => f.path)).toEqual(['to', 'departDate']);
    const found = await h.call('POST', '/v1/offers/search', { ...auth(), body: { intent: retailIntent() } });
    const fulfillment = await h.call('POST', '/v1/quotes', { ...auth(), body: { offerId: found.body.offers[0].offerId, fulfillment: { category: 'retail', email: 'private@example.com', shippingAddress: { firstName: 'Private' } } } });
    expect(fulfillment.status).toBe(422);
    expect(fulfillment.body.error.details.fields.map((f: any) => f.path)).toContain('shippingAddress.lastName');
    expect(JSON.stringify(fulfillment.body)).not.toMatch(/private@example.com|Private/);
    const bad = await h.call('POST', '/v1/offers/search', { ...auth(), body: { intent: { category: 'flight', departDate: 'tomorrow' } } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_request');
  });
  it('provider requirements stay in canonical fields and unknown requirements fail safely', async () => {
    const executor = h.retail as typeof h.retail & Pick<import('../../src/contracts/ports.js').CommerceExecutor, 'inputRequirements'>;
    executor.inputRequirements = async () => ({ phase: 'search', paths: ['productRef'] });
    const response = await h.call('POST', '/v1/offers/search', { ...auth(), body: { intent: retailIntent() } });
    expect(response.body.error.details).toMatchObject({ phase: 'provider', collectionPhase: 'search', fields: [{ path: 'productRef' }] });
    executor.inputRequirements = async () => ({ phase: 'search', paths: ['providerExtras.secret'] });
    const unknown = await h.call('POST', '/v1/offers/search', { ...auth(), body: { intent: retailIntent() } });
    expect(unknown.status).toBe(502);
    expect(unknown.body.error.message).toContain('unmodelled');
    expect(JSON.stringify(unknown.body)).not.toContain('providerExtras');
  });
  it('execution refuses approval that no longer binds the frozen funding option', async () => {
    const { purchase, required } = await createFundablePurchase(h);
    await h.call('POST', `/v1/purchases/${purchase.purchaseId}/fund`, { ...auth(), headers: { 'payment-signature': `fixture:approval-tamper:${required}` } });
    const row = await h.gw.db.get<{ approval_json: string }>('SELECT approval_json FROM purchases WHERE id=$1', purchase.purchaseId);
    const approval = JSON.parse(row!.approval_json); approval.selectedFundingOptionId = 'fop_OTHERFUNDINGOPTION';
    await h.gw.db.run('UPDATE purchases SET approval_json=$1 WHERE id=$2', JSON.stringify(approval), purchase.purchaseId);
    await h.gw.worker.tick();
    expect(h.retail.executeCalls).toBe(0);
    const result = await h.call('GET', `/v1/purchases/${purchase.purchaseId}`, auth());
    expect(result.body.purchase.state).toBe('requires_reauthorization');
  });
  it.each(['MISSING_CONFIG', 'ACCESS_BLOCKED'] as const)('excludes %s and cannot create a purchase', async readiness => {
    h.funding.readinessStatus = readiness;
    const q = await quote();
    expect(q.fundingOptions).toEqual([]);
    const result = await h.call('POST', '/v1/purchases', { ...auth(), headers: { 'idempotency-key': 'no-payment-source' }, body: { quoteId: q.quoteId, approval: { maxTotal: q.payablePrincipal, quoteDigest: q.digest, selectedFundingOptionId: 'fop_ABCDEFGHIJKLMNOP' } } });
    expect(result.status).toBe(400);
  });
  it.each(['CONFIGURED_UNVERIFIED', 'EXTERNAL_CHECK_PASSED', 'LOCAL_TESTS_ONLY'] as const)('allows %s in tests', async readiness => {
    h.funding.readinessStatus = readiness;
    expect((await quote()).fundingOptions).toHaveLength(1);
  });
  it('fixture rails are not selectable in demo runtime; no fallback', async () => {
    h.gw.core.deps.config.appEnv = 'sandbox';
    expect((await quote()).fundingOptions).toEqual([]);
    h.funding.readinessStatus = 'CONFIGURED_UNVERIFIED';
    expect((await quote()).fundingOptions).toHaveLength(1);
  });
  it('readiness loss after quote prevents creating a new funding obligation', async () => {
    const q = await quote(); h.funding.readinessStatus = 'ACCESS_BLOCKED';
    const result = await h.call('POST', '/v1/purchases', { ...auth(), headers: { 'idempotency-key': 'readiness-changed' }, body: {
      quoteId: q.quoteId, approval: { maxTotal: q.payablePrincipal, quoteDigest: q.digest, selectedFundingOptionId: q.fundingOptions[0].fundingOptionId },
    } });
    expect(result.status).toBe(503);
    expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM purchases'))!.n).toBe(0);
  });
  it('represents two ready fixture rails with distinct quote-scoped identities', async () => {
    const fixture = new FixtureFundingAdapter(h.clock);
    const second: FundingAdapter = { rail: 'solana', network: 'fixture:second', paymentHeaderName: fixture.paymentHeaderName,
      acceptedAsset: () => fixture.acceptedAsset(), readiness: () => fixture.readiness(), paymentRequirements: r => fixture.paymentRequirements(r), verify: (header, r) => fixture.verify(header, r) };
    h.gw.core.deps.fundingAdapters.set('solana', second);
    const q = await quote();
    expect(q.fundingOptions.map((o: any) => o.rail)).toEqual(['cardano', 'solana']);
    expect(new Set(q.fundingOptions.map((o: any) => o.fundingOptionId)).size).toBe(2);
  });
  it('refuses missing/foreign option IDs, freezes selected option and records approval', async () => {
    const q = await quote(), other = await quote();
    const request = { quoteId: q.quoteId, approval: { maxTotal: q.payablePrincipal, quoteDigest: q.digest } };
    const buy = (body: unknown) => h.call('POST', '/v1/purchases', { ...auth(), headers: { 'idempotency-key': 'explicit-funding-choice' }, body });
    expect((await buy(request)).status).toBe(400);
    expect((await buy({ ...request, approval: { ...request.approval, selectedFundingOptionId: other.fundingOptions[0].fundingOptionId } })).status).toBe(400);
    const body = { ...request, approval: { ...request.approval, selectedFundingOptionId: q.fundingOptions[0].fundingOptionId } };
    const result = await buy(body);
    expect(result.status).toBe(201);
    expect(result.body.purchase.fundingRequirement).toEqual(q.fundingOptions[0]);
    expect((await buy(body)).body.purchase.purchaseId).toBe(result.body.purchase.purchaseId);
    const persisted = await h.gw.db.get<{ approval_json: string }>('SELECT approval_json FROM purchases WHERE id=$1', result.body.purchase.purchaseId);
    expect(JSON.parse(persisted!.approval_json)).toEqual(body.approval);
    const events = await h.call('GET', `/v1/purchases/${result.body.purchase.purchaseId}/events`, auth());
    expect(events.body.events.find((e: any) => e.type === 'approval.recorded').data.selectedFundingOptionId).toBe(body.approval.selectedFundingOptionId);
    h.funding.readinessStatus = 'ACCESS_BLOCKED';
    const lookup = await h.call('GET', `/v1/quotes/${q.quoteId}/purchase`, auth());
    expect(lookup.body.purchase.purchaseId).toBe(result.body.purchase.purchaseId);
    expect((await h.call('GET', `/v1/quotes/${q.quoteId}/purchase`, { token: h.bob.token })).status).toBe(404);
  });
  it('proof stops at pending payment and protects customer ownership/scopes/PII', async () => {
    const { purchase } = await createFundablePurchase(h);
    const path = `/v1/evidence/purchases/${purchase.purchaseId}/proof`;
    const result = await h.call('GET', path, auth());
    expect(result.status).toBe(200);
    const proof = PurchaseProof.parse(result.body.proof);
    expect(proof.timeline.map(s => s.status)).toEqual(['complete', 'complete', 'complete', 'current', 'pending', 'pending']);
    expect(proof.funding.transfers).toEqual([]);
    expect(proof.merchant.providerReference).toBeNull();
    expect(proof.receipt).toBeNull();
    expect(JSON.stringify(proof)).not.toMatch(/buyer@example|Demo Buyer|address1|fulfillment|checkpoint|treasuryEffect|details_json|executionRef/);
    expect((await h.call('GET', path, { token: h.bob.token })).status).toBe(404);
    expect((await h.call('GET', path)).status).toBe(401);
    const limited = await createClient(h.gw.db, { customerId: h.alice.customerId, displayName: 'Read only', channel: 'test', label: 'no-proof', scopes: ['purchases:read'] }, h.clock.now().toISOString());
    expect((await h.call('GET', path, { token: limited.token })).status).toBe(403);
  });
  it('completed proof shows durable receipt and exact 1:1000 quantities without treasury data', async () => {
    h.retail.price = { currency: 'USD', amountMinor: '18340', scale: 2 };
    const { purchase, required } = await createFundablePurchase(h, h.alice.token, 'proof-complete', '20000');
    await h.call('POST', `/v1/purchases/${purchase.purchaseId}/fund`, { ...auth(), headers: { 'payment-signature': `fixture:proof-transfer:${required}` } });
    await h.gw.worker.tick();
    const result = await h.call('GET', `/v1/evidence/purchases/${purchase.purchaseId}/proof`, auth());
    const proof = PurchaseProof.parse(result.body.proof);
    expect(proof.progress.stage).toBe('complete');
    expect(proof.timeline.every(s => s.status === 'complete')).toBe(true);
    expect(proof.funding.requirement.amount.amountBaseUnits).toBe('183400');
    expect(proof.funding.requirement.settlement?.commercialTotal.amountMinor).toBe('18340');
    expect(proof.funding.transfers[0]?.reference).toBe('proof-transfer');
    expect(proof.funding.sources[0]?.displayAddress).toMatch(/^addr_test1/);
    expect(proof.receipt?.evidenceRefs.length).toBeGreaterThan(0);
    expect(JSON.stringify(proof)).not.toContain('treasuryEffect');
  });
  it('unresolved proof visibly stops at verifying the merchant result', async () => {
    h.retail.behavior = 'unknown';
    const { purchase, required } = await createFundablePurchase(h);
    await h.call('POST', `/v1/purchases/${purchase.purchaseId}/fund`, { ...auth(), headers: { 'payment-signature': `fixture:pending-proof:${required}` } });
    await h.gw.worker.tick();
    const result = await h.call('GET', `/v1/evidence/purchases/${purchase.purchaseId}/proof`, auth());
    expect(result.body.proof.progress.stage).toBe('verifying_result');
    expect(result.body.proof.timeline.slice(-2).map((s: any) => s.status)).toEqual(['current', 'pending']);
    expect(result.body.proof.receipt).toBeNull();
  });
  it('projects every internal state without leading with technical status or recovery jargon', async () => {
    const { purchase } = await createFundablePurchase(h);
    const stages = { awaiting_funding: 'confirming_payment', funded_queued: 'purchasing', executing: 'purchasing', succeeded: 'verifying_result', failed: 'needs_attention', unresolved: 'verifying_result', requires_reauthorization: 'needs_attention', expired: 'needs_attention' } as const;
    for (const [state, stage] of Object.entries(stages)) {
      const progress = projectProgress({ ...purchase, state: state as typeof purchase.state, statusReason: 'retry budget exhausted; job dead' });
      expect(progress.stage).toBe(stage);
      expect(progress.message).not.toMatch(/state=|retry budget|job dead|buy again/i);
    }
    const submitted = projectProgress({ ...purchase, paymentState: 'submitted' });
    expect(submitted.nextAction).toBeNull();
    expect(submitted.paymentConfirmed).toBe(false);
    expect(projectProgress({ ...purchase, state: 'unresolved', commerceStatus: 'held', merchantPaymentStatus: 'pending' }).outcomeFinal).toBe(false);
  });
  it('serves a protected-data-free proof shell with CSP and external script', async () => {
    const response = await fetch(h.url + '/proof');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(await response.text()).toContain('Purchase proof');
  });
});
