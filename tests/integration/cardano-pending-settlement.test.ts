/**
 * Gateway/core contract for the Cardano adapter's uncertain-settlement result
 * ({ ok:false, code:'payment_required', settlementAttempted:true }, locked by tests/unit/cardano-adapter.test.ts):
 * the purchase stays confirmation-pending with the ORIGINAL durable candidate; a repeat POST never reaches settlement;
 * independent recovery of the same transaction produces exactly one funding effect and one merchant execution.
 * Runs against disposable native PostgreSQL (restart = a second gateway on the same schema).
 */
import { describe, expect, it } from 'vitest';
import { newTestSchema } from '../support/database.js';
import { startHarness, createFundablePurchase, type Harness } from '../support/harness.js';
import type { FundingVerification, VerifiedFunding } from '../../src/contracts/ports.js';
import { Accounts, accountBalance, cryptoAsset, trialBalance } from '../../src/core/journal.js';
import { FIXTURE_ASSET, FIXTURE_NETWORK } from '../support/fixtures.js';
import { ManualClock } from '../../src/infrastructure/clock.js';

const asset = cryptoAsset(FIXTURE_NETWORK, FIXTURE_ASSET);
const TX = 'tx-cardano-pending-0001';
const PENDING: FundingVerification = { ok: false, code: 'payment_required', reason: 'Cardano settlement outcome retained for independent recovery', settlementAttempted: true };

const fund = (h: Harness, id: string, amount: string, ref = TX) =>
  h.call('POST', `/v1/purchases/${id}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:${ref}:${amount}:confirmed` } });
const row = async (h: Harness, id: string) => (await h.gw.db.get<{ state: string; payment_state: string }>('SELECT state,payment_state FROM purchases WHERE id=$1', id))!;
const count = async (h: Harness, sql: string, ...args: string[]) => (await h.gw.db.get<{ n: number }>(sql, ...args))!.n;
async function balanced(h: Harness) { for (const v of (await trialBalance(h.gw.db)).values()) expect(v).toBe(0n); }

/** Make the fixture rail behave like the real adapter: prepare binds the tx identity; verify settles but cannot observe the outcome. */
function uncertain(h: Harness, confirmed: () => VerifiedFunding | undefined) {
  Object.assign(h.funding, {
    prepare: (header: string) => ({ ok: true, transferReference: header.split(':')[1]! }),
    recover: async () => { const funding = confirmed(); return funding ? { ok: true, funding } : { ok: false, code: 'payment_invalid', reason: 'recovery_pending: transfer is not independently observable' }; },
  });
  h.funding.verify = async () => { h.funding.verifyCalls++; return PENDING; };
}
async function confirmedFunding(h: Harness, amount: string): Promise<VerifiedFunding> {
  const calls = h.funding.verifyCalls;
  const ok = await Object.getPrototypeOf(h.funding).verify.call(h.funding, `fixture:${TX}:${amount}:confirmed`, {
    purchaseId: 'x', quoteId: 'x', quoteDigest: 'x', amount: { network: FIXTURE_NETWORK, assetId: FIXTURE_ASSET, decimals: 6, amountBaseUnits: amount },
    payTo: 'addr_test1fixturetreasury', resourceUrl: 'x', description: 'x', expiresAt: new Date(h.clock.now().getTime() + 3_600_000).toISOString(),
  }) as Extract<FundingVerification, { ok: true }>;
  h.funding.verifyCalls = calls; // building the fixture evidence is not a settlement call
  return ok.funding;
}

describe('Cardano uncertain settlement is confirmation-pending end to end (gateway + PostgreSQL)', () => {
  it('journals confirmation_pending (never funding.rejected), keeps the candidate, reservation and no evidence; repeat POST never settles again', async () => {
    const h = await startHarness();
    try {
      const a = await createFundablePurchase(h), id = a.purchase.purchaseId;
      uncertain(h, () => undefined);
      const first = await fund(h, id, a.required);
      expect(first.status).toBe(202);
      expect(first.body.confirmationPending).toBe(true);
      expect(first.body.purchase.fundingEvidence ?? first.body.purchase.funding ?? []).toHaveLength(0);
      expect(await row(h, id)).toEqual({ state: 'awaiting_funding', payment_state: 'unknown' });
      expect(await h.gw.db.get("SELECT id FROM purchase_events WHERE purchase_id=$1 AND type='funding.confirmation_pending'", id)).toBeDefined();
      expect(await h.gw.db.get("SELECT id FROM purchase_events WHERE purchase_id=$1 AND type='funding.rejected'", id)).toBeUndefined();
      // Original durable candidate and recovery obligation survive; authority/exposure stays reserved.
      expect(await h.gw.db.get<{ transfer_reference: string; status: string }>('SELECT transfer_reference,status FROM funding_attempts WHERE purchase_id=$1', id)).toEqual({ transfer_reference: TX, status: 'pending' });
      expect((await h.gw.db.get<{ status: string }>('SELECT status FROM reservations WHERE purchase_id=$1', id))!.status).toBe('active');
      expect(await count(h, "SELECT COUNT(*)::int n FROM jobs WHERE purchase_id=$1 AND kind='recover_funding' AND status IN ('pending','claimed')", id)).toBe(1);
      expect(await count(h, 'SELECT COUNT(*)::int n FROM funding_evidence WHERE purchase_id=$1', id)).toBe(0);
      expect(await count(h, "SELECT COUNT(*)::int n FROM journal_entries WHERE kind='funding_received'")).toBe(0);
      expect(h.retail.executeCalls).toBe(0);

      // A retry (same signed header, or a different one) is refused before any adapter work: no second settlement.
      expect((await fund(h, id, a.required)).status).toBe(409);
      expect((await fund(h, id, a.required, 'tx-another-candidate')).status).toBe(409);
      expect(h.funding.verifyCalls).toBe(1);
      expect(await h.gw.db.get<{ transfer_reference: string }>('SELECT transfer_reference FROM funding_attempts WHERE purchase_id=$1', id)).toEqual({ transfer_reference: TX });
      await balanced(h);
    } finally { await h.close(); await h.gw.db.close(); }
  });

  it('does not close the purchase while recovery still sees nothing, then the same tx confirms: one funding effect, one execution', async () => {
    const h = await startHarness();
    try {
      const a = await createFundablePurchase(h), id = a.purchase.purchaseId;
      let funding: VerifiedFunding | undefined;
      uncertain(h, () => funding);
      expect((await fund(h, id, a.required)).status).toBe(202);
      h.clock.advance(16_000); await h.gw.worker.tick();
      expect(await row(h, id)).toEqual({ state: 'awaiting_funding', payment_state: 'unknown' }); // still pending, not rejected
      expect(await count(h, 'SELECT COUNT(*)::int n FROM funding_evidence WHERE purchase_id=$1', id)).toBe(0);

      funding = await confirmedFunding(h, a.required);
      // Recovery can race itself and the original path: every call is idempotent on the transfer reference.
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);
      await h.gw.worker.tick(); await h.gw.worker.tick();
      expect((await row(h, id)).state).toBe('succeeded');
      expect(h.retail.executeCalls).toBe(1);
      expect(await count(h, 'SELECT COUNT(*)::int n FROM funding_evidence WHERE purchase_id=$1', id)).toBe(1);
      expect(await count(h, "SELECT COUNT(*)::int n FROM journal_entries WHERE kind='funding_received'")).toBe(1);
      expect(await accountBalance(h.gw.db, Accounts.cryptoTreasury, asset)).toBe(BigInt(a.required));
      expect(h.funding.verifyCalls).toBe(1); // settlement was invoked exactly once, ever
      await balanced(h);
    } finally { await h.close(); await h.gw.db.close(); }
  });

  it('survives a gateway restart: the same candidate is recovered from PostgreSQL and merchant execution happens once', async () => {
    const schema = newTestSchema(), clock = new ManualClock();
    let h = await startHarness({ schema, clock });
    try {
      const a = await createFundablePurchase(h), id = a.purchase.purchaseId;
      uncertain(h, () => undefined);
      expect((await fund(h, id, a.required)).status).toBe(202);
      const funding = await confirmedFunding(h, a.required);
      await h.close(); await h.gw.db.close();

      h = await startHarness({ schema, clock });
      Object.assign(h.funding, { recover: async (ref: string) => { expect(ref).toBe(TX); return { ok: true, funding }; } });
      expect(await row(h, id)).toEqual({ state: 'awaiting_funding', payment_state: 'unknown' });
      clock.advance(16_000); await h.gw.worker.tick(); await h.gw.worker.tick();
      expect((await row(h, id)).state).toBe('succeeded');
      expect(h.funding.verifyCalls).toBe(0); // the restarted gateway never settles; it only reads
      expect(h.retail.executeCalls).toBe(1);
      expect(await count(h, "SELECT COUNT(*)::int n FROM journal_entries WHERE kind='funding_received'")).toBe(1);
      await balanced(h);
    } finally { await h.close(); await h.gw.db.close(); }
  });

  it('two concurrent POSTs of the same signed payment settle at most once', async () => {
    const h = await startHarness();
    try {
      const a = await createFundablePurchase(h), id = a.purchase.purchaseId;
      uncertain(h, () => undefined);
      h.funding.verify = async () => { h.funding.verifyCalls++; await new Promise((r) => setTimeout(r, 150)); return PENDING; };
      const results = await Promise.all([fund(h, id, a.required), fund(h, id, a.required)]);
      expect(results.map((r) => r.status).sort()).toEqual([202, 409]);
      expect(h.funding.verifyCalls).toBe(1);
      expect(await count(h, 'SELECT COUNT(*)::int n FROM funding_attempts WHERE purchase_id=$1', id)).toBe(1);
    } finally { await h.close(); await h.gw.db.close(); }
  });

  it('keeps a genuine invalid payment (settlement never attempted) as a rejection that frees the attempt', async () => {
    const h = await startHarness();
    try {
      const a = await createFundablePurchase(h), id = a.purchase.purchaseId;
      uncertain(h, () => undefined);
      h.funding.verify = async () => ({ ok: false, code: 'payment_invalid', reason: 'facilitator rejected payment: verification_failed', settlementAttempted: false });
      expect((await fund(h, id, a.required)).status).toBe(402);
      expect(await row(h, id)).toEqual({ state: 'awaiting_funding', payment_state: 'not_received' });
      expect(await h.gw.db.get("SELECT id FROM purchase_events WHERE purchase_id=$1 AND type='funding.rejected'", id)).toBeDefined();
      expect(await h.gw.db.get("SELECT id FROM purchase_events WHERE purchase_id=$1 AND type='funding.confirmation_pending'", id)).toBeUndefined();
      expect(await count(h, 'SELECT COUNT(*)::int n FROM funding_attempts WHERE purchase_id=$1', id)).toBe(0);
    } finally { await h.close(); await h.gw.db.close(); }
  });
});
