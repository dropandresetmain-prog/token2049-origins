import type { Db } from '../infrastructure/db.js';
import type { Clock } from '../infrastructure/clock.js';
import { iso } from '../infrastructure/clock.js';
import { digestOf, newId } from '../infrastructure/ids.js';
import { CoreError } from './errors.js';
import { assessPurchaseIntent, assessFulfillment, providerRequirements } from '../contracts/input.js';
import { CreatePurchaseRequest as PurchaseRequestSchema } from '../contracts/api.js';
import type { ActorContext } from './actor.js';
import type { Scope, ProviderRoute, Category, FundingRail, Readiness } from '../contracts/common.js';
import type { PurchaseIntent, Fulfillment } from '../contracts/intent.js';
import { Fulfillment as FulfillmentSchema, PurchaseIntent as PurchaseIntentSchema } from '../contracts/intent.js';
import type { OfferView, QuoteView, PurchaseView, FundingOption, PurchaseEventView } from '../contracts/commerce.js';
import type { CommerceExecutor, FundingAdapter, FundingRequirementInput, VerifiedFunding, BankObservationAdapter } from '../contracts/ports.js';
import { compareMoney, money, minor, type Money, addMoney } from '../contracts/money.js';
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

import { demoData } from '../demo/config.js';
import { SettlementPolicy, settlementBaseUnits, validateSettlement } from '../contracts/settlement.js';

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
  settlementPolicy?: SettlementPolicy;
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

  private fundingReady(status: Readiness['status']): boolean {
    return status === 'CONFIGURED_UNVERIFIED' || status === 'EXTERNAL_CHECK_PASSED' ||
      (status === 'LOCAL_TESTS_ONLY' && this.d.config.appEnv === 'test');
  }

  private async assessProvider(ex: CommerceExecutor, intent: PurchaseIntent, fulfillment?: Fulfillment): Promise<void> {
    const request = await ex.inputRequirements?.({ intent, fulfillment });
    if (!request?.paths.length) return;
    if (!fulfillment && request.phase !== 'search') throw new CoreError('provider_error', 'provider requirement belongs in fulfillment; operator attention is required');
    let needs;
    try { needs = providerRequirements(intent.category, request.phase, request.paths); }
    catch { throw new CoreError('provider_error', 'provider requires an unmodelled canonical field; operator attention is required'); }
    throw new CoreError('needs_input', 'additional customer information required', needs);
  }

  /* ---------------- offers ---------------- */

  async searchOffers(actor: ActorContext, rawIntent: unknown): Promise<OfferView[]> {
    this.requireScope(actor, 'offers:read');
    const assessment = assessPurchaseIntent(rawIntent);
    if (assessment.status === 'needs_input') throw new CoreError('needs_input', 'search information required', assessment);
    const intent = PurchaseIntentSchema.parse(assessment.value);
    const route = intent.route ?? DEFAULT_ROUTE[intent.category];
    const ex = this.executorFor(route);
    if (ex.category !== intent.category) throw new CoreError('invalid_request', `route ${route} does not serve ${intent.category}`);
    await this.assertRouteReady(ex);
    await this.assessProvider(ex, intent);
    const found = await ex.search(intent);
    const now = this.d.clock.now();
    const views: OfferView[] = [];
    await this.d.db.tx(async () => {
      for (const o of found) {
        const offerId = newId('off');
        const ttl = new Date(now.getTime() + this.d.config.offerTtlSeconds * 1000);
        const expiresAt = new Date(Math.min(ttl.getTime(), Date.parse(o.expiresAt))).toISOString();
        const view: OfferView = {
          offerId,
          ...(o.sourceOffer ? { sourceOffer: o.sourceOffer } : {}),
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
        await this.d.db.run(
          `INSERT INTO offers(id, customer_id, category, route, provider_environment, intent_json, public_json, execution_ref_json, expires_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
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
    const offer = await this.d.db.get<{ customer_id: string; intent_json: string }>('SELECT customer_id,intent_json FROM offers WHERE id=$1', offerId);
    if (!offer || offer.customer_id !== actor.customerId) throw new CoreError('not_found', 'offer not found');
    const intent = JSON.parse(offer.intent_json) as PurchaseIntent;
    if (intent.category !== 'retail' || intent.discovery !== 'live') return this.createQuoteOnce(actor, offerId, rawFulfillment, supersedes);
    const assessment = assessFulfillment(rawFulfillment);
    if (assessment.status === 'needs_input') throw new CoreError('needs_input', 'fulfillment information required', assessment);
    const fulfillment = FulfillmentSchema.parse(assessment.value);
    // One selected live offer has one immutable quote. New terms require a new discovery/selection.
    // The session lock spans provider I/O without holding a database transaction.
    const result = await this.d.db.withExclusiveLock('live-retail-quote:' + offerId, async () => {
      const existing = await this.d.db.get<QuoteRow>('SELECT * FROM quotes WHERE offer_id=$1 ORDER BY created_at LIMIT 1', offerId);
      if (existing) {
        if (digestOf(JSON.parse(existing.fulfillment_json)) !== digestOf(fulfillment))
          throw new CoreError('quote_changed', 'Selected offer already has frozen fulfillment; search again for new terms');
        if (Date.parse(existing.expires_at) <= this.d.clock.now().getTime())
          throw new CoreError('quote_expired', 'Selected offer quote expired; search and select again');
        return JSON.parse(existing.public_json) as QuoteView;
      }
      return this.createQuoteOnce(actor, offerId, fulfillment, supersedes);
    });
    if (!result.acquired) throw new CoreError('conflict', 'Selected offer quote is being prepared; retry the same offer');
    return result.value;
  }

  private async createQuoteOnce(actor: ActorContext, offerId: string, rawFulfillment: unknown, supersedes?: QuoteRow): Promise<QuoteView> {
    this.requireScope(actor, 'quotes:write');
    const assessment = assessFulfillment(rawFulfillment);
    if (assessment.status === 'needs_input') throw new CoreError('needs_input', 'fulfillment information required', assessment);
    const fulfillment = FulfillmentSchema.parse(assessment.value);
    const offer = await this.d.db.get<{
      id: string;
      customer_id: string;
      category: Category;
      route: ProviderRoute;
      intent_json: string;
      execution_ref_json: string;
      expires_at: string;
    }>('SELECT * FROM offers WHERE id = $1', offerId);
    if (!offer || offer.customer_id !== actor.customerId) throw new CoreError('not_found', 'offer not found');
    if (Date.parse(offer.expires_at) <= this.d.clock.now().getTime()) throw new CoreError('quote_expired', 'offer expired; search again');
    if (fulfillment.category !== offer.category) throw new CoreError('invalid_request', 'fulfillment category does not match offer');
    const intent = JSON.parse(offer.intent_json) as PurchaseIntent;
    const ex = this.executorFor(offer.route);
    await this.assertRouteReady(ex);

    await this.assessProvider(ex, intent, fulfillment);
    const pq = await ex.quote({ offerId, executionRef: JSON.parse(offer.execution_ref_json), intent }, fulfillment);

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
    const fundingOptions = await this.fundingOptionsFor(pq.merchantTotal, fee, payable);
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
      ...(pq.sourceOffer ? { sourceOffer: pq.sourceOffer } : {}),
      ...(pq.sandboxRepresentation ? { sandboxRepresentation: pq.sandboxRepresentation } : {}),
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
    await this.d.db.run(
      `INSERT INTO quotes(id, version, supersedes_quote_id, customer_id, offer_id, category, route, provider_environment, public_json, fulfillment_json, execution_ref_json, digest, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
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

  /** USD commercial obligations and valueless testnet notional are distinct quantities. */
  private async fundingOptionsFor(principal: Money, fee: Money, payable: Money): Promise<FundingOption[]> {
    const out: FundingOption[] = [];
    const policy = SettlementPolicy.parse(this.d.config.settlementPolicy ?? demoData.settlementPolicy);
    for (const [rail, adapter] of this.d.fundingAdapters) {
      if (!this.fundingReady((await adapter.readiness()).status)) continue;
      const asset = adapter.acceptedAsset();
      if (!asset || !asset.supportsUsdNotional || payable.currency !== 'USD') continue;
      let settlement;
      try {
        settlement = validateSettlement({
          policy, commercialPrincipal: principal, commercialServiceFee: fee, commercialTotal: payable,
          principalBaseUnits: settlementBaseUnits(principal, asset.decimals, policy).toString(),
          feeBaseUnits: settlementBaseUnits(fee, asset.decimals, policy).toString(),
          totalBaseUnits: settlementBaseUnits(payable, asset.decimals, policy).toString(),
        }, asset.decimals);
      } catch {
        throw new CoreError('route_unavailable', 'commercial obligation cannot be settled exactly under the supported notional policy');
      }
      out.push({ fundingOptionId: newId('fop'), rail, payTo: asset.payTo, settlement,
        amount: { network: adapter.network, assetId: asset.assetId, decimals: asset.decimals,
          ...(asset.symbol ? { symbol: asset.symbol } : {}), amountBaseUnits: settlement.totalBaseUnits },
      });
    }
    return out;
  }

  async getQuote(actor: ActorContext, quoteId: string): Promise<QuoteView> {
    this.requireScope(actor, 'quotes:write');
    const q = await getQuoteRow(this.d.db, quoteId);
    if (!q || q.customer_id !== actor.customerId) throw new CoreError('not_found', 'quote not found');
    return JSON.parse(q.public_json) as QuoteView;
  }

  async quotePurchase(actor: ActorContext, quoteId: string) {
    this.requireScope(actor, 'purchases:read');
    const quote = await getQuoteRow(this.d.db, quoteId);
    if (!quote || quote.customer_id !== actor.customerId) throw new CoreError('not_found', 'quote not found');
    const p = await this.d.db.get<PurchaseRow>('SELECT * FROM purchases WHERE quote_id = $1 AND customer_id = $2', quoteId, actor.customerId);
    return p ? { purchase: await this.viewOf(p), approval: JSON.parse(p.approval_json) } : { purchase: null, approval: null };
  }

  /* ---------------- purchases ---------------- */

  async createPurchase(actor: ActorContext, req: CreatePurchaseRequest, idempotencyKey: string | undefined): Promise<{ status: number; purchase: PurchaseView }> {
    this.requireScope(actor, 'purchases:write');
    req = PurchaseRequestSchema.parse(req);
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      throw new CoreError('invalid_request', 'Idempotency-Key header (8-128 chars) is required');
    }
    const requestDigest = digestOf(req);
    const prior = await this.d.db.get<{ request_digest: string; status_code: number; response_json: string }>(
      "SELECT request_digest, status_code, response_json FROM idempotency_keys WHERE customer_id = $1 AND operation = 'createPurchase' AND idem_key = $2",
      actor.customerId,
      idempotencyKey,
    );
    if (prior) {
      if (prior.request_digest !== requestDigest) throw new CoreError('idempotency_conflict', 'Idempotency-Key reused with a different request');
      const { purchaseId } = JSON.parse(prior.response_json) as { purchaseId: string };
      return { status: prior.status_code, purchase: (await this.getPurchase(actor, purchaseId)) };
    }

    const quote = await getQuoteRow(this.d.db, req.quoteId);
    if (!quote || quote.customer_id !== actor.customerId) throw new CoreError('not_found', 'quote not found');
    const qv = JSON.parse(quote.public_json) as QuoteView;
    const option = qv.fundingOptions.find(o => o.fundingOptionId === req.approval.selectedFundingOptionId);
    if (!option) throw new CoreError('invalid_request', 'selected funding option does not belong to this quote; select an option from a fresh quote');
    const ex = this.executorFor(qv.route);
    ex.assertPaymentAvailable?.();
    await this.assertRouteReady(ex);
    const adapter = this.d.fundingAdapters.get(option.rail);
    if (!adapter) throw new CoreError('route_unavailable', `funding rail ${option.rail} is not available`);
    const railReady = await adapter.readiness();
    if (!this.fundingReady(railReady.status)) {
      throw new CoreError('route_unavailable', `funding rail ${option.rail} is not ready (${railReady.status})`, { missing: railReady.missing });
    }

    const nowIso = this.now();
    return await this.d.db.tx(async () => {
      // Re-check idempotency inside the write transaction (concurrent identical requests).
      const raced = await this.d.db.get<{ request_digest: string; status_code: number; response_json: string }>(
        "SELECT request_digest, status_code, response_json FROM idempotency_keys WHERE customer_id = $1 AND operation = 'createPurchase' AND idem_key = $2",
        actor.customerId,
        idempotencyKey,
      );
      if (raced) {
        if (raced.request_digest !== requestDigest) throw new CoreError('idempotency_conflict', 'Idempotency-Key reused with a different request');
        const { purchaseId } = JSON.parse(raced.response_json) as { purchaseId: string };
        return { status: raced.status_code, purchase: (await this.getPurchase(actor, purchaseId)) };
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
      const existing = await this.d.db.get<{ id: string }>('SELECT id FROM purchases WHERE quote_id = $1', quote.id);
      if (existing) throw new CoreError('conflict', 'a purchase already exists for this quote', { purchaseId: existing.id });

      // Capacity reservation for the merchant spend (simulated card capacity), not the fee.
      const cap = await capacitySnapshot(this.d.db, qv.merchantTotal.currency);
      if (!cap || cap.scale !== qv.merchantTotal.scale) {
        throw new CoreError('insufficient_capacity', `no simulated capacity configured for ${qv.merchantTotal.currency}`);
      }
      if (cap.availableMinor < minor(qv.merchantTotal)) {
        throw new CoreError('insufficient_capacity', 'insufficient simulated purchasing capacity');
      }

      const purchaseId = newId('pur');
      const requirement: FundingRequirementRecord = {
        fundingOptionId: option.fundingOptionId,
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
        ...(option.valuation ? { valuation: option.valuation } : {}),
        ...(option.settlement ? { settlement: validateSettlement(option.settlement, option.amount.decimals) } : {}),
      };
      await this.d.db.run(
        `INSERT INTO purchases(id, customer_id, quote_id, channel, state, payment_state, commerce_status, merchant_payment_status, funding_rail, funding_requirement_json, approval_json, created_at, updated_at)
         VALUES ($1,$2,$3,$4, 'awaiting_funding', 'not_received', 'not_started', 'none', $5,$6,$7,$8,$9)`,
        purchaseId,
        actor.customerId,
        quote.id,
        actor.channel,
        option.rail,
        JSON.stringify(requirement),
        JSON.stringify(req.approval),
        nowIso,
        nowIso,
      );
      await this.d.db.run(
        `INSERT INTO reservations(id, purchase_id, currency, scale, amount_minor, status, expires_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5, 'active', $6,$7,$8)`,
        newId('res'),
        purchaseId,
        qv.merchantTotal.currency,
        qv.merchantTotal.scale,
        qv.merchantTotal.amountMinor,
        quote.expires_at,
        nowIso,
        nowIso,
      );
      await appendEvent(this.d.db, purchaseId, 'purchase.created', { quoteId: quote.id, channel: actor.channel, rail: option.rail }, nowIso);
      await appendEvent(this.d.db, purchaseId, 'approval.recorded', { ...req.approval, channel: actor.channel }, nowIso);
      await appendEvent(this.d.db, purchaseId, 'capacity.reserved', { amount: qv.merchantTotal, ledgerMode: 'simulated' }, nowIso);
      await this.d.db.run(
        `INSERT INTO idempotency_keys(customer_id, operation, idem_key, request_digest, status_code, response_json, created_at)
         VALUES ($1, 'createPurchase', $2, $3, 201, $4, $5)`,
        actor.customerId,
        idempotencyKey,
        requestDigest,
        JSON.stringify({ purchaseId }),
        nowIso,
      );
      return { status: 201, purchase: (await this.viewOf((await getPurchaseRow(this.d.db, purchaseId))!)) };
    });
  }

  private async ownedPurchase(actor: ActorContext, id: string): Promise<PurchaseRow> {
    const p = await getPurchaseRow(this.d.db, id);
    if (!p || p.customer_id !== actor.customerId) throw new CoreError('not_found', 'purchase not found');
    return p;
  }

  async getPurchase(actor: ActorContext, id: string): Promise<PurchaseView> {
    this.requireScope(actor, 'purchases:read');
    return await this.viewOf((await this.ownedPurchase(actor, id)));
  }

  async purchaseEvents(actor: ActorContext, id: string): Promise<PurchaseEventView[]> {
    this.requireScope(actor, 'purchases:read');
    await this.ownedPurchase(actor, id);
    return (await this.d.db
      .all<{ id: string; sequence: number; purchase_id: string; type: string; data_json: string; created_at: string }>(
        'SELECT * FROM purchase_events WHERE purchase_id = $1 ORDER BY sequence',
        id,
      ))
      .map((e) => ({ eventId: e.id, sequence: e.sequence, purchaseId: e.purchase_id, type: e.type, data: JSON.parse(e.data_json), at: e.created_at }));
  }

  private async viewOf(p: PurchaseRow): Promise<PurchaseView> {
    return await buildPurchaseView(this.d.db, p, this.d.config.publicBaseUrl);
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
      ...(r.settlement ? { settlement: validateSettlement(r.settlement, r.decimals) } : {}),
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
    let p = await this.ownedPurchase(actor, purchaseId);
    const quote = (await getQuoteRow(this.d.db, p.quote_id))!;
    this.executorFor(quote.route as ProviderRoute).assertPaymentAvailable?.();
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
      await this.expirePurchase(p.id, 'quote expired before funding');
      throw new CoreError('quote_expired', 'quote expired before funding; request a new quote');
    }
    const requirements = adapter.paymentRequirements(input);
    if (!paymentHeader) {
      return { kind: 'payment_required', requirements, purchase: (await this.viewOf(p)) };
    }

    // One settlement attempt per purchase at a time: a concurrent second payment is refused before it
    // can be settled on-chain (otherwise it would become an unapplied refundable obligation).
    if (this.fundingInFlight.has(purchaseId)) {
      throw new CoreError('conflict', 'a funding attempt for this purchase is already in progress; retry with the same payment after it completes');
    }
    this.fundingInFlight.add(purchaseId);
    try {
      const locked = await this.d.db.withExclusiveLock(`funding:${purchaseId}`, async () => {
        // Another process may have committed funding between the initial read and the lock.
        p = (await this.ownedPurchase(actor, purchaseId));
        if (p.state !== 'awaiting_funding' || p.payment_state === 'submitted' || p.payment_state === 'unknown') {
          throw new CoreError('conflict', 'purchase no longer accepts a new funding transfer');
        }
        if (adapter.prepare) {
          const candidate = adapter.prepare(paymentHeader, input);
          if (!candidate.ok) throw new CoreError(candidate.code, candidate.reason);
          if (!adapter.recover) throw new CoreError('route_unavailable', 'funding adapter has no durable recovery');
          await this.persistFundingCandidate(purchaseId, adapter.rail, input.amount.network, candidate.transferReference);
        }
        return await this.verifyAndRecord(purchaseId, adapter, paymentHeader, input);
      });
      if (!locked.acquired) throw new CoreError('conflict', 'a funding attempt for this purchase is already in progress');
      return locked.value;
    } finally {
      this.fundingInFlight.delete(purchaseId);
    }
  }

  private async verifyAndRecord(purchaseId: string, adapter: FundingAdapter, paymentHeader: string, input: FundingRequirementInput): Promise<FundResult> {
    let p = (await getPurchaseRow(this.d.db, purchaseId))!;
    const verification = await adapter.verify(paymentHeader, input);
    if (!verification.ok) {
      const nowIso = this.now();
      await this.d.db.tx(async () => {
        await appendEvent(this.d.db,p.id,'funding.rejected',{code:verification.code,reason:verification.reason},nowIso);
        if(verification.settlementAttempted===false) {
          const removed=(await this.d.db.run("DELETE FROM funding_attempts WHERE purchase_id = $1 AND status = 'pending'",p.id)).changes;
          if(removed) await this.d.db.run("UPDATE purchases SET payment_state = 'not_received', updated_at = $1 WHERE id = $2 AND state = 'awaiting_funding' AND payment_state = 'unknown'",nowIso,p.id);
        }
      });
      throw new CoreError(verification.code, verification.reason);
    }
    return await this.recordVerifiedFunding(purchaseId, verification.funding, input);
  }

  private async recordVerifiedFunding(purchaseId: string, f: VerifiedFunding, input: FundingRequirementInput): Promise<FundResult> {
    let p = (await getPurchaseRow(this.d.db, purchaseId))!;
    if (f.rail !== p.funding_rail) throw new CoreError('payment_invalid', 'funding rail does not match purchase');
    if (p.state === 'awaiting_funding' && Date.parse(input.expiresAt) <= this.d.clock.now().getTime()) {
      await this.expirePurchase(p.id,'quote expired before funding was independently confirmed');
      p=(await getPurchaseRow(this.d.db,purchaseId))!;
    }
    // Recovery can race the original response after a confirmed chain read; never post twice.
    const existing = await this.d.db.get<{purchase_id:string}>('SELECT purchase_id FROM funding_evidence WHERE rail = $1 AND network = $2 AND transfer_reference = $3', f.rail, f.network, f.transferReference);
    if (existing) {
      if (existing.purchase_id !== purchaseId) throw new CoreError('payment_replayed', 'this transfer has already been used');
      return {kind:'funded', purchase:(await this.viewOf(p))};
    }
    // Defense in depth: core re-checks the adapter's claims against the stored requirement.
    this.assertFundingMatches(f, input);

    const nowIso = this.now();
    await this.d.db.tx(async () => {
      p = (await getPurchaseRow(this.d.db, purchaseId))!;
      const raced = await this.d.db.get<{ purchase_id: string }>(
        'SELECT purchase_id FROM funding_evidence WHERE rail = $1 AND network = $2 AND transfer_reference = $3',
        f.rail, f.network, f.transferReference,
      );
      if (raced) {
        if (raced.purchase_id !== purchaseId) throw new CoreError('payment_replayed', 'this transfer has already been used');
        return;
      }
      const stillOpen = p.state === 'awaiting_funding' && p.payment_state !== 'submitted';
      const required = BigInt(input.amount.amountBaseUnits);
      const received = BigInt(f.amountBaseUnits);
      const confirmed = f.paymentState === 'confirmed';
      const application: FundingEvidenceRow['application'] = !confirmed ? 'pending_confirmation' : stillOpen ? 'applied' : 'unapplied';
      try {
        await this.insertEvidence(p.id, f, application, nowIso);
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new CoreError('payment_replayed', 'this transfer has already been used');
        throw e;
      }
      await this.d.db.run("UPDATE funding_attempts SET status = 'recorded', updated_at = $1 WHERE purchase_id = $2 AND transfer_reference = $3", nowIso, p.id, f.transferReference);
      if (!confirmed) {
        await this.d.db.run("UPDATE purchases SET payment_state = 'submitted', updated_at = $1 WHERE id = $2", nowIso, p.id);
        await appendEvent(this.d.db, p.id, 'funding.submitted', { transfer: f.transferReference, network: f.network }, nowIso);
        await this.enqueueJob('confirm_funding', p.id, `confirm:${p.id}:${f.transferReference}`, nowIso);
        return;
      }
      if (!stillOpen) {
        await this.recordConfirmedUnappliedFunding(p.id, f, nowIso);
        return;
      }
      await this.applyConfirmedFunding(p, f, required, received, nowIso);
    });
    const after = (await getPurchaseRow(this.d.db, purchaseId))!;
    if (after.state === 'awaiting_funding' && after.payment_state !== 'submitted') {
      throw new CoreError('conflict', 'funding was received but could not be applied; it is recorded as a refundable obligation');
    }
    return {
      kind: 'funded',
      purchase: (await this.viewOf(after)),
      ...(f.settlementResponseHeader ? { settlementHeader: f.settlementResponseHeader } : {}),
    };
  }

  private async persistFundingCandidate(purchaseId: string, rail: FundingRail, network: string, reference: string): Promise<void> {
    if (!reference || reference.length > 256) throw new CoreError('payment_invalid', 'invalid funding recovery reference');
    const nowIso = this.now();
    await this.d.db.tx(async () => {
      const prior = await this.d.db.get<{purchase_id:string;transfer_reference:string}>('SELECT purchase_id, transfer_reference FROM funding_attempts WHERE rail = $1 AND network = $2 AND transfer_reference = $3',rail,network,reference);
      if (prior && prior.purchase_id !== purchaseId) throw new CoreError('payment_replayed','this transfer is already bound to another purchase');
      const current = await this.d.db.get<{transfer_reference:string}>('SELECT transfer_reference FROM funding_attempts WHERE purchase_id = $1',purchaseId);
      if (current && current.transfer_reference !== reference) throw new CoreError('conflict','a different payment is already pending recovery');
      await this.d.db.run("INSERT INTO funding_attempts(id,purchase_id,rail,network,transfer_reference,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'pending',$6,$7) ON CONFLICT(purchase_id) DO NOTHING",newId('fat'),purchaseId,rail,network,reference,nowIso,nowIso);
      await this.d.db.run("UPDATE purchases SET payment_state = 'unknown', updated_at = $1 WHERE id = $2 AND state = 'awaiting_funding'",nowIso,purchaseId);
      const candidate=(await this.d.db.get<{id:string}>('SELECT id FROM funding_attempts WHERE purchase_id = $1',purchaseId))!;
      await this.enqueueJob('recover_funding',purchaseId,'recover_funding:'+candidate.id,new Date(Date.parse(nowIso)+15_000).toISOString());
      await appendEvent(this.d.db,purchaseId,'funding.attempt_prepared',{transfer:reference},nowIso);
    });
  }

  /** Only durable candidate references can enter this read-only recovery path. */
  async recoverPendingFunding(purchaseId: string): Promise<boolean> {
    const candidate=await this.d.db.get<{rail:FundingRail;transfer_reference:string}>("SELECT rail, transfer_reference FROM funding_attempts WHERE purchase_id = $1 AND status = 'pending'",purchaseId);
    if(!candidate) return true;
    const p=(await getPurchaseRow(this.d.db,purchaseId))!;
    const adapter=this.d.fundingAdapters.get(candidate.rail);
    if(!adapter?.recover) throw new Error('funding adapter recovery unavailable');
    const input=this.requirementInput(p);
    if(p.state==='awaiting_funding' && Date.parse(input.expiresAt)<=this.d.clock.now().getTime()) await this.expirePurchase(p.id,'quote expired during funding recovery');
    const verification=await adapter.recover(candidate.transfer_reference,input);
    if(!verification.ok) return false;
    if(verification.funding.transferReference!==candidate.transfer_reference) throw new Error('funding recovery reference mismatch');
    await this.recordVerifiedFunding(purchaseId,verification.funding,input);
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

  private async insertEvidence(purchaseId: string, f: VerifiedFunding, application: FundingEvidenceRow['application'], nowIso: string): Promise<string> {
    const id = newId('fev');
    await this.d.db.run(
      `INSERT INTO funding_evidence(id, purchase_id, rail, network, asset_id, decimals, amount_base_units, payer, payee, transfer_reference, payment_state, confirmations, purpose, application, evidence_mode, observed_at, verified_at, details_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
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
  private async postReceipt(purchaseId: string, f: VerifiedFunding, applied: bigint, received: bigint, nowIso: string): Promise<void> {
    const asset = cryptoAsset(f.network, f.assetId);
    const excess = received - applied;
    const lines: JournalLine[] = [{ account: Accounts.cryptoTreasury, asset, side: 'debit', amount: received }];
    if (applied > 0n) lines.push({ account: Accounts.customerPrepayment, asset, side: 'credit' as const, amount: applied });
    if (excess > 0n) lines.push({ account: Accounts.customerUnapplied, asset, side: 'credit' as const, amount: excess });
    await postEntry(
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
  async recordConfirmedUnappliedFunding(purchaseId: string, funding: VerifiedFunding, nowIso: string): Promise<void> {
    await this.postReceipt(purchaseId, funding, 0n, BigInt(funding.amountBaseUnits), nowIso);
    await this.d.db.run("UPDATE purchases SET payment_state = 'confirmed', updated_at = $1 WHERE id = $2",nowIso,purchaseId);
    await appendEvent(this.d.db, purchaseId, 'funding.unapplied', { reason: 'confirmed after purchase closed', transfer: funding.transferReference }, nowIso);
  }

  /** Called inside a tx with a confirmed, matching transfer for an open purchase. */
  async applyConfirmedFunding(p: PurchaseRow, f: VerifiedFunding, required: bigint, received: bigint, nowIso: string): Promise<void> {
    await this.postReceipt(p.id, f, required, received, nowIso);
    const ok = await transitionPurchase(this.d.db, p.id, ['awaiting_funding'], { state: 'funded_queued', payment_state: 'confirmed' }, nowIso);
    if (!ok) throw new Error('purchase state changed during funding');
    await appendEvent(
      this.d.db,
      p.id,
      'funding.confirmed',
      { rail: f.rail, network: f.network, asset: f.assetId, amountBaseUnits: f.amountBaseUnits, transfer: f.transferReference, excessBaseUnits: (received - required).toString() },
      nowIso,
    );
    await this.enqueueJob('execute_purchase', p.id, `execute:${p.id}`, nowIso);
    await appendEvent(this.d.db, p.id, 'execution.queued', {}, nowIso);
  }

  async enqueueJob(kind: string, purchaseId: string, dedupeKey: string, runAfterIso: string): Promise<void> {
    await this.d.db.run(
      `INSERT INTO jobs(id, kind, purchase_id, dedupe_key, status, run_after, attempts, created_at, updated_at)
       VALUES ($1,$2,$3,$4, 'pending', $5, 0, $6, $7) ON CONFLICT(dedupe_key) DO NOTHING`,
      newId('job'),
      kind,
      purchaseId,
      dedupeKey,
      runAfterIso,
      runAfterIso,
      runAfterIso,
    );
  }

  async expirePurchase(purchaseId: string, reason: string): Promise<void> {
    const nowIso = this.now();
    await this.d.db.tx(async () => {
      const ok = await transitionPurchase(this.d.db, purchaseId, ['awaiting_funding'], { state: 'expired', status_reason: reason }, nowIso);
      if (!ok) return;
      await setReservationStatus(this.d.db, purchaseId, ['active'], 'released', nowIso);
      await appendEvent(this.d.db, purchaseId, 'purchase.expired', { reason }, nowIso);
      await appendEvent(this.d.db, purchaseId, 'capacity.released', { reason }, nowIso);
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
  async paymentHeaderName(purchaseId: string, actor: ActorContext): Promise<string> {
    const p = await getPurchaseRow(this.d.db, purchaseId);
    if (!p || p.customer_id !== actor.customerId) return 'payment-signature';
    return this.d.fundingAdapters.get(p.funding_rail as FundingRail)?.paymentHeaderName ?? 'payment-signature';
  }

  /** Used by the worker. */
  get deps(): CoreDeps {
    return this.d;
  }

  async reservationOf(purchaseId: string) {
    return await getReservation(this.d.db, purchaseId);
  }
}
