import { z } from 'zod';
import type { CommerceExecutor, ExecutionContext, ExecutionResult, ProviderEvidence, ProviderOffer, ProviderQuote } from '../../contracts/ports.js';
import type { PurchaseIntent, Fulfillment, FlightFulfillment } from '../../contracts/intent.js';
import type { Readiness, ReadinessStatus } from '../../contracts/common.js';
import { formatMinor, money } from '../../contracts/money.js';
import { ProviderError } from '../../core/errors.js';
import { systemClock, type Clock } from '../../infrastructure/clock.js';
import { AtlasClient, AtlasTransportError, DEFAULT_TIMEOUT_MS, type AtlasEndpoint } from './client.js';
import { checkAtlasConfig, missingAtlasEnv, paymentGateEnabled, type AtlasConfig } from './config.js';
import { OfferRef, QuoteRef, atlasSgtToIso, currencyScale, mapSearch, mapVerify, parseRef, toMinor } from './mapping.js';
import { OrderBody, OrderDetailsBody, OrderListRow, PayBody, SearchBody, VerifyBody } from './wire.js';

/**
 * Atlas flight executor (sandbox only).
 *
 * Money safety, in order of importance:
 *  1. order.do is NOT idempotent (clientOrderNo is ignored, duplicate detection is unreliable), so it
 *     is sent at most once per attempt, preceded by a durable `create_attempt` checkpoint. A resumed
 *     execute() that finds that checkpoint never creates again; it reconciles instead.
 *  2. Payment is gated off by default. Supplier credit/prefunding is not an approved architecture;
 *     the only payment mechanism found (pay.do against the sandbox test balance) is reachable only
 *     when ATLAS_ALLOW_TEST_BALANCE_PAYMENT === 'true'. With the gate closed a hold is created and
 *     reported as a definite no-charge failure; it is never reported as a purchase.
 *  3. The order number is checkpointed before pay.do, and a `pay_attempt` checkpoint precedes the
 *     request. After any pay outcome the order is read back; pay.do is never repeated.
 *  4. Provider free text (`msg`) and secrets never reach errors, evidence or logs.
 */

export interface AtlasExecutorOptions {
  fetchImpl?: typeof fetch;
  clock?: Clock;
  timeoutMs?: number;
}

const SOURCE = 'atlas:sandbox';
// A latest readback must explicitly verify zero fees before payment; absence is not zero.
const FeeOrderDetails = OrderDetailsBody.extend({ totalTransactionFee: z.union([z.string(), z.number()]).nullish() });
const PAYMENT_METHOD_BALANCE = 1;
const READINESS_OK_TTL_MS = 10 * 60_000;
const READINESS_BLOCKED_TTL_MS = 2 * 60_000;
const READINESS_ERROR_TTL_MS = 30_000;
/** Allowance for clock skew between us and Atlas when matching order creation times. */
const RECONCILE_SKEW_MS = 60_000;
/** Grace after the ticketing deadline before an unpaid hold is declared lapsed. */
const HOLD_LAPSE_GRACE_MS = 60_000;

export function createAtlasExecutor(env: NodeJS.ProcessEnv, opts: AtlasExecutorOptions = {}): CommerceExecutor {
  return new AtlasExecutor(env, opts);
}

/* ---------------- checkpoint helpers ---------------- */

/**
 * The core persists checkpoints through `redact`, which masks digit runs of 13-19 characters. A
 * long numeric order number would come back as `[REDACTED_NUMBER]` on a fresh context, so an encoded
 * copy (base64url has no long digit runs) is stored beside it and preferred when the raw one is masked.
 */
function orderCheckpoint(orderNo: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { providerReference: orderNo, orderNoB64: Buffer.from(orderNo, 'utf8').toString('base64url'), ...extra };
}

export function readOrderNo(cp: Record<string, unknown> | undefined): string | null {
  if (!cp) return null;
  const raw = cp.providerReference;
  if (typeof raw === 'string' && raw !== '' && !raw.includes('[REDACTED')) return raw;
  const enc = cp.orderNoB64;
  if (typeof enc === 'string' && enc !== '') {
    const dec = Buffer.from(enc, 'base64url').toString('utf8');
    if (/^\S{1,64}$/.test(dec)) return dec;
  }
  return null;
}

class AtlasExecutor implements CommerceExecutor {
  readonly route = 'atlas' as const;
  readonly category = 'flight' as const;
  readonly environment = 'sandbox' as const;

  private readonly clock: Clock;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readyCache: { status: Readiness; until: number } | null = null;

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    opts: AtlasExecutorOptions,
  ) {
    this.clock = opts.clock ?? systemClock;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private now(): Date {
    return this.clock.now();
  }

  private evidence(reference: string, details: Record<string, unknown>): ProviderEvidence[] {
    return [{ source: SOURCE, environment: 'sandbox', evidenceMode: 'fresh_external', reference, observedAt: this.now().toISOString(), details }];
  }

  /** Config for a call that may reach the provider; absent/invalid config means nothing was sent. */
  private config(): AtlasConfig {
    const c = checkAtlasConfig(this.env);
    if (!c.ok) {
      throw new ProviderError('not_sent', 'atlas_not_configured', c.reason === 'missing' ? `missing configuration: ${c.missing.join(', ')}` : c.detail);
    }
    return c.config;
  }

  private client(cfg: AtlasConfig): AtlasClient {
    return new AtlasClient(cfg, this.fetchImpl, this.timeoutMs);
  }

  /** POST + schema validation. A body that does not match the schema is a transport `parse` failure. */
  private async call<T>(client: AtlasClient, endpoint: AtlasEndpoint, body: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    const raw = await client.post(endpoint, body);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new AtlasTransportError('parse', endpoint, null);
    return parsed.data;
  }

  /** Read-only call failures surface as ProviderError; outcome only matters for irreversible calls. */
  private asProviderError(e: unknown): ProviderError {
    if (e instanceof ProviderError) return e;
    if (e instanceof AtlasTransportError) {
      if (e.definitelyNotProcessed) return new ProviderError('rejected', `atlas_http_${e.httpStatus}`, e.message);
      return new ProviderError('unknown', `atlas_${e.kind}`, e.message, e.kind === 'timeout' || e.kind === 'network');
    }
    return new ProviderError('unknown', 'atlas_unexpected', 'unexpected adapter failure');
  }

  /* ---------------- readiness ---------------- */

  async readiness(): Promise<Readiness> {
    try {
      return await this.readinessInner();
    } catch {
      return this.ready('CONFIGURED_UNVERIFIED', [], 'readiness check failed unexpectedly');
    }
  }

  private ready(status: ReadinessStatus, missing: string[], detail: string): Readiness {
    const gate = paymentGateEnabled(this.env)
      ? 'payment gate ENABLED (bounded sandbox test-balance exception)'
      : 'payment gate disabled (holds are created but never paid)';
    return { component: 'atlas', status, environment: 'sandbox', missing, detail: `${detail}; ${gate}`, checkedAt: this.now().toISOString() };
  }

  private async readinessInner(): Promise<Readiness> {
    const cfg = checkAtlasConfig(this.env);
    if (!cfg.ok) {
      if (cfg.reason === 'missing') return this.ready('MISSING_CONFIG', cfg.missing, 'configuration incomplete');
      return this.ready('ACCESS_BLOCKED', [], cfg.detail);
    }
    const t = this.now().getTime();
    if (this.readyCache && this.readyCache.until > t) return this.readyCache.status;

    // Cheap read-only probe: a search on a documented sandbox route ~30 days out. Passes when the
    // provider accepts our credentials and answers with its success envelope (zero offers is fine).
    const date = new Date(t + 30 * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '');
    let status: Readiness;
    let ttl = READINESS_OK_TTL_MS;
    try {
      const client = this.client(cfg.config);
      const body = await this.call(client, '/search.do', { cid: client.cid, tripType: '1', adultNum: 1, childNum: 0, infantNum: 0, fromCity: 'MNL', toCity: 'CEB', fromDate: date }, SearchBody);
      status =
        body.status === 0
          ? this.ready('EXTERNAL_CHECK_PASSED', [], 'sandbox search probe accepted')
          : this.ready('CONFIGURED_UNVERIFIED', [], `sandbox search probe returned provider status ${body.status}`);
    } catch (e) {
      if (e instanceof AtlasTransportError && e.accessBlocked) {
        status = this.ready('ACCESS_BLOCKED', [], `provider rejected credentials (http ${e.httpStatus})`);
        ttl = READINESS_BLOCKED_TTL_MS;
      } else {
        status = this.ready('CONFIGURED_UNVERIFIED', [], e instanceof AtlasTransportError ? `probe failed (${e.kind})` : 'probe failed');
        ttl = READINESS_ERROR_TTL_MS;
      }
    }
    this.readyCache = { status, until: t + ttl };
    return status;
  }

  /* ---------------- search / quote ---------------- */

  async search(intent: PurchaseIntent): Promise<ProviderOffer[]> {
    if (intent.category !== 'flight') throw new ProviderError('rejected', 'atlas_unsupported_category', 'Atlas serves flights only');
    const cfg = this.config();
    const client = this.client(cfg);
    let body;
    try {
      body = await this.call(
        client,
        '/search.do',
        {
          cid: client.cid,
          tripType: '1',
          adultNum: intent.adults,
          childNum: 0,
          infantNum: 0,
          fromCity: intent.from,
          toCity: intent.to,
          fromDate: intent.departDate.replaceAll('-', ''),
        },
        SearchBody,
      );
    } catch (e) {
      throw this.asProviderError(e);
    }
    if (body.status !== 0) throw new ProviderError('rejected', `atlas_search_status_${body.status}`, 'provider rejected the search');
    return mapSearch(body, intent, this.now());
  }

  async quote(offer: { executionRef: Record<string, unknown>; intent: PurchaseIntent }, fulfillment: Fulfillment): Promise<ProviderQuote> {
    if (offer.intent.category !== 'flight' || fulfillment.category !== 'flight') {
      throw new ProviderError('rejected', 'atlas_unsupported_category', 'Atlas serves flights only');
    }
    const ref = parseRef(OfferRef, offer.executionRef, 'offer');
    const cfg = this.config();
    let body;
    try {
      body = await this.call(this.client(cfg), '/verify.do', { routingIdentifier: ref.routingIdentifier, maxResponseTime: 15_000 }, VerifyBody);
    } catch (e) {
      throw this.asProviderError(e);
    }
    if (body.status !== 0) throw new ProviderError('rejected', `atlas_verify_status_${body.status}`, 'provider could not verify the offer');
    return mapVerify(body, offer.intent, fulfillment, this.now());
  }

  /* ---------------- execute ---------------- */

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    let ref: QuoteRef;
    let cfg: AtlasConfig;
    try {
      ref = parseRef(QuoteRef, ctx.quote.executionRef, 'quote');
      cfg = this.config();
    } catch (e) {
      const pe = e instanceof ProviderError ? e : null;
      return { kind: 'failed_definite', reason: pe ? `${pe.providerCode}: ${pe.message}` : 'atlas_not_configured', providerReference: null, evidence: [] };
    }
    if (ctx.fulfillment.category !== 'flight' || ctx.fulfillment.passengers.length !== ref.adults) {
      return { kind: 'failed_definite', reason: 'atlas_traveller_data_mismatch: fulfillment does not match the quote', providerReference: null, evidence: [] };
    }
    const client = this.client(cfg);

    let orderNo = readOrderNo(ctx.checkpoints['order']);
    if (!orderNo) {
      // A started create is never repeated: order.do is not idempotent. Reconcile instead.
      if (ctx.checkpoints['create_attempt']) return this.retrieve(ctx);
      const created = await this.createHold(ctx, ref, client, ctx.fulfillment);
      if ('result' in created) return created.result;
      orderNo = created.orderNo;
    } else if (ctx.checkpoints['pay_attempt'] || ctx.checkpoints['order']?.adopted === true) {
      // Resumed after a pay attempt began (pay.do is never repeated) or on an adopted order (never paid): read back only.
      return this.retrieve(ctx);
    }

    // Payment gate. Supplier prefunding is not an approved architecture: closed by default.
    if (!cfg.allowTestBalancePayment) {
      return {
        kind: 'failed_definite',
        reason: 'atlas_payment_mechanism_not_approved',
        providerReference: orderNo,
        evidence: this.evidence(orderNo, { stage: 'hold_created', paymentGate: 'closed', note: 'nothing charged; hold lapses at the ticketing deadline' }),
      };
    }
    return this.payHold(ctx, ref, client, orderNo);
  }

  /** Create the held order exactly once. Returns a terminal result or the order number to continue with. */
  private async createHold(
    ctx: ExecutionContext,
    ref: QuoteRef,
    client: AtlasClient,
    f: FlightFulfillment,
  ): Promise<{ orderNo: string } | { result: ExecutionResult }> {
    const reqBody = {
      sessionId: ref.sessionId,
      passengers: f.passengers.map((p) => ({
        name: `${p.familyName.toUpperCase()}/${p.givenName.toUpperCase()}`,
        passengerType: 0, // adult
        gender: p.gender,
        birthday: p.birthday.replaceAll('-', ''),
        nationality: p.nationality,
        // Document field names/values per Atlas bookingRequirement; cardType 'PP' (passport) is UNVERIFIED.
        ...(p.document
          ? { cardNum: p.document.number, cardType: 'PP', cardExpired: p.document.expiry.replaceAll('-', ''), cardIssuePlace: p.document.issuingCountry }
          : {}),
      })),
      contact: { name: `${f.contact.familyName}/${f.contact.givenName}`, email: f.contact.email, mobile: f.contact.mobile },
    };

    // Durable BEFORE the request: its presence later proves a create may have been sent.
    await ctx.checkpoint('create_attempt', { at: this.now().toISOString() });

    let body: OrderBody;
    try {
      body = await this.call(client, '/order.do', reqBody, OrderBody);
    } catch (e) {
      if (e instanceof AtlasTransportError && e.definitelyNotProcessed) {
        return { result: { kind: 'failed_definite', reason: `atlas_order_http_${e.httpStatus}`, providerReference: null, evidence: [] } };
      }
      const kind = e instanceof AtlasTransportError ? e.kind : 'unexpected';
      return { result: { kind: 'unknown', reason: `atlas_create_outcome_unknown (${kind})`, providerReference: null, evidence: [] } };
    }

    const orderNo = body.orderNo ?? null;
    if (body.status !== 0) {
      // A non-success envelope that still names an order is ambiguous; never discard the reference.
      if (orderNo) return { result: { kind: 'unknown', reason: `atlas_order_status_${body.status}_with_reference`, providerReference: orderNo, evidence: [] } };
      // 318 = duplicate detection. It never adopts someone else's order; this call created nothing.
      const reason = body.status === 318 ? 'atlas_duplicate_order' : `atlas_order_rejected_status_${body.status}`;
      return { result: { kind: 'failed_definite', reason, providerReference: null, evidence: [] } };
    }
    if (!orderNo) {
      return { result: { kind: 'unknown', reason: 'atlas_order_missing_reference', providerReference: null, evidence: [] } };
    }

    await ctx.checkpoint('order', orderCheckpoint(orderNo, { pnrCode: body.pnrCode ?? null, tktLimitTime: body.tktLimitTime ?? null }));

    // Price guard: never pay (or report as purchasable) an order whose total differs from the quote.
    const totalCheck = await this.checkOrderTotal(client, body, ref);
    if (totalCheck.kind === 'unverifiable') {
      return { result: { kind: 'unknown', reason: 'atlas_order_total_unverifiable', providerReference: orderNo, evidence: this.evidence(orderNo, { stage: 'hold_created' }) } };
    }
    if (totalCheck.kind === 'mismatch') {
      return {
        result: {
          kind: 'terms_changed',
          reason: `atlas_order_total_changed: ${totalCheck.detail}`,
          evidence: this.evidence(orderNo, { stage: 'hold_created', detail: totalCheck.detail, note: 'not paid; hold lapses at the ticketing deadline' }),
        },
      };
    }
    return { orderNo };
  }

  private feeState(fee: OrderBody['totalTransactionFee'], scale: number): 'zero' | 'nonzero' | 'unverifiable' {
    if (fee == null || (typeof fee === 'string' && fee.trim() === '')) return 'unverifiable';
    try { return toMinor(fee, scale) === 0n ? 'zero' : 'nonzero'; }
    catch { return 'unverifiable'; }
  }

  /**
   * The all-in meaning of totalPrice versus totalTransactionFee is unverified. Only an explicit
   * zero fee is supported: accepting either total alone or total plus fee could underfund payment.
   */
  private async checkOrderTotal(
    client: AtlasClient,
    body: OrderBody,
    ref: QuoteRef,
  ): Promise<{ kind: 'ok' } | { kind: 'mismatch'; detail: string } | { kind: 'unverifiable' }> {
    const fee = this.feeState(body.totalTransactionFee, ref.scale);
    if (fee === 'unverifiable') return { kind: 'unverifiable' };
    if (fee === 'nonzero') return { kind: 'mismatch', detail: 'nonzero transaction fee is unsupported until all-in fee semantics are verified' };
    let total = body.totalPrice;
    let currency = body.currency;
    if (total == null || !currency) {
      try {
        const d = await this.call(client, '/queryOrderDetails.do', { orderNo: body.orderNo }, FeeOrderDetails);
        if (d.status !== 0) return { kind: 'unverifiable' };
        const readbackFee = this.feeState(d.totalTransactionFee, ref.scale);
        if (readbackFee === 'unverifiable') return { kind: 'unverifiable' };
        if (readbackFee === 'nonzero') return { kind: 'mismatch', detail: 'readback reports an unsupported nonzero transaction fee' };
        total = d.totalPrice;
        currency = d.currency;
      } catch {
        return { kind: 'unverifiable' };
      }
    }
    if (total == null || !currency) return { kind: 'unverifiable' };
    const expected = BigInt(ref.expectedTotalMinor);
    const quoted = formatMinor(money(ref.currency, expected, ref.scale));
    if (currency !== ref.currency) return { kind: 'mismatch', detail: `currency ${currency} differs from quoted ${ref.currency}` };
    try {
      const t = toMinor(total, ref.scale);
      if (t === expected) return { kind: 'ok' };
      return { kind: 'mismatch', detail: `quoted ${quoted}, order ${formatMinor(money(currency, t, ref.scale))}` };
    } catch {
      return { kind: 'mismatch', detail: `quoted ${quoted}, order total not exactly representable` };
    }
  }

  /** Gate-open payment path: pre-check, checkpoint, pay once, read back. Never repeats pay.do. */
  private async payHold(ctx: ExecutionContext, ref: QuoteRef, client: AtlasClient, orderNo: string): Promise<ExecutionResult> {
    // Pre-check: the only state a payment may be issued against is a held order at the quoted total.
    let pre: z.infer<typeof FeeOrderDetails>;
    try {
      pre = await this.call(client, '/queryOrderDetails.do', { orderNo }, FeeOrderDetails);
    } catch {
      return { kind: 'unknown', reason: 'atlas_precheck_unavailable', providerReference: orderNo, evidence: [] };
    }
    if (pre.status !== 0) return { kind: 'unknown', reason: 'atlas_precheck_unavailable', providerReference: orderNo, evidence: [] };
    const st = pre.orderStatus == null ? null : String(pre.orderStatus);
    if (st === '1' || st === '2') {
      return { kind: 'unknown', reason: 'atlas_order_paid_before_pay_attempt', providerReference: orderNo, evidence: this.evidence(orderNo, { orderStatus: st }) };
    }
    if (st === '-3') return { kind: 'failed_definite', reason: 'atlas_order_cancelled', providerReference: orderNo, evidence: this.evidence(orderNo, { orderStatus: st }) };
    if (st !== '0') return { kind: 'unknown', reason: 'atlas_precheck_unmapped_status', providerReference: orderNo, evidence: [] };
    const fee = this.feeState(pre.totalTransactionFee, ref.scale);
    if (fee !== 'zero') {
      return fee === 'nonzero'
        ? { kind: 'terms_changed', reason: 'atlas_precheck_nonzero_fee_unsupported', evidence: this.evidence(orderNo, { stage: 'pre_pay_check', note: 'not paid; all-in fee semantics are unverified' }) }
        : { kind: 'unknown', reason: 'atlas_precheck_fee_unverifiable', providerReference: orderNo, evidence: [] };
    }
    const expected = BigInt(ref.expectedTotalMinor);
    let totalOk = false;
    try {
      totalOk = pre.currency === ref.currency && pre.totalPrice != null && toMinor(pre.totalPrice, ref.scale) === expected;
    } catch {
      totalOk = false;
    }
    if (!totalOk) {
      return { kind: 'terms_changed', reason: 'atlas_precheck_total_mismatch', evidence: this.evidence(orderNo, { stage: 'pre_pay_check', note: 'not paid' }) };
    }

    // Durable BEFORE pay.do.
    await ctx.checkpoint('pay_attempt', orderCheckpoint(orderNo, { at: this.now().toISOString(), paymentMechanism: 'sandbox_test_balance' }));

    let payOutcome: 'accepted' | 'rejected' | 'ambiguous';
    let payStatus: number | string = 'none';
    try {
      const pay = await this.call(client, '/pay.do', { orderNo, paymentMethod: PAYMENT_METHOD_BALANCE }, PayBody);
      payStatus = pay.status;
      // 0 accepted; 404 already paid, 402 beyond payment stage, 406 in progress: all settled by readback, never re-paid.
      payOutcome = pay.status === 0 ? 'accepted' : [404, 402, 406].includes(pay.status) ? 'ambiguous' : 'rejected';
    } catch (e) {
      if (e instanceof AtlasTransportError && e.definitelyNotProcessed) {
        payOutcome = 'rejected';
        payStatus = `http_${e.httpStatus}`;
      } else {
        payOutcome = 'ambiguous';
        payStatus = e instanceof AtlasTransportError ? e.kind : 'unexpected';
      }
    }

    const rb = await this.readback(client, ref, orderNo, { payAttempted: true, adopted: false });
    // An explicit rejection with the order still held is a definite no-charge failure.
    if (payOutcome === 'rejected' && rb.kind === 'unknown' && rb.reason === HELD_PAYMENT_PENDING) {
      return { kind: 'failed_definite', reason: `atlas_pay_rejected (${payStatus})`, providerReference: orderNo, evidence: this.evidence(orderNo, { stage: 'pay_rejected', payStatus }) };
    }
    return rb;
  }

  /* ---------------- retrieve ---------------- */

  async retrieve(ctx: ExecutionContext): Promise<ExecutionResult> {
    let ref: QuoteRef;
    let client: AtlasClient;
    try {
      ref = parseRef(QuoteRef, ctx.quote.executionRef, 'quote');
      client = this.client(this.config());
    } catch {
      return { kind: 'unknown', reason: 'atlas_not_configured', providerReference: null, evidence: [] };
    }

    const orderCp = ctx.checkpoints['order'];
    let orderNo = readOrderNo(orderCp);
    let adopted = orderCp?.adopted === true;
    if (!orderNo) {
      const attempt = ctx.checkpoints['create_attempt'];
      // The create_attempt checkpoint is durable before order.do is sent, so its absence proves no create was sent.
      if (!attempt) return { kind: 'failed_definite', reason: 'atlas_create_not_attempted', providerReference: null, evidence: [] };
      const found = await this.findCreatedOrder(client, ctx, ref, attempt);
      if (found.kind !== 'found') return { kind: 'unknown', reason: found.reason, providerReference: null, evidence: [] };
      orderNo = found.orderNo;
      adopted = true;
      await ctx.checkpoint('order', orderCheckpoint(orderNo, { adopted: true, adoptedBy: 'orderList' }));
    }
    const payAttempted = !!ctx.checkpoints['pay_attempt'];
    return this.readback(client, ref, orderNo, { payAttempted, adopted, tktLimitTime: typeof orderCp?.tktLimitTime === 'string' ? orderCp.tktLimitTime : null });
  }

  /**
   * Find the order a create of unknown outcome may have produced. Atlas has no client reference, so
   * this matches on contact e-mail, traveller names, route, departure date and creation time inside
   * the attempt window, and only a UNIQUE match is adopted. The adopted order is never paid.
   */
  private async findCreatedOrder(
    client: AtlasClient,
    ctx: ExecutionContext,
    ref: QuoteRef,
    attempt: Record<string, unknown>,
  ): Promise<{ kind: 'found'; orderNo: string } | { kind: 'none'; reason: string }> {
    const f = ctx.fulfillment;
    const at = typeof attempt.at === 'string' ? Date.parse(attempt.at) : NaN;
    if (f.category !== 'flight' || Number.isNaN(at)) return { kind: 'none', reason: 'atlas_create_outcome_unknown (no attempt time)' };
    let raw: unknown;
    try {
      raw = await client.post('/orderList.do', { pageNo: 1, pageSize: 50 });
    } catch {
      return { kind: 'none', reason: 'atlas_create_outcome_unknown (order list unavailable)' };
    }
    const wantNames = f.passengers.map((p) => `${p.familyName}/${p.givenName}`.toUpperCase()).sort().join('|');
    const wantEmail = f.contact.email.toLowerCase();
    const wantDate = ref.departDate.replaceAll('-', '');
    const nowMs = this.now().getTime();
    const matches = extractRows(raw).filter((row) => {
      const created = parseTimestamp(row.orderCreateTimestamp);
      if (created === null || created < at - RECONCILE_SKEW_MS || created > nowMs + RECONCILE_SKEW_MS) return false;
      const names = (Array.isArray(row.paxNames) ? row.paxNames : typeof row.paxNames === 'string' ? row.paxNames.split(/[,;]/) : [])
        .map((n) => n.trim().toUpperCase())
        .filter(Boolean)
        .sort()
        .join('|');
      return (
        !!row.orderNo &&
        names === wantNames &&
        (row.contactEmail ?? '').toLowerCase() === wantEmail &&
        (row.fromCity ?? '').toUpperCase() === ref.from &&
        (row.toCity ?? '').toUpperCase() === ref.to &&
        String(row.depDate ?? '').replace(/\D/g, '').slice(0, 8) === wantDate
      );
    });
    const refs = [...new Set(matches.map((m) => m.orderNo as string))];
    if (refs.length === 1) return { kind: 'found', orderNo: refs[0]! };
    return { kind: 'none', reason: refs.length === 0 ? 'atlas_create_outcome_unknown (no matching order found)' : 'atlas_create_outcome_unknown (several matching orders)' };
  }

  /** Read the order and map Atlas state to an ExecutionResult. Read-only; never pays. */
  private async readback(
    client: AtlasClient,
    ref: QuoteRef,
    orderNo: string,
    s: { payAttempted: boolean; adopted: boolean; tktLimitTime?: string | null },
  ): Promise<ExecutionResult> {
    let d: OrderDetailsBody;
    try {
      d = await this.call(client, '/queryOrderDetails.do', { orderNo }, OrderDetailsBody);
    } catch {
      return { kind: 'unknown', reason: 'atlas_readback_unavailable', providerReference: orderNo, evidence: [] };
    }
    if (d.status !== 0) return { kind: 'unknown', reason: `atlas_readback_status_${d.status}`, providerReference: orderNo, evidence: [] };
    if (d.orderNo !== orderNo) return { kind: 'unknown', reason: 'atlas_readback_reference_mismatch', providerReference: orderNo, evidence: [] };

    const st = d.orderStatus == null ? null : String(d.orderStatus);
    const ts = d.ticketStatus == null ? null : String(d.ticketStatus);
    const currency = d.currency ?? ref.currency;
    const scale = currencyScale(currency);
    let observed: bigint | null = null;
    try {
      observed = d.totalPrice == null ? null : toMinor(d.totalPrice, scale);
    } catch {
      observed = null;
    }
    // Ticket numbers persist on cancelled orders: only counts are recorded, and they never imply ticketing.
    const details = {
      orderStatus: st,
      ticketStatus: ts,
      currency,
      totalMinor: observed === null ? null : observed.toString(),
      pnrCode: d.pnrCode ?? null,
      tktLimitTime: d.tktLimitTime ?? null,
      paid: !!d.payTime,
      passengerRecords: d.paxTicketInfos?.length ?? 0,
      paymentMechanism: s.payAttempted ? 'sandbox_test_balance' : 'none',
    };
    const ev = this.evidence(orderNo, details);
    const unknown = (reason: string): ExecutionResult => ({ kind: 'unknown', reason, providerReference: orderNo, evidence: ev });

    switch (st) {
      case '0': {
        if (s.payAttempted) return unknown(HELD_PAYMENT_PENDING);
        // We never paid it. Once the ticketing deadline has passed the hold cannot become a purchase.
        const lapse = atlasSgtToIso(d.tktLimitTime) ?? atlasSgtToIso(s.tktLimitTime);
        if (lapse && this.now().getTime() > Date.parse(lapse) + HOLD_LAPSE_GRACE_MS) {
          return { kind: 'failed_definite', reason: 'atlas_hold_lapsed_unpaid', providerReference: orderNo, evidence: ev };
        }
        return unknown('atlas_order_held_unpaid');
      }
      case '1':
      case '2': {
        // Paid states only count as our purchase if we paid. Otherwise someone else did: do not claim it.
        if (!s.payAttempted) return unknown(s.adopted ? 'atlas_adopted_order_unexpectedly_paid' : 'atlas_order_paid_without_pay_attempt');
        if (!d.currency || observed === null) return unknown('atlas_paid_amount_unverifiable');
        const chargedAmount = money(currency, observed, scale);
        const ticketed = st === '2' && ts === '1';
        return {
          kind: 'succeeded',
          providerReference: orderNo,
          commerceStatus: ticketed ? 'ticketed' : 'ticketing',
          merchantPaymentStatus: 'test_balance_paid',
          chargedAmount,
          evidence: ev,
        };
      }
      case '-3':
        // Cancelled after a payment time was recorded: refund state is unverifiable here.
        if (s.payAttempted && d.payTime) return unknown('atlas_cancelled_after_payment');
        return { kind: 'failed_definite', reason: 'atlas_order_cancelled', providerReference: orderNo, evidence: ev };
      default:
        return unknown(st === null ? 'atlas_readback_no_status' : 'atlas_readback_unmapped_status');
    }
  }
}

/** Reason string shared between readback and the pay path to recognise "still held after a pay attempt". */
const HELD_PAYMENT_PENDING = 'atlas_payment_pending_or_not_accepted';

/* ---------------- orderList parsing (container key and timestamp format UNVERIFIED) ---------------- */

function extractRows(raw: unknown): OrderListRow[] {
  const rows: unknown[] = [];
  const consider = (v: unknown): boolean => {
    if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'object' && x !== null && 'orderNo' in x)) {
      rows.push(...v);
      return true;
    }
    return false;
  };
  if (!raw || typeof raw !== 'object') return [];
  const top = raw as Record<string, unknown>;
  if (top.status !== 0) return [];
  for (const k of ['orders', 'orderList', 'list', 'records', 'items', 'data']) if (consider(top[k])) break;
  if (rows.length === 0) {
    const data = top.data;
    if (data && typeof data === 'object') for (const v of Object.values(data as Record<string, unknown>)) if (consider(v)) break;
  }
  if (rows.length === 0) for (const v of Object.values(top)) if (consider(v)) break;
  return rows.flatMap((r) => {
    const p = OrderListRow.safeParse(r);
    return p.success ? [p.data] : [];
  });
}

/** Epoch (s or ms), ISO-8601, or Atlas SGT `yyyy-MM-dd HH:mm:ss` -> epoch ms; null when unparseable. */
function parseTimestamp(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || /^\d+$/.test(v)) {
    const n = Number(v);
    return n > 1e11 ? n : n > 1e8 ? n * 1000 : null;
  }
  const sgt = atlasSgtToIso(v);
  const t = Date.parse(sgt ?? v);
  return Number.isNaN(t) ? null : t;
}
