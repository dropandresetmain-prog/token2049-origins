import { z } from 'zod';
import { SourceOffer, SandboxRepresentation, SandboxExecution } from './provenance.js';
import { SettlementBreakdown, validateSettlement } from './settlement.js';
import { CryptoAmount, Money } from './money.js';
import {
  Category,
  CustomerId,
  FundingRail,
  IsoTimestamp,
  OfferId,
  ProviderEnvironment,
  ProviderRoute,
  PurchaseId,
  QuoteId,
  EvidenceMode,
} from './common.js';

/* ---------------- Offers ---------------- */

/**
 * Public view of an offer. A search result is NOT executable; it must be quoted.
 * The server keeps the opaque provider execution reference privately.
 */
export const OfferView = z
  .object({
    offerId: OfferId,
    sourceOffer: SourceOffer.optional(),
    category: Category,
    route: ProviderRoute,
    providerEnvironment: ProviderEnvironment,
    title: z.string(),
    description: z.string(),
    indicativePrice: Money,
    terms: z.array(z.string()).default([]),
    sourceObservedAt: IsoTimestamp,
    expiresAt: IsoTimestamp,
    executable: z.literal(false),
    checkout: z.object({ status: z.literal('search_only'), reason: z.string() }).strict().optional(),
  })
  .strict();
export type OfferView = z.infer<typeof OfferView>;

/* ---------------- Quotes ---------------- */

export const PriceLine = z
  .object({
    kind: z.enum(['item', 'shipping', 'tax', 'fee_included', 'fee_payable_at_property', 'discount']),
    label: z.string(),
    amount: Money,
  })
  .strict();

/** How a payable merchant principal is converted to a crypto funding requirement. Stated, not a market price. */
export const ValuationConvention = z
  .object({
    convention: z.enum(['test_stablecoin_usd_parity', 'configured_demo_rate']),
    /** Base units of the funding asset per 1 minor unit of the quote currency, as an exact rational. */
    numerator: z.string(),
    denominator: z.string(),
    statement: z.string(),
  })
  .strict();

export const FundingOption = z
  .object({
    /** Absent only on legacy records. New quote options have an opaque quote-scoped identity. */
    fundingOptionId: z.string().regex(/^fop_[0-9A-Za-z]{10,40}$/).optional(),
    rail: FundingRail,
    amount: CryptoAmount,
    payTo: z.string(),
    /** Legacy persisted quotes only. New quotes carry an explicit notional settlement. */
    valuation: ValuationConvention.optional(),
    settlement: SettlementBreakdown.optional(),
  })
  .strict().superRefine((o, ctx) => {
    if (!o.settlement && !o.valuation) ctx.addIssue({ code: 'custom', message: 'settlement policy required' });
    if (o.settlement) {
      try {
        const s = validateSettlement(o.settlement, o.amount.decimals);
        if (s.totalBaseUnits !== o.amount.amountBaseUnits) throw new Error('total mismatch');
      } catch { ctx.addIssue({ code: 'custom', message: 'inconsistent funding settlement' }); }
    }
  });
export type FundingOption = z.infer<typeof FundingOption>;

export const QuoteView = z
  .object({
    quoteId: QuoteId,
    version: z.number().int().min(1),
    supersedesQuoteId: QuoteId.nullable(),
    customerId: CustomerId,
    offerId: OfferId,
    sourceOffer: SourceOffer.optional(),
    category: Category,
    route: ProviderRoute,
    providerEnvironment: ProviderEnvironment,
    title: z.string(),
    breakdown: z.array(PriceLine),
    merchantTotal: Money,
    sandboxRepresentation: SandboxRepresentation.optional(),
    serviceFee: Money,
    /** merchantTotal + serviceFee: the amount purchase funding must cover. */
    payablePrincipal: Money,
    fundingOptions: z.array(FundingOption),
    fulfillmentSummary: z.string(),
    terms: z.array(z.string()),
    expiresAt: IsoTimestamp,
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    createdAt: IsoTimestamp,
  })
  .strict();
export type QuoteView = z.infer<typeof QuoteView>;

/* ---------------- Purchases ---------------- */

/** Overall purchase lifecycle. Funding, commerce and bank dimensions are tracked separately below. */
export const PurchaseState = z.enum([
  'awaiting_funding',
  'funded_queued',
  'executing',
  'succeeded',
  'failed',
  'unresolved',
  'requires_reauthorization',
  'expired',
]);
export type PurchaseState = z.infer<typeof PurchaseState>;

export const PaymentState = z.enum([
  'not_received',
  'submitted',
  'confirmed',
  'escrow_locked',
  'released',
  'refunded',
  'invalid',
  'unknown',
]);
export type PaymentState = z.infer<typeof PaymentState>;

/**
 * Provider-side commerce status. Only semantics the provider actually supports are normalized.
 * `order_created_unpaid` / `held` are NOT completed purchases.
 */
export const CommerceStatus = z.enum([
  'not_started',
  'order_created_unpaid',
  'held',
  'payment_pending',
  'paid',
  'confirmed',
  'ticketing',
  'ticketed',
  'failed',
  'cancelled',
  'unknown',
]);
export type CommerceStatus = z.infer<typeof CommerceStatus>;

/** Merchant-side payment status as reported by the provider (not bank settlement). */
export const MerchantPaymentStatus = z.enum([
  'none',
  'pending',
  'authorized',
  'paid',
  'simulated_paid',
  'test_balance_paid',
  'failed',
  'refunded',
  'unknown',
]);
export type MerchantPaymentStatus = z.infer<typeof MerchantPaymentStatus>;

export const Approval = z
  .object({
    selectedFundingOptionId: z.string().regex(/^fop_[0-9A-Za-z]{10,40}$/),
    /** Ceiling the customer authorizes; must be >= quote.payablePrincipal and in the same currency. */
    maxTotal: Money,
    /** Must equal the quote digest: approval binds exact merchant/offer/amount/fulfillment/expiry. */
    quoteDigest: z.string(),
  })
  .strict();
export type Approval = z.infer<typeof Approval>;

export const FundingSummary = z
  .object({
    rail: FundingRail,
    network: z.string(),
    asset: z.string(),
    amountBaseUnits: z.string(),
    decimals: z.number().int(),
    transferReference: z.string(),
    paymentState: PaymentState,
    purpose: z.enum(['purchase_principal', 'service_fee', 'principal_and_fee']),
    verifiedAt: IsoTimestamp,
    evidenceMode: EvidenceMode,
  })
  .strict();
export type FundingSummary = z.infer<typeof FundingSummary>;

export const ReceiptView = z
  .object({
    receiptId: z.string(),
    sourceOffer: SourceOffer.optional(),
    sandboxExecution: SandboxExecution.optional(),
    purchaseId: PurchaseId,
    quoteId: QuoteId,
    quoteDigest: z.string(),
    category: Category,
    route: ProviderRoute,
    providerEnvironment: ProviderEnvironment,
    evidenceMode: EvidenceMode,
    principal: Money,
    serviceFee: Money,
    funding: z.array(FundingSummary),
    /** Frozen selected requirement, retained after funding and completion. */
    fundingRequirement: FundingOption.optional(),
    providerReference: z.string().nullable(),
    commerceStatus: CommerceStatus,
    merchantPaymentStatus: MerchantPaymentStatus,
    /** Plain-language statement of what this receipt does and does not prove. */
    limitations: z.array(z.string()),
    treasuryEffect: z.array(
      z
        .object({ ledgerMode: z.enum(['observed', 'simulated']), account: z.string(), asset: z.string(), delta: z.string() })
        .strict(),
    ),
    evidenceRefs: z.array(z.string()),
    issuedAt: IsoTimestamp,
  })
  .strict();
export type ReceiptView = z.infer<typeof ReceiptView>;

export const FundingInstructions = z
  .object({
    fundUrl: z.string(),
    protocol: z.literal('x402'),
    options: z.array(FundingOption),
    expiresAt: IsoTimestamp,
    note: z.string(),
  })
  .strict();

export const PaymentAttempt = z.object({
  attemptId: z.string().regex(/^pat_[0-9A-Za-z]{10,40}$/),
  status: z.enum(['running', 'succeeded', 'failed']),
  retrySafe: z.boolean(),
  errorCode: z.string().regex(/^[a-z_]{3,40}$/).nullable(),
  updatedAt: IsoTimestamp,
  reviewRequired: z.boolean().optional(),
}).strict();

export const PurchaseView = z
  .object({
    purchaseId: PurchaseId,
    customerId: CustomerId,
    quoteId: QuoteId,
    quoteVersion: z.number().int(),
    category: Category,
    route: ProviderRoute,
    state: PurchaseState,
    paymentState: PaymentState,
    commerceStatus: CommerceStatus,
    merchantPaymentStatus: MerchantPaymentStatus,
    payablePrincipal: Money,
    fundingInstructions: FundingInstructions.nullable(),
    funding: z.array(FundingSummary),
    /** Frozen selected requirement, retained after funding and completion. */
    fundingRequirement: FundingOption.optional(),
    reservation: z
      .object({ status: z.enum(['active', 'consumed', 'released', 'held_unresolved']), amount: Money })
      .strict()
      .nullable(),
    providerReference: z.string().nullable(),
    receipt: ReceiptView.nullable(),
    statusReason: z.string().nullable(),
    /** Channel diagnostics only; confirmed funding remains authoritative. */
    paymentAttempt: PaymentAttempt.optional(),
    operatorAttention: z.boolean().optional(),
    createdAt: IsoTimestamp,
    updatedAt: IsoTimestamp,
  })
  .strict();
export type PurchaseView = z.infer<typeof PurchaseView>;

export const PurchaseEventView = z
  .object({
    eventId: z.string(),
    sequence: z.number().int(),
    purchaseId: PurchaseId,
    type: z.string(),
    data: z.record(z.string(), z.unknown()),
    at: IsoTimestamp,
  })
  .strict();
export type PurchaseEventView = z.infer<typeof PurchaseEventView>;
