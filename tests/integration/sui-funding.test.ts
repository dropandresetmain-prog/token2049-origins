import { afterEach, describe, it, expect } from 'vitest';
import { startHarness, createFundablePurchase, retailFulfillment, retailIntent, type Harness } from '../support/harness.js';
import { newTestSchema } from '../support/database.js';
import { suiScenario, suiClock, suiEnv } from '../support/sui.js';
import { createSuiFundingAdapter } from '../../src/funding/sui/adapter.js';
import { bindingMessage, encodeCandidate } from '../../src/funding/sui/wire.js';
import type { FundingRequirementInput } from '../../src/contracts/ports.js';
import { money } from '../../src/contracts/money.js';
import type { ChainTransaction } from '../../src/funding/sui/rpc.js';
import { Accounts, accountBalance, cryptoAsset, trialBalance } from '../../src/core/journal.js';
import { FixtureFundingAdapter } from '../support/fixtures.js';

async function storedInput(h: Harness, id: string): Promise<FundingRequirementInput> {
  const p = (await h.gw.db.get<{ quote_id: string; funding_requirement_json: string }>('SELECT * FROM purchases WHERE id=$1', id))!;
  const r = JSON.parse(p.funding_requirement_json);
  return { purchaseId: id, quoteId: p.quote_id, quoteDigest: r.quoteDigest, resourceUrl: r.resourceUrl,
    expiresAt: r.expiresAt, description: 'test', payTo: r.payTo,
    amount: { network: r.network, assetId: r.assetId, decimals: r.decimals, amountBaseUnits: r.amountBaseUnits }, settlement: r.settlement };
}
describe('Sui adapter with mocked chain and real HTTP/core/PostgreSQL', () => {
  afterEach(() => suiClock.set('2026-10-08T00:00:00Z'));

  it('binds the purchase to the explicitly selected Sui option when another rail is available', async () => {
    suiClock.set('2026-10-08T00:00:00Z');
    const h = await startHarness({ clock: suiClock, settlementPolicy: { mode: 'scaled_testnet', numerator: 1, denominator: 1000 } });
    try {
      h.retail.price = money('USD', 100n);
      const sui = await suiScenario(); h.gw.core.deps.fundingAdapters.set('sui', sui.adapter);
      const search = await h.call('POST', '/v1/offers/search', { token: h.alice.token, body: { intent: retailIntent() } });
      expect(search.status).toBe(200);
      const quoteResponse = await h.call('POST', '/v1/quotes', { token: h.alice.token, body: {
        offerId: search.body.offers[0].offerId,
        fulfillment: retailFulfillment,
      } });
      expect(quoteResponse.status).toBe(201);
      const quote = quoteResponse.body.quote;
      expect(quote.fundingOptions.map((option: { rail: string }) => option.rail)).toEqual(['cardano', 'sui']);
      const selected = quote.fundingOptions.find((option: { rail: string }) => option.rail === 'sui')!;
      const purchase = await h.call('POST', '/v1/purchases', { token: h.alice.token,
        headers: { 'idempotency-key': 'sui-explicit-selection' }, body: { quoteId: quote.quoteId,
          approval: { maxTotal: quote.payablePrincipal, quoteDigest: quote.digest, selectedFundingOptionId: selected.fundingOptionId } },
      });
      expect(purchase.status).toBe(201);
      expect(purchase.body.purchase.fundingRequirement).toEqual(selected);
      const persisted = await h.gw.db.get<{ funding_rail: string; funding_requirement_json: string }>(
        'SELECT funding_rail,funding_requirement_json FROM purchases WHERE id=$1', purchase.body.purchase.purchaseId);
      expect(persisted!.funding_rail).toBe('sui');
      expect(JSON.parse(persisted!.funding_requirement_json).fundingOptionId).toBe(selected.fundingOptionId);
      expect(h.funding).toBeInstanceOf(FixtureFundingAdapter);
    } finally { await h.close(); }
  });

  it('resumes the exact persisted candidate once after process loss before verification', async () => {
    suiClock.set('2026-10-08T00:00:00Z');
    const initial = await suiScenario(), schema = newTestSchema();
    let h = await startHarness({ schema, clock: suiClock, settlementPolicy: { mode: 'scaled_testnet', numerator: 1, denominator: 1000 } });
    try {
      h.retail.price = money('USD', 100n); h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('sui', initial.adapter);
      const p = await createFundablePurchase(h), id = p.purchase.purchaseId, token = h.alice.token, input = await storedInput(h, id);
      expect(p.quote.fundingOptions[0].rail).toBe('sui');
      expect(p.purchase.fundingInstructions.protocol).toBe('sui-usdc-transfer');
      const s = await suiScenario(input); h.gw.core.deps.fundingAdapters.set('sui', s.adapter);
      s.adapter.verify = async () => {
        expect(await h.gw.db.get('SELECT id FROM funding_attempts WHERE purchase_id=$1', id)).toBeDefined();
        throw new Error('process loss after candidate persistence before verification');
      };
      const send = () => h.call('POST', `/v1/purchases/${id}/fund`, { token, headers: { 'sui-payment': s.candidate.header } });
      const responses = await Promise.all([send(), send()]);
      expect(responses.map(r => r.status).sort()).toEqual([409, 500]); expect(s.counts().executed).toBe(0);
      expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM funding_evidence WHERE purchase_id=$1', id))!.n).toBe(0);
      const saved = (await h.gw.db.get<{ transfer_reference: string; recovery_payload_json: string }>(
        'SELECT transfer_reference,recovery_payload_json FROM funding_attempts WHERE purchase_id=$1', id))!;
      const savedHeader = JSON.parse(saved.recovery_payload_json).header as string;
      const savedCandidate = JSON.parse(Buffer.from(savedHeader, 'base64').toString('utf8')) as { digest: string; transaction: string };
      expect(savedHeader).toBe(s.candidate.header);
      expect(saved.transfer_reference).toBe(s.candidate.digest);
      expect(savedCandidate.digest).toBe(s.candidate.digest);
      expect(savedCandidate.transaction).toBe(Buffer.from(s.candidate.bytes).toString('base64'));

      await h.close(); await h.gw.db.close(); h = await startHarness({ schema, clock: suiClock });
      const restarted = createSuiFundingAdapter(suiEnv, { clock: suiClock, rpc: s.rpc });
      h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('sui', restarted);
      expect(await restarted.recover(saved.transfer_reference, input)).toMatchObject({ ok: false, code: 'payment_required' });
      expect(s.counts().executed).toBe(0); // recovery is read-only; resume owns the same-candidate retry.
      const verify = restarted.verify.bind(restarted), verifiedHeaders: string[] = [];
      restarted.verify = async (header, requirement) => { verifiedHeaders.push(header); return verify(header, requirement); };
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      await h.gw.worker.tick(); await h.gw.worker.tick();
      const view = await h.call('GET', `/v1/purchases/${id}`, { token });
      expect(view.body.purchase.state).toBe('succeeded');
      expect(h.retail.executeCalls).toBe(1); expect(s.counts().executed).toBe(1);
      expect(verifiedHeaders).toEqual([savedHeader]);
      expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM funding_evidence WHERE purchase_id=$1', id))!.n).toBe(1);
      const after = (await h.gw.db.get<{ recovery_payload_json: string; transfer_reference: string }>(
        'SELECT recovery_payload_json,transfer_reference FROM funding_attempts WHERE purchase_id=$1', id))!;
      expect(after).toEqual(saved);
      expect(view.body.purchase.receipt.funding[0].transferReference).toBe(s.candidate.digest);
      expect(view.body.purchase.receipt.fundingRequirement.rail).toBe('sui');
    } finally { await h.close(); }
  });

  it('recovers accepted chain evidence after restart without submitting or settling twice', async () => {
    suiClock.set('2026-10-08T00:00:00Z');
    const initial = await suiScenario(), schema = newTestSchema();
    let h = await startHarness({ schema, clock: suiClock, settlementPolicy: { mode: 'scaled_testnet', numerator: 1, denominator: 1000 } });
    try {
      h.retail.price = money('USD', 100n); h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('sui', initial.adapter);
      const p = await createFundablePurchase(h), id = p.purchase.purchaseId, token = h.alice.token, input = await storedInput(h, id);
      const s = await suiScenario(input); h.gw.core.deps.fundingAdapters.set('sui', s.adapter);
      const verifyBeforeLoss = s.adapter.verify.bind(s.adapter);
      s.adapter.verify = async (header, requirement) => {
        expect(await h.gw.db.get('SELECT id FROM funding_attempts WHERE purchase_id=$1', id)).toBeDefined();
        expect(await verifyBeforeLoss(header, requirement)).toMatchObject({ ok: true });
        throw new Error('process loss after chain acceptance before funding recording');
      };
      const send = () => h.call('POST', `/v1/purchases/${id}/fund`, { token, headers: { 'sui-payment': s.candidate.header } });
      const responses = await Promise.all([send(), send()]);
      expect(responses.map(r => r.status).sort()).toEqual([409, 500]); expect(s.counts().executed).toBe(1);
      expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM funding_evidence WHERE purchase_id=$1', id))!.n).toBe(0);
      const saved = (await h.gw.db.get<{ transfer_reference: string; recovery_payload_json: string }>(
        'SELECT transfer_reference,recovery_payload_json FROM funding_attempts WHERE purchase_id=$1', id))!;
      const savedHeader = JSON.parse(saved.recovery_payload_json).header as string;
      const savedCandidate = JSON.parse(Buffer.from(savedHeader, 'base64').toString('utf8')) as { digest: string; transaction: string };
      expect(savedHeader).toBe(s.candidate.header); expect(saved.transfer_reference).toBe(s.candidate.digest);
      expect(savedCandidate.digest).toBe(s.candidate.digest);
      expect(savedCandidate.transaction).toBe(Buffer.from(s.candidate.bytes).toString('base64'));

      await h.close(); await h.gw.db.close(); h = await startHarness({ schema, clock: suiClock });
      const restarted = createSuiFundingAdapter(suiEnv, { clock: suiClock, rpc: s.rpc });
      h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('sui', restarted);
      expect(await restarted.recover(saved.transfer_reference, input)).toMatchObject({ ok: true });
      expect(s.counts().executed).toBe(1); // Chain inspection finds acceptance without resubmitting.
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      await h.gw.worker.tick(); await h.gw.worker.tick();
      const view = await h.call('GET', `/v1/purchases/${id}`, { token });
      expect(view.body.purchase.state).toBe('succeeded'); expect(h.retail.executeCalls).toBe(1);
      expect(s.counts().executed).toBe(1);
      expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM funding_evidence WHERE purchase_id=$1', id))!.n).toBe(1);
      const after = (await h.gw.db.get<{ recovery_payload_json: string; transfer_reference: string }>(
        'SELECT recovery_payload_json,transfer_reference FROM funding_attempts WHERE purchase_id=$1', id))!;
      expect(after).toEqual(saved);
      expect(view.body.purchase.receipt.funding[0].transferReference).toBe(s.candidate.digest);
    } finally { await h.close(); }
  });

  it('records late finalized confirmation once as unapplied funding after expiry', async () => {
    suiClock.set('2026-10-08T00:00:00Z');
    const initial = await suiScenario(), schema = newTestSchema();
    let h = await startHarness({ schema, clock: suiClock, settlementPolicy: { mode: 'scaled_testnet', numerator: 1, denominator: 1000 } });
    try {
      h.retail.price = money('USD', 100n); h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('sui', initial.adapter);
      const p = await createFundablePurchase(h), id = p.purchase.purchaseId, token = h.alice.token, input = await storedInput(h, id);
      const s = await suiScenario(input, { missingCheckpoint: true }); h.gw.core.deps.fundingAdapters.set('sui', s.adapter);
      const verifyBeforeLoss = s.adapter.verify.bind(s.adapter);
      s.adapter.verify = async (header, requirement) => {
        expect(await h.gw.db.get('SELECT id FROM funding_attempts WHERE purchase_id=$1', id)).toBeDefined();
        expect(await verifyBeforeLoss(header, requirement)).toMatchObject({ ok: false, code: 'payment_required' });
        throw new Error('process loss after submission while finality is unavailable');
      };
      const send = () => h.call('POST', `/v1/purchases/${id}/fund`, { token, headers: { 'sui-payment': s.candidate.header } });
      const responses = await Promise.all([send(), send()]);
      expect(responses.map(r => r.status).sort()).toEqual([409, 500]); expect(s.counts().executed).toBe(1);
      expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM funding_evidence WHERE purchase_id=$1', id))!.n).toBe(0);
      const saved = (await h.gw.db.get<{ transfer_reference: string; recovery_payload_json: string }>(
        'SELECT transfer_reference,recovery_payload_json FROM funding_attempts WHERE purchase_id=$1', id))!;

      // The transaction is valid within the original quote window but becomes observable only after expiry.
      s.setOptions({ missingCheckpoint: false, receivedAtMs: Date.parse(input.expiresAt) - 1000 });
      suiClock.advance(3600000);
      await h.close(); await h.gw.db.close(); h = await startHarness({ schema, clock: suiClock });
      const restarted = createSuiFundingAdapter(suiEnv, { clock: suiClock, rpc: s.rpc });
      h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('sui', restarted);
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      await h.gw.worker.tick(); await h.gw.worker.tick();

      const view = await h.call('GET', `/v1/purchases/${id}`, { token });
      expect(view.body.purchase.state).toBe('expired'); expect(view.body.purchase.paymentState).toBe('confirmed');
      expect(h.retail.executeCalls).toBe(0); expect(s.counts().executed).toBe(1);
      expect((await h.gw.db.get<{ status: string }>('SELECT status FROM reservations WHERE purchase_id=$1', id))!.status).toBe('released');
      expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM funding_evidence WHERE purchase_id=$1', id))!.n).toBe(1);
      expect((await h.gw.db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM journal_entries WHERE purchase_id=$1 AND kind='funding_received'", id))!.n).toBe(1);
      expect(await accountBalance(h.gw.db, Accounts.customerUnapplied, cryptoAsset(input.amount.network, input.amount.assetId))).toBe(-1000n);
      for (const sum of (await trialBalance(h.gw.db)).values()) expect(sum).toBe(0n);
      const after = (await h.gw.db.get<{ recovery_payload_json: string; transfer_reference: string }>(
        'SELECT recovery_payload_json,transfer_reference FROM funding_attempts WHERE purchase_id=$1', id))!;
      expect(after).toEqual(saved);
    } finally { await h.close(); suiClock.set('2026-10-08T00:00:00Z'); }
  });

  it('closes funding and releases capacity only after a matching finalized failure', async () => {
    suiClock.set('2026-10-08T00:00:00Z');
    const h = await startHarness({ clock: suiClock, settlementPolicy: { mode: 'scaled_testnet', numerator: 1, denominator: 1000 } });
    try {
      h.retail.price = money('USD', 100n);
      const initial = await suiScenario();
      h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('sui', initial.adapter);
      const p = await createFundablePurchase(h), id = p.purchase.purchaseId, input = await storedInput(h, id);
      const s = await suiScenario(input);
      s.setOptions({ missingTransaction: false });
      s.setRecord({ digest: s.candidate.digest, bcs: s.candidate.bytes, checkpoint: '2', timestampMs: suiClock.now().getTime(),
        balanceChanges: [], status: { success: false } } as unknown as ChainTransaction);
      h.gw.core.deps.fundingAdapters.set('sui', s.adapter);

      const response = await h.call('POST', `/v1/purchases/${id}/fund`, { token: h.alice.token, headers: { 'sui-payment': s.candidate.header } });
      expect(response.status).toBe(402);
      const purchase = (await h.gw.db.get<{ state: string; payment_state: string }>('SELECT state,payment_state FROM purchases WHERE id=$1', id))!;
      expect(purchase).toEqual({ state: 'failed', payment_state: 'invalid' });
      expect((await h.gw.db.get<{ status: string }>('SELECT status FROM funding_attempts WHERE purchase_id=$1', id))!.status).toBe('failed');
      expect((await h.gw.db.get<{ status: string }>('SELECT status FROM reservations WHERE purchase_id=$1', id))!.status).toBe('released');
      expect(await h.gw.db.get("SELECT id FROM purchase_events WHERE purchase_id=$1 AND type='funding.failed_finalized'", id)).toBeDefined();
      expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM funding_evidence WHERE purchase_id=$1', id))!.n).toBe(0);
      expect(h.retail.executeCalls).toBe(0);
    } finally { await h.close(); }
  });
  it('retains ambiguous submission and rejects a signed replay into a second purchase', async () => {
    const h = await startHarness({ clock: suiClock, settlementPolicy: { mode: 'scaled_testnet', numerator: 1, denominator: 1000 } });
    try {
      h.retail.price = money('USD', 100n); const initial = await suiScenario();
      h.gw.core.deps.fundingAdapters.clear(); h.gw.core.deps.fundingAdapters.set('sui', initial.adapter);
      const p = await createFundablePurchase(h), id = p.purchase.purchaseId, input = await storedInput(h, id);
      const s = await suiScenario(input, { throwExecute: true }); h.gw.core.deps.fundingAdapters.set('sui', s.adapter);
      expect((await h.call('POST', `/v1/purchases/${id}/fund`, { token: h.alice.token, headers: { 'sui-payment': s.candidate.header } })).status).toBe(402);
      expect((await h.call('POST', `/v1/purchases/${id}/fund`, { token: h.alice.token, headers: { 'sui-payment': s.candidate.header } })).status).toBe(409);
      expect(s.counts().executed).toBe(1); expect(h.retail.executeCalls).toBe(0);
      s.setOptions({ throwExecute: false, missingTransaction: false }); expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      await h.gw.worker.tick(); await h.gw.worker.tick(); expect(h.retail.executeCalls).toBe(1);
      const second = await createFundablePurchase(h), secondInput = await storedInput(h, second.purchase.purchaseId);
      const binding = await s.candidate.keypair.signPersonalMessage(bindingMessage(secondInput, s.candidate.digest));
      const replay = encodeCandidate({ ...s.candidate.candidate, bindingSignature: binding.signature });
      expect((await h.call('POST', `/v1/purchases/${secondInput.purchaseId}/fund`, { token: h.alice.token, headers: { 'sui-payment': replay } })).status).toBe(409);
      expect(s.counts().executed).toBe(1); expect(h.retail.executeCalls).toBe(1);
    } finally { await h.close(); }
  });
});
