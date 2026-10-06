import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { CreatePurchaseRequest, PurchaseResponse } from '../../contracts/api.js';
import { Db } from '../../infrastructure/db.js';
import { MasumiClient, MasumiError } from '../../integrations/masumi/client.js';
import { assertFeeBinding, observeServiceFee } from '../../funding/masumi/index.js';

const Start = z.object({ identifier_from_purchaser: z.string().regex(/^(?:[a-f0-9]{2}){7,13}$/), input_data: z.object({ purchase_request: z.string().min(1).max(8000) }).strict() }).strict();
type Job = { id: string; owner: string; external_id: string; input_hash: string; request_json: string; phase: string; purchase_json: string | null; payment_json: string | null; result_json: string | null; pay_by: string; submit_by: string; unlock_at: string; dispute_until: string; transfer_ref: string | null };
export interface SokosumiIdentity { owner: string; token: string; gatewayToken: string; }
export interface RuntimeOptions { db: Db; masumi: MasumiClient; gatewayUrl: string; identities: SokosumiIdentity[]; fetchImpl?: typeof fetch; clock?: () => number; }
export class TaskError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export const mipInputHash = (identifier: string, input: { purchase_request: string }) => digest(identifier + ';' + JSON.stringify(input));
export const mipOutputHash = (identifier: string, output: string) => digest(identifier + ';' + output);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value);
}
export class SokosumiRuntime {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  constructor(readonly opts: RuntimeOptions) {
    const u = new URL(opts.gatewayUrl);
    if ((u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) || u.username || u.password || u.search || u.hash) throw new Error('Invalid gateway URL');
    if (opts.identities.length === 0 || opts.identities.some(i => i.token.length < 32 || !i.owner || !i.gatewayToken)) throw new Error('Authenticated runtime identities are required');
    this.fetchImpl = opts.fetchImpl ?? fetch; this.now = opts.clock ?? Date.now;
  }
  async initialize(): Promise<void> {
    await this.opts.db.run('CREATE TABLE IF NOT EXISTS sokosumi_jobs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, external_id TEXT NOT NULL, input_hash TEXT NOT NULL, request_json TEXT NOT NULL, phase TEXT NOT NULL, purchase_json TEXT, payment_json TEXT, result_json TEXT, pay_by TEXT NOT NULL, submit_by TEXT NOT NULL, unlock_at TEXT NOT NULL, dispute_until TEXT NOT NULL, transfer_ref TEXT UNIQUE, UNIQUE(owner,external_id))');
    // Persist public terms once for this job store; credential rotation does not reprice existing jobs.
    await this.opts.db.run('CREATE TABLE IF NOT EXISTS sokosumi_runtime_terms (id INTEGER PRIMARY KEY CHECK(id=1), terms_json TEXT NOT NULL)');
    const terms = canonical({agentIdentifier:this.opts.masumi.config.agentIdentifier,sellerVkey:this.opts.masumi.config.sellerVkey,sellerAddress:this.opts.masumi.config.sellerAddress,contractAddress:this.opts.masumi.config.contractAddress,assetUnit:this.opts.masumi.config.assetUnit,feeBaseUnits:this.opts.masumi.config.feeBaseUnits,gatewayUrl:this.opts.gatewayUrl});
    const jobs = await this.opts.db.all<Job>('SELECT * FROM sokosumi_jobs WHERE payment_json IS NOT NULL');
    for (const job of jobs) assertFeeBinding(JSON.parse(job.payment_json!), this.opts.masumi.config, this.binding(job, JSON.parse(job.payment_json!).blockchainIdentifier));
    await this.opts.db.run('INSERT INTO sokosumi_runtime_terms (id,terms_json) VALUES (1,$1) ON CONFLICT DO NOTHING', terms);
    const stored = await this.opts.db.get<{terms_json:string}>('SELECT terms_json FROM sokosumi_runtime_terms WHERE id=1');
    if (stored?.terms_json !== terms) throw new Error('Durable Masumi payment terms changed; use a separate job store for new pricing or identities');
  }
  identity(header: string | undefined): SokosumiIdentity {
    const candidate = digest(header?.startsWith('Bearer ') ? header.slice(7) : '');
    const matches = this.opts.identities.filter(i => timingSafeEqual(Buffer.from(candidate), Buffer.from(digest(i.token))));
    if (matches.length !== 1) throw new TaskError(401, 'unauthorized');
    return matches[0]!;
  }
  async start(raw: unknown, identity: SokosumiIdentity): Promise<Record<string, unknown>> {
    const parsed = Start.safeParse(raw);
    if (!parsed.success) throw new TaskError(400, 'invalid_request');
    let request: z.infer<typeof CreatePurchaseRequest>;
    try { request = CreatePurchaseRequest.parse(JSON.parse(parsed.data.input_data.purchase_request)); } catch { throw new TaskError(400, 'invalid_purchase_request'); }
    const inputHash = mipInputHash(parsed.data.identifier_from_purchaser, parsed.data.input_data);
    const key = 'sokosumi:' + digest(identity.owner + ':' + parsed.data.identifier_from_purchaser);
    const lock = await this.opts.db.withExclusiveLock(key, async () => {
      let job = await this.opts.db.get<Job>('SELECT * FROM sokosumi_jobs WHERE owner=$1 AND external_id=$2', identity.owner, parsed.data.identifier_from_purchaser);
      if (job && job.input_hash !== inputHash) throw new TaskError(409, 'idempotency_conflict');
      if (!job) {
        const now = Math.floor(this.now() / 1000) * 1000;
        await this.opts.db.run('INSERT INTO sokosumi_jobs (id,owner,external_id,input_hash,request_json,phase,pay_by,submit_by,unlock_at,dispute_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', randomUUID(), identity.owner, parsed.data.identifier_from_purchaser, inputHash, canonical(request), 'new', String(now + 15 * 60000), String(now + 30 * 60000), String(now + 45 * 60000), String(now + 60 * 60000));
        job = (await this.opts.db.get<Job>('SELECT * FROM sokosumi_jobs WHERE owner=$1 AND external_id=$2', identity.owner, parsed.data.identifier_from_purchaser))!;
      }
      if (!job.purchase_json) {
        // The core's durable idempotency key recovers an ambiguous create; this operation never spends.
        let res: Response;
        try { res = await this.fetchImpl(this.opts.gatewayUrl + '/v1/purchases', { method: 'POST', headers: { authorization: 'Bearer ' + identity.gatewayToken, 'Idempotency-Key': key, 'content-type': 'application/json' }, body: job.request_json, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
        catch { throw new TaskError(503, 'gateway_outcome_unknown'); }
        if (!res.ok) throw new TaskError(res.status >= 500 ? 503 : 422, 'gateway_purchase_rejected');
        const purchase = PurchaseResponse.safeParse(await res.json().catch(() => null));
        if (!purchase.success || purchase.data.purchase.customerId !== identity.owner || purchase.data.purchase.quoteId !== request.quoteId) throw new TaskError(503, 'gateway_response_invalid');
        job.purchase_json = JSON.stringify(purchase.data.purchase);
        await this.opts.db.run('UPDATE sokosumi_jobs SET purchase_json=$1 WHERE id=$2', job.purchase_json, job.id);
      }
      if (!job.payment_json) {
        let payment;
        if (job.phase === 'payment_attempt') {
          // Never create again after an unknown native payment write, even if a list page is empty.
          payment = await this.opts.masumi.findPayment(job.input_hash);
          if (!payment) throw new TaskError(503, 'payment_creation_unknown');
        } else {
          const now = Math.floor(this.now() / 1000) * 1000;
          job.pay_by = String(now + 15 * 60000); job.submit_by = String(now + 30 * 60000); job.unlock_at = String(now + 45 * 60000); job.dispute_until = String(now + 60 * 60000);
          await this.opts.db.run('UPDATE sokosumi_jobs SET phase=$1,pay_by=$2,submit_by=$3,unlock_at=$4,dispute_until=$5 WHERE id=$6', 'payment_attempt', job.pay_by, job.submit_by, job.unlock_at, job.dispute_until, job.id);
          try { payment = await this.opts.masumi.createPayment(job.input_hash, job.external_id, { payBy: Number(job.pay_by), submitBy: Number(job.submit_by), unlockAt: Number(job.unlock_at), disputeUntil: Number(job.dispute_until) }); }
          catch (error) {
            if (error instanceof MasumiError && error.code === 'rejected' && error.status === 400) {
              // Native validation rejects before creating or signing a request; this definitive no-write may retry.
              await this.opts.db.run('UPDATE sokosumi_jobs SET phase=$1 WHERE id=$2', 'payment_rejected', job.id);
              throw new TaskError(422, 'payment_terms_rejected');
            }
            throw new TaskError(503, 'payment_creation_unknown');
          }
        }
        assertFeeBinding(payment, this.opts.masumi.config, this.binding(job, payment.blockchainIdentifier));
        job.payment_json = JSON.stringify(payment);
        await this.opts.db.run('UPDATE sokosumi_jobs SET payment_json=$1,phase=$2 WHERE id=$3', job.payment_json, 'awaiting_payment', job.id);
      }
      const payment = JSON.parse(job.payment_json);
      return { id: job.id, blockchainIdentifier: payment.blockchainIdentifier, agentIdentifier: this.opts.masumi.config.agentIdentifier, sellerVKey: this.opts.masumi.config.sellerVkey,
        payByTime: Math.floor(Number(job.pay_by) / 1000), submitResultTime: Math.floor(Number(job.submit_by) / 1000), unlockTime: Math.floor(Number(job.unlock_at) / 1000), externalDisputeUnlockTime: Math.floor(Number(job.dispute_until) / 1000),
        identifierFromPurchaser: job.external_id, serviceFee: this.serviceFee(), input_hash: job.input_hash };
    });
    if (!lock.acquired) throw new TaskError(409, 'job_busy');
    return lock.value;
  }
  async status(id: string, identity: SokosumiIdentity): Promise<Record<string, unknown>> {
    const lock = await this.opts.db.withExclusiveLock('sokosumi-job:' + id, async () => {
      const job = await this.opts.db.get<Job>('SELECT * FROM sokosumi_jobs WHERE id=$1 AND owner=$2', id, identity.owner);
      if (!job) throw new TaskError(404, 'job_not_found');
      if (job.phase === 'completed') return { status: 'completed', result: job.result_json };
      if (!job.payment_json) return { status: 'running', result: JSON.stringify({type:'native_payment_creation_reconciliation_required',action:'Resolve the original native creation checkpoint before any retry',payBy:new Date(Number(job.pay_by)).toISOString()}) };
      const p = JSON.parse(job.payment_json);
      const current = await this.opts.masumi.payment(p.blockchainIdentifier);
      const noNativeTransaction = !current.CurrentTransaction?.txHash && !(current.TransactionHistory ?? []).some(t => t.txHash);
      if (current.onChainState === 'FundsOrDatumInvalid' && noNativeTransaction && this.now() > Number(job.pay_by)) {
        assertFeeBinding(current, this.opts.masumi.config, this.binding(job,p.blockchainIdentifier));
        const coreResult = await this.corePurchase(job, identity);
        return {status:'failed',result:JSON.stringify({type:'native_payment_invalid_expired',action:'The immutable native request is invalid and its payment window expired; audit chain exposure before a new task',coreResult})};
      }
      let observed;
      try { observed = await observeServiceFee(this.opts.masumi, this.binding(job, p.blockchainIdentifier)); }
      catch { throw new TaskError(503, 'fee_verification_unavailable'); }
      if (observed.status === 'pending') return this.now() > Number(job.pay_by) ? {status:'running',result:JSON.stringify({type:'native_payment_reconciliation_required',action:'Payment window expired; reconcile existing native and chain state before any new payment'})} : { status: 'awaiting_payment' };
      if (observed.transferReference && job.transfer_ref !== observed.transferReference) {
        try { await this.opts.db.run('UPDATE sokosumi_jobs SET transfer_ref=$1 WHERE id=$2', observed.transferReference, id); }
        catch { throw new TaskError(409, 'payment_replayed'); }
      }
      // Refresh authenticated core truth; fee payment cannot complete or fund a merchant purchase.
      const purchase = await this.corePurchase(job, identity);
      if (!['succeeded', 'failed', 'expired', 'cancelled', 'requires_reauthorization'].includes(purchase.state)) {
        const deadlineExpired = this.now() > Number(job.submit_by);
        const type = deadlineExpired ? 'native_task_deadline_reconciliation_required'
          : purchase.state === 'awaiting_funding' ? 'direct_principal_funding'
          : purchase.state === 'unresolved' ? 'merchant_outcome_reconciliation_required' : 'purchase_in_progress';
        // An unresolved merchant outcome is never a request to fund again or a definite purchase failure.
        return { status: deadlineExpired ? 'failed' : 'running', result: JSON.stringify({
          type, purchaseId: purchase.purchaseId, state: purchase.state, statusReason: purchase.statusReason,
          submitBy: new Date(Number(job.submit_by)).toISOString(),
          ...(purchase.state === 'awaiting_funding' && !deadlineExpired ? { fundingInstructions: purchase.fundingInstructions } : {}),
          ...(deadlineExpired ? { action: 'Reconcile the existing native payment and purchase; no new payment is authorized' } : {}),
        }) };
      }
      // Evidence modes travel with the actual core receipt, so fixture merchants cannot masquerade as live.
      const result = job.result_json ?? JSON.stringify({ serviceFee: this.serviceFee(), purchaseId: purchase.purchaseId, state: purchase.state, receipt: purchase.receipt, statusReason: purchase.statusReason, serviceFeePurpose: 'service_fee' });
      const resultHash = mipOutputHash(job.external_id, result);
      if (job.phase !== 'submit_attempt' && job.phase !== 'submit_rejected') {
        // Keep a truthful terminal outcome, but never begin a native write after its immutable deadline.
        if (observed.status === 'escrow_locked' && this.now() > Number(job.submit_by)) {
          if (!job.result_json) await this.opts.db.run('UPDATE sokosumi_jobs SET result_json=$1 WHERE id=$2', result, id);
          job.result_json = result;
          return this.recovery(job, resultHash);
        }
        await this.opts.db.run('UPDATE sokosumi_jobs SET phase=$1,result_json=$2 WHERE id=$3', 'submit_attempt', result, id); job.result_json = result;
        if (observed.status === 'escrow_locked') {
          try { await this.opts.masumi.submitResult(p.blockchainIdentifier, resultHash); } catch (error) {
            if (error instanceof MasumiError && (error.code === 'unauthorized' || error.code === 'rejected')) await this.opts.db.run('UPDATE sokosumi_jobs SET phase=$1 WHERE id=$2', 'submit_rejected', id);
            return this.recovery(job, resultHash);
          }
          return { status: 'running' };
        }
      }
      if ((observed.status === 'result_submitted' || observed.status === 'released') && observed.payment.resultHash === resultHash) {
        await this.opts.db.run('UPDATE sokosumi_jobs SET phase=$1 WHERE id=$2', 'completed', id);
        return { status: 'completed', result };
      }
      // An unknown submit is reconciled only. Surface an actionable state rather than perpetual progress.
      return this.recovery(job, resultHash);
    });
    if (!lock.acquired) throw new TaskError(409, 'job_busy');
    return lock.value;
  }
  private async corePurchase(job: Job, identity: SokosumiIdentity) {
    let response: Response;
    try { response = await this.fetchImpl(this.opts.gatewayUrl + '/v1/purchases/' + JSON.parse(job.purchase_json!).purchaseId, {headers:{authorization:'Bearer '+identity.gatewayToken},redirect:'error',signal:AbortSignal.timeout(15000)}); }
    catch { throw new TaskError(503,'gateway_outcome_unknown'); }
    if (!response.ok) throw new TaskError(503,'gateway_status_unavailable');
    const fresh = PurchaseResponse.safeParse(await response.json().catch(()=>null));
    if (!fresh.success || fresh.data.purchase.customerId !== identity.owner || fresh.data.purchase.purchaseId !== JSON.parse(job.purchase_json!).purchaseId || fresh.data.purchase.quoteId !== JSON.parse(job.request_json).quoteId) throw new TaskError(503,'gateway_response_invalid');
    return fresh.data.purchase;
  }
  private serviceFee() { return { purpose: 'service_fee', assetUnit: this.opts.masumi.config.assetUnit, amountBaseUnits: this.opts.masumi.config.feeBaseUnits, network: 'cardano:preprod', additionalToApprovedCoreTotal: true }; }
  private recovery(job: Job, resultHash: string): Record<string, unknown> {
    return { status: this.now() > Number(job.submit_by) ? 'failed' : 'running', result: JSON.stringify({ type: 'native_result_reconciliation_required', jobId: job.id, resultHash, coreResult: job.result_json ? JSON.parse(job.result_json) : null, submitBy: new Date(Number(job.submit_by)).toISOString(), action: 'Reconcile the existing native payment before any retry; no new payment is authorized' }) };
  }
  private binding(job: Job, identifier: string) {
    return { identifier, inputHash: job.input_hash, payBy: Number(job.pay_by), submitBy: Number(job.submit_by), unlockAt: Number(job.unlock_at), disputeUntil: Number(job.dispute_until), nonce: job.external_id };
  }
  router(): Router {
    const r = Router();
    r.get('/availability', (_q, s) => s.json({ status: 'available', type: 'masumi-agent', serviceFee: this.serviceFee(), message: 'Preprod commerce; purchaser nonce must be 14-26 even lowercase hex characters; principal requires direct funding' }));
    r.get('/input_schema', (_q, s) => s.json({ input_data: [{ id: 'purchase_request', type: 'string', name: 'Canonical approved purchase request JSON', validations: [{ validation: 'min', value: '1' }, { validation: 'max', value: '8000' }] }] }));
    r.post('/start_job', async (q, s) => { try { s.json(await this.start(q.body, this.identity(q.header('authorization')))); } catch (e) { this.error(s, e); } });
    r.get('/status', async (q, s) => { try { const parsed = z.uuid().safeParse(q.query.job_id); if (!parsed.success) throw new TaskError(400, 'invalid_job_id'); const id = parsed.data; s.json(await this.status(id, this.identity(q.header('authorization')))); } catch (e) { this.error(s, e); } });
    return r;
  }
  private error(res: import('express').Response, error: unknown): void {
    const typed = error instanceof TaskError ? error : new TaskError(503, 'service_unavailable');
    res.status(typed.status).json({ error: { code: typed.code } });
  }
}
