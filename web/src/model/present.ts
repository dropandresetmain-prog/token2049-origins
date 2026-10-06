/**
 * Presenters: gateway contract data in, view models out.
 *
 * Status comes from the gateway's own projection (projectProgress in src/contracts/presentation.ts), so the
 * console never invents its own idea of "paid" or "done". Payment, merchant result and receipt stay separate:
 * a confirmed payment never makes a purchase look complete, and no receipt is shown before the merchant confirms.
 */
import * as copy from '../copy/en.js';
import { projectProgress } from '../contracts/backend.js';
import type { Category, Channel, FundingRail, HumanProgress, Money, ProviderRoute, PurchaseState, PurchaseView, SourceOffer } from '../contracts/backend.js';
import type { EvidenceListItem } from '../contracts/evidence.js';
import type { ConsoleMode, PurchaseBundle, PurchaseListResult } from '../contracts/source.js';
import { displayId, formatCrypto, formatMoney, formatTime, formatWhen, isTestNetwork, type FormatContext } from './format.js';
import type {
  ActivityItemVM, AttentionVM, Field, IconName, ListFilter, ProofSectionVM, ProofVM, PurchaseDetailVM, PurchaseListVM,
  PurchaseRowVM, QuoteVM, ReceiptVM, RouteVM, StatusKey, StatusVM, StepStatus, StepVM, SummaryVM,
} from './types.js';

export interface PresentContext extends FormatContext {
  mode: ConsoleMode;
}

type Cat = Category | 'unknown';

const asCategory = (c: string): Cat => (c === 'hotel' || c === 'flight' || c === 'retail' ? c : 'unknown');
const categoryIcon = (c: Cat): IconName => (c === 'unknown' ? 'purchases' : c);

function merchantOf(route: string) {
  return (copy.merchant as Record<string, { name: string; kind: string }>)[route as ProviderRoute] ?? copy.unknownMerchant;
}
function methodOf(rail: string): string {
  return (copy.paymentMethod as Record<string, string>)[rail as FundingRail] ?? rail.charAt(0).toUpperCase() + rail.slice(1);
}
function channelOf(channel: string | undefined) {
  return channel ? ((copy.channel as Record<string, { name: string; kind: string }>)[channel as Channel] ?? copy.unknownRequester) : copy.unknownRequester;
}
const isTestEnvironment = (env: string | undefined | null) => env !== 'production';

/* ---------------- Status ---------------- */

/** Map the gateway's progress stage (plus lifecycle state) onto the console's status vocabulary. */
export function statusKey(stage: HumanProgress['stage'], state: string, paymentState: string): StatusKey {
  switch (stage) {
    case 'confirming_payment': return paymentState === 'not_received' ? 'awaiting_payment' : 'confirming_payment';
    case 'purchasing': return 'in_progress';
    case 'verifying_result': return 'checking';
    case 'complete': return 'completed';
    case 'needs_attention':
      return state === 'requires_reauthorization' ? 'price_changed' : state === 'expired' ? 'expired' : 'not_completed';
  }
}

export function statusVM(key: StatusKey): StatusVM {
  return { key, ...copy.status[key] };
}

export function groupOf(key: StatusKey): Exclude<ListFilter, 'all'> | null {
  switch (key) {
    case 'awaiting_payment': case 'confirming_payment': case 'in_progress': case 'checking': return 'in_progress';
    case 'price_changed': case 'not_completed': return 'attention';
    case 'completed': return 'completed';
    case 'expired': return null;
  }
}

/**
 * List rows carry no PurchaseView, only the fields projectProgress reads. This builds exactly those fields
 * (receipt presence comes from executionEvidenceStatus) so list and detail share one status rule.
 */
function progressForListItem(item: EvidenceListItem): HumanProgress {
  const fields = {
    state: item.state as PurchaseState,
    paymentState: item.paymentState,
    commerceStatus: item.commerceStatus,
    merchantPaymentStatus: item.merchantPaymentStatus,
    receipt: item.executionEvidenceStatus === 'receipt_issued' ? {} : null,
    providerReference: null,
  } as unknown as PurchaseView;
  return projectProgress(fields);
}

/* ---------------- List ---------------- */

export function presentList(result: PurchaseListResult, ctx: PresentContext): PurchaseListVM {
  const rows: PurchaseRowVM[] = result.entries.map(({ item, context }) => {
    const cat = asCategory(item.category);
    const key = statusKey(progressForListItem(item).stage, item.state, item.paymentState);
    const title = context.title ?? copy.category[cat].title;
    const merchantName = merchantOf(item.route).name;
    const requestedBy = context.requestedBy?.name ?? copy.unknownRequester.name;
    const rail = item.fundingRequirement.rail;
    const network = item.fundingRequirement.amount.network;
    const id = displayId(item.id);
    return {
      id: item.id,
      displayId: id,
      title,
      icon: categoryIcon(cat),
      merchant: merchantName,
      createdAt: item.createdAt,
      createdLabel: formatWhen(item.createdAt, ctx),
      requestedBy,
      paidWith: methodOf(rail),
      paidWithDetail: isTestNetwork(network) ? copy.testNetwork : '',
      amount: item.payable ? formatMoney(item.payable, ctx) : '',
      status: statusVM(key),
      group: groupOf(key),
      searchText: [title, merchantName, requestedBy, id, item.id, methodOf(rail)].join(' ').toLowerCase(),
    };
  });
  const counts: Record<ListFilter, number> = { all: rows.length, in_progress: 0, attention: 0, completed: 0 };
  for (const r of rows) if (r.group) counts[r.group]++;
  return { rows, counts, limitNote: rows.length >= result.limit ? copy.list.limitNote(result.limit) : null };
}

export function filterRows(rows: PurchaseRowVM[], filter: ListFilter, query: string): PurchaseRowVM[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (filter === 'all' || r.group === filter) && (!q || r.searchText.includes(q)));
}

/* ---------------- Detail ---------------- */

interface Facts {
  b: PurchaseBundle;
  p: PurchaseView;
  ctx: PresentContext;
  cat: Cat;
  key: StatusKey;
  progress: HumanProgress;
  title: string;
  ref: string;
  agent: { name: string; kind: string };
  merchant: { name: string; kind: string };
  merchantIsTest: boolean;
  method: string;
  network: string | null;
  networkIsTest: boolean;
  /** Set when the product was found at another store and bought as an equivalent order in Capsule's test store. */
  source: SourceOffer | null;
}

function facts(b: PurchaseBundle, ctx: PresentContext): Facts {
  const p = b.purchase;
  const cat = asCategory(p.category);
  const progress = b.proof?.progress ?? projectProgress(p);
  const key = statusKey(progress.stage, p.state, p.paymentState);
  const requirement = p.fundingRequirement ?? b.proof?.funding.requirement ?? null;
  const rail = requirement?.rail ?? b.evidence?.purchase.fundingRail ?? p.funding[0]?.rail ?? '';
  const networkRaw = requirement?.amount.network ?? p.funding[0]?.network ?? null;
  const fromChannel = channelOf(b.evidence?.purchase.channel);
  const agent = { name: b.context.requestedBy?.name ?? fromChannel.name, kind: fromChannel.kind };
  const env = b.quote?.providerEnvironment ?? p.receipt?.providerEnvironment ?? b.proof?.merchant.environment;
  const sandboxed = !!(b.quote?.sandboxRepresentation ?? b.proof?.sandboxExecution ?? p.receipt?.sandboxExecution);
  const source = sandboxed ? (b.quote?.sourceOffer ?? b.proof?.sourceOffer ?? p.receipt?.sourceOffer ?? null) : null;
  return {
    b, p, ctx, cat, key, progress,
    title: b.quote?.title ?? b.context.title ?? copy.category[cat].title,
    ref: displayId(p.purchaseId),
    agent,
    // The order goes to Capsule's test store, never to the store where the product was found.
    merchant: sandboxed ? { name: copy.sourceStore.testStoreName, kind: copy.sourceStore.testStoreKind } : merchantOf(p.route),
    merchantIsTest: sandboxed || isTestEnvironment(env),
    method: rail ? methodOf(rail) : '',
    network: networkRaw,
    networkIsTest: networkRaw ? isTestNetwork(networkRaw) : false,
    source,
  };
}

function boundaryNote(f: Facts): string | null {
  return f.source ? copy.sourceStore.boundary(f.source.merchantName) : null;
}

function eventTime(f: Facts, types: string[]): string | null {
  const events = f.b.evidence?.events ?? [];
  return events.find((e) => types.includes(e.type))?.at ?? null;
}

function timelineTime(f: Facts, step: string, fallbackTypes: string[]): string | null {
  return f.b.proof?.timeline.find((t) => t.step === step)?.timestamp ?? eventTime(f, fallbackTypes);
}

function stepTime(f: Facts, status: StepStatus, iso: string | null): string {
  if (status === 'pending') return copy.stepState.pending;
  if (status === 'attention') return copy.stepState.needsAttention;
  if (iso) return formatTime(iso, f.ctx);
  return status === 'current' ? copy.stepState.inProgress : '';
}

function buildSteps(f: Facts): StepVM[] {
  const paid = f.progress.paymentConfirmed;
  const approvedAt = timelineTime(f, 'approved', ['approval.recorded']);
  const paidAt = timelineTime(f, 'funded', ['funding.confirmed']);
  const orderAt = timelineTime(f, 'merchant_execution', ['execution.started']);
  const confirmedAt = timelineTime(f, 'result_verified', ['execution.succeeded', 'receipt.issued']);
  const m = f.merchant.name;

  // Approval: a purchase cannot exist without a submitted approval; older purchases may lack the record.
  const approvedDetail = approvedAt ? copy.steps.approved.done(f.agent.name) : copy.steps.approved.noRecord;

  let paidS: StepStatus; let orderS: StepStatus; let confS: StepStatus;
  let orderDetail: string; let confDetail: string;
  let paidDetail = paid ? copy.steps.paid.done(f.method, f.networkIsTest) : copy.steps.paid.pending;

  switch (f.key) {
    case 'awaiting_payment':
    case 'confirming_payment':
      paidS = 'current'; orderS = 'pending'; confS = 'pending';
      if (f.key === 'confirming_payment') paidDetail = `${copy.paymentState[f.p.paymentState]}.`;
      else paidDetail = copy.steps.paid.current;
      orderDetail = copy.steps.ordering.pending; confDetail = copy.steps.confirmed.pending;
      break;
    case 'in_progress':
      paidS = 'done'; orderS = 'current'; confS = 'pending';
      orderDetail = copy.steps.ordering.current(m, f.cat); confDetail = copy.steps.confirmed.pending;
      break;
    case 'checking':
      paidS = 'done'; orderS = 'done'; confS = 'current';
      orderDetail = copy.steps.ordering.done(m); confDetail = copy.steps.confirmed.current(m);
      break;
    case 'completed':
      paidS = 'done'; orderS = 'done'; confS = 'done';
      orderDetail = copy.steps.ordering.done(m);
      confDetail = copy.steps.confirmed.done(m, copy.commerceOutcome(f.p.commerceStatus, f.cat));
      break;
    case 'price_changed':
      paidS = paid ? 'done' : 'pending'; orderS = 'attention'; confS = 'pending';
      orderDetail = copy.steps.ordering.priceChanged(m); confDetail = copy.steps.confirmed.nothingBought;
      break;
    case 'expired':
      paidS = paid ? 'done' : 'pending'; orderS = 'attention'; confS = 'pending';
      orderDetail = copy.steps.ordering.expired; confDetail = copy.steps.confirmed.nothingBought;
      break;
    case 'not_completed':
      paidS = paid ? 'done' : 'pending'; orderS = orderAt ? 'done' : 'pending'; confS = 'attention';
      orderDetail = orderAt ? copy.steps.ordering.done(m) : copy.steps.ordering.pending; confDetail = copy.steps.confirmed.failed(m);
      break;
  }

  return [
    { key: 'approved', label: copy.steps.approved.label, detail: approvedDetail, status: 'done', time: approvedAt ? formatTime(approvedAt, f.ctx) : '' },
    { key: 'paid', label: copy.steps.paid.label, detail: paidDetail, status: paidS, time: stepTime(f, paidS, paidAt) },
    { key: 'ordering', label: copy.category[f.cat].stepLabel, detail: orderDetail, status: orderS, time: stepTime(f, orderS, orderAt) },
    { key: 'confirmed', label: copy.steps.confirmed.label, detail: confDetail, status: confS, time: stepTime(f, confS, confirmedAt) },
  ];
}

function buildRoute(f: Facts): RouteVM {
  const done = f.key === 'completed';
  const stopped = f.key === 'price_changed' || f.key === 'expired' || f.key === 'not_completed';
  let result: string;
  let resultIcon: IconName = 'receipt';
  if (done) { result = copy.commerceOutcome(f.p.commerceStatus, f.cat); resultIcon = 'check'; }
  else if (f.key === 'price_changed' || f.key === 'expired') { result = copy.steps.confirmed.nothingBought.replace(/\.$/, ''); resultIcon = 'pause'; }
  else if (f.key === 'not_completed') { result = copy.commerceOutcome(f.p.commerceStatus, f.cat); resultIcon = 'alert'; }
  else if (f.key === 'checking' || f.key === 'in_progress') result = 'Waiting for confirmation';
  else result = copy.commerceOutcome('not_started', f.cat);
  return {
    from: { label: copy.detail.requestedBy, name: f.agent.name, detail: f.agent.kind, payment: { method: f.method, network: f.networkIsTest ? copy.testNetwork : null } },
    capsule: { label: copy.detail.capsule, action: copy.routeAction[f.key](f.cat), stopped },
    to: {
      label: copy.detail.merchantLabel, name: f.merchant.name,
      detail: f.source ? copy.sourceStore.foundAt(f.source.merchantName) : copy.merchantDetail(f.merchant.kind, f.merchantIsTest),
      icon: categoryIcon(f.cat), result, resultIcon, done,
    },
    flowIn: f.progress.paymentConfirmed ? 'done' : f.key === 'awaiting_payment' || f.key === 'confirming_payment' ? 'active' : 'idle',
    flowOut: done ? 'done' : stopped ? 'stopped' : f.key === 'in_progress' || f.key === 'checking' ? 'active' : 'idle',
  };
}

function buildAttention(f: Facts): AttentionVM | null {
  const paid = f.progress.paymentConfirmed;
  switch (f.key) {
    case 'price_changed': {
      const a = copy.attention.priceChanged;
      return { tone: 'attention', title: a.title, body: [a.body(f.merchant.name, f.agent.name), paid ? a.paidNote : ''].filter(Boolean).join(' '),
        action: { label: a.action, copyText: a.copyText(f.title, f.ref) } };
    }
    case 'expired': {
      const a = copy.attention.expired;
      return { tone: 'neutral', title: a.title, body: [a.body(f.agent.name), paid ? a.paidNote : ''].filter(Boolean).join(' '),
        action: { label: a.action, copyText: a.copyText(f.title, f.ref) } };
    }
    case 'not_completed': {
      const a = copy.attention.notCompleted;
      return { tone: 'attention', title: a.title, body: a.body(f.merchant.name, f.ref), action: { label: a.action, copyText: f.p.purchaseId } };
    }
    default:
      return null;
  }
}

function payAtPropertyNotes(f: Facts): string[] {
  return (f.b.quote?.breakdown ?? [])
    .filter((l) => l.kind === 'fee_payable_at_property')
    .map((l) => copy.detail.payAtProperty(formatMoney(l.amount, f.ctx)));
}

function buildSummary(f: Facts): SummaryVM {
  const q = f.b.quote;
  const requirement = f.p.fundingRequirement ?? f.b.proof?.funding.requirement ?? null;
  const paid = f.progress.paymentConfirmed;
  const costs: Field[] = q
    ? [{ label: copy.detail.price, value: formatMoney(q.merchantTotal, f.ctx) }, { label: copy.detail.capsuleFee, value: formatMoney(q.serviceFee, f.ctx) }]
    : [];
  const amount = requirement ? formatCrypto(requirement.amount, copy.testFunds, f.ctx) : null;
  const scaled = requirement?.settlement?.policy.mode === 'scaled_testnet';
  return {
    item: { title: f.title, detail: q?.fulfillmentSummary ?? copy.category[f.cat].title, icon: categoryIcon(f.cat) },
    costs,
    total: { label: copy.detail.total, value: `${formatMoney(f.p.payablePrincipal, f.ctx)} ${f.p.payablePrincipal.currency}` },
    notes: [...payAtPropertyNotes(f), boundaryNote(f)].filter((n): n is string => !!n),
    payment: {
      method: f.method,
      network: f.networkIsTest ? copy.testNetwork : null,
      amount: amount ? (paid ? copy.detail.paidAmount(amount) : copy.detail.dueAmount(amount)) : null,
      note: scaled ? copy.detail.scaledTestPayment : f.networkIsTest ? copy.detail.testPaymentNote : '',
      locked: paid,
      lockText: paid ? copy.detail.paymentLocked : copy.detail.paymentNotYet,
    },
  };
}

function buildProof(f: Facts): ProofVM {
  const p = f.p;
  const paid = f.progress.paymentConfirmed;
  const done = f.key === 'completed';
  const funding = p.funding[0] ?? null;
  const requirement = p.fundingRequirement ?? f.b.proof?.funding.requirement ?? null;
  const transferRef = f.b.proof?.funding.transfers[0]?.reference ?? funding?.transferReference ?? null;

  const paymentBadge = paid
    ? { label: copy.proof.received, tone: 'positive' as const }
    : p.paymentState === 'not_received'
      ? { label: copy.proof.notReceived, tone: 'pending' as const }
      : { label: copy.paymentState[p.paymentState], tone: 'progress' as const };
  const paymentFields: Field[] = [
    { label: copy.proof.rowMethod, value: f.networkIsTest ? `${f.method}, ${copy.testNetwork.toLowerCase()}` : f.method },
  ];
  if (requirement) paymentFields.push({ label: copy.proof.rowAmount, value: formatCrypto(requirement.amount, copy.testFunds, f.ctx) });
  if (funding) {
    paymentFields.push({ label: copy.proof.rowCovers, value: copy.paymentCovers[funding.purpose] });
    paymentFields.push({ label: copy.proof.rowReceivedAt, value: formatWhen(funding.verifiedAt, f.ctx) });
  }
  const payment: ProofSectionVM = {
    heading: copy.proof.paymentHeading, icon: 'wallet', badge: paymentBadge, fields: paymentFields,
    reference: transferRef ? { label: copy.proof.paymentReference, value: transferRef, copyLabel: copy.proof.copyPaymentReference } : null,
    note: !funding ? copy.proof.noPayment : funding.purpose === 'service_fee' ? copy.proof.feeOnlyNote : null,
  };

  const orderBadge = done
    ? { label: copy.proof.confirmed, tone: 'positive' as const }
    : f.key === 'not_completed'
      ? { label: copy.status.not_completed.label, tone: 'attention' as const }
      : { label: copy.proof.notConfirmed, tone: 'pending' as const };
  const order: ProofSectionVM = {
    heading: copy.proof.orderHeading(f.cat), icon: 'receipt', badge: orderBadge,
    fields: [
      { label: copy.proof.rowMerchant, value: f.merchant.name },
      ...(f.source ? [{ label: copy.sourceStore.rowFoundAt, value: f.source.merchantName }] : []),
      { label: copy.proof.rowMode, value: f.merchantIsTest ? copy.proof.testMode : copy.proof.liveMode },
      { label: copy.proof.rowOutcome, value: copy.commerceOutcome(p.commerceStatus, f.cat) },
      { label: copy.proof.rowMerchantPayment, value: copy.merchantPayment[p.merchantPaymentStatus] },
    ],
    reference: p.providerReference ? { label: copy.proof.merchantReference, value: p.providerReference, copyLabel: copy.proof.copyMerchantReference } : null,
    note: [
      done ? null : f.key === 'price_changed' || f.key === 'expired' ? copy.steps.confirmed.nothingBought : copy.proof.notConfirmedNote(f.merchant.name),
      boundaryNote(f),
    ].filter(Boolean).join(' ') || null,
  };

  const sections = [payment, order];
  const reservation = f.b.evidence?.reservation ?? p.reservation;
  if (reservation) {
    sections.push({
      heading: copy.proof.allowanceHeading, icon: 'layers', badge: { label: copy.proof.simulated, tone: 'neutral' },
      fields: [
        { label: copy.proof.rowStatus, value: copy.allowance[reservation.status] },
        { label: copy.proof.rowAmount, value: formatMoney(reservation.amount, f.ctx) },
      ],
      reference: null, note: copy.proof.allowanceNote,
    });
  }

  return {
    available: !!(f.b.proof || f.b.evidence),
    disclaimer: f.ctx.mode === 'sample' ? copy.proof.sampleNote : f.ctx.mode === 'test' ? copy.proof.testNote : null,
    sections,
    confirmedCount: (paid ? 1 : 0) + (done ? 1 : 0),
    activity: buildActivity(f),
    technicalRecord: f.b.technicalRecord,
    downloadName: `capsule-proof-${f.ref.slice(1).toLowerCase()}.json`,
  };
}

function buildActivity(f: Facts): ActivityItemVM[] {
  const events = [...(f.b.evidence?.events ?? [])].sort((a, b) => a.sequence - b.sequence);
  const items: ActivityItemVM[] = [];
  for (const e of events) {
    const label = copy.activity[e.type] ?? copy.activity.fallback;
    // Retries produce runs of the same event; one line says it.
    if (items.at(-1)?.label === label) continue;
    items.push({ label, time: formatWhen(e.at, f.ctx) });
  }
  return items;
}

function buildReceipt(f: Facts): ReceiptVM | null {
  const r = f.p.receipt;
  // No receipt before the merchant confirms, whatever else is true.
  if (!r || f.key !== 'completed') return null;
  const fields: Field[] = [
    { label: copy.receipt.rowRequestedBy, value: f.agent.name },
    { label: copy.receipt.rowPaidWith, value: f.networkIsTest ? `${f.method}, ${copy.testNetwork.toLowerCase()}` : f.method },
    { label: copy.receipt.rowMerchant, value: copy.merchantDetail(f.merchant.name, f.merchantIsTest) },
    ...(f.source ? [{ label: copy.sourceStore.rowFoundAt, value: f.source.merchantName }] : []),
    { label: copy.receipt.rowOutcome, value: copy.commerceOutcome(r.commerceStatus, f.cat) },
  ];
  if (r.providerReference) fields.push({ label: copy.receipt.rowMerchantReference, value: r.providerReference, mono: true });
  fields.push({ label: copy.receipt.rowReceiptNumber, value: displayId(r.receiptId), mono: true });
  fields.push({ label: copy.receipt.rowIssued, value: formatWhen(r.issuedAt, f.ctx) });
  return {
    sample: f.ctx.mode === 'sample',
    total: formatMoney(f.p.payablePrincipal, f.ctx),
    currency: f.p.payablePrincipal.currency,
    itemTitle: f.title,
    fields,
    notes: [boundaryNote(f), ...r.limitations].filter((n): n is string => !!n),
    downloadName: `capsule-receipt-${f.ref.slice(1).toLowerCase()}.json`,
    download: r,
  };
}

function buildQuote(f: Facts): QuoteVM | null {
  const q = f.b.quote;
  if (!q) return null;
  const line = (label: string, m: Money, negative = false): Field => ({ label, value: `${negative ? '-' : ''}${formatMoney(m, f.ctx)}` });
  return {
    itemTitle: q.title,
    details: q.fulfillmentSummary,
    lines: q.breakdown
      .filter((l) => l.kind !== 'fee_payable_at_property')
      .map((l) => line(l.label, l.amount, l.kind === 'discount')),
    fee: line(copy.quoteDialog.rowCapsuleFee, q.serviceFee),
    total: { label: copy.quoteDialog.rowTotal, value: `${formatMoney(q.payablePrincipal, f.ctx)} ${q.payablePrincipal.currency}` },
    notes: payAtPropertyNotes(f),
    limit: f.b.context.approvedMaxTotal ? { label: copy.quoteDialog.rowLimit, value: formatMoney(f.b.context.approvedMaxTotal, f.ctx) } : null,
    validUntil: { label: copy.quoteDialog.rowValidUntil, value: formatWhen(q.expiresAt, f.ctx) },
    quoteNumber: { label: copy.quoteDialog.rowQuoteNumber, value: displayId(q.quoteId), mono: true },
    terms: q.terms,
    source: f.source
      ? {
          foundAt: { label: copy.sourceStore.rowFoundAt, value: f.source.merchantName },
          listedPrice: { label: copy.sourceStore.rowListedPrice, value: copy.sourceStore.listed(formatMoney(f.source.observedPrice, f.ctx), formatWhen(f.source.observedAt, f.ctx)) },
          note: copy.sourceStore.boundary(f.source.merchantName),
          link: { href: f.source.productUrl, label: copy.sourceStore.viewListing(f.source.merchantName) },
        }
      : null,
  };
}

export function presentDetail(b: PurchaseBundle, ctx: PresentContext): PurchaseDetailVM {
  const f = facts(b, ctx);
  const steps = buildSteps(f);
  const done = steps.filter((s) => s.status === 'done').length;
  const limit = b.context.approvedMaxTotal ? copy.detail.approvedUpTo(formatMoney(b.context.approvedMaxTotal, ctx)) : null;
  return {
    id: f.p.purchaseId,
    displayId: f.ref,
    title: f.title,
    requestedBy: f.agent.name,
    createdLabel: formatWhen(f.p.createdAt, ctx),
    status: statusVM(f.key),
    total: { amount: formatMoney(f.p.payablePrincipal, ctx), currency: f.p.payablePrincipal.currency },
    request: b.context.requestText || limit ? { text: b.context.requestText ?? null, limit } : null,
    attention: buildAttention(f),
    route: buildRoute(f),
    stepsHeading: f.key === 'completed' ? copy.detail.completeHeading : copy.detail.progressHeading,
    stepsCount: copy.detail.stepsDone(done, steps.length),
    steps,
    summary: buildSummary(f),
    proof: buildProof(f),
    receipt: buildReceipt(f),
    quote: buildQuote(f),
    live: !f.progress.outcomeFinal,
  };
}
