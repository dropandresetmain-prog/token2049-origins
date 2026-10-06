/**
 * TEST-ONLY fixtures. These live under tests/ and are never imported by src/wiring.ts,
 * so the deployed gateway cannot fall back to them.
 */
import type {
  CommerceExecutor,
  ExecutionContext,
  ExecutionResult,
  FundingAdapter,
  FundingRequirementInput,
  FundingVerification,
  ProviderOffer,
  ProviderQuote,
} from '../../src/contracts/ports.js';
import type { Category, ProviderRoute, Readiness, ReadinessStatus } from '../../src/contracts/common.js';
import type { PurchaseIntent, Fulfillment } from '../../src/contracts/intent.js';
import { money, type Money } from '../../src/contracts/money.js';
import type { Clock } from '../../src/infrastructure/clock.js';

export const FIXTURE_NETWORK = 'cardano:preprod';
export const FIXTURE_ASSET = 'e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9.0014df10745553444d';
export const FIXTURE_TREASURY = 'addr_test1fixturetreasury';

type Behavior = 'succeed' | 'fail' | 'unknown' | 'throw_unknown' | 'terms_changed' | 'held_only' | 'unknown_then_succeed';

export class FixtureExecutor implements CommerceExecutor {
  readonly environment = 'fixture' as const;
  behavior: Behavior = 'succeed';
  price: Money;
  readinessStatus: ReadinessStatus = 'LOCAL_TESTS_ONLY';
  executeCalls = 0;
  retrieveCalls = 0;
  /** Simulated provider-side state, keyed by idempotency key. */
  orders = new Map<string, { ref: string; paid: boolean }>();
  private gate: Promise<void> | null = null;
  private release: (() => void) | null = null;

  constructor(
    readonly route: ProviderRoute,
    readonly category: Category,
    private readonly clock: Clock,
    priceMinor = 4999n,
  ) {
    this.price = money('USD', priceMinor);
  }

  /** Make the next execute() block until unblock() is called (to simulate in-flight crash windows). */
  block(): void {
    this.gate = new Promise((r) => (this.release = r));
  }
  unblock(): void {
    this.release?.();
    this.gate = null;
  }

  async readiness(): Promise<Readiness> {
    return { component: `${this.route}`, status: this.readinessStatus, environment: 'fixture', missing: [], checkedAt: this.clock.now().toISOString() };
  }

  async search(_intent: PurchaseIntent): Promise<ProviderOffer[]> {
    const exp = new Date(this.clock.now().getTime() + 3600_000).toISOString();
    return [
      {
        title: `Fixture ${this.category} item`,
        description: 'Deterministic local fixture',
        indicativePrice: this.price,
        terms: ['fixture'],
        executionRef: { sku: 'FIX-1' },
        sourceObservedAt: this.clock.now().toISOString(),
        expiresAt: exp,
      },
    ];
  }

  async quote(_offer: { executionRef: Record<string, unknown>; intent: PurchaseIntent }, _f: Fulfillment): Promise<ProviderQuote> {
    return {
      title: `Fixture ${this.category} item`,
      breakdown: [{ kind: 'item', label: 'item', amount: this.price }],
      merchantTotal: this.price,
      terms: ['fixture'],
      fulfillmentSummary: 'fixture fulfillment',
      executionRef: { sku: 'FIX-1', quotedMinor: this.price.amountMinor },
      expiresAt: new Date(this.clock.now().getTime() + 3600_000).toISOString(),
    };
  }

  private evidence(ref: string) {
    return [{ source: `fixture:${this.route}`, environment: 'fixture' as const, evidenceMode: 'local_fixture' as const, reference: ref, observedAt: this.clock.now().toISOString(), details: {} }];
  }

  async execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    this.executeCalls++;
    if (this.gate) await this.gate;
    const ref = `FIX-${ctx.idempotencyKey}`;
    switch (this.behavior) {
      case 'succeed':
        this.orders.set(ctx.idempotencyKey, { ref, paid: true });
        await ctx.checkpoint('order', { providerReference: ref });
        return { kind: 'succeeded', providerReference: ref, commerceStatus: 'confirmed', merchantPaymentStatus: 'simulated_paid', chargedAmount: ctx.quote.merchantTotal, evidence: this.evidence(ref) };
      case 'fail':
        return { kind: 'failed_definite', reason: 'fixture decline', providerReference: null, evidence: [] };
      case 'terms_changed':
        return { kind: 'terms_changed', reason: 'fixture price changed', evidence: [] };
      case 'held_only':
        this.orders.set(ctx.idempotencyKey, { ref, paid: false });
        return { kind: 'succeeded', providerReference: ref, commerceStatus: 'held', merchantPaymentStatus: 'none', chargedAmount: ctx.quote.merchantTotal, evidence: this.evidence(ref) };
      case 'unknown':
        return { kind: 'unknown', reason: 'fixture timeout', providerReference: null, evidence: [] };
      case 'unknown_then_succeed':
        this.orders.set(ctx.idempotencyKey, { ref, paid: true });
        return { kind: 'unknown', reason: 'fixture timeout after provider accepted', providerReference: null, evidence: [] };
      case 'throw_unknown':
        throw new Error('socket hang up');
    }
  }

  async retrieve(ctx: ExecutionContext): Promise<ExecutionResult> {
    this.retrieveCalls++;
    const o = this.orders.get(ctx.idempotencyKey);
    if (!o) return { kind: 'unknown', reason: 'fixture: no order found yet', providerReference: null, evidence: [] };
    if (!o.paid) return { kind: 'unknown', reason: 'fixture: order held, unpaid', providerReference: o.ref, evidence: [] };
    return { kind: 'succeeded', providerReference: o.ref, commerceStatus: 'confirmed', merchantPaymentStatus: 'simulated_paid', chargedAmount: ctx.quote.merchantTotal, evidence: this.evidence(o.ref) };
  }
}

/**
 * Fixture funding rail. Payment header format: `fixture:<txref>:<amountBaseUnits>[:<state>][:<asset>][:<payee>]`.
 * Verification mimics a real verifier's checks (amount/asset/payee/expiry/replay at adapter level).
 */
export class FixtureFundingAdapter implements FundingAdapter {
  readonly rail = 'cardano' as const;
  readonly network = FIXTURE_NETWORK;
  readonly paymentHeaderName = 'payment-signature';
  readinessStatus: ReadinessStatus = 'LOCAL_TESTS_ONLY';
  verifyCalls = 0;
  confirmResult: 'confirmed' | 'submitted' | 'invalid' = 'confirmed';
  /** Simulated verification/settlement latency. */
  delayMs = 0;

  constructor(private readonly clock: Clock) {}

  async readiness(): Promise<Readiness> {
    return { component: 'cardano', status: this.readinessStatus, environment: 'fixture', missing: [], checkedAt: this.clock.now().toISOString() };
  }

  acceptedAsset() {
    return { assetId: FIXTURE_ASSET, decimals: 6, symbol: 'tUSDM', payTo: FIXTURE_TREASURY, supportsUsdNotional: true };
  }

  paymentRequirements(input: FundingRequirementInput): Record<string, unknown> {
    return {
      x402Version: 2,
      error: 'payment required',
      resource: { url: input.resourceUrl, description: input.description, mimeType: 'application/json' },
      accepts: [{ scheme: 'exact', network: input.amount.network, amount: input.amount.amountBaseUnits, asset: input.amount.assetId, payTo: input.payTo, maxTimeoutSeconds: 300, extra: { purchaseId: input.purchaseId } }],
    };
  }

  async verify(header: string, input: FundingRequirementInput): Promise<FundingVerification> {
    this.verifyCalls++;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const [tag, ref, amount, state = 'confirmed', asset = FIXTURE_ASSET, payee = FIXTURE_TREASURY, purpose = 'purchase_principal'] = header.split(':');
    if (tag !== 'fixture' || !ref || !amount) return { ok: false, code: 'payment_invalid', reason: 'malformed payment payload' };
    if (Date.parse(input.expiresAt) <= this.clock.now().getTime()) return { ok: false, code: 'payment_invalid', reason: 'requirement expired' };
    return {
      ok: true,
      funding: {
        rail: 'cardano',
        network: FIXTURE_NETWORK,
        assetId: asset,
        decimals: 6,
        amountBaseUnits: amount,
        payer: 'addr_test1fixturepayer',
        payee,
        transferReference: ref,
        paymentState: state as 'confirmed' | 'submitted',
        confirmations: state === 'confirmed' ? 1 : 0,
        purpose: purpose as 'purchase_principal' | 'service_fee' | 'principal_and_fee',
        evidenceMode: 'local_fixture',
        observedAt: this.clock.now().toISOString(),
        details: { fixture: true },
      },
    };
  }

  async confirm() {
    return { paymentState: this.confirmResult, confirmations: this.confirmResult === 'confirmed' ? 3 : 0, observedAt: this.clock.now().toISOString() };
  }
}
