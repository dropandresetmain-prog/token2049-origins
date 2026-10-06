import { iso } from '../infrastructure/clock.js';
import { newId } from '../infrastructure/ids.js';
import { redact } from '../infrastructure/redact.js';
import type { CommerceCore } from './service.js';
import { ProviderError } from './errors.js';
import {
  appendEvent,
  getPurchaseRow,
  getQuoteRow,
  getReservation,
  setReservationStatus,
  transitionPurchase,
  type AttemptRow,
  type FundingEvidenceRow,
  type PurchaseRow,
  type FundingRequirementRecord,
} from './store.js';
import type { ExecutionContext, ExecutionResult, VerifiedFunding } from '../contracts/ports.js';
import type { Fulfillment } from '../contracts/intent.js';
import type { QuoteView, ReceiptView, CommerceStatus, MerchantPaymentStatus } from '../contracts/commerce.js';
import type { FundingRail, ProviderRoute } from '../contracts/common.js';
import { Accounts, cryptoAsset, entriesForPurchase, fiatAsset, postEntry, type JournalLine } from './journal.js';
import { validateSettlement } from '../contracts/settlement.js';
import { fundingRequirementView, fundingSummaries } from './views.js';
import { Money, minor, rescaleMinor } from '../contracts/money.js';

interface JobRow {
  id: string;
  kind: string;
  purchase_id: string;
  dedupe_key: string;
  status: string;
  attempts: number;
}

/** Commerce states that are NOT a completed purchase even if an adapter claims success. */
const NOT_COMPLETE: ReadonlySet<CommerceStatus> = new Set(['not_started', 'order_created_unpaid', 'held', 'payment_pending', 'failed', 'cancelled', 'unknown']);
const PAID: ReadonlySet<MerchantPaymentStatus> = new Set(['paid', 'simulated_paid', 'test_balance_paid']);

const RECONCILE_BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 300_000, 600_000];
const MAX_RECONCILE_ATTEMPTS = 12;
const LEASE_MS = 120_000;

/**
 * Single in-process worker. Claims durable jobs with leases; recovers expired leases on restart.
 * Invariant: an execution attempt is persisted before any provider call, and an attempt that was
 * started is NEVER re-executed — only reconciled through retrieve().
 */
export class Worker {
  private readonly workerId = newId('wrk');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly core: CommerceCore, private readonly log: (line: Record<string, unknown>) => void = () => undefined) {}

  private logFailure(error: unknown, stage: string, jobId?: string): void {
    // Error messages, SQL detail and provider bodies can contain secrets. Emit only a machine code.
    const code = (error as { code?: unknown } | null)?.code;
    this.log(redact({ component: 'worker', event: 'worker.error', stage, ...(jobId ? { jobId } : {}),
      errorCode: typeof code === 'string' && /^(?:[0-9A-Z]{5}|E[A-Z_]{2,30})$/.test(code) ? code : 'UNCLASSIFIED',
      message: 'worker operation failed; durable jobs retain retry and recovery state' }));
  }

  private get db() {
    return this.core.deps.db;
  }
  private now(): string {
    return iso(this.core.deps.clock.now());
  }

  async start(intervalMs = 1000): Promise<void> {
    await this.recoverLeases();
    await this.recoverOrphans();
    this.timer = setInterval(() => void this.tick().catch(e => this.logFailure(e, 'tick')), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Expired leases (crash mid-job) go back to pending. Execute jobs then see the started attempt and reconcile. */
  async recoverLeases(): Promise<number> {
    const nowIso = this.now();
    return (await this.db.run(
      "UPDATE jobs SET status = 'pending', claimed_by = NULL, lease_until = NULL, updated_at = $1 WHERE status = 'claimed' AND (lease_until IS NULL OR lease_until <= $2)",
      nowIso,
      nowIso,
    )).changes;
  }

  /** Purchases left executing/unresolved without any live job get a reconcile job (startup safety net). */
  async recoverOrphans(): Promise<number> {
    return this.db.tx(async () => {
      const nowIso = this.now();
      const orphans = await this.db.all<{ id: string }>(
        `SELECT p.id FROM purchases p WHERE p.state IN ('executing','unresolved')
         AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.purchase_id = p.id AND j.status IN ('pending','claimed'))`,
      );
      for (const o of orphans) await this.db.tx(async () => (await this.core.enqueueJob('reconcile_purchase', o.id, `reconcile:${o.id}:${nowIso}`, nowIso)));
      const funding=await this.db.all<{id:string;purchase_id:string}>(
        "SELECT f.id,f.purchase_id FROM funding_attempts f WHERE f.status='pending' AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.purchase_id=f.purchase_id AND j.kind='recover_funding' AND j.status IN ('pending','claimed'))"
      );
      for(const f of funding) await this.db.tx(async ()=>(await this.core.enqueueJob('recover_funding',f.purchase_id,'recover_funding:'+f.id+':'+newId('repair'),nowIso)));
      return orphans.length+funding.length;
    });
  }

  /** Run all currently due work once. Returns number of jobs processed. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      await this.recoverLeases();
      await this.sweepExpired();
      let n = 0;
      for (;;) {
        const job = await this.claim();
        if (!job) break;
        n++;
        const locked = await this.db.withExclusiveLock(`worker:${job.purchase_id}`, async () => {
          try {
            // Actual pickup includes time behind other jobs, not just the configured tick interval.
            if (job.kind === 'execute_purchase') await appendEvent(this.db, job.purchase_id, 'execution.picked_up', {}, this.now());
            await this.run(job);
          } catch (e) {
            this.logFailure(e, 'job', job.id);
            await this.failJob(job, e);
          }
        });
        if (!locked.acquired) await this.reschedule(job, 1000, 'purchase work is in progress');
      }
      return n;
    } finally {
      this.running = false;
    }
  }

  private async claim(): Promise<JobRow | undefined> {
    const nowIso = this.now();
    return await this.db.tx(async () => {
      const job = await this.db.get<JobRow>(
        "SELECT * FROM jobs WHERE status = 'pending' AND run_after <= $1 ORDER BY run_after, created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED",
        nowIso,
      );
      if (!job) return undefined;
      const lease = new Date(Date.parse(nowIso) + LEASE_MS).toISOString();
      const r = await this.db.run(
        "UPDATE jobs SET status = 'claimed', claimed_by = $1, lease_until = $2, attempts = attempts + 1, updated_at = $3 WHERE id = $4 AND status = 'pending'",
        this.workerId,
        lease,
        nowIso,
        job.id,
      );
      return r.changes === 1 ? { ...job, attempts: job.attempts + 1 } : undefined;
    }, false);
  }

  private async complete(job: JobRow): Promise<void> {
    await this.db.run("UPDATE jobs SET status = 'done', lease_until = NULL, updated_at = $1 WHERE id = $2 AND status = 'claimed' AND claimed_by = $3 AND attempts = $4", this.now(), job.id, this.workerId, job.attempts);
  }

  private async reschedule(job: JobRow, delayMs: number, lastError?: string): Promise<void> {
    const runAfter = new Date(Date.parse(this.now()) + delayMs).toISOString();
    await this.db.run(
      "UPDATE jobs SET status = 'pending', claimed_by = NULL, lease_until = NULL, run_after = $1, last_error = $2, updated_at = $3 WHERE id = $4 AND status = 'claimed' AND claimed_by = $5 AND attempts = $6",
      runAfter,
      lastError ?? null,
      this.now(),
      job.id,
      this.workerId,
      job.attempts,
    );
  }

  private async failJob(job: JobRow, e: unknown): Promise<void> {
    const msg = String(redact((e as Error)?.message ?? e)).slice(0, 500);
    if (job.attempts >= MAX_RECONCILE_ATTEMPTS && (job.kind === 'recover_funding' || job.kind === 'confirm_funding' || job.kind === 'refresh_outcome')) {
      if(job.attempts === MAX_RECONCILE_ATTEMPTS) await this.db.tx(async ()=>(await appendEvent(this.db,job.purchase_id,job.kind==='refresh_outcome'?'outcome.manual_required':'funding.manual_required',{reason:'readback repeatedly failed; recovery continues hourly'},this.now())));
      await this.reschedule(job,3_600_000,msg);
      return;
    }
    if (job.attempts >= MAX_RECONCILE_ATTEMPTS) {
      await this.db.run("UPDATE jobs SET status = 'dead', last_error = $1, updated_at = $2 WHERE id = $3 AND status = 'claimed' AND claimed_by = $4 AND attempts = $5", msg, this.now(), job.id, this.workerId, job.attempts);
      return;
    }
    await this.reschedule(job, RECONCILE_BACKOFF_MS[Math.min(job.attempts, RECONCILE_BACKOFF_MS.length - 1)]!, msg);
  }

  private async run(job: JobRow): Promise<void> {
    switch (job.kind) {
      case 'execute_purchase':
        return await this.executePurchase(job);
      case 'reconcile_purchase':
        return await this.reconcilePurchase(job);
      case 'refresh_outcome':
        return await this.refreshOutcome(job);
      case 'recover_funding':
        return await this.recoverFunding(job);
      case 'confirm_funding':
        return await this.confirmFunding(job);
      default:
        throw new Error(`unknown job kind ${job.kind}`);
    }
  }

  /* ---------------- expiry ---------------- */

  private async sweepExpired(): Promise<void> {
    const nowIso = this.now();
    const due = await this.db.all<{ id: string }>(
      `SELECT p.id FROM purchases p JOIN reservations r ON r.purchase_id = p.id
       WHERE p.state = 'awaiting_funding' AND r.expires_at IS NOT NULL AND r.expires_at <= $1`,
      nowIso,
    );
    for (const { id } of due) await this.core.expirePurchase(id, 'quote expired before funding');
  }

  /* ---------------- execution ---------------- */

  private async executor(p: PurchaseRow) {
    const q = (await getQuoteRow(this.db, p.quote_id))!;
    const ex = this.core.deps.executors.get(q.route as ProviderRoute);
    if (!ex) throw new Error(`executor ${q.route} missing`);
    return { ex, q };
  }

  private async context(p: PurchaseRow, attempt: AttemptRow): Promise<ExecutionContext> {
    const q = (await getQuoteRow(this.db, p.quote_id))!;
    const qv = JSON.parse(q.public_json) as QuoteView;
    const current = await this.db.get<{ checkpoints_json: string }>('SELECT checkpoints_json FROM execution_attempts WHERE id = $1', attempt.id);
    const ctx: ExecutionContext = {
      purchaseId: p.id,
      attemptId: attempt.id,
      idempotencyKey: attempt.idempotency_key,
      quote: { quoteId: q.id, merchantTotal: qv.merchantTotal, executionRef: JSON.parse(q.execution_ref_json), expiresAt: q.expires_at },
      fulfillment: JSON.parse(q.fulfillment_json) as Fulfillment,
      checkpoints: JSON.parse(current?.checkpoints_json ?? attempt.checkpoints_json),
      checkpoint: async (step, data) => {
        const nowIso = this.now();
        // Every currently wired provider commits side effects through one of these pre-call markers.
        // Post-call order/reference checkpoints remain writable after expiry for recovery.
        if (['create_attempt','book_attempt','pay_attempt','pay_click'].includes(step) && Date.parse(q.expires_at)<=Date.parse(nowIso)) {
          throw new ProviderError('not_sent','quote_expired','quote expired before provider commit');
        }
        await this.db.tx(async () => {
          const cur = (await this.db.get<{ checkpoints_json: string }>('SELECT checkpoints_json FROM execution_attempts WHERE id = $1', attempt.id))!;
          const cps = JSON.parse(cur.checkpoints_json) as Record<string, unknown>;
          const safe = redact(data);
          // Opaque provider handles are needed intact after restart; public events remain redacted.
          if (typeof data.providerReference === 'string') safe.providerReference = data.providerReference;
          cps[step] = safe;
          const ref = typeof data.providerReference === 'string' ? data.providerReference : null;
          await this.db.run(
            'UPDATE execution_attempts SET checkpoints_json = $1, provider_reference = COALESCE($2, provider_reference) WHERE id = $3',
            JSON.stringify(cps),
            ref,
            attempt.id,
          );
          if (ref) await this.db.run('UPDATE purchases SET provider_reference = $1, updated_at = $2 WHERE id = $3', ref, nowIso, p.id);
          await appendEvent(this.db, p.id, 'execution.checkpoint', { step, providerReference: ref }, nowIso);
          // The first booking/order reference bounds response vs readback on these routes. Atlas's
          // order reference precedes payment, so it cannot supply this boundary for ticket issuance.
          if (ref && ((q.route === 'nuitee' && step === 'booking') || (q.route === 'shopify' && step === 'order'))) {
            await appendEvent(this.db, p.id, 'execution.reference_observed', {}, nowIso);
          }
        });
        // Keep the in-memory checkpoint aligned with the durable reconciliation data.
        ctx.checkpoints[step] = data;
      },
    };
    return ctx;
  }

  private async appliedFunding(purchaseId: string): Promise<FundingEvidenceRow[]> {
    return await this.db.all<FundingEvidenceRow>(
      "SELECT * FROM funding_evidence WHERE purchase_id = $1 AND application = 'applied' AND payment_state = 'confirmed'",
      purchaseId,
    );
  }

  private async executePurchase(job: JobRow): Promise<void> {
    const p0 = (await getPurchaseRow(this.db, job.purchase_id))!;
    const existingAttempt = await this.db.get<AttemptRow>('SELECT * FROM execution_attempts WHERE purchase_id = $1 ORDER BY attempt_no DESC LIMIT 1', p0.id);
    if (existingAttempt) {
      // Crash/restart after an attempt began: never re-execute. Reconcile instead.
      await this.complete(job);
      if (existingAttempt.status === 'started' || existingAttempt.status === 'unknown') await this.toUnresolved(p0.id, existingAttempt, 'execution interrupted; reconciling via provider readback');
      return;
    }
    if (p0.state !== 'funded_queued') {
      await this.complete(job);
      return;
    }
    const { ex, q } = await this.executor(p0);
    const qv = JSON.parse(q.public_json) as QuoteView;
    let nowIso = this.now();

    // Pre-execution gate: funding, authority, quote validity, capacity, route readiness.
    let gateFailure = await (async (): Promise<{ state: 'requires_reauthorization' | 'failed'; reason: string } | null> => {
      const funding = await this.appliedFunding(p0.id);
      const req = JSON.parse(p0.funding_requirement_json) as { amountBaseUnits: string; network: string; assetId: string; fundingOptionId?: string };
      const covered = funding
        .filter((f) => f.network === req.network && f.asset_id === req.assetId)
        .reduce((s, f) => s + BigInt(f.amount_base_units), 0n);
      if (covered < BigInt(req.amountBaseUnits)) return { state: 'failed', reason: 'confirmed funding does not cover the quote' };
      const approval = JSON.parse(p0.approval_json) as { quoteDigest: string; selectedFundingOptionId?: string };
      if (approval.quoteDigest !== q.digest) return { state: 'requires_reauthorization', reason: 'approval does not bind quote' };
      // New approvals authorize the frozen payment choice too; legacy obligations retain their stored terms.
      if (req.fundingOptionId && approval.selectedFundingOptionId !== req.fundingOptionId) return { state: 'requires_reauthorization', reason: 'approval does not bind selected funding option' };
      if (Date.parse(q.expires_at) <= Date.parse(nowIso)) return { state: 'requires_reauthorization', reason: 'quote expired before execution; renewed authority required' };
      const res = await getReservation(this.db, p0.id);
      if (!res || res.status !== 'active' || BigInt(res.amount_minor) < minor(qv.merchantTotal)) return { state: 'failed', reason: 'no active capacity reservation' };
      const r = await ex.readiness();
      if (!['CONFIGURED_UNVERIFIED', 'EXTERNAL_CHECK_PASSED', 'LOCAL_TESTS_ONLY'].includes(r.status)) return { state: 'failed', reason: `route not ready (${r.status})` };
      return null;
    })();

    // Readiness may take long enough to outlive the approval; recheck after every awaited gate.
    if (!gateFailure && Date.parse(q.expires_at) <= this.core.deps.clock.now().getTime()) gateFailure = { state: 'requires_reauthorization', reason: 'quote expired while checking readiness; renewed authority required' };
    nowIso = this.now();
    if (gateFailure) {
      await this.db.tx(async () => {
        await transitionPurchase(this.db, p0.id, ['funded_queued'], { state: gateFailure.state, status_reason: gateFailure.reason }, nowIso);
        await setReservationStatus(this.db, p0.id, ['active'], 'released', nowIso);
        await appendEvent(this.db, p0.id, 'execution.blocked', { reason: gateFailure.reason }, nowIso);
        await appendEvent(this.db, p0.id, 'refund.due', { reason: 'funding received but purchase not executed; customer prepayment remains a refundable obligation' }, nowIso);
      });
      await this.complete(job);
      return;
    }

    // Persist the attempt BEFORE the external request.
    const attemptId = newId('att');
    const attempt: AttemptRow = await this.db.tx(async () => {
      const ok = await transitionPurchase(this.db, p0.id, ['funded_queued'], { state: 'executing' }, nowIso);
      if (!ok) throw new Error('purchase left funded_queued concurrently');
      await this.db.run(
        `INSERT INTO execution_attempts(id, purchase_id, attempt_no, idempotency_key, status, checkpoints_json, started_at)
         VALUES ($1,$2,1,$3, 'started', '{}', $4)`,
        attemptId,
        p0.id,
        `${p0.id}:1`,
        nowIso,
      );
      await appendEvent(this.db, p0.id, 'execution.started', { attemptId, route: ex.route }, nowIso);
      return (await this.db.get<AttemptRow>('SELECT * FROM execution_attempts WHERE id = $1', attemptId))!;
    });

    const p = (await getPurchaseRow(this.db, p0.id))!;
    let result: ExecutionResult;
    try {
      result = await ex.execute((await this.context(p, attempt)));
    } catch (e) {
      result = this.resultFromError(e);
    }
    // execute() includes the adapter's mandatory readback. No raw provider response is recorded.
    await appendEvent(this.db, p.id, 'execution.adapter_returned', { kind: result.kind }, this.now());
    await this.applyResult(p.id, attemptId, result);
    // The job stays claimed until the result is durable: a crash before this point leaves a
    // leased job that, once recovered, sees the started attempt and reconciles instead of re-executing.
    await this.complete(job);
  }

  private resultFromError(e: unknown): ExecutionResult {
    if (e instanceof ProviderError && (e.outcome === 'not_sent' || e.outcome === 'rejected')) {
      return { kind: 'failed_definite', reason: `${e.providerCode}: ${redact(e.message)}`, providerReference: null, evidence: [] };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: 'unknown', reason: `execution outcome unknown: ${redact(msg).slice(0, 200)}`, providerReference: null, evidence: [] };
  }

  /** Apply an execution or reconciliation result exactly once. */
  async applyResult(purchaseId: string, attemptId: string, result: ExecutionResult): Promise<void> {
    const nowIso = this.now();
    // Core-side semantic guard: "succeeded" requires a paid, complete commerce state.
    if (result.kind === 'succeeded' && (NOT_COMPLETE.has(result.commerceStatus) || !PAID.has(result.merchantPaymentStatus))) {
      result = {
        kind: 'unknown',
        reason: `provider reported ${result.commerceStatus}/${result.merchantPaymentStatus}; not a completed paid purchase`,
        providerReference: result.providerReference,
        evidence: result.evidence,
      };
    }
    let financialAnomaly: {expected: Money; actual: unknown} | null = null;
    if (result.kind === 'succeeded') {
      const qv=JSON.parse((await getQuoteRow(this.db,(await getPurchaseRow(this.db,purchaseId))!.quote_id))!.public_json) as QuoteView;
      const parsed=Money.safeParse(result.chargedAmount);
      if(!parsed.success || parsed.data.currency!==qv.merchantTotal.currency || parsed.data.scale!==qv.merchantTotal.scale || parsed.data.amountMinor!==qv.merchantTotal.amountMinor) {
        financialAnomaly={expected:qv.merchantTotal,actual:result.chargedAmount};
        result={kind:'unknown',reason:'provider charge differs from the authorized quote; exposure held for operator review',providerReference:result.providerReference,
          evidence:result.evidence.map(e=>({...e,details:{...e.details,quotedAmount:qv.merchantTotal,reportedCharge:financialAnomaly!.actual}}))};
      }
    }
    // A later success, cancellation or terms change cannot erase an earlier observed charge.
    if(result.kind!=='unknown' && (await this.db.get("SELECT id FROM purchase_events WHERE purchase_id = $1 AND type='execution.financial_anomaly' LIMIT 1",purchaseId))) {
      result={kind:'unknown',reason:'an earlier charge anomaly requires operator review; exposure remains held',providerReference:'providerReference' in result?result.providerReference:null,evidence:result.evidence};
    }
    await this.db.tx(async () => {
      const p = (await getPurchaseRow(this.db, purchaseId))!;
      if (!['executing', 'unresolved'].includes(p.state)) return; // finalized already: never regress
      if(financialAnomaly) {
        const actual=Money.safeParse(financialAnomaly.actual);
        // Retain at least the original reservation; greater same-unit charges increase held exposure.
        if(actual.success && actual.data.currency===financialAnomaly.expected.currency && actual.data.scale===financialAnomaly.expected.scale && minor(actual.data)>BigInt((await getReservation(this.db,p.id))!.amount_minor))
          await this.db.run('UPDATE reservations SET amount_minor = $1, updated_at = $2 WHERE purchase_id = $3',actual.data.amountMinor,nowIso,p.id);
        await appendEvent(this.db,p.id,'execution.financial_anomaly',financialAnomaly,nowIso);
      }
      const evidence = result.evidence.map((e) => redact(e));
      await this.db.run(
        'UPDATE execution_attempts SET status = $1, provider_reference = COALESCE($2, provider_reference), result_json = $3, finished_at = $4 WHERE id = $5',
        result.kind,
        'providerReference' in result ? result.providerReference : null,
        JSON.stringify({ ...result, evidence }),
        result.kind === 'unknown' ? null : nowIso,
        attemptId,
      );
      switch (result.kind) {
        case 'succeeded':
          await this.finalizeSuccess(p, result, nowIso);
          break;
        case 'failed_definite':
        case 'terms_changed': {
          const state = result.kind === 'failed_definite' ? 'failed' : 'requires_reauthorization';
          await transitionPurchase(
            this.db,
            p.id,
            ['executing', 'unresolved'],
            {
              state,
              commerce_status: result.kind === 'failed_definite' ? 'failed' : 'not_started',
              merchant_payment_status: 'none',
              status_reason: result.reason,
              ...(result.kind === 'failed_definite' && result.providerReference ? { provider_reference: result.providerReference } : {}),
            },
            nowIso,
          );
          await setReservationStatus(this.db, p.id, ['active', 'held_unresolved'], 'released', nowIso);
          await appendEvent(this.db, p.id, `execution.${result.kind}`, { reason: result.reason }, nowIso);
          await appendEvent(this.db, p.id, 'capacity.released', {}, nowIso);
          await appendEvent(this.db, p.id, 'refund.due', { reason: 'purchase not completed; customer prepayment remains a refundable obligation' }, nowIso);
          break;
        }
        case 'unknown':
          if (p.state === 'executing') {
            await transitionPurchase(this.db, p.id, ['executing'], { state: 'unresolved', commerce_status: 'unknown', status_reason: result.reason, ...(result.providerReference ? { provider_reference: result.providerReference } : {}) }, nowIso);
            await setReservationStatus(this.db, p.id, ['active'], 'held_unresolved', nowIso);
            await appendEvent(this.db, p.id, 'execution.unknown', { reason: result.reason }, nowIso);
          }
          await this.core.enqueueJob('reconcile_purchase', p.id, `reconcile:${p.id}`, new Date(Date.parse(nowIso) + RECONCILE_BACKOFF_MS[0]!).toISOString());
          break;
      }
    });
  }

  private async toUnresolved(purchaseId: string, attempt: AttemptRow, reason: string): Promise<void> {
    const nowIso = this.now();
    await this.db.tx(async () => {
      const p = (await getPurchaseRow(this.db, purchaseId))!;
      if (p.state === 'executing') {
        await transitionPurchase(this.db, p.id, ['executing'], { state: 'unresolved', commerce_status: 'unknown', status_reason: reason }, nowIso);
        await setReservationStatus(this.db, p.id, ['active'], 'held_unresolved', nowIso);
        await this.db.run("UPDATE execution_attempts SET status = 'unknown' WHERE id = $1 AND status = 'started'", attempt.id);
        await appendEvent(this.db, p.id, 'execution.unknown', { reason }, nowIso);
      }
      await this.core.enqueueJob('reconcile_purchase', p.id, `reconcile:${p.id}`, nowIso);
    });
  }

  private async finalizeSuccess(p: PurchaseRow, r: Extract<ExecutionResult, { kind: 'succeeded' }>, nowIso: string): Promise<void> {
    const q = (await getQuoteRow(this.db, p.quote_id))!;
    const qv = JSON.parse(q.public_json) as QuoteView;
    const charged = r.chargedAmount;
    const testBalance = r.merchantPaymentStatus === 'test_balance_paid';
    // Provider test-balance usage must never be presented as card spend or a bank debit.
    await postEntry(
      this.db,
      {
        eventKey: `merchant_payment:${p.id}`,
        purchaseId: p.id,
        kind: testBalance ? 'merchant_payment_provider_test_balance' : 'merchant_payment_simulated_card',
        ledgerMode: 'simulated',
        description: testBalance ? `Provider sandbox test-balance payment (${qv.route}); synthetic capacity usage` : `Provider-reported merchant payment via simulated card capacity (${qv.route})`,
        externalReference: r.providerReference,
        lines: [
          { account: Accounts.merchantPurchases, asset: fiatAsset(charged.currency, charged.scale), side: 'debit', amount: minor(charged) },
          { account: testBalance ? Accounts.providerTestBalanceUsed : Accounts.cardPayable, asset: fiatAsset(charged.currency, charged.scale), side: 'credit', amount: minor(charged) },
        ],
      },
      nowIso,
    );
    // Discharge the testnet prepayment obligation in its own asset; this is not USD revenue or conversion.
    const req = JSON.parse(p.funding_requirement_json) as FundingRequirementRecord;
    const asset = cryptoAsset(req.network, req.assetId);
    const total = BigInt(req.amountBaseUnits);
    // New obligations use the frozen allocation; legacy obligations retain their stored full notional.
    const settlement = req.settlement ? validateSettlement(req.settlement, req.decimals) : null;
    if (settlement && settlement.totalBaseUnits !== req.amountBaseUnits) throw new Error('stored settlement total mismatch');
    const feeBase = settlement ? BigInt(settlement.feeBaseUnits) : minor(qv.serviceFee) === 0n ? 0n : rescaleMinorCeilSafe(minor(qv.serviceFee), qv.serviceFee.scale, req.decimals);
    const principalBase = total - feeBase;
    if (principalBase <= 0n || feeBase < 0n) throw new Error('invalid stored settlement allocation');
    const lines: JournalLine[] = [
      { account: Accounts.customerPrepayment, asset, side: 'debit' as const, amount: total },
      { account: Accounts.principalApplied, asset, side: 'credit' as const, amount: principalBase },
    ];
    if (feeBase > 0n) lines.push({ account: Accounts.serviceFee, asset, side: 'credit' as const, amount: feeBase });
    await postEntry(
      this.db,
      {
        eventKey: `prepayment_applied:${p.id}`,
        purchaseId: p.id,
        kind: 'prepayment_applied',
        ledgerMode: 'observed',
        description: 'Customer prepayment applied to completed purchase',
        externalReference: r.providerReference,
        lines,
      },
      nowIso,
    );
    await setReservationStatus(this.db, p.id, ['active', 'held_unresolved'], 'consumed', nowIso);
    const overReservation = charged.currency !== qv.merchantTotal.currency || charged.scale !== qv.merchantTotal.scale || minor(charged) > minor(qv.merchantTotal);

    await transitionPurchase(
      this.db,
      p.id,
      ['executing', 'unresolved'],
      {
        state: 'succeeded',
        commerce_status: r.commerceStatus,
        merchant_payment_status: r.merchantPaymentStatus,
        provider_reference: r.providerReference,
        status_reason: overReservation ? 'provider charged more than quoted; flagged for review' : null,
      },
      nowIso,
    );
    const receipt = await this.buildReceipt((await getPurchaseRow(this.db, p.id))!, r, nowIso);
    await this.db.run('UPDATE purchases SET receipt_json = $1 WHERE id = $2', JSON.stringify(receipt), p.id);
    await appendEvent(this.db, p.id, 'execution.succeeded', { providerReference: r.providerReference, commerceStatus: r.commerceStatus, merchantPaymentStatus: r.merchantPaymentStatus }, nowIso);
    await appendEvent(this.db, p.id, 'capacity.consumed', {}, nowIso);
    await appendEvent(this.db, p.id, 'receipt.issued', { receiptId: receipt.receiptId }, nowIso);
    if (r.commerceStatus === 'ticketing') {
      await this.core.enqueueJob('refresh_outcome', p.id, `refresh:${p.id}`, new Date(Date.parse(nowIso) + 30_000).toISOString());
    }
  }

  async buildReceipt(p: PurchaseRow, r: { providerReference: string; commerceStatus: CommerceStatus; merchantPaymentStatus: MerchantPaymentStatus; evidence: ExecutionResult['evidence'] }, nowIso: string): Promise<ReceiptView> {
    const q = (await getQuoteRow(this.db, p.quote_id))!;
    const qv = JSON.parse(q.public_json) as QuoteView;
    const entries = await entriesForPurchase(this.db, p.id);
    const evidenceMode = r.evidence[0]?.evidenceMode ?? (qv.providerEnvironment === 'fixture' ? 'local_fixture' : 'fresh_external');
    const limitations = [
      'Testnet funding uses valueless test assets; no crypto-to-fiat conversion occurred.',
      ...(JSON.parse(p.funding_requirement_json).settlement?.policy.mode === 'scaled_testnet' ? ['Scaled testnet notional — 1:1000. Commercial capacity and chain settlement have no equivalent economic value.'] : []),
      'Merchant payment is provider sandbox/test evidence; it is not bank settlement or an OCBC transaction.',
      ...(r.merchantPaymentStatus === 'test_balance_paid'
        ? ['Provider test-balance usage consumes synthetic capacity; it is not card spend or supplier credit approval.']
        : ['Card spend is internally simulated capacity (card payable), not an immediate bank debit.']),
    ];
    if (qv.route === 'atlas') limitations.push('Atlas sandbox payment uses the provider test balance mechanism; see status for hold/payment/ticket state.');
    if (qv.route === 'nuitee') limitations.push('Nuitée sandbox booking payment is simulated by the provider (no charge).');
    if (qv.route === 'shopify') limitations.push('Shopify test-gateway payment proves merchant-side test behaviour only; no physical fulfillment is implied.');
    if (evidenceMode === 'local_fixture') limitations.unshift('LOCAL FIXTURE: not external evidence.');
    const funding = await fundingSummaries(this.db, p.id);
    if (funding.some(f => f.evidenceMode === 'local_fixture')) limitations.unshift('Funding is SIMULATED / LOCAL FIXTURE; no externally confirmed chain transaction is proved.');
    if (qv.sourceOffer && qv.sandboxRepresentation) limitations.push(qv.sandboxRepresentation.boundary, 'Source price is an observed item price. Shipping, tax and total are Capsule sandbox charges, not source merchant checkout charges.');
    return {
      receiptId: newId('rcp'),
      ...(qv.sourceOffer ? { sourceOffer: qv.sourceOffer } : {}),
      ...(qv.sandboxRepresentation ? { sandboxExecution: { ...qv.sandboxRepresentation, quotedTotal: qv.merchantTotal, orderReference: r.providerReference, paymentStatus: r.merchantPaymentStatus, evidenceMode } } : {}),
      purchaseId: p.id,
      quoteId: q.id,
      quoteDigest: q.digest,
      category: qv.category,
      route: qv.route,
      providerEnvironment: qv.providerEnvironment,
      evidenceMode,
      principal: qv.merchantTotal,
      fundingRequirement: fundingRequirementView(JSON.parse(p.funding_requirement_json) as FundingRequirementRecord),
      serviceFee: qv.serviceFee,
      funding,
      providerReference: r.providerReference,
      commerceStatus: r.commerceStatus,
      merchantPaymentStatus: r.merchantPaymentStatus,
      limitations,
      treasuryEffect: entries.flatMap((e) =>
        e.lines.map((l) => ({
          ledgerMode: e.ledger_mode as 'observed' | 'simulated',
          account: l.account,
          asset: l.asset,
          delta: l.side === 'debit' ? l.amount : `-${l.amount}`,
        })),
      ),
      evidenceRefs: [...entries.map((e) => `journal:${e.id}`), ...r.evidence.map((e) => `${e.source}:${e.reference}`)],
      issuedAt: nowIso,
    };
  }

  /* ---------------- reconciliation ---------------- */

  private async reconcilePurchase(job: JobRow): Promise<void> {
    const p = (await getPurchaseRow(this.db, job.purchase_id))!;
    if (p.state !== 'unresolved' && p.state !== 'executing') {
      await this.complete(job);
      return;
    }
    const attempt = await this.db.get<AttemptRow>('SELECT * FROM execution_attempts WHERE purchase_id = $1 ORDER BY attempt_no DESC LIMIT 1', p.id);
    if (!attempt) {
      await this.complete(job);
      return;
    }
    const { ex } = await this.executor(p);
    let result: ExecutionResult;
    try {
      result = await ex.retrieve((await this.context(p, attempt)));
    } catch (e) {
      result = { kind: 'unknown', reason: `readback failed: ${redact((e as Error).message ?? String(e)).slice(0, 200)}`, providerReference: null, evidence: [] };
    }
    if (result.kind === 'unknown') {
      if (job.attempts >= MAX_RECONCILE_ATTEMPTS) {
        await this.db.run("UPDATE jobs SET status = 'dead', last_error = $1, updated_at = $2 WHERE id = $3 AND status = 'claimed' AND claimed_by = $4 AND attempts = $5", 'manual reconciliation required', this.now(), job.id, this.workerId, job.attempts);
        await this.db.tx(async () => (await appendEvent(this.db, p.id, 'reconciliation.manual_required', { reason: result.reason }, this.now())));
        return;
      }
      await this.db.tx(async () => (await appendEvent(this.db, p.id, 'reconciliation.pending', { reason: result.reason, attempt: job.attempts }, this.now())));
      await this.reschedule(job, RECONCILE_BACKOFF_MS[Math.min(job.attempts, RECONCILE_BACKOFF_MS.length - 1)]!, result.reason);
      return;
    }
    await this.applyResult(p.id, attempt.id, result);
    // A financial anomaly can turn a provider success into an unresolved core outcome.
    if ((await getPurchaseRow(this.db,p.id))!.state === 'unresolved') {
      if(job.attempts === MAX_RECONCILE_ATTEMPTS) await this.db.tx(async ()=>(await appendEvent(this.db,p.id,'reconciliation.manual_required',{reason:'provider charge remains outside authorized terms; exposure retained'},this.now())));
      await this.reschedule(job,job.attempts >= MAX_RECONCILE_ATTEMPTS ? 3_600_000 : 30_000,'provider outcome requires operator review');
      return;
    }
    await this.complete(job);
  }

  /** Post-success status refresh (e.g. ticketing -> ticketed). Never changes financial state. */
  private async refreshOutcome(job: JobRow): Promise<void> {
    const p = (await getPurchaseRow(this.db, job.purchase_id))!;
    const attempt = await this.db.get<AttemptRow>('SELECT * FROM execution_attempts WHERE purchase_id = $1 ORDER BY attempt_no DESC LIMIT 1', p.id);
    if (p.state !== 'succeeded' || !attempt) {
      await this.complete(job);
      return;
    }
    const { ex } = await this.executor(p);
    const r = await ex.retrieve((await this.context(p, attempt)));
    const receipt=JSON.parse(p.receipt_json!) as ReceiptView;
    const coherent = r.kind==='succeeded' && !NOT_COMPLETE.has(r.commerceStatus) && PAID.has(r.merchantPaymentStatus) &&
      r.providerReference===p.provider_reference && r.merchantPaymentStatus===p.merchant_payment_status &&
      r.chargedAmount.currency===receipt.principal.currency && r.chargedAmount.scale===receipt.principal.scale && r.chargedAmount.amountMinor===receipt.principal.amountMinor;
    // Refresh can confirm ticket issuance; it cannot rewrite payment facts or regress the receipt.
    if(coherent && p.commerce_status==='ticketing' && r.commerceStatus==='ticketed') {
      const nowIso=this.now();
      await this.db.tx(async ()=>{
        await this.db.run('UPDATE purchases SET commerce_status = $1, updated_at = $2 WHERE id = $3','ticketed',nowIso,p.id);
        receipt.commerceStatus='ticketed';
        await this.db.run('UPDATE purchases SET receipt_json = $1 WHERE id = $2',JSON.stringify(receipt),p.id);
        await appendEvent(this.db,p.id,'outcome.refreshed',{commerceStatus:'ticketed'},nowIso);
      });
      await this.complete(job);return;
    }
    if(p.commerce_status==='ticketing') {
      if(job.attempts===MAX_RECONCILE_ATTEMPTS) await this.db.tx(async ()=>(await appendEvent(this.db,p.id,'outcome.manual_required',{reason:'ticket issuance remains unverified; read-only refresh continues hourly'},this.now())));
      await this.reschedule(job,job.attempts>=MAX_RECONCILE_ATTEMPTS?3_600_000:30_000,'ticket issuance not independently confirmed');
      return;
    }
    await this.complete(job);
  }

  private async recoverFunding(job: JobRow): Promise<void> {
    if (await this.core.recoverPendingFunding(job.purchase_id)) { await this.complete(job); return; }
    if (job.attempts === MAX_RECONCILE_ATTEMPTS) await this.db.tx(async () => (await appendEvent(this.db,job.purchase_id,'funding.manual_required',{reason:'candidate transfer still unavailable; automatic read-only recovery continues hourly'},this.now())));
    await this.reschedule(job,job.attempts >= MAX_RECONCILE_ATTEMPTS ? 3_600_000 : RECONCILE_BACKOFF_MS[Math.min(job.attempts,RECONCILE_BACKOFF_MS.length-1)]!);
  }

  /** Re-check a submitted (not yet confirmed) transfer; apply it once confirmed. */
  private async confirmFunding(job: JobRow): Promise<void> {
    const p = (await getPurchaseRow(this.db, job.purchase_id))!;
    const ev = await this.db.get<FundingEvidenceRow>(
      "SELECT * FROM funding_evidence WHERE purchase_id = $1 AND application = 'pending_confirmation' ORDER BY verified_at LIMIT 1",
      p.id,
    );
    if (!ev) {
      await this.complete(job);
      return;
    }
    const adapter = this.core.deps.fundingAdapters.get(ev.rail as FundingRail);
    if (!adapter?.confirm) throw new Error('funding adapter cannot confirm');
    const vf: VerifiedFunding = {
      rail: ev.rail as FundingRail,
      network: ev.network,
      assetId: ev.asset_id,
      decimals: ev.decimals,
      amountBaseUnits: ev.amount_base_units,
      payer: ev.payer,
      payee: ev.payee,
      transferReference: ev.transfer_reference,
      paymentState: ev.payment_state as VerifiedFunding['paymentState'],
      confirmations: ev.confirmations,
      purpose: ev.purpose as VerifiedFunding['purpose'],
      evidenceMode: ev.evidence_mode as VerifiedFunding['evidenceMode'],
      observedAt: ev.observed_at,
      details: JSON.parse(ev.details_json),
    };
    const c = await adapter.confirm(vf);
    const nowIso = this.now();
    if (c.paymentState === 'confirmed') {
      const current=(await getPurchaseRow(this.db,p.id))!;
      if(current.state==='awaiting_funding' && Date.parse((await getQuoteRow(this.db,current.quote_id))!.expires_at)<=this.core.deps.clock.now().getTime()) await this.core.expirePurchase(p.id,'quote expired while confirming funding');
      await this.db.tx(async () => {
        // A competing/recovered confirmation may have committed while this readback was awaited.
        const pending = await this.db.get("SELECT id FROM funding_evidence WHERE id = $1 AND application = 'pending_confirmation'", ev.id);
        if (!pending) return;
        const cur = (await getPurchaseRow(this.db, p.id))!;
        const open = cur.state === 'awaiting_funding';
        await this.db.run(
          "UPDATE funding_evidence SET payment_state = 'confirmed', confirmations = $1, application = $2, observed_at = $3 WHERE id = $4",
          c.confirmations,
          open ? 'applied' : 'unapplied',
          c.observedAt,
          ev.id,
        );
        const req = JSON.parse(cur.funding_requirement_json) as { amountBaseUnits: string };
        const confirmed = { ...vf, paymentState: 'confirmed' as const, confirmations: c.confirmations };
        if (open) {
          await this.core.applyConfirmedFunding(cur, confirmed, BigInt(req.amountBaseUnits), BigInt(ev.amount_base_units), nowIso);
        } else {
          await this.core.recordConfirmedUnappliedFunding(p.id, confirmed, nowIso);
        }
      });
      await this.complete(job);
      return;
    }
    if (c.paymentState === 'invalid') {
      await this.db.tx(async () => {
        const pending = await this.db.get("SELECT id FROM funding_evidence WHERE id = $1 AND application = 'pending_confirmation'", ev.id);
        if (!pending) return;
        await this.db.run("UPDATE funding_evidence SET payment_state = 'invalid', application = 'unapplied' WHERE id = $1", ev.id);
        await this.db.run('DELETE FROM funding_attempts WHERE purchase_id = $1 AND transfer_reference = $2',p.id,ev.transfer_reference);
        await transitionPurchase(this.db, p.id, ['awaiting_funding'], { payment_state: 'not_received' }, nowIso);
        await appendEvent(this.db, p.id, 'funding.invalid', { transfer: ev.transfer_reference }, nowIso);
      });
      await this.complete(job);
      return;
    }
    if (job.attempts >= MAX_RECONCILE_ATTEMPTS) {
      if (job.attempts === MAX_RECONCILE_ATTEMPTS) await this.db.tx(async () => (await appendEvent(this.db,p.id,'funding.manual_required',{reason:'confirmation delayed; automatic read-only confirmation continues hourly'},nowIso)));
      await this.reschedule(job,3_600_000,'confirmation delayed; operator review required');
      return;
    }
    await this.reschedule(job, RECONCILE_BACKOFF_MS[Math.min(job.attempts, RECONCILE_BACKOFF_MS.length - 1)]!);
  }
}

function rescaleMinorCeilSafe(amount: bigint, fromScale: number, toScale: number): bigint {
  if (toScale >= fromScale) return rescaleMinor(amount, fromScale, toScale);
  const f = 10n ** BigInt(fromScale - toScale);
  return (amount + f - 1n) / f;
}
