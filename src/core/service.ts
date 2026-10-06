import type { Db } from '../infrastructure/db.js';
import type { Clock } from '../infrastructure/clock.js';
import { iso } from '../infrastructure/clock.js';
import { digestOf, newId } from '../infrastructure/ids.js';
import { CoreError } from './errors.js';
import type { ActorContext } from './actor.js';
import type { Scope, ProviderRoute, Category, FundingRail, Readiness } from '../contracts/common.js';
import type { PurchaseIntent, Fulfillment } from '../contracts/intent.js';
import { Fulfillment as FulfillmentSchema, PurchaseIntent as PurchaseIntentSchema } from '../contracts/intent.js';
import type { OfferView, QuoteView, PurchaseView, FundingOption, PurchaseEventView } from '../contracts/commerce.js';
import type { CommerceExecutor, FundingAdapter, FundingRequirementInput, VerifiedFunding, BankObservationAdapter } from '../contracts/ports.js';
import { compareMoney, money, minor, rescaleMinorCeil, type Money, addMoney } from '../contracts/money.js';
import {
  appendEvent,
  getPurchaseRow,
  getQuoteRow,
  getReservation,
  setReservationStatus,
  transitionPurchase,
  type FundingRequirementRecord,
  type PurchaseRow,
  type QuoteRow,
  type FundingEvidenceRow,
} from './store.js';
import { capacitySnapshot } from './capacity.js';
import { Accounts, cryptoAsset, postEntry, type JournalLine } from './journal.js';
import { buildPurchaseView } from './views.js';
import type { CreatePurchaseRequest } from '../contracts/api.js';

export const DEFAULT_ROUTE: Record<Category, ProviderRoute> = { retail: 'shopify', hotel: 'nuitee', flight: 'atlas' };

export interface CoreConfig {
  appEnv: string;
  publicBaseUrl: string;
  quoteTtlSeconds: number;
  offerTtlSeconds: number;
  /** Max payable principal per purchase, by currency, in minor units (approved demo spend limit). */
  perPurchaseLimitMinor: Record<string, bigint>;
  /** Service fee in basis points of merchant total (0 for launch unless configured). */
  serviceFeeBps: number;
}

export interface CoreDeps {
  db: Db;
  clock: Clock;
  config: CoreConfig;
  executors: Map<ProviderRoute, CommerceExecutor>;
  fundingAdapters: Map<FundingRail, FundingAdapter>;
  bankAdapters: BankObservationAdapter[];
}

export type FundResult =
  | { kind: 'payment_required'; requirements: Record<string, unknown>; purchase: PurchaseView }
  | { kind: 'funded'; purchase: PurchaseView; settlementHeader?: { name: string; value: string } };

const READY_FOR_USE = new Set(['CONFIGURED_UNVERIFIED', 'EXTERNAL_CHECK_PASSED', 'LOCAL_TESTS_ONLY']);

export class CommerceCore {
  /** Purchases with a payment verification/settlement in flight (single gateway process). */
  private readonly fundingInFlight = new Set<string>();

  constructor(private readonly d: CoreDeps) {}

  private now(): string {
    return iso(this.d.clock.now());
  }

  private requireScope(actor: ActorContext, scope: Scope): void {
    if (!actor.scopes.has(scope)) throw new CoreError('forbidden', `missing scope ${scope}`);
  }

  private executorFor(route: ProviderRoute): CommerceExecutor {
    const ex = this.d.executors.get(route);
    if (!ex) throw new CoreError('route_unavailable', `route ${route} is not available in this deployment`);
    return ex;
  }

  private async assertRouteReady(ex: CommerceExecutor): Promise<Readiness> {
    const r = await ex.readiness();
    if (!READY_FOR_USE.has(r.status)) {
      throw new CoreError('route_unavailable', `route ${ex.route} is not ready (${r.status})`, {
        route: ex.route,
        status: r.status,
        missing: r.missing,
      });
    }
    return r;
  }

  /* ---------------- offers ---------------- */

  async searchOffers(actor: ActorContext, rawIntent: unknown): Promise<OfferView[]> {
    this.requireScope(actor, 'offers:read');
    const intent = PurchaseIntentSchema.parse(rawIntent);
    const route = intent.route ?? DEFAULT_ROUTE[intent.category];
    const ex = this.executorFor(route);
    if (ex.category !== intent.category) throw new CoreError('invalid_request', `route ${route} does not serve ${intent.category}`);
    await this.assertRouteReady(ex);
    const found = await ex.search(intent);
    const now = this.d.clock.now();
    const views: OfferView[] = [];
    this.d.db.tx(() => {
      for (const o of found) {
        const offerId = newId('off');
        const ttl = new Date(now.getTime() + this.d.config.offerTtlSeconds * 1000);
        const expiresAt = new Date(Math.min(ttl.getTime(), Date.parse(o.expiresAt))).toISOString();
        const view: OfferView = {
          offerId,
          category: intent.category,
          route,
          providerEnvironment: ex.environment,
          title: o.title,
          description: o.description,
          indicativePrice: o.indicativePrice,
          terms: o.terms,
          sourceObservedAt: o.sourceObservedAt,
          expiresAt,
          executable: false,
        };
        this.d.db.run(
          `INSERT INTO offers(id, customer_id, category, route, provider_environment, intent_json, public_json, execution_ref_json, expires_at, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          offerId,
          actor.customerId,
          intent.category,
          route,
          ex.environment,
          JSON.stringify(intent),
          JSON.stringify(view),
          JSON.stringify(o.executionRef),
          expiresAt,
          iso(now),
        );
        views.push(view);
      }
    });
    return views;
  }

  /* ---------------- quotes ---------------- */

  async createQuote(actor: ActorContext, offerId: string, rawFulfillment: unknown, supersedes?: QuoteRow): Promise<QuoteView> {
    this.requireScope(actor, 'quotes:write');
    const fulfillment = FulfillmentSchema.parse(rawFulfillment);
    const offer = this.d.db.get<{
      id: string;
      customer_id: string;
      category: Category;
      route: ProviderRoute;
      intent_json: string;
      execution_ref_json: string;
      expires_at: string;
    }>('SELECT * FROM offers WHERE id = ?', offerId);
    if (!offer || offer.customer_id !== actor.customerId) throw new CoreError('not_found', 'offer not found');
    if (Date.parse(offer.expires_at) <= this.d.clock.now().getTime()) throw new CoreError('quote_expired', 'offer expired; search again');
    if (fulfillment.category !== offer.category) throw new CoreError('invalid_request', 'fulfillment category does not match offer');
    const intent = JSON.parse(offer.intent_json) as PurchaseIntent;
    const ex = this.executorFor(offer.route);
    await this.assertRouteReady(ex);

    const pq = await ex.quote({ executionRef: JSON.parse(offer.execution_ref_json), intent }, fulfillment);

    // Spend ceiling from intent applies to the exact payable principal.
    const fee = this.serviceFee(pq.merchantTotal);
    const payable = addMoney(pq.merchantTotal, fee);
    if (intent.spendCeiling.currency !== payable.currency || intent.spendCeiling.scale !== payable.scale) {
      throw new CoreError('invalid_request', 'spend ceiling currency/scale does not match the provider quote', {
        quoteCurrency: payable.currency,
      });
    }
    if (compareMoney(payable, intent.spendCeiling) > 0) {
      throw new CoreError('spend_limit_exceeded', 'quoted total exceeds the intent spend ceiling', { payable });
    }

    const now = this.d.clock.now();
    const ttl = new Date(now.getTime() + this.d.config.quoteTtlSeconds * 1000);
    const expiresAt = new Date(Math.min(ttl.getTime(), Date.parse(pq.expiresAt), Date.parse(offer.expires_at) + this.d.config.quoteTtlSeconds * 1000)).toISOString();
    const fundingOptions = this.fundingOptionsFor(payable);
    const quoteId = newId('quo');
    const version = supersedes ? supersedes.version + 1 : 1;
    const digest = digestOf({
      quoteId,
      customerId: actor.customerId,
      offerId,
      route: offer.route,
      merchantTotal: pq.merchantTotal,
      serviceFee: fee,
      payable,
      fundingOptions,
      fulfillment,
      executionRef: pq.executionRef,
      expiresAt,
    });
    const view: QuoteView = {
      quoteId,
      version,
      supersedesQuoteId: supersedes?.id ?? null,
      customerId: actor.customerId,
      offerId,
      category: offer.category,
      route: offer.route,
      providerEnvironment: ex.environment,
      title: pq.title,
      breakdown: pq.breakdown,
      merchantTotal: pq.merchantTotal,
      serviceFee: fee,
      payablePrincipal: payable,
      fundingOptions,
      fulfillmentSummary: pq.fulfillmentSummary,
      terms: pq.terms,
      expiresAt,
      digest,
      createdAt: iso(now),
    };
    this.d.db.run(
      `INSERT INTO quotes(id, version, supersedes_quote_id, customer_id, offer_id, category, route, provider_environment, public_json, fulfillment_json, execution_ref_json, digest, expires_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      quoteId,
      version,
      supersedes?.id ?? null,
      actor.customerId,
      offerId,
      offer.category,
      offer.route,
      ex.environment,
      JSON.stringify(view),
      JSON.stringify(fulfillment),
      JSON.stringify(pq.executionRef),
      digest,
      expiresAt,
      iso(now),
    );
    return view;
  }

  private serviceFee(merchantTotal: Money): Money {
    const bps = BigInt(this.d.config.serviceFeeBps);
    const fee = (minor(merchantTotal) * bps + 9999n) / 10000n;
    return money(merchantTotal.currency, fee, merchantTotal.scale);
  }

  /** Funding options for configured rails. Only USD-parity test stablecoins for USD quotes are offered. */
  private fundingOptionsFor(payable: Money): FundingOption[] {
    const out: FundingOption[] = [];
    for (const [rail, adapter] of this.d.fundingAdapters) {
      const asset = adapter.acceptedAsset();
      if (!asset || !asset.usdParity || payable.currency !== 'USD') continue;
      const base = rescaleMinorCeil(minor(payable), payable.scale, asset.decimals);
      const num = asset.decimals >= payable.scale ? (10n ** BigInt(asset.decimals - payable.scale)).toString() : '1';
      const den = asset.decimals >= payable.scale ? '1' : (10n ** BigInt(payable.scale - asset.decimals)).toString();
      out.push({
        rail,
        amount: {
          network: adapter.network,
          assetId: asset.assetId,
          ...(asset.symbol ? { symbol: asset.symbol } : {}),
          decimals: asset.decimals,
          amountBaseUnits: base.toString(),
        },
        payTo: asset.payTo,
        valuation: {
          convention: 'test_stablecoin_usd_parity',
          numerator: num,
          denominator: den,
          statement:
            'Demo convention: 1 unit of the configured testnet stablecoin is valued at 1 USD for reporting. Test assets have no market value and are not redeemable.',
        },
      });
    }
    return out;
  }

  getQuote(actor: ActorContext, quoteId: string): QuoteView {
    this.requireScope(actor, 'quotes:write');
    const q = getQuoteRow(this.d.db, quoteId);
    if (!q || q.customer_id !== actor.customerId) throw new CoreError('not_found', 'quote not found');
    return JSON.parse(q.public_json) as QuoteView;
  }

  /* ---------------- purchases ---------------- */

  async createPurchase(actor: ActorContext, req: CreatePurchaseRequest, idempotencyKey: string | undefined): Promise<{ status: number; purchase: PurchaseView }> {
    this.requireScope(actor, 'purchases:write');
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new CoreError('invalid_request', 'Idempotency-Key header (8-128 chars) is required');
    }
    const requestDigest = digestOf(req);
    const prior = this.d.db.get<{ request_digest: string; status_code: number; response_json: string }>(
      "SELECT request_digest, status_code, response_json FROM idempotency_keys WHERE customer_id = ? AND operation = 'createPurchase' AND idem_key = ?",
      actor.customerId,
      idempotencyKey,
    );
    if (prior) {
      if (prior.request_digest !== requestDigest) throw new CoreError('idempotency_conflict', 'Idempotency-Key reused with a different request');
      const { purchaseId } = JSON.parse(prior.response_json) as { purchaseId: string };
      return { status: prior.status_code, purchase: this.getPurchase(actor, purchaseId) };
    }

    const quote = getQuoteRow(this.d.db, req.quoteId);
    if (!quote || quote.customer_id !== actor.customerId) throw new CoreError('not_found', 'quote not found');
    const qv = JSON.parse(quote.public_json) as QuoteView;
    const ex = this.executorFor(qv.route);
    await this.assertRouteReady(ex);
    const adapter = this.d.fundingAdapters.get(req.fundingRail);
    if (!adapter) throw new CoreError('route_unavailable', `funding rail ${req.fundingRail} is not available`);
    const railReady = await adapter.readiness();
    if (!READY_FOR_USE.has(railReady.status)) {
      throw new CoreError('route_unavailable', `funding rail ${req.fundingRail} is not ready (${railReady.status})`, { missing: railReady.missing });
    }

    const nowIso = this.now();
    return this.d.db.tx(() => {
      // Re-check idempotency inside the write transaction (concurrent identical requests).
      const raced = this.d.db.get<{ request_digest: string; status_code: number; response_json: string }>(
        "SELECT request_digest, status_code, response_json FROM idempotency_keys WHERE customer_id = ? AND operation = 'createPurchase' AND idem_key = ?",
        actor.customerId,
        idempotencyKey,
      );
      if (raced) {
        if (raced.request_digest !== requestDigest) throw new CoreError('idempotency_conflict', 'Idempotency-Key reused with a different request');
        const { purchaseId } = JSON.parse(raced.response_json) as { purchaseId: string };
        return { status: raced.status_code, purchase: this.getPurchase(actor, purchaseId) };
      }
      if (Date.parse(quote.expires_at) <= Date.parse(nowIso)) throw new CoreError('quote_expired', 'quote expired; request a new quote');
      if (req.approval.quoteDigest !== quote.digest) {
        throw new CoreError('quote_changed', 'approval does not bind this exact quote (digest mismatch); re-approve the current quote');
      }
      const payable = qv.payablePrincipal;
      if (req.approval.maxTotal.currency !== payable.currency || req.approval.maxTotal.scale !== payable.scale) {
        throw new CoreError('invalid_request', 'approval currency/scale must match the quote');
      }
      if (compareMoney(payable, req.approval.maxTotal) > 0) throw new CoreError('spend_limit_exceeded', 'quote exceeds approved maximum');
      const limit = this.d.config.perPurchaseLimitMinor[payable.currency];
      if (limit === undefined || minor(payable) > limit) {
        throw new CoreError('spend_limit_exceeded', 'quote exceeds the deployment per-purchase demo limit', { currency: payable.currency });
      }
      const option = qv.fundingOptions.find((o) => o.rail === req.fundingRail);
      if (!option) throw new CoreError('route_unavailable', `quote has no ${req.fundingRail} funding option`);
      const existing = this.d.db.get<{ id: string }>('SELECT id FROM purchases WHERE quote_id = ?', quote.id);
      if (existing) throw new CoreError('conflict', 'a purchase already exists for this quote', { purchaseId: existing.id });

      // Capacity reservation for the merchant spend (simulated card capacity), not the fee.
      const cap = capacitySnapshot(this.d.db, qv.merchantTotal.currency);
      if (!cap || cap.scale !== qv.merchantTotal.scale) {
        throw new CoreError('insufficient_capacity', `no simulated capacity configured for ${qv.merchantTotal.currency}`);
      }
      if (cap.availableMinor < minor(qv.merchantTotal)) {
        throw new CoreError('insufficient_capacity', 'insufficient simulated purchasing capacity');
      }

      const purchaseId = newId('pur');
      const requirement: FundingRequirementRecord = {
        resourceUrl: `${this.d.config.publicBaseUrl}/v1/purchases/${purchaseId}/fund`,
        rail: option.rail,
        network: option.amount.network,
        assetId: option.amount.assetId,
        decimals: option.amount.decimals,
        ...(option.amount.symbol ? { symbol: option.amount.symbol } : {}),
        amountBaseUnits: option.amount.amountBaseUnits,
        payTo: option.payTo,
        expiresAt: quote.expires_at,
        quoteDigest: quote.digest,
        valuation: option.valuation,
      };
      this.d.db.run(
        `INSERT INTO purchases(id, customer_id, quote_id, channel, state, payment_state, commerce_status, merchant_payment_status, funding_rail, funding_requirement_json, approval_json, created_at, updated_at)
         VALUES (?,?,?,?, 'awaiting_funding', 'not_received', 'not_started', 'none', ?,?,?,?,?)`,
        purchaseId,
        actor.customerId,
        quote.id,
        actor.channel,
        req.fundingRail,
        JSON.stringify(requirement),
        JSON.stringify(req.approval),
        nowIso,
        nowIso,
      );
      this.d.db.run(
        `INSERT INTO reservations(id, purchase_id, currency, scale, amount_minor, status, expires_at, created_at, updated_at)
         VALUES (?,?,?,?,?, 'active', ?,?,?)`,
        newId('res'),
        purchaseId,
        qv.merchantTotal.currency,
        qv.merchantTotal.scale,
        qv.merchantTotal.amountMinor,
        quote.expires_at,
        nowIso,
        nowIso,
      );
      appendEvent(this.d.db, purchaseId, 'purchase.created', { quoteId: quote.id, channel: actor.channel, rail: req.fundingRail }, nowIso);
      appendEvent(this.d.db, purchaseId, 'capacity.reserved', { amount: qv.merchantTotal, ledgerMode: 'simulated' }, nowIso);
      this.d.db.run(
        `INSERT INTO idempotency_keys(customer_id, operation, idem_key, request_digest, status_code, response_json, created_at)
         VALUES (?, 'createPurchase', ?, ?, 201, ?, ?)`,
        actor.customerId,
        idempotencyKey,
        requestDigest,
        JSON.stringify({ purchaseId }),
        nowIso,
      );
      return { status: 201, purchase: this.viewOf(getPurchaseRow(this.d.db, purchaseId)!) };
    });
  }

  private ownedPurchase(actor: ActorContext, id: string): PurchaseRow {
    const p = getPurchaseRow(this.d.db, id);
    if (!p || p.customer_id !== actor.customerId) throw new CoreError('not_found', 'purchase not found');
    return p;
  }

  getPurchase(actor: ActorContext, id: string): PurchaseView {
    this.requireScope(actor, 'purchases:read');
    return this.viewOf(this.ownedPurchase(actor, id));
  }

  purchaseEvents(actor: ActorContext, id: string): PurchaseEventView[] {
    this.requireScope(actor, 'purchases:read');
    this.ownedPurchase(actor, id);
    return this.d.db
      .all<{ id: string; sequence: number; purchase_id: string; type: string; data_json: string; created_at: string }>(
        'SELECT * FROM purchase_events WHERE purchase_id = ? ORDER BY sequence',
        id,
      )
      .map((e) => ({ eventId: e.id, sequence: e.sequence, purchaseId: e.purchase_id, type: e.type, data: JSON.parse(e.data_json), at: e.created_at }));
  }

  private viewOf(p: PurchaseRow): PurchaseView {
    return buildPurchaseView(this.d.db, p, this.d.config.publicBaseUrl);
  }

  requirementInput(p: PurchaseRow): FundingRequirementInput {
    const r = JSON.parse(p.funding_requirement_json) as FundingRequirementRecord;
    return {
      purchaseId: p.id,
      quoteId: p.quote_id,
      quoteDigest: r.quoteDigest,
      amount: {
        network: r.network,
        assetId: r.assetId,
        decimals: r.decimals,
        amountBaseUnits: r.amountBaseUnits,
        ...(r.symbol ? { symbol: r.symbol } : {}),
      },
      payTo: r.payTo,
      resourceUrl: r.resourceUrl ?? `${this.d.config.publicBaseUrl}/v1/purchases/${p.id}/fund`,
      description: `Purchase funding for ${p.id} (quote ${p.quote_id})`,
      expiresAt: r.expiresAt,
    };
  }

  /**
   * x402-protected funding resource. Without a payment header returns the protocol challenge.
   * With one: verify via the rail adapter, then persist evidence + journal + execution job atomically.
   * Never executes commerce in the request path.
   */
  async fundPurchase(actor: ActorContext, purchaseId: string, paymentHeader: string | undefined): Promise<FundResult> {
    this.requireScope(actor, 'purchases:fund');
    let p = this.ownedPurchase(actor, purchaseId);
    const adapter = this.d.fundingAdapters.get(p.funding_rail as FundingRail);
    if (!adapter) throw new CoreError('route_unavailable', `funding rail ${p.funding_rail} unavailable`);

    if (p.state !== 'awaiting_funding') {
      throw new CoreError('conflict', `purchase is ${p.state}; it does not accept funding`, { state: p.state, paymentState: p.payment_state });
    }
    if (p.payment_state === 'submitted' || p.payment_state === 'unknown') {
      throw new CoreError('conflict', 'a funding transfer is already awaiting confirmation for this purchase', { paymentState: p.payment_state });
    }
    const input = this.requirementInput(p);
    if (Date.parse(input.expiresAt) <= this.d.clock.now().getTime()) {
      this.expirePurchase(p.id, 'quote expired before funding');
      throw new CoreError('quote_expired', 'quote expired before funding; request a new quote');
    }
    const requirements = adapter.paymentRequirements(input);
    if (!paymentHeader) {
      return { kind: 'payment_required', requirements, purchase: this.viewOf(p) };
    }

    // One settlement attempt per purchase at a time: a concurrent second payment is refused before it
    // can be settled on-chain (otherwise it would become an unapplied refundable obligation).
    if (this.fundingInFlight.has(purchaseId)) {
      throw new CoreError('conflict', 'a funding attempt for this purchase is already in progress; retry with the same payment after it completes');
    }
    this.fundingInFlight.add(purchaseId);
    try {
      if (adapter.prepare) {
        const candidate = adapter.prepare(paymentHeader, input);
        if (!candidate.ok) throw new CoreError(candidate.code, candidate.reason);
        if (!adapter.recover) throw new CoreError('route_unavailable', 'funding adapter has no durable recovery');
        this.persistFundingCandidate(purchaseId, adapter.rail, input.amount.network, candidate.transferReference);
      }
      return await this.verifyAndRecord(purchaseId, adapter, paymentHeader, input);
    } finally {
      this.fundingInFlight.delete(purchaseId);
    }
  }

  private async verifyAndRecord(purchaseId: string, adapter: FundingAdapter, paymentHeader: string, input: FundingRequirementInput): Promise<FundResult> {
    let p = getPurchaseRow(this.d.db, purchaseId)!;
    const verification = await adapter.verify(paymentHeader, input);
    if (!verification.ok) {
      const nowIso = this.now();
      this.d.db.tx(() => {
        appendEvent(this.d.db,p.id,'funding.rejected',{code:verification.code,reason:verification.reason},nowIso);
        if(verification.settlementAttempted===false) {
          const removed=this.d.db.run("DELETE FROM funding_attempts WHERE purchase_id = ? AND status = 'pending'",p.id).changes;
          if(removed) this.d.db.run("UPDATE purchases SET payment_state = 'not_received', updated_at = ? WHERE id = ? AND state = 'awaiting_funding' AND payment_state = 'unknown'",nowIso,p.id);
        }
      });
      throw new CoreError(verification.code, verification.reason);
    }
    return this.recordVerifiedFunding(purchaseId, verification.funding, input);
  }

  private recordVerifiedFunding(purchaseId: string, f: VerifiedFunding, input: FundingRequirementInput): FundResult {
    let p = getPurchaseRow(this.d.db, purchaseId)!;
    if (f.rail !== p.funding_rail) throw new CoreError('payment_invalid', 'funding rail does not match purchase');
    if (p.state === 'awaiting_funding' && Date.parse(input.expiresAt) <= this.d.clock.now().getTime()) {
      this.expirePurchase(p.id,'quote expired before funding was independently confirmed');
      p=getPurchaseRow(this.d.db,purchaseId)!;
    }
    // Recovery can race the original response after a confirmed chain read; never post twice.
    const existing = this.d.db.get<{purchase_id:string}>('SELECT purchase_id FROM funding_evidence WHERE rail = ? AND network = ? AND transfer_reference = ?', f.rail, f.network, f.transferReference);
    if (existing) {
      if (existing.purchase_id !== purchaseId) throw new CoreError('payment_replayed', 'this transfer has already been used');
      return {kind:'funded', purchase:this.viewOf(p)};
    }
    // Defense in depth: core re-checks the adapter's claims against the stored requirement.
    this.assertFundingMatches(f, input);

    const nowIso = this.now();
    this.d.db.tx(() => {
      p = getPurchaseRow(this.d.db, purchaseId)!;
      const stillOpen = p.state === 'awaiting_funding' && p.payment_state !== 'submitted';
      const required = BigInt(input.amount.amountBaseUnits);
      const received = BigInt(f.amountBaseUnits);
      const confirmed = f.paymentState === 'confirmed';
      const application: FundingEvidenceRow['application'] = !confirmed ? 'pending_confirmation' : stillOpen ? 'applied' : 'unapplied';
      try {
        this.insertEvidence(p.id, f, application, nowIso);
      } catch (e) {
        if (String((e as Error).message).includes('UNIQUE')) throw new CoreError('payment_replayed', 'this transfer has already been used');
        throw e;
      }
      this.d.db.run("UPDATE funding_attempts SET status = 'recorded', updated_at = ? WHERE purchase_id = ? AND transfer_reference = ?", nowIso, p.id, f.transferReference);
      if (!confirmed) {
        this.d.db.run("UPDATE purchases SET payment_state = 'submitted', updated_at = ? WHERE id = ?", nowIso, p.id);
        appendEvent(this.d.db, p.id, 'funding.submitted', { transfer: f.transferReference, network: f.network }, nowIso);
        this.enqueueJob('confirm_funding', p.id, `confirm:${p.id}:${f.transferReference}`, nowIso);
        return;
      }
      if (!stillOpen) {
        this.recordConfirmedUnappliedFunding(p.id, f, nowIso);
        return;
      }
      this.applyConfirmedFunding(p, f, required, received, nowIso);
    });
    const after = getPurchaseRow(this.d.db, purchaseId)!;
    if (after.state === 'awaiting_funding' && after.payment_state !== 'submitted') {
      throw new CoreError('conflict', 'funding was received but could not be applied; it is recorded as a refundable obligation');
    }
    return {
      kind: 'funded',
      purchase: this.viewOf(after),
      ...(f.settlementResponseHeader ? { settlementHeader: f.settlementResponseHeader } : {}),
    };
  }

  private persistFundingCandidate(purchaseId: string, rail: FundingRail, network: string, reference: string): void {
    if (!reference || reference.length > 256) throw new CoreError('payment_invalid', 'invalid funding recovery reference');
    const nowIso = this.now();
    this.d.db.tx(() => {
      const prior = this.d.db.get<{purchase_id:string;transfer_reference:string}>('SELECT purchase_id, transfer_reference FROM funding_attempts WHERE rail = ? AND network = ? AND transfer_reference = ?',rail,network,reference);
      if (prior && prior.purchase_id !== purchaseId) throw new CoreError('payment_replayed','this transfer is already bound to another purchase');
      const current = this.d.db.get<{transfer_reference:string}>('SELECT transfer_reference FROM funding_attempts WHERE purchase_id = ?',purchaseId);
      if (current && current.transfer_reference !== reference) throw new CoreError('conflict','a different payment is already pending recovery');
      this.d.db.run("INSERT INTO funding_attempts(id,purchase_id,rail,network,transfer_reference,status,created_at,updated_at) VALUES(?,?,?,?,?,'pending',?,?) ON CONFLICT(purchase_id) DO NOTHING",newId('fat'),purchaseId,rail,network,reference,nowIso,nowIso);
      this.d.db.run("UPDATE purchases SET payment_state = 'unknown', updated_at = ? WHERE id = ? AND state = 'awaiting_funding'",nowIso,purchaseId);
      const candidate=this.d.db.get<{id:string}>('SELECT id FROM funding_attempts WHERE purchase_id = ?',purchaseId)!;
      this.enqueueJob('recover_funding',purchaseId,'recover_funding:'+candidate.id,new Date(Date.parse(nowIso)+15_000).toISOString());
      appendEvent(this.d.db,purchaseId,'funding.attempt_prepared',{transfer:reference},nowIso);
    });
  }

  /** Only durable candidate references can enter this read-only recovery path. */
  async recoverPendingFunding(purchaseId: string): Promise<boolean> {
    const candidate=this.d.db.get<{rail:FundingRail;transfer_reference:string}>("SELECT rail, transfer_reference FROM funding_attempts WHERE purchase_id = ? AND status = 'pending'",purchaseId);
    if(!candidate) return true;
    const p=getPurchaseRow(this.d.db,purchaseId)!;
    const adapter=this.d.fundingAdapters.get(candidate.rail);
    if(!adapter?.recover) throw new Error('funding adapter recovery unavailable');
    const input=this.requirementInput(p);
    if(p.state==='awaiting_funding' && Date.parse(input.expiresAt)<=this.d.clock.now().getTime()) this.expirePurchase(p.id,'quote expired during funding recovery');
    const verification=await adapter.recover(candidate.transfer_reference,input);
    if(!verification.ok) return false;
    if(verification.funding.transferReference!==candidate.transfer_reference) throw new Error('funding recovery reference mismatch');
    this.recordVerifiedFunding(purchaseId,verification.funding,input);
    return true;
  }

  private assertFundingMatches(f: VerifiedFunding, input: FundingRequirementInput): void {
    const problems: string[] = [];
    if (f.network !== input.amount.network) problems.push('network');
    if (f.assetId !== input.amount.assetId) problems.push('asset');
    if (f.decimals !== input.amount.decimals) problems.push('decimals');
    if (f.payee !== input.payTo) problems.push('payee');
    if (BigInt(f.amountBaseUnits) < BigInt(input.amount.amountBaseUnits)) problems.push('amount');
    if (f.purpose === 'service_fee') problems.push('purpose');
    if (!['confirmed', 'submitted'].includes(f.paymentState)) problems.push('state');
    if (problems.length) throw new CoreError('payment_invalid', `funding does not satisfy requirement: ${problems.join(', ')}`);
  }

  private insertEvidence(purchaseId: string, f: VerifiedFunding, application: FundingEvidenceRow['application'], nowIso: string): string {
    const id = newId('fev');
    this.d.db.run(
      `INSERT INTO funding_evidence(id, purchase_id, rail, network, asset_id, decimals, amount_base_units, payer, payee, transfer_reference, payment_state, confirmations, purpose, application, evidence_mode, observed_at, verified_at, details_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id,
      purchaseId,
      f.rail,
      f.network,
      f.assetId,
      f.decimals,
      f.amountBaseUnits,
      f.payer,
      f.payee,
      f.transferReference,
      f.paymentState,
      f.confirmations,
      f.purpose,
      application,
      f.evidenceMode,
      f.observedAt,
      nowIso,
      JSON.stringify(f.details),
    );
    return id;
  }

  /** Journal the observed receipt: applied part to prepayment liability, any excess to unapplied (refundable). */
  private postReceipt(purchaseId: string, f: VerifiedFunding, applied: bigint, received: bigint, nowIso: string): void {
    const asset = cryptoAsset(f.network, f.assetId);
    const excess = received - applied;
    const lines: JournalLine[] = [{ account: Accounts.cryptoTreasury, asset, side: 'debit', amount: received }];
    if (applied > 0n) lines.push({ account: Accounts.customerPrepayment, asset, side: 'credit' as const, amount: applied });
    if (excess > 0n) lines.push({ account: Accounts.customerUnapplied, asset, side: 'credit' as const, amount: excess });
    postEntry(
      this.d.db,
      {
        eventKey: `funding:${f.rail}:${f.network}:${f.transferReference}`,
        purchaseId,
        kind: 'funding_received',
        ledgerMode: 'observed',
        description: `Verified ${f.rail} testnet transfer`,
        externalReference: f.transferReference,
        lines,
      },
      nowIso,
    );
  }

  /** A late confirmed transfer remains an observed refundable obligation, even after closure. */
  recordConfirmedUnappliedFunding(purchaseId: string, funding: VerifiedFunding, nowIso: string): void {
    this.postReceipt(purchaseId, funding, 0n, BigInt(funding.amountBaseUnits), nowIso);
    this.d.db.run("UPDATE purchases SET payment_state = 'confirmed', updated_at = ? WHERE id = ?",nowIso,purchaseId);
    appendEvent(this.d.db, purchaseId, 'funding.unapplied', { reason: 'confirmed after purchase closed', transfer: funding.transferReference }, nowIso);
  }

  /** Called inside a tx with a confirmed, matching transfer for an open purchase. */
  applyConfirmedFunding(p: PurchaseRow, f: VerifiedFunding, required: bigint, received: bigint, nowIso: string): void {
    this.postReceipt(p.id, f, required, received, nowIso);
    const ok = transitionPurchase(this.d.db, p.id, ['awaiting_funding'], { state: 'funded_queued', payment_state: 'confirmed' }, nowIso);
    if (!ok) throw new Error('purchase state changed during funding');
    appendEvent(
      this.d.db,
      p.id,
      'funding.confirmed',
      { rail: f.rail, network: f.network, asset: f.assetId, amountBaseUnits: f.amountBaseUnits, transfer: f.transferReference, excessBaseUnits: (received - required).toString() },
      nowIso,
    );
    this.enqueueJob('execute_purchase', p.id, `execute:${p.id}`, nowIso);
    appendEvent(this.d.db, p.id, 'execution.queued', {}, nowIso);
  }

  enqueueJob(kind: string, purchaseId: string, dedupeKey: string, runAfterIso: string): void {
    this.d.db.run(
      `INSERT INTO jobs(id, kind, purchase_id, dedupe_key, status, run_after, attempts, created_at, updated_at)
       VALUES (?,?,?,?, 'pending', ?, 0, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING`,
      newId('job'),
      kind,
      purchaseId,
      dedupeKey,
      runAfterIso,
      runAfterIso,
      runAfterIso,
    );
  }

  expirePurchase(purchaseId: string, reason: string): void {
    const nowIso = this.now();
    this.d.db.tx(() => {
      const ok = transitionPurchase(this.d.db, purchaseId, ['awaiting_funding'], { state: 'expired', status_reason: reason }, nowIso);
      if (!ok) return;
      setReservationStatus(this.d.db, purchaseId, ['active'], 'released', nowIso);
      appendEvent(this.d.db, purchaseId, 'purchase.expired', { reason }, nowIso);
      appendEvent(this.d.db, purchaseId, 'capacity.released', { reason }, nowIso);
    });
  }

  /* ---------------- capabilities ---------------- */

  async capabilities() {
    const routes = [];
    for (const ex of this.d.executors.values()) routes.push({ route: ex.route, category: ex.category, readiness: await ex.readiness() });
    const fundingRails = [];
    for (const a of this.d.fundingAdapters.values()) fundingRails.push({ rail: a.rail, readiness: await a.readiness() });
    const banking = [];
    for (const b of this.d.bankAdapters) banking.push(await b.readiness());
    return {
      contractVersion: 'v1' as const,
      appEnv: this.d.config.appEnv,
      routes,
      fundingRails,
      banking,
      operations: ['find_offers', 'create_quote', 'buy', 'get_purchase'],
    };
  }

  /** Header the funding rail expects the payment payload in (x402 v2: PAYMENT-SIGNATURE). */
  paymentHeaderName(purchaseId: string, actor: ActorContext): string {
    const p = getPurchaseRow(this.d.db, purchaseId);
    if (!p || p.customer_id !== actor.customerId) return 'payment-signature';
    return this.d.fundingAdapters.get(p.funding_rail as FundingRail)?.paymentHeaderName ?? 'payment-signature';
  }

  /** Used by the worker. */
  get deps(): CoreDeps {
    return this.d;
  }

  reservationOf(purchaseId: string) {
    return getReservation(this.d.db, purchaseId);
  }
}
