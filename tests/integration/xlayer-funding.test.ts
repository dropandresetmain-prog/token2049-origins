import { afterEach, describe, it, expect } from 'vitest';
import { startHarness, createFundablePurchase, retailFulfillment, retailIntent, type Harness } from '../support/harness.js';
import { newTestSchema } from '../support/database.js';
import { xlayerScenario, xlayerClock, xlayerEnv } from '../support/xlayer.js';
import { createXLayerFundingAdapter } from '../../src/funding/xlayer/adapter.js';
import { bindingMessage, encodeCandidate } from '../../src/funding/xlayer/wire.js';
import type { FundingRequirementInput } from '../../src/contracts/ports.js';
import { money } from '../../src/contracts/money.js';
import { Accounts, accountBalance, cryptoAsset, trialBalance } from '../../src/core/journal.js';
import { FixtureFundingAdapter } from '../support/fixtures.js';

const START = '2026-10-08T00:00:00Z';
const settlementPolicy = { mode: 'scaled_testnet', numerator: 1, denominator: 1000 } as const;
async function storedInput(h: Harness, id: string): Promise<FundingRequirementInput> {
  const p = (await h.gw.db.get<{ quote_id: string; funding_requirement_json: string }>('SELECT * FROM purchases WHERE id=$1', id))!;
  const r = JSON.parse(p.funding_requirement_json);
  return { purchaseId: id, quoteId: p.quote_id, quoteDigest: r.quoteDigest, resourceUrl: r.resourceUrl,
    expiresAt: r.expiresAt, description: 'test', payTo: r.payTo,
    amount: { network: r.network, assetId: r.assetId, decimals: r.decimals, amountBaseUnits: r.amountBaseUnits }, settlement: r.settlement };
}
const count = async (h: Harness, sql: string, id: string) => (await h.gw.db.get<{ n: number }>(sql, id))!.n;
const evidenceCount = (h: Harness, id: string) => count(h, 'SELECT COUNT(*)::int AS n FROM funding_evidence WHERE purchase_id=$1', id);
const saved = async (h: Harness, id: string) => (await h.gw.db.get<{ transfer_reference: string; recovery_payload_json: string }>(
  'SELECT transfer_reference,recovery_payload_json FROM funding_attempts WHERE purchase_id=$1', id))!;

describe('X Layer adapter with a fake chain and real HTTP/core/PostgreSQL', () => {
  afterEach(() => xlayerClock.set(START));

  it('binds the purchase to the explicitly selected X Layer option when another rail is available', async () => {
    xlayerClock.set(START);
    const h = await startHarness({ clock: xlayerClock, settlementPolicy });
    try {
      h.retail.price = money('USD', 100n);
      const x = await xlayerScenario(); h.gw.core.deps.fundingAdapters.set('xlayer', x.adapter);
      const search = await h.call('POST', '/v1/offers/search', { token: h.alice.token, body: { intent: retailIntent() } });
      const quoteResponse = await h.call('POST', '/v1/quotes', { token: h.alice.token, body: { offerId: search.body.offers[0].offerId, fulfillment: retailFulfillment } });
      expect(quoteResponse.status).toBe(201);
      const quote = quoteResponse.body.quote;
      expect(quote.fundingOptions.map((o: { rail: string }) => o.rail)).toEqual(['cardano', 'xlayer']);
      const selected = quote.fundingOptions.find((o: { rail: string }) => o.rail === 'xlayer')!;
      // Same 1:1000 scaling as Sui: USD 1.00 (100 cents) -> 0.001 test token (6 decimals).
      expect(selected.amount).toMatchObject({ network: 'eip155:1952', assetId: '0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c', decimals: 6, amountBaseUnits: '1000' });
      const purchase = await h.call('POST', '/v1/purchases', { token: h.alice.token, headers: { 'idempotency-key': 'xlayer-explicit-selection' },
        body: { quoteId: quote.quoteId, approval: { maxTotal: quote.payablePrincipal, quoteDigest: quote.digest, selectedFundingOptionId: selected.fundingOptionId } } });
      expect(purchase.status).toBe(201);
      expect(purchase.body.purchase.fundingRequirement).toEqual(selected);
      const persisted = await h.gw.db.get<{ funding_rail: string }>('SELECT funding_rail FROM purchases WHERE id=$1', purchase.body.purchase.purchaseId);
      expect(persisted!.funding_rail).toBe('xlayer');
      expect(h.funding).toBeInstanceOf(FixtureFundingAdapter);
    } finally { await h.close(); }
  });

  it('a confirmed transfer funds once, runs the merchant once, and exposes receipt proof; repeats change nothing', async () => {
    xlayerClock.set(START);
    const initial = await xlayerScenario();
    const h = await startHarness({ clock: xlayerClock, settlementPolicy });
    try {
      h.retail.price = money('USD', 100n); h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('xlayer', initial.adapter);
      const p = await createFundablePurchase(h), id = p.purchase.purchaseId, token = h.alice.token, input = await storedInput(h, id);
      expect(p.purchase.fundingInstructions.protocol).toBe('xlayer-usdt0-transfer');
      const challenge = await h.call('POST', `/v1/purchases/${id}/fund`, { token });
      expect(challenge.status).toBe(402);
      expect(challenge.body).toMatchObject({ protocol: 'xlayer-usdt0-transfer', paymentHeader: 'xlayer-payment', onChainPurchaseCommitment: false });
      const s = await xlayerScenario(input); h.gw.core.deps.fundingAdapters.set('xlayer', s.adapter);
      // Two concurrent identical requests: one broadcast, one funding record.
      const send = () => h.call('POST', `/v1/purchases/${id}/fund`, { token, headers: { 'xlayer-payment': s.candidate.header } });
      const [a, b] = await Promise.all([send(), send()]);
      expect([a.status, b.status].filter(x => x === 202 || x === 200)).not.toHaveLength(0);
      expect(s.rpc.sent).toHaveLength(1);
      await h.gw.worker.tick(); await h.gw.worker.tick();
      const view = await h.call('GET', `/v1/purchases/${id}`, { token });
      expect(view.body.purchase.state).toBe('succeeded'); expect(h.retail.executeCalls).toBe(1);
      expect(await evidenceCount(h, id)).toBe(1);
      expect(view.body.purchase.receipt.funding[0]).toMatchObject({ transferReference: s.candidate.hash });
      expect(view.body.purchase.receipt.fundingRequirement.rail).toBe('xlayer');
      const details = JSON.parse((await h.gw.db.get<{ details_json: string }>('SELECT details_json FROM funding_evidence WHERE purchase_id=$1', id))!.details_json);
      expect(details).toMatchObject({ chainId: 1952, txHash: s.candidate.hash, tokenContract: '0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c', onChainPurchaseCommitment: false });
      // Repeat requests after funding never broadcast, fund or execute again.
      await send(); await h.gw.worker.tick();
      expect(s.rpc.sent).toHaveLength(1); expect(await evidenceCount(h, id)).toBe(1); expect(h.retail.executeCalls).toBe(1);
      expect(await count(h, "SELECT COUNT(*)::int AS n FROM journal_entries WHERE purchase_id=$1 AND kind='funding_received'", id)).toBe(1);
      for (const sum of (await trialBalance(h.gw.db)).values()) expect(sum).toBe(0n);
    } finally { await h.close(); }
  });

  it('resumes the exact persisted candidate once after process loss before verification', async () => {
    xlayerClock.set(START);
    const initial = await xlayerScenario(), schema = newTestSchema();
    let h = await startHarness({ schema, clock: xlayerClock, settlementPolicy });
    try {
      h.retail.price = money('USD', 100n); h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('xlayer', initial.adapter);
      const p = await createFundablePurchase(h), id = p.purchase.purchaseId, token = h.alice.token, input = await storedInput(h, id);
      const s = await xlayerScenario(input); h.gw.core.deps.fundingAdapters.set('xlayer', s.adapter);
      s.adapter.verify = async () => {
        expect(await h.gw.db.get('SELECT id FROM funding_attempts WHERE purchase_id=$1', id)).toBeDefined();
        throw new Error('process loss after candidate persistence before verification');
      };
      const send = () => h.call('POST', `/v1/purchases/${id}/fund`, { token, headers: { 'xlayer-payment': s.candidate.header } });
      const responses = await Promise.all([send(), send()]);
      expect(responses.map(r => r.status).sort()).toEqual([409, 500]); expect(s.rpc.sent).toHaveLength(0);
      expect(await evidenceCount(h, id)).toBe(0);
      const row = await saved(h, id), savedHeader = JSON.parse(row.recovery_payload_json).header as string;
      expect(savedHeader).toBe(s.candidate.header); expect(row.transfer_reference).toBe(s.candidate.hash);
      expect(JSON.parse(Buffer.from(savedHeader, 'base64').toString('utf8')).rawTransaction).toBe(s.candidate.raw);

      await h.close(); await h.gw.db.close(); h = await startHarness({ schema, clock: xlayerClock });
      const restarted = createXLayerFundingAdapter(xlayerEnv, { clock: xlayerClock, rpc: s.rpc, sleep: async () => {}, pollAttempts: 3, pollIntervalMs: 0 });
      h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('xlayer', restarted);
      expect(await restarted.recover(row.transfer_reference, input)).toMatchObject({ ok: false, code: 'payment_required' });
      expect(s.rpc.sent).toHaveLength(0); // recovery is read-only; resume owns the same-candidate retry.
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      await h.gw.worker.tick(); await h.gw.worker.tick();
      const view = await h.call('GET', `/v1/purchases/${id}`, { token });
      expect(view.body.purchase.state).toBe('succeeded');
      expect(h.retail.executeCalls).toBe(1); expect(s.rpc.sent).toEqual([s.candidate.raw]);
      expect(await evidenceCount(h, id)).toBe(1);
      expect(await saved(h, id)).toEqual(row);
      expect(view.body.purchase.receipt.funding[0].transferReference).toBe(s.candidate.hash);
    } finally { await h.close(); }
  });

  it('recovers accepted chain evidence after restart without broadcasting twice', async () => {
    xlayerClock.set(START);
    const initial = await xlayerScenario(), schema = newTestSchema();
    let h = await startHarness({ schema, clock: xlayerClock, settlementPolicy });
    try {
      h.retail.price = money('USD', 100n); h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('xlayer', initial.adapter);
      const p = await createFundablePurchase(h), id = p.purchase.purchaseId, token = h.alice.token, input = await storedInput(h, id);
      const s = await xlayerScenario(input); h.gw.core.deps.fundingAdapters.set('xlayer', s.adapter);
      const verifyBeforeLoss = s.adapter.verify.bind(s.adapter);
      s.adapter.verify = async (header, requirement) => {
        expect(await verifyBeforeLoss(header, requirement)).toMatchObject({ ok: true });
        throw new Error('process loss after chain acceptance before funding recording');
      };
      const send = () => h.call('POST', `/v1/purchases/${id}/fund`, { token, headers: { 'xlayer-payment': s.candidate.header } });
      const responses = await Promise.all([send(), send()]);
      expect(responses.map(r => r.status).sort()).toEqual([409, 500]); expect(s.rpc.sent).toHaveLength(1);
      expect(await evidenceCount(h, id)).toBe(0);
      const row = await saved(h, id);

      await h.close(); await h.gw.db.close(); h = await startHarness({ schema, clock: xlayerClock });
      const restarted = createXLayerFundingAdapter(xlayerEnv, { clock: xlayerClock, rpc: s.rpc, sleep: async () => {} });
      h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('xlayer', restarted);
      expect(await restarted.recover(row.transfer_reference, input)).toMatchObject({ ok: true });
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      await h.gw.worker.tick(); await h.gw.worker.tick();
      const view = await h.call('GET', `/v1/purchases/${id}`, { token });
      expect(view.body.purchase.state).toBe('succeeded'); expect(h.retail.executeCalls).toBe(1);
      expect(s.rpc.sent).toHaveLength(1); expect(await evidenceCount(h, id)).toBe(1);
      expect(await saved(h, id)).toEqual(row);
    } finally { await h.close(); }
  });

  it('records late confirmation once as unapplied funding after expiry and never runs the merchant', async () => {
    xlayerClock.set(START);
    const initial = await xlayerScenario(), schema = newTestSchema();
    let h = await startHarness({ schema, clock: xlayerClock, settlementPolicy });
    try {
      h.retail.price = money('USD', 100n); h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('xlayer', initial.adapter);
      const p = await createFundablePurchase(h), id = p.purchase.purchaseId, token = h.alice.token, input = await storedInput(h, id);
      const s = await xlayerScenario(input); s.rpc.sendEffect = 'mempool'; h.gw.core.deps.fundingAdapters.set('xlayer', s.adapter);
      const verifyBeforeLoss = s.adapter.verify.bind(s.adapter);
      s.adapter.verify = async (header, requirement) => {
        expect(await verifyBeforeLoss(header, requirement)).toMatchObject({ ok: false, code: 'payment_required' });
        throw new Error('process loss after broadcast while the transaction is unmined');
      };
      const send = () => h.call('POST', `/v1/purchases/${id}/fund`, { token, headers: { 'xlayer-payment': s.candidate.header } });
      const responses = await Promise.all([send(), send()]);
      expect(responses.map(r => r.status).sort()).toEqual([409, 500]); expect(s.rpc.sent).toHaveLength(1);
      const row = await saved(h, id);
      // Included inside the quote window but observable only after expiry.
      await s.rpc.include(s.candidate.raw, { timestampMs: Date.parse(input.expiresAt) - 1000 });
      xlayerClock.advance(3600000);
      await h.close(); await h.gw.db.close(); h = await startHarness({ schema, clock: xlayerClock });
      const restarted = createXLayerFundingAdapter(xlayerEnv, { clock: xlayerClock, rpc: s.rpc, sleep: async () => {} });
      h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('xlayer', restarted);
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      await h.gw.worker.tick(); await h.gw.worker.tick();
      const view = await h.call('GET', `/v1/purchases/${id}`, { token });
      expect(view.body.purchase.state).toBe('expired'); expect(view.body.purchase.paymentState).toBe('confirmed');
      expect(h.retail.executeCalls).toBe(0); expect(s.rpc.sent).toHaveLength(1);
      expect((await h.gw.db.get<{ status: string }>('SELECT status FROM reservations WHERE purchase_id=$1', id))!.status).toBe('released');
      expect(await evidenceCount(h, id)).toBe(1);
      expect(await accountBalance(h.gw.db, Accounts.customerUnapplied, cryptoAsset(input.amount.network, input.amount.assetId))).toBe(-BigInt(input.amount.amountBaseUnits));
      for (const sum of (await trialBalance(h.gw.db)).values()) expect(sum).toBe(0n);
      expect(await saved(h, id)).toEqual(row);
    } finally { await h.close(); xlayerClock.set(START); }
  });

  it('closes funding and releases capacity only after a confirmed revert', async () => {
    xlayerClock.set(START);
    const h = await startHarness({ clock: xlayerClock, settlementPolicy });
    try {
      h.retail.price = money('USD', 100n);
      const initial = await xlayerScenario(); h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('xlayer', initial.adapter);
      const p = await createFundablePurchase(h), id = p.purchase.purchaseId, input = await storedInput(h, id);
      const s = await xlayerScenario(input, {}, (rpc, c) => rpc.include(c.raw, { status: 'reverted' }));
      h.gw.core.deps.fundingAdapters.set('xlayer', s.adapter);
      const response = await h.call('POST', `/v1/purchases/${id}/fund`, { token: h.alice.token, headers: { 'xlayer-payment': s.candidate.header } });
      expect(response.status).toBe(402);
      expect(await h.gw.db.get('SELECT state,payment_state FROM purchases WHERE id=$1', id)).toEqual({ state: 'failed', payment_state: 'invalid' });
      expect((await h.gw.db.get<{ status: string }>('SELECT status FROM funding_attempts WHERE purchase_id=$1', id))!.status).toBe('failed');
      expect((await h.gw.db.get<{ status: string }>('SELECT status FROM reservations WHERE purchase_id=$1', id))!.status).toBe('released');
      expect(await evidenceCount(h, id)).toBe(0); expect(h.retail.executeCalls).toBe(0); expect(s.rpc.sent).toHaveLength(0);
    } finally { await h.close(); }
  });

  it('closes funding when the signed nonce was consumed by another transaction, without paying', async () => {
    xlayerClock.set(START);
    const h = await startHarness({ clock: xlayerClock, settlementPolicy });
    try {
      h.retail.price = money('USD', 100n);
      const initial = await xlayerScenario(); h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('xlayer', initial.adapter);
      const p = await createFundablePurchase(h), id = p.purchase.purchaseId, input = await storedInput(h, id);
      const s = await xlayerScenario(input, {}, (rpc, c) => { rpc.consumeNonce(c.payer, rpc.height - 5n); rpc.setNonceBase(c.payer, c.nonce); });
      h.gw.core.deps.fundingAdapters.set('xlayer', s.adapter);
      const response = await h.call('POST', `/v1/purchases/${id}/fund`, { token: h.alice.token, headers: { 'xlayer-payment': s.candidate.header } });
      expect(response.status).toBe(402);
      expect(await h.gw.db.get('SELECT state,payment_state FROM purchases WHERE id=$1', id)).toEqual({ state: 'failed', payment_state: 'invalid' });
      expect(s.rpc.sent).toHaveLength(0); expect(await evidenceCount(h, id)).toBe(0); expect(h.retail.executeCalls).toBe(0);
    } finally { await h.close(); }
  });

  it('retains an ambiguous broadcast, never rebroadcasts, and rejects a signed replay into a second purchase', async () => {
    xlayerClock.set(START);
    const h = await startHarness({ clock: xlayerClock, settlementPolicy });
    try {
      h.retail.price = money('USD', 100n); const initial = await xlayerScenario();
      h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('xlayer', initial.adapter);
      const p = await createFundablePurchase(h), id = p.purchase.purchaseId, input = await storedInput(h, id);
      const s = await xlayerScenario(input); h.gw.core.deps.fundingAdapters.set('xlayer', s.adapter);
      s.rpc.sendEffect = 'drop'; s.rpc.sendThrows = true; // node times out and the transaction is not (yet) visible
      const ambiguous = await h.call('POST', `/v1/purchases/${id}/fund`, { token: h.alice.token, headers: { 'xlayer-payment': s.candidate.header } });
      expect(ambiguous.status).toBe(202); expect(ambiguous.body.confirmationPending).toBe(true);
      expect(await h.gw.db.get('SELECT state,payment_state FROM purchases WHERE id=$1', id)).toEqual({ state: 'awaiting_funding', payment_state: 'unknown' });
      expect(await h.gw.db.get("SELECT id FROM purchase_events WHERE purchase_id=$1 AND type='funding.rejected'", id)).toBeUndefined();
      expect((await h.gw.db.get<{ status: string }>('SELECT status FROM funding_attempts WHERE purchase_id=$1', id))!.status).toBe('pending');
      expect((await h.call('POST', `/v1/purchases/${id}/fund`, { token: h.alice.token, headers: { 'xlayer-payment': s.candidate.header } })).status).toBe(409);
      expect(h.retail.executeCalls).toBe(0);
      // The first broadcast actually landed. Recovery observes it and does not send again.
      const sentBefore = s.rpc.sent.length;
      await s.rpc.include(s.candidate.raw);
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      await h.gw.worker.tick(); await h.gw.worker.tick();
      expect(s.rpc.sent).toHaveLength(sentBefore); expect(h.retail.executeCalls).toBe(1);
      // A fresh binding signature over the same on-chain transaction cannot fund a second purchase.
      const second = await createFundablePurchase(h), secondInput = await storedInput(h, second.purchase.purchaseId);
      const binding = await s.candidate.account.signMessage({ message: bindingMessage(secondInput, s.candidate.hash) });
      const replay = encodeCandidate({ ...s.candidate.candidate, bindingSignature: binding });
      expect((await h.call('POST', `/v1/purchases/${secondInput.purchaseId}/fund`, { token: h.alice.token, headers: { 'xlayer-payment': replay } })).status).toBe(409);
      expect(s.rpc.sent).toHaveLength(sentBefore); expect(h.retail.executeCalls).toBe(1);
    } finally { await h.close(); }
  });
});
