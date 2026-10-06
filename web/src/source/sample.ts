/**
 * Sample source: local, illustrative purchases in the gateway's own contract shapes.
 *
 * Every object is validated with the gateway schemas when the source is created, so a sample that would not
 * come out of the real gateway fails fast. Nothing here is a real payment, booking or order.
 */
import { EvidenceDetail, EvidenceListItem, PurchaseProof } from '../contracts/evidence.js';
import { PurchaseView, QuoteView, ReceiptView, projectProgress } from '../contracts/backend.js';
import type { Money, PurchaseState, PaymentState, CommerceStatus, MerchantPaymentStatus } from '../contracts/backend.js';
import { PurchaseContext } from '../contracts/proposed.js';
import { ConsoleError, type ConsoleSource, type PurchaseBundle, type PurchaseListResult } from '../contracts/source.js';
import { sampleConnections, sampleTreasury } from './sample.operator.js';

type Cat = 'hotel' | 'retail' | 'flight';
type Route = 'nuitee' | 'shopify' | 'atlas';
type Rail = 'cardano' | 'solana';
type Channel = 'chatgpt' | 'mcp' | 'sokosumi';

interface Spec {
  key: string;
  idSuffix: string;
  category: Cat;
  route: Route;
  title: string;
  fulfillmentSummary: string;
  breakdown: Array<{ kind: 'item' | 'shipping' | 'tax' | 'fee_payable_at_property'; label: string; cents: number }>;
  rail: Rail;
  channel: Channel;
  requestedBy: string;
  requestText: string;
  limitCents: number;
  state: PurchaseState;
  paymentState: PaymentState;
  commerceStatus: CommerceStatus;
  merchantPaymentStatus: MerchantPaymentStatus;
  providerReference: string | null;
  /** Minutes before "now" the purchase was created. */
  ageMinutes: number;
  events: string[];
  /** Found at another store; bought as an equivalent order in Capsule's test store. */
  source?: { store: string; storeUrl: string; product: string; variant: string; productUrl: string; listedCents: number };
}

const LIMIT = 50;
const usd = (cents: number): Money => ({ currency: 'USD', amountMinor: String(cents), scale: 2 });
/** Fixed-width opaque ID body. The unique part goes last, because people see the last six characters. */
const pad = (s: string, n = 26) => ('0'.repeat(n) + s).slice(-n).toUpperCase().replace(/[^0-9A-Z]/g, '0');
const hex64 = (seed: string) => Array.from({ length: 64 }, (_, i) => '0123456789abcdef'[(seed.charCodeAt(i % seed.length) + i * 7) % 16]).join('');

const NETWORK: Record<Rail, { network: string; assetId: string; symbol: string; payTo: string }> = {
  cardano: { network: 'cardano:preprod', assetId: 'c0ffee0000000000000000000000000000000000000000000000000.74555344', symbol: 'tUSD', payTo: 'addr_test1qsampleonlysampleonlysampleonlysampleonly0000000000' },
  solana: { network: 'solana:devnet', assetId: 'SampleMint1111111111111111111111111111111111', symbol: 'tUSD', payTo: 'SamplePayee11111111111111111111111111111111' },
};

/** Events in the order the gateway records them, by how far the purchase got. */
const EVENTS = {
  created: ['purchase.created', 'approval.recorded'],
  paid: ['funding.attempt_prepared', 'funding.submitted', 'funding.confirmed', 'capacity.reserved'],
  started: ['execution.queued', 'execution.started'],
  done: ['execution.succeeded', 'capacity.consumed', 'receipt.issued'],
};

const SPECS: Spec[] = [
  {
    key: 'in-progress', idSuffix: 'HTLSGP0428', category: 'hotel', route: 'nuitee', title: 'Two nights in Singapore',
    fulfillmentSummary: 'Singapore, Oct 8 to Oct 10, 1 adult',
    breakdown: [{ kind: 'item', label: 'Room, 2 nights', cents: 26100 }, { kind: 'tax', label: 'Taxes', cents: 2500 }],
    rail: 'cardano', channel: 'chatgpt', requestedBy: 'ChatGPT', requestText: 'Book two nights in Singapore. Keep the total under $400.', limitCents: 40000,
    state: 'executing', paymentState: 'confirmed', commerceStatus: 'not_started', merchantPaymentStatus: 'none', providerReference: null,
    ageMinutes: 6, events: [...EVENTS.created, ...EVENTS.paid, ...EVENTS.started],
  },
  {
    key: 'completed', idSuffix: 'RTLHDP0427', category: 'retail', route: 'shopify', title: 'Noise-cancelling headphones',
    fulfillmentSummary: '1 item, delivery included',
    breakdown: [{ kind: 'item', label: 'Headphones', cents: 7400 }, { kind: 'shipping', label: 'Delivery', cents: 500 }],
    rail: 'solana', channel: 'mcp', requestedBy: 'Claude', requestText: 'Buy these headphones from our test store. Keep the delivered price under $100.', limitCents: 10000,
    state: 'succeeded', paymentState: 'confirmed', commerceStatus: 'paid', merchantPaymentStatus: 'simulated_paid', providerReference: 'SAMPLE-ORDER-1042',
    ageMinutes: 12, events: [...EVENTS.created, ...EVENTS.paid, ...EVENTS.started, ...EVENTS.done],
  },
  {
    key: 'checking', idSuffix: 'FLTSIN0426', category: 'flight', route: 'atlas', title: 'Singapore to Tokyo flight',
    fulfillmentSummary: 'SIN to NRT, Oct 12, 1 adult',
    breakdown: [{ kind: 'item', label: 'Economy fare', cents: 36800 }, { kind: 'tax', label: 'Taxes and charges', cents: 4400 }],
    rail: 'cardano', channel: 'mcp', requestedBy: 'Claude', requestText: 'Book this Singapore to Tokyo flight for one adult, under $500.', limitCents: 50000,
    state: 'unresolved', paymentState: 'confirmed', commerceStatus: 'unknown', merchantPaymentStatus: 'unknown', providerReference: null,
    ageMinutes: 28, events: [...EVENTS.created, ...EVENTS.paid, ...EVENTS.started, 'execution.unknown', 'reconciliation.pending', 'outcome.refreshed'],
  },
  {
    key: 'completed-hotel', idSuffix: 'HTLBKK0425', category: 'hotel', route: 'nuitee', title: 'One night in Bangkok',
    fulfillmentSummary: 'Bangkok, Oct 14 to Oct 15, 1 adult',
    breakdown: [{ kind: 'item', label: 'Room, 1 night', cents: 16900 }, { kind: 'tax', label: 'Taxes', cents: 1500 }, { kind: 'fee_payable_at_property', label: 'City tax', cents: 300 }],
    rail: 'cardano', channel: 'chatgpt', requestedBy: 'ChatGPT', requestText: 'Book one night in Bangkok, with a total under $220.', limitCents: 22000,
    state: 'succeeded', paymentState: 'confirmed', commerceStatus: 'confirmed', merchantPaymentStatus: 'test_balance_paid', providerReference: 'SAMPLE-BOOKING-023',
    ageMinutes: 40, events: [...EVENTS.created, ...EVENTS.paid, ...EVENTS.started, ...EVENTS.done],
  },
  {
    key: 'price-changed', idSuffix: 'RTLBAG0424', category: 'retail', route: 'shopify', title: 'Everyday carry bag',
    fulfillmentSummary: '1 item, delivery included',
    breakdown: [{ kind: 'item', label: 'Carry bag', cents: 5700 }, { kind: 'shipping', label: 'Delivery', cents: 500 }],
    rail: 'cardano', channel: 'chatgpt', requestedBy: 'ChatGPT', requestText: 'Buy this carry bag from the test store for no more than $80 including delivery.', limitCents: 8000,
    state: 'requires_reauthorization', paymentState: 'confirmed', commerceStatus: 'not_started', merchantPaymentStatus: 'none', providerReference: null,
    ageMinutes: 55, events: [...EVENTS.created, ...EVENTS.paid, ...EVENTS.started, 'execution.terms_changed'],
  },
  {
    key: 'awaiting-payment', idSuffix: 'RTLLMP0423', category: 'retail', route: 'shopify', title: 'Desk lamp',
    fulfillmentSummary: '1 item, delivery included',
    breakdown: [{ kind: 'item', label: 'Desk lamp', cents: 3900 }, { kind: 'shipping', label: 'Delivery', cents: 500 }],
    rail: 'cardano', channel: 'sokosumi', requestedBy: 'Sokosumi agent', requestText: 'Buy a desk lamp for under $50.', limitCents: 5000,
    state: 'awaiting_funding', paymentState: 'not_received', commerceStatus: 'not_started', merchantPaymentStatus: 'none', providerReference: null,
    ageMinutes: 70, events: [...EVENTS.created],
  },
  {
    key: 'found-elsewhere', idSuffix: 'RTLSRC0422', category: 'retail', route: 'shopify', title: 'Merino crew socks',
    fulfillmentSummary: '1 item, delivery included',
    breakdown: [{ kind: 'item', label: 'Merino crew socks', cents: 2400 }, { kind: 'shipping', label: 'Delivery', cents: 500 }],
    rail: 'solana', channel: 'mcp', requestedBy: 'Claude', requestText: 'Find merino socks online and buy a pair for under $35.', limitCents: 3500,
    state: 'succeeded', paymentState: 'confirmed', commerceStatus: 'paid', merchantPaymentStatus: 'simulated_paid', providerReference: 'SAMPLE-ORDER-1043',
    ageMinutes: 95, events: [...EVENTS.created, ...EVENTS.paid, ...EVENTS.started, ...EVENTS.done],
    source: { store: 'Harbor and Pine', storeUrl: 'https://harborandpine.example', product: 'Merino crew socks', variant: 'Charcoal, medium',
      productUrl: 'https://harborandpine.example/products/merino-crew-socks', listedCents: 2400 },
  },
];

function build(spec: Spec, now: number) {
  const created = new Date(now - spec.ageMinutes * 60_000);
  // Events land about 25 seconds apart, roughly how long each stage takes in test mode.
  const at = (i: number) => new Date(created.getTime() + i * 25_000).toISOString();
  const purchaseId = `pur_${pad(spec.idSuffix)}`;
  const quoteId = `quo_${pad(spec.idSuffix + 'Q')}`;
  const fundingOptionId = `fop_${pad(spec.idSuffix + 'F')}`;
  const merchantTotalCents = spec.breakdown.filter((l) => l.kind !== 'fee_payable_at_property').reduce((s, l) => s + l.cents, 0);
  const net = NETWORK[spec.rail];
  const decimals = 6;
  // Scaled testnet settlement: 1/1000 of the commercial total, exact at 6 decimals.
  const totalBaseUnits = String((merchantTotalCents * 10 ** decimals) / (100 * 1000));
  const requirement = {
    fundingOptionId, rail: spec.rail,
    amount: { network: net.network, assetId: net.assetId, symbol: net.symbol, decimals, amountBaseUnits: totalBaseUnits },
    payTo: net.payTo,
    settlement: {
      policy: { mode: 'scaled_testnet' as const, numerator: 1 as const, denominator: 1000 as const },
      commercialPrincipal: usd(merchantTotalCents), commercialServiceFee: usd(0), commercialTotal: usd(merchantTotalCents),
      principalBaseUnits: totalBaseUnits, feeBaseUnits: '0', totalBaseUnits,
    },
  };
  const env = spec.route === 'shopify' ? 'test' : 'sandbox';
  const paid = spec.paymentState === 'confirmed';
  const done = spec.state === 'succeeded';
  const eventRows = spec.events.map((type, i) => ({ sequence: i + 1, type, at: at(i) }));
  const eventAt = (type: string) => eventRows.find((e) => e.type === type)?.at ?? null;
  const transferReference = `SAMPLE-TX-${spec.idSuffix}`;
  const digits = (n: number) => String(7_000_000_000 + n);
  const sourceOffer = spec.source
    ? {
        source: 'shopify_global_catalog' as const, productId: `gid://shopify/p/${spec.idSuffix}`, variantId: `gid://shopify/ProductVariant/${digits(1)}`,
        merchantId: `gid://shopify/Shop/${digits(2)}`, merchantName: spec.source.store, merchantUrl: spec.source.storeUrl,
        productTitle: spec.source.product, variantTitle: spec.source.variant, productUrl: spec.source.productUrl,
        observedPrice: usd(spec.source.listedCents), availability: 'available' as const, observedAt: created.toISOString(),
        schemaVersion: '2026-08-25' as const, evidenceMode: 'local_fixture' as const,
      }
    : null;
  const sandboxRepresentation = spec.source
    ? {
        provider: 'shopify' as const, environment: 'test' as const,
        boundary: 'Source merchant receives no order or payment; equivalent transaction executes in Capsule Shopify Sandbox.' as const,
        shadowProductId: `gid://shopify/Product/${digits(3)}`, shadowVariantId: `gid://shopify/ProductVariant/${digits(4)}`,
        publicationId: `gid://shopify/Publication/${digits(5)}`, sourceDigest: hex64(spec.idSuffix + 'S'),
      }
    : null;
  const provenance = { ...(sourceOffer ? { sourceOffer } : {}) };
  const sandboxExecution = sandboxRepresentation
    ? { ...sandboxRepresentation, quotedTotal: usd(merchantTotalCents), orderReference: spec.providerReference, paymentStatus: spec.merchantPaymentStatus,
        evidenceMode: done ? ('local_fixture' as const) : null }
    : null;

  const quote = QuoteView.parse({
    ...provenance, ...(sandboxRepresentation ? { sandboxRepresentation } : {}),
    quoteId, version: 1, supersedesQuoteId: null, customerId: 'cus_SAMPLECUSTOMER0001', offerId: `off_${pad(spec.idSuffix + 'O')}`,
    category: spec.category, route: spec.route, providerEnvironment: env, title: spec.title,
    breakdown: spec.breakdown.map((l) => ({ kind: l.kind, label: l.label, amount: usd(l.cents) })),
    merchantTotal: usd(merchantTotalCents), serviceFee: usd(0), payablePrincipal: usd(merchantTotalCents),
    fundingOptions: [requirement], fulfillmentSummary: spec.fulfillmentSummary,
    terms: spec.category === 'hotel' ? ['Free cancellation until 24 hours before check-in.'] : [],
    expiresAt: new Date(created.getTime() + 30 * 60_000).toISOString(), digest: `sha256:${hex64(spec.idSuffix)}`, createdAt: created.toISOString(),
  });

  const funding = paid
    ? [{ rail: spec.rail, network: net.network, asset: net.assetId, amountBaseUnits: totalBaseUnits, decimals, transferReference,
        paymentState: 'confirmed' as const, purpose: 'principal_and_fee' as const, verifiedAt: eventAt('funding.confirmed')!, evidenceMode: 'local_fixture' as const }]
    : [];

  const receipt = done
    ? ReceiptView.parse({
        ...provenance, ...(sandboxExecution ? { sandboxExecution } : {}),
        receiptId: `rcp_${pad(spec.idSuffix + 'R')}`, purchaseId, quoteId, quoteDigest: quote.digest, category: spec.category, route: spec.route,
        providerEnvironment: env, evidenceMode: 'local_fixture', principal: usd(merchantTotalCents), serviceFee: usd(0), funding,
        fundingRequirement: requirement, providerReference: spec.providerReference, commerceStatus: spec.commerceStatus,
        merchantPaymentStatus: spec.merchantPaymentStatus,
        limitations: ['This is a sample receipt. No payment, booking or delivery took place.', 'Test payments have no cash value and are not bank payments.'],
        treasuryEffect: [], evidenceRefs: [], issuedAt: eventAt('receipt.issued')!,
      })
    : null;

  const reservationStatus = !paid ? null : done ? 'consumed' : spec.state === 'unresolved' ? 'held_unresolved' : spec.state === 'requires_reauthorization' ? 'held_unresolved' : 'active';
  const reservation = reservationStatus ? { status: reservationStatus, amount: usd(merchantTotalCents) } : null;

  const purchase = PurchaseView.parse({
    purchaseId, customerId: 'cus_SAMPLECUSTOMER0001', quoteId, quoteVersion: 1, category: spec.category, route: spec.route,
    state: spec.state, paymentState: spec.paymentState, commerceStatus: spec.commerceStatus, merchantPaymentStatus: spec.merchantPaymentStatus,
    payablePrincipal: usd(merchantTotalCents),
    fundingInstructions: spec.state === 'awaiting_funding'
      ? { fundUrl: `https://gateway.example/v1/purchases/${purchaseId}/fund`, protocol: 'x402', options: [requirement], expiresAt: quote.expiresAt, note: 'Sample only.' }
      : null,
    funding, fundingRequirement: requirement, reservation, providerReference: spec.providerReference, receipt,
    statusReason: null, createdAt: created.toISOString(), updatedAt: at(spec.events.length - 1),
  });

  const progress = projectProgress(purchase);
  const verified = progress.outcomeFinal && eventRows.some((e) => ['execution.succeeded', 'execution.terms_changed', 'execution.failed_definite'].includes(e.type));
  const step = (key: string, label: string, isDone: boolean, ts: string | null, current = false) => ({
    step: key, label, status: isDone ? 'complete' : current ? (progress.stage === 'needs_attention' ? 'attention' : 'current') : 'pending',
    timestamp: isDone || current ? ts : null, text: label, evidenceRef: null,
  });
  const proof = PurchaseProof.parse({
    ...provenance, ...(sandboxExecution ? { sandboxExecution } : {}),
    purchaseId, quoteId, summary: `${spec.category} purchase`, commercialAmount: usd(merchantTotalCents), progress,
    timeline: [
      step('requested', 'Requested', true, created.toISOString()),
      step('quote_confirmed', 'Quote confirmed', true, created.toISOString()),
      step('approved', 'Approved', true, eventAt('approval.recorded')),
      step('funded', 'Funded', paid, eventAt('funding.confirmed'), !paid),
      step('merchant_execution', 'Merchant execution', !!eventAt('execution.started') && verified, eventAt('execution.started'), paid && !verified),
      step('result_verified', 'Result verified', verified && progress.stage === 'complete', eventAt('execution.succeeded') ?? eventAt('execution.terms_changed'), verified && progress.stage !== 'complete'),
    ],
    funding: {
      requirement, confirmationStatus: spec.paymentState, applied: paid, sources: [],
      transfers: paid ? [{ reference: transferReference, confirmationStatus: 'confirmed', application: 'applied', evidenceMode: 'local_fixture', verifiedAt: eventAt('funding.confirmed')! }] : [],
    },
    merchant: { provider: spec.route, environment: env, result: spec.commerceStatus, paymentStatus: spec.merchantPaymentStatus, providerReference: spec.providerReference, evidenceMode: done ? 'local_fixture' : null },
    receipt: receipt ? { receiptId: receipt.receiptId, finalResult: progress.label, issuedAt: receipt.issuedAt, limitations: receipt.limitations, evidenceRefs: [] } : null,
    technicalEvidencePath: `/v1/evidence/purchases/${purchaseId}`,
  });

  const technicalRecord = {
    note: 'Sample record. Not a real purchase.',
    purchase: { id: purchaseId, state: spec.state, route: spec.route, category: spec.category, channel: spec.channel, paymentState: spec.paymentState,
      commerceStatus: spec.commerceStatus, merchantPaymentStatus: spec.merchantPaymentStatus, fundingRail: spec.rail, payable: usd(merchantTotalCents),
      fundingRequirement: requirement, createdAt: created.toISOString(), updatedAt: purchase.updatedAt },
    reservation: reservation ? { ...reservation, ledgerMode: 'simulated' } : null,
    events: eventRows,
  };
  const evidence = EvidenceDetail.parse(technicalRecord);

  const listItem = EvidenceListItem.parse({
    id: purchaseId, state: spec.state, route: spec.route, category: spec.category, paymentState: spec.paymentState,
    commerceStatus: spec.commerceStatus, merchantPaymentStatus: spec.merchantPaymentStatus, payable: usd(merchantTotalCents),
    fundingRequirement: requirement, createdAt: created.toISOString(),
    provenance: { environment: env, evidenceMode: 'local_fixture' },
    executionEvidenceStatus: done ? 'receipt_issued' : spec.events.includes('execution.started') ? 'pending' : 'not_started',
  });

  const context = PurchaseContext.parse({ title: spec.title, requestedBy: { name: spec.requestedBy }, requestText: spec.requestText, approvedMaxTotal: usd(spec.limitCents) });
  const bundle: PurchaseBundle = { purchase, quote, proof, evidence, technicalRecord, context };
  return { key: spec.key, listItem, bundle };
}

export interface SampleSource extends ConsoleSource {
  /** Named sample purchases, for the review shortcuts: in-progress, completed, checking, price-changed, ... */
  idFor(key: string): string | undefined;
}

export function createSampleSource(opts: { now?: number; latencyMs?: number } = {}): SampleSource {
  const now = opts.now ?? Date.now();
  const latency = opts.latencyMs ?? 0;
  const built = SPECS.map((s) => build(s, now));
  const wait = () => (latency ? new Promise((r) => setTimeout(r, latency)) : Promise.resolve());
  return {
    kind: 'sample',
    async environment() { return { mode: 'sample' }; },
    async listPurchases(): Promise<PurchaseListResult> {
      await wait();
      return { entries: built.map((b) => ({ item: b.listItem, context: b.bundle.context })), limit: LIMIT };
    },
    async getPurchase(purchaseId: string) {
      await wait();
      const found = built.find((b) => b.bundle.purchase.purchaseId === purchaseId);
      if (!found) throw new ConsoleError('not_found', 'purchase not found', undefined, 404);
      return found.bundle;
    },
    async getTreasury() {
      await wait();
      return sampleTreasury();
    },
    async getConnections() {
      await wait();
      return sampleConnections(now);
    },
    async hasOperatorAccess() {
      return true;
    },
    idFor(key: string) {
      return built.find((b) => b.key === key)?.bundle.purchase.purchaseId;
    },
  };
}

export const SAMPLE_KEYS = SPECS.map((s) => s.key);
