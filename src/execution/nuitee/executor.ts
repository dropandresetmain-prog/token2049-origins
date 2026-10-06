import type { HotelIntent, HotelFulfillment, Fulfillment, PurchaseIntent } from '../../contracts/index.js';
import type { Readiness } from '../../contracts/common.js';
import type { Money } from '../../contracts/money.js';
import { moneyOf, pickTotal } from './money.js';
import type {
  CommerceExecutor,
  ExecutionContext,
  ExecutionResult,
  ProviderEvidence,
  ProviderOffer,
  ProviderQuote,
} from '../../contracts/ports.js';
import { ProviderError } from '../../core/errors.js';
import { systemClock, type Clock } from '../../infrastructure/clock.js';
import {
  bookBody,
  bookingIdsForReference,
  classifyBookFailure,
  clientReferenceFor,
  parseBooking,
  type ParsedBooking,
} from './booking.js';
import { keyEnvironmentHint, loadNuiteeConfig, type NuiteeConfig } from './config.js';
import { NuiteeHttp, describeOutcome, type HttpOutcome } from './http.js';
import { OfferRef, PrebookRef, QUOTE_TTL_MS, mapPrebook, mapSearch, prebookBody, searchBody } from './offers.js';
import { CurrenciesResponse } from './schemas.js';

export interface NuiteeOptions {
  fetchImpl?: typeof fetch;
  clock?: Clock;
  /** Per-request timeout; liteAPI calls use 15s. */
  timeoutMs?: number;
}

const READINESS_TTL_MS = 5 * 60_000;
const SOURCE = 'nuitee';

/**
 * Nuitee (liteAPI) hotel executor, sandbox only.
 *
 * Money safety summary:
 *  - the prebook price is the quote; the book response/readback price is what we report as charged;
 *  - a `book_attempt` checkpoint (with the deterministic clientReference) is durable BEFORE the book
 *    request leaves the process, so every later ambiguity can be reconciled by reference;
 *  - only an explicit provider refusal is `failed_definite`; timeouts, 5xx and unparseable responses are `unknown`;
 *  - `succeeded` requires an independent GET /bookings/{id} showing CONFIRMED + payment succeeded + sandbox flag.
 */
export function createNuiteeExecutor(env: NodeJS.ProcessEnv, opts: NuiteeOptions = {}): CommerceExecutor {
  return new NuiteeExecutor(env, opts);
}

class NuiteeExecutor implements CommerceExecutor {
  readonly route = 'nuitee' as const;
  readonly category = 'hotel' as const;
  readonly environment = 'sandbox' as const;

  private readonly clock: Clock;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private cachedReadiness: { at: number; value: Readiness } | null = null;

  constructor(
    private readonly env: NodeJS.ProcessEnv,
    opts: NuiteeOptions,
  ) {
    this.clock = opts.clock ?? systemClock;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  /* ---------------- plumbing ---------------- */

  private nowIso(): string {
    return this.clock.now().toISOString();
  }

  /** Config + client, or a ProviderError('not_sent') that nothing was attempted. */
  private connect(): { cfg: NuiteeConfig; http: NuiteeHttp } {
    const r = loadNuiteeConfig(this.env);
    if (!r.ok) {
      throw new ProviderError('not_sent', 'not_configured', r.kind === 'missing' ? `missing configuration: ${r.missing.join(', ')}` : r.reason);
    }
    return { cfg: r.config, http: new NuiteeHttp({ apiKey: r.config.apiKey, fetchImpl: this.fetchImpl, timeoutMs: this.timeoutMs }) };
  }

  /** Map a failed read/prebook outcome to a ProviderError (reasons never contain request data). */
  private fail(o: HttpOutcome, op: string): ProviderError {
    if (o.kind === 'transport') return new ProviderError('unknown', `transport_${o.reason}`, `${op}: ${describeOutcome(o)}`, true);
    if (o.kind === 'provider_error') {
      const code = o.code === null ? `http_${o.status}` : String(o.code);
      // 4xx is a refusal; 5xx / 408 may mean the provider did work we cannot see.
      const refused = o.status >= 400 && o.status < 500 && o.status !== 408;
      return new ProviderError(refused ? 'rejected' : 'unknown', code, `${op}: ${describeOutcome(o)}`, !refused);
    }
    return new ProviderError('unknown', 'bad_response', `${op}: ${describeOutcome(o)}`);
  }

  private evidence(op: string, reference: string, details: Record<string, unknown>): ProviderEvidence {
    return { source: `${SOURCE}:${op}`, environment: 'sandbox', evidenceMode: 'fresh_external', reference, observedAt: this.nowIso(), details };
  }

  /* ---------------- readiness ---------------- */

  async readiness(): Promise<Readiness> {
    const cached = this.cachedReadiness;
    if (cached && this.clock.now().getTime() - cached.at < READINESS_TTL_MS) return cached.value;
    let value: Readiness;
    try {
      value = await this.checkReadiness();
    } catch {
      // Readiness must never throw; an unexpected failure is "could not verify".
      value = this.ready('CONFIGURED_UNVERIFIED', 'readiness check failed unexpectedly');
    }
    this.cachedReadiness = { at: this.clock.now().getTime(), value };
    return value;
  }

  private ready(status: Readiness['status'], detail?: string, missing: string[] = []): Readiness {
    return { component: 'nuitee', status, environment: 'sandbox', missing, ...(detail ? { detail } : {}), checkedAt: this.nowIso() };
  }

  private async checkReadiness(): Promise<Readiness> {
    const r = loadNuiteeConfig(this.env);
    if (!r.ok) {
      return r.kind === 'missing'
        ? this.ready('MISSING_CONFIG', undefined, r.missing)
        : this.ready('ACCESS_BLOCKED', r.reason);
    }
    const hint = keyEnvironmentHint(r.config.apiKey);
    if (hint === 'production') {
      return this.ready('ACCESS_BLOCKED', 'API key prefix indicates a production key; this sandbox lane refuses to book with it');
    }
    const note = hint === 'unknown' ? ' Key prefix is not recognised as a sandbox key.' : '';
    // Cheap authenticated read of reference data: proves the key is accepted, nothing more.
    const http = new NuiteeHttp({ apiKey: r.config.apiKey, fetchImpl: this.fetchImpl, timeoutMs: this.timeoutMs });
    const o = await http.request('GET', `${r.config.searchBaseUrl}/data/currencies`);
    if (o.kind === 'ok' && CurrenciesResponse.safeParse(o.json).success) {
      return this.ready('EXTERNAL_CHECK_PASSED', `API key accepted by GET /data/currencies; search/prebook/book access not exercised.${note}`);
    }
    if (o.kind === 'provider_error' && (o.status === 401 || o.status === 403)) {
      return this.ready('ACCESS_BLOCKED', `API key rejected (HTTP ${o.status})`);
    }
    return this.ready('CONFIGURED_UNVERIFIED', `external check inconclusive: ${describeOutcome(o)}.${note}`);
  }

  /* ---------------- search ---------------- */

  async search(intent: PurchaseIntent): Promise<ProviderOffer[]> {
    const hotel = this.hotelIntent(intent);
    const { cfg, http } = this.connect();
    const o = await http.request('POST', `${cfg.searchBaseUrl}/hotels/rates`, searchBody(hotel));
    if (o.kind === 'ok') return mapSearch(o.json, hotel, this.clock.now());
    // 2001 on search means no honourable inventory for the basket: an empty result, not a failure.
    if (o.kind === 'provider_error' && o.code === 2001) return [];
    throw this.fail(o, 'search');
  }

  private hotelIntent(intent: PurchaseIntent): HotelIntent {
    if (intent.category !== 'hotel') throw new ProviderError('not_sent', 'unsupported_category', 'nuitee only serves hotel intents');
    return intent;
  }

  /* ---------------- quote (prebook) ---------------- */

  async quote(offer: { executionRef: Record<string, unknown>; intent: PurchaseIntent }, fulfillment: Fulfillment): Promise<ProviderQuote> {
    const intent = this.hotelIntent(offer.intent);
    const ref = OfferRef.safeParse(offer.executionRef);
    if (!ref.success) throw new ProviderError('not_sent', 'invalid_execution_ref', 'offer reference is not a nuitee offer');
    if (fulfillment.category !== 'hotel') throw new ProviderError('not_sent', 'invalid_fulfillment', 'hotel fulfillment required');
    this.checkTravellers(fulfillment, intent);
    const { cfg, http } = this.connect();
    const o = await http.request('POST', `${cfg.bookingBaseUrl}/rates/prebook`, prebookBody(ref.data));
    if (o.kind !== 'ok') throw this.fail(o, 'prebook');
    const q = mapPrebook(o.json, ref.data, intent);
    return { ...q, expiresAt: new Date(this.clock.now().getTime() + QUOTE_TTL_MS).toISOString() };
  }

  /** Every occupancy needs at least one named guest and no guest may point at a room that was not requested. */
  private checkTravellers(f: HotelFulfillment, intent: HotelIntent): void {
    const rooms = intent.occupancies.length;
    const covered = new Set<number>();
    for (const g of f.guests) {
      if (g.occupancyNumber < 1 || g.occupancyNumber > rooms) {
        throw new ProviderError('not_sent', 'invalid_fulfillment', 'a guest references a room that is not in the search');
      }
      covered.add(g.occupancyNumber);
    }
    if (covered.size !== rooms) throw new ProviderError('not_sent', 'invalid_fulfillment', 'every requested room needs at least one guest');
  }

  /* ---------------- execute ---------------- */

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    // Refusals before anything is sent are definite by construction.
    const refuse = (reason: string): ExecutionResult => ({ kind: 'failed_definite', reason, providerReference: null, evidence: [] });
    let conn: { cfg: NuiteeConfig; http: NuiteeHttp };
    try {
      conn = this.connect();
    } catch (e) {
      return refuse(`not attempted: ${(e as Error).message}`);
    }
    if (keyEnvironmentHint(conn.cfg.apiKey) === 'production') return refuse('not attempted: production API key refused by the sandbox lane');
    const ref = PrebookRef.safeParse(ctx.quote.executionRef);
    if (!ref.success) return refuse('not attempted: quote reference is not a nuitee prebook');
    if (ctx.fulfillment.category !== 'hotel') return refuse('not attempted: hotel fulfillment required');
    const fulfillment = ctx.fulfillment;

    const priorBooking = stringField(ctx.checkpoints['booking'], 'providerReference');
    const priorAttempt = ctx.checkpoints['book_attempt'];
    const clientReference = stringField(priorAttempt, 'clientReference') ?? clientReferenceFor(ctx.idempotencyKey);

    // Resume paths: never send a second book request for an attempt that already began.
    if (priorBooking) return this.readBack(conn, ctx, priorBooking, clientReference, ref.data, null);
    if (priorAttempt) return this.reconcile(conn, ctx, clientReference, ref.data, 'resumed after an interrupted book attempt');

    // Durable BEFORE the request leaves the process. If this fails nothing was sent, so it is definite.
    try {
      await ctx.checkpoint('book_attempt', { clientReference });
    } catch {
      return refuse('not attempted: could not persist the book_attempt checkpoint');
    }

    const o = await conn.http.request('POST', `${conn.cfg.bookingBaseUrl}/rates/book`, bookBody(fulfillment, ref.data.prebookId, clientReference));
    const attemptEvidence = (extra: Record<string, unknown>): ProviderEvidence[] => [this.evidence('book', clientReference, { clientReference, ...extra })];

    if (o.kind === 'transport') {
      return { kind: 'unknown', reason: `book request outcome unknown (${describeOutcome(o)}); reconcile by client reference`, providerReference: null, evidence: attemptEvidence({ outcome: describeOutcome(o) }) };
    }
    if (o.kind === 'provider_error') {
      const c = classifyBookFailure(o);
      const detail = { httpStatus: o.status, providerCode: o.code };
      if (c === 'definite') {
        return { kind: 'failed_definite', reason: `provider refused the booking (${describeOutcome(o)}); nothing was booked`, providerReference: null, evidence: attemptEvidence(detail) };
      }
      if (c === 'duplicate') return this.reconcile(conn, ctx, clientReference, ref.data, 'provider reported a duplicate client reference (4005)');
      return { kind: 'unknown', reason: `book failed ambiguously (${describeOutcome(o)}); reconcile by client reference`, providerReference: null, evidence: attemptEvidence(detail) };
    }
    if (o.kind === 'bad_body') return this.reconcile(conn, ctx, clientReference, ref.data, 'book response was not JSON');

    const booked = parseBooking(o.json, ctx.quote.merchantTotal);
    if (!booked || !booked.bookingId) return this.reconcile(conn, ctx, clientReference, ref.data, 'book response carried no booking id');
    // A booking now exists: persist its reference before anything else can fail.
    try {
      await ctx.checkpoint('booking', { providerReference: booked.bookingId, clientReference });
    } catch {
      return { kind: 'unknown', reason: 'booking created but its reference could not be checkpointed; reconcile', providerReference: booked.bookingId, evidence: attemptEvidence({ bookingStatus: booked.status }) };
    }
    return this.readBack(conn, ctx, booked.bookingId, clientReference, ref.data, booked);
  }

  /* ---------------- retrieve ---------------- */

  async retrieve(ctx: ExecutionContext): Promise<ExecutionResult> {
    const unknown = (reason: string, providerReference: string | null = null): ExecutionResult => ({ kind: 'unknown', reason, providerReference, evidence: [] });
    let conn: { cfg: NuiteeConfig; http: NuiteeHttp };
    try {
      conn = this.connect();
    } catch (e) {
      return unknown(`readback not possible: ${(e as Error).message}`);
    }
    const ref = PrebookRef.safeParse(ctx.quote.executionRef);
    const clientReference = stringField(ctx.checkpoints['book_attempt'], 'clientReference') ?? clientReferenceFor(ctx.idempotencyKey);
    const bookingId = stringField(ctx.checkpoints['booking'], 'providerReference');
    if (bookingId) return this.readBack(conn, ctx, bookingId, clientReference, ref.success ? ref.data : null, null);
    return this.reconcile(conn, ctx, clientReference, ref.success ? ref.data : null, 'no booking checkpoint');
  }

  /* ---------------- shared readback / reconciliation ---------------- */

  /** Find the booking for our client reference. Absence is never proof that nothing was booked. */
  private async reconcile(
    conn: { cfg: NuiteeConfig; http: NuiteeHttp },
    ctx: ExecutionContext,
    clientReference: string,
    ref: PrebookRef | null,
    why: string,
  ): Promise<ExecutionResult> {
    const unknown = (reason: string): ExecutionResult => ({ kind: 'unknown', reason: `${why}; ${reason}`, providerReference: null, evidence: [this.evidence('lookup', clientReference, { clientReference })] });
    const o = await conn.http.request('GET', `${conn.cfg.bookingBaseUrl}/bookings?clientReference=${encodeURIComponent(clientReference)}`);
    if (o.kind !== 'ok') return unknown(`lookup by client reference failed (${describeOutcome(o)})`);
    const ids = bookingIdsForReference(o.json, clientReference);
    if (ids.length === 0) return unknown('no booking found for the client reference (the filter is undocumented, so this is not proof nothing was booked)');
    if (ids.length > 1) return unknown('several bookings share the client reference; manual review required');
    const bookingId = ids[0]!;
    try {
      await ctx.checkpoint('booking', { providerReference: bookingId, clientReference });
    } catch {
      /* Best effort: the reference is still returned in the result and persisted from there. */
    }
    return this.readBack(conn, ctx, bookingId, clientReference, ref, null);
  }

  /**
   * Independent readback (GET /bookings/{id}) and mapping to an ExecutionResult.
   * `bookResponse` is the parsed POST /rates/book body when available; the charged amount is the
   * higher of the two provider-reported prices if they ever disagree.
   */
  private async readBack(
    conn: { cfg: NuiteeConfig; http: NuiteeHttp },
    ctx: ExecutionContext,
    bookingId: string,
    clientReference: string,
    ref: PrebookRef | null,
    bookResponse: ParsedBooking | null,
  ): Promise<ExecutionResult> {
    const unknown = (reason: string, details: Record<string, unknown> = {}): ExecutionResult => ({
      kind: 'unknown',
      reason,
      providerReference: bookingId,
      evidence: [this.evidence('readback', bookingId, { clientReference, ...details })],
    });
    const o = await conn.http.request('GET', `${conn.cfg.bookingBaseUrl}/bookings/${encodeURIComponent(bookingId)}`);
    if (o.kind !== 'ok') return unknown(`booking ${bookingId} readback failed (${describeOutcome(o)})`);
    const b = parseBooking(o.json, ctx.quote.merchantTotal);
    if (!b) return unknown(`booking ${bookingId} readback did not match the expected shape`);

    const status = (b.status ?? '').toUpperCase();
    const payment = (b.paymentStatus ?? '').toLowerCase();
    const base = { status: b.status, paymentStatus: b.paymentStatus, sandbox: b.sandbox ?? null };
    // Completion and no-charge cancellation both require independently bound identities.
    // Missing fields cannot prove that this is our booking or the approved hotel.
    if (!b.bookingId || b.bookingId !== bookingId) return unknown('readback booking id is missing or differs from this booking', base);
    if (!b.clientReference || b.clientReference !== clientReference) return unknown('readback client reference is missing or differs from this attempt', base);
    if (!ref || !b.hotelId || b.hotelId !== ref.hotelId) return unknown('readback hotel identity is missing or differs from the stored quote', base);

    if (status === 'CANCELLED' || status === 'CANCELED') {
      // We never cancel; a cancelled sandbox booking carries no real charge. Without the sandbox
      // flag we cannot say that, so it stays unknown (exposure retained).
      if (b.sandbox === true) {
        return { kind: 'failed_definite', reason: 'booking is CANCELLED at the provider (sandbox: payment was simulated, nothing charged)', providerReference: bookingId, evidence: [this.evidence('readback', bookingId, { clientReference, ...base })] };
      }
      return unknown('booking is CANCELLED but the sandbox flag is not confirmed; a charge cannot be ruled out', base);
    }
    if (status !== 'CONFIRMED' && status !== 'COMPLETED') {
      return unknown(`booking status ${b.status ?? 'missing'} is not a completed booking`, base);
    }
    if (payment !== 'succeeded') return unknown(`booking ${status} but payment status is ${b.paymentStatus ?? 'missing'}`, base);
    if (b.sandbox !== true) {
      // Never label a possibly real charge as simulated.
      return unknown(b.sandbox === false ? 'provider reports a NON-sandbox booking; real payment possible, refusing to label it simulated' : 'provider response lacks a sandbox flag; cannot label the payment simulated', base);
    }

    const candidates: Money[] = [b.price, bookResponse?.price ?? null].filter((m): m is Money => m !== null);
    const sameUnit = candidates.filter((m) => m.currency === candidates[0]?.currency && m.scale === candidates[0]?.scale);
    if (candidates.length === 0 || sameUnit.length !== candidates.length) {
      return unknown('booking confirmed but the charged amount is missing or inconsistent across responses', base);
    }
    const picked = pickTotal(candidates.map((m) => BigInt(m.amountMinor)))!;
    const charged = moneyOf(candidates[0]!.currency, picked.minor, candidates[0]!.scale);
    const quoted = ctx.quote.merchantTotal;
    const priceDiffersFromQuote = charged.currency !== quoted.currency || charged.scale !== quoted.scale || charged.amountMinor !== quoted.amountMinor;
    return {
      kind: 'succeeded',
      providerReference: bookingId,
      commerceStatus: 'confirmed',
      // ACC_CREDIT_CARD in sandbox: the provider simulates the payment; no card or bank was charged.
      merchantPaymentStatus: 'simulated_paid',
      // Actual provider price, even if it differs from the quote: the core flags over-charges.
      chargedAmount: charged,
      evidence: [
        this.evidence('readback', bookingId, {
          clientReference,
          ...base,
          hotelConfirmationCode: b.confirmationCode,
          charged,
          quoted,
          priceDiffersFromQuote,
          priceFieldsDisagree: picked.disagree || b.priceDisagrees,
        }),
      ],
    };
  }
}

function stringField(rec: Record<string, unknown> | undefined, key: string): string | null {
  const v = rec?.[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}
