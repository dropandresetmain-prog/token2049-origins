/**
 * Ports consumed by the core. Provider and chain SDK types must not leak through these.
 * - CommerceExecutor: resolves/quotes/executes/retrieves provider objects. Cannot mark funding
 *   valid or write financial tables.
 * - FundingAdapter: generates protocol requirements and independently verifies payments. Never books commerce.
 * - BankObservationAdapter: provenance-bearing OCBC observations only.
 */
import type { SettlementBreakdown } from './settlement.js';
import type { Money, CryptoAmount } from './money.js';
import type {
  Category,
  EvidenceMode,
  FundingRail,
  ProviderEnvironment,
  ProviderRoute,
  Readiness,
} from './common.js';
import type { PurchaseIntent, Fulfillment } from './intent.js';
import type { CommerceStatus, MerchantPaymentStatus, PaymentState } from './commerce.js';

/* ---------------- Commerce executor ---------------- */

export interface ProviderOffer {
  title: string;
  description: string;
  indicativePrice: Money;
  terms: string[];
  /** Opaque, server-held reference needed to quote/execute. Never returned to channels. */
  executionRef: Record<string, unknown>;
  sourceObservedAt: string;
  expiresAt: string;
}

export interface ProviderQuote {
  title: string;
  breakdown: Array<{ kind: 'item' | 'shipping' | 'tax' | 'fee_included' | 'fee_payable_at_property' | 'discount'; label: string; amount: Money }>;
  /** Exact amount the merchant/provider will charge for this purchase (incl. shipping/tax). */
  merchantTotal: Money;
  terms: string[];
  fulfillmentSummary: string;
  /** Opaque provider handle for execution (prebookId, sessionId, cart id...). Server-held. */
  executionRef: Record<string, unknown>;
  expiresAt: string;
}

export interface ExecutionContext {
  purchaseId: string;
  attemptId: string;
  /** Stable per attempt; use as provider idempotency/client reference where supported. */
  idempotencyKey: string;
  quote: { quoteId: string; merchantTotal: Money; executionRef: Record<string, unknown>; expiresAt: string };
  fulfillment: Fulfillment;
  /**
   * Persist an intermediate provider reference BEFORE the next irreversible step
   * (e.g. Atlas order number before pay). Durable when the promise resolves.
   */
  checkpoint(step: string, data: Record<string, unknown>): Promise<void>;
  /** Previously persisted checkpoints for this attempt (for resume/reconcile). */
  checkpoints: Record<string, Record<string, unknown>>;
}

export interface ProviderEvidence {
  source: string;
  environment: ProviderEnvironment;
  evidenceMode: EvidenceMode;
  reference: string;
  observedAt: string;
  /** Private, redacted-at-write details (no PII/secrets). */
  details: Record<string, unknown>;
}

export type ExecutionResult =
  | {
      kind: 'succeeded';
      providerReference: string;
      commerceStatus: CommerceStatus;
      merchantPaymentStatus: MerchantPaymentStatus;
      chargedAmount: Money;
      evidence: ProviderEvidence[];
    }
  | {
      /** Definitive, provider-confirmed failure with nothing charged. */
      kind: 'failed_definite';
      reason: string;
      providerReference: string | null;
      evidence: ProviderEvidence[];
    }
  | {
      /** Terms changed at execution time (price/terms/availability); nothing charged. */
      kind: 'terms_changed';
      reason: string;
      evidence: ProviderEvidence[];
    }
  | {
      /** Outcome not known (timeout, ambiguous state). Exposure retained; reconcile via retrieve. */
      kind: 'unknown';
      reason: string;
      providerReference: string | null;
      evidence: ProviderEvidence[];
    };

export interface CommerceExecutor {
  readonly route: ProviderRoute;
  readonly category: Category;
  readonly environment: ProviderEnvironment;
  readiness(): Promise<Readiness>;
  /** Local payment gate; must run before creating a funding obligation. */
  assertPaymentAvailable?(): void;
  /** Read-only discovery; paths must refer to reviewed canonical customer fields. Never request arbitrary JSON. */
  inputRequirements?(input: { intent: PurchaseIntent; fulfillment?: Fulfillment }): Promise<{ phase: 'search' | 'fulfillment'; paths: string[] } | null>;
  search(intent: PurchaseIntent): Promise<ProviderOffer[]>;
  quote(offer: { executionRef: Record<string, unknown>; intent: PurchaseIntent }, fulfillment: Fulfillment): Promise<ProviderQuote>;
  /** Must never be called twice for one attempt by the core; must still be safe to resume from checkpoints. */
  execute(ctx: ExecutionContext): Promise<ExecutionResult>;
  /** Independent readback; used after execute and for reconciliation of unknown outcomes. */
  retrieve(ctx: ExecutionContext): Promise<ExecutionResult>;
}

/* ---------------- Funding adapter ---------------- */

export interface FundingRequirementInput {
  /** Absent only for legacy obligations, whose stored amounts remain authoritative. */
  settlement?: SettlementBreakdown;
  purchaseId: string;
  quoteId: string;
  quoteDigest: string;
  amount: CryptoAmount;
  payTo: string;
  resourceUrl: string;
  description: string;
  expiresAt: string;
}

export interface VerifiedFunding {
  rail: FundingRail;
  network: string;
  assetId: string;
  decimals: number;
  amountBaseUnits: string;
  payer: string;
  payee: string;
  /** Unique external reference (tx hash, or tx#output). Consumed exactly once. */
  transferReference: string;
  paymentState: PaymentState;
  confirmations: number | null;
  purpose: 'purchase_principal' | 'service_fee' | 'principal_and_fee';
  evidenceMode: EvidenceMode;
  observedAt: string;
  /** Header value the channel should echo back (protocol settlement response), if any. */
  settlementResponseHeader?: { name: string; value: string };
  details: Record<string, unknown>;
}

export type FundingVerification =
  | { ok: true; funding: VerifiedFunding }
  | {
      ok: false;
      code: 'payment_invalid' | 'payment_replayed' | 'payment_required';
      reason: string;
      /** False proves settlement was never invoked. Omission retains durable recovery. */
      settlementAttempted?: boolean;
    };

export type FundingPreparation =
  | { ok: true; transferReference: string }
  | Extract<FundingVerification, { ok: false }>;

export interface FundingAdapter {
  readonly rail: FundingRail;
  readonly network: string;
  readiness(): Promise<Readiness>;
  /** Asset/payee this rail will accept, for building quotes. Null if not configured. */
  acceptedAsset(): { assetId: string; decimals: number; symbol?: string; payTo: string; supportsUsdNotional: boolean } | null;
  /** Protocol-native challenge body (e.g. x402 `accepts[]` entry) for this requirement. */
  paymentRequirements(input: FundingRequirementInput): Record<string, unknown>;
  /** Header the client sends the payment payload in. */
  readonly paymentHeaderName: string;
  /** Decode and bind a candidate without external side effects, so core can persist its recovery reference. */
  prepare?(paymentHeaderValue: string, input: FundingRequirementInput): FundingPreparation;
  /** Read an already-persisted candidate independently; never submit or settle another transfer. */
  recover?(transferReference: string, input: FundingRequirementInput): Promise<FundingVerification>;
  /** Independently verify (and settle if the protocol requires) the payment for this exact requirement. */
  verify(paymentHeaderValue: string, input: FundingRequirementInput): Promise<FundingVerification>;
  /**
   * Re-check a previously verified but not yet confirmed transfer (`submitted`) against the chain.
   * Optional: adapters that only return `confirmed` from verify() need not implement it.
   */
  confirm?(funding: VerifiedFunding): Promise<{ paymentState: PaymentState; confirmations: number | null; observedAt: string }>;
}

/* ---------------- Bank observation adapter ---------------- */

export interface BankObservation {
  kind: 'account_balance' | 'card_summary' | 'account_transaction' | 'card_transaction';
  maskedReference: string;
  currency: string;
  amount: Money | null;
  availableAmount: Money | null;
  description: string | null;
  observedAt: string;
  providerTimestamp: string | null;
  environment: 'sandbox' | 'production';
  source: string;
  caveats: string[];
}

export interface BankObservationAdapter {
  readonly bank: 'ocbc';
  readiness(): Promise<Readiness>;
  observe(): Promise<BankObservation[]>;
}
