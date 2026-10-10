/**
 * Presenters for the operator screens. Pure: gateway responses in, view models (user-facing strings) out.
 *
 * The rules these presenters enforce, and `operator.test.ts` pins:
 * - observed and simulated amounts live in separate view-model sections and are never summed, netted or
 *   sorted into one list;
 * - an OCBC observation is labelled as an observation, its reference is masked again here, and nothing but the
 *   fields in `BankObservation` can reach a view model (a bank `description` never does);
 * - an asset the console does not recognise is shown in raw base units, never guessed at.
 */
import type { CapabilitiesResponse } from '../contracts/backend.js';
import type { BankObservation, BankResponse, LedgerMode, TreasuryResponse } from '../contracts/operator.js';
import type { ConnectionsData, ConsoleMode } from '../contracts/source.js';
import * as op from '../copy/operator.js';
import type { Tone } from '../copy/en.js';
import { formatSignedMoney, formatSignedUnits, formatWhen, type FormatContext } from './format.js';

export interface OperatorContext extends FormatContext {
  mode: ConsoleMode;
}

/* ---------------- assets ---------------- */

export interface AssetInfo {
  kind: 'fiat' | 'crypto';
  /** "Cardano test network", "USD (simulated)". */
  label: string;
  /** Unit word for amounts: "test ADA", "USD". */
  unit: string;
  /** Decimal places, or null when the console cannot know them. */
  decimals: number | null;
  currency?: string;
}

/** Exact Preprod tUSDM identities the gateway recognises (src/funding/cardano/config.ts). Two units, one ticker. */
const USDM_UNITS = new Set([
  'e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9.0014df10745553444d',
  '16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde.0014df10745553444d',
]);

const isTestNetworkId = (network: string): boolean =>
  /preprod|preview|devnet|testnet/i.test(network) || /^solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1$/.test(network);

const shortAsset = (id: string): string => (id.length <= 14 ? id : `${id.slice(0, 8)}...${id.slice(-4)}`);

/** Journal assets are `fiat:USD/2` or `<network>/<assetId>` (see src/core/journal.ts). */
export function describeAsset(asset: string): AssetInfo {
  const fiat = /^fiat:([A-Z]{3})\/(\d+)$/.exec(asset);
  if (fiat) {
    const currency = fiat[1]!;
    return { kind: 'fiat', label: op.asset.simulatedFiat(currency), unit: currency, decimals: Number(fiat[2]), currency };
  }
  const slash = asset.indexOf('/');
  const network = slash < 0 ? asset : asset.slice(0, slash);
  const id = slash < 0 ? '' : asset.slice(slash + 1);
  const test = isTestNetworkId(network);
  if (network.startsWith('cardano:')) {
    const label = op.asset.network('cardano', test);
    if (id === 'lovelace') return { kind: 'crypto', label, unit: op.asset.ada(test), decimals: 6 };
    if (USDM_UNITS.has(id)) return { kind: 'crypto', label, unit: op.asset.usdm(test), decimals: 6 };
    return { kind: 'crypto', label: `${label}, ${shortAsset(id)}`, unit: op.asset.baseUnits, decimals: null };
  }
  if (network.startsWith('solana:')) {
    // The Solana adapter only accepts 6-decimal mints (src/funding/solana/adapter.ts).
    return { kind: 'crypto', label: `${op.asset.network('solana', test)}, ${shortAsset(id)}`, unit: op.asset.token(test), decimals: 6 };
  }
  if (network.startsWith('sui:')) {
    return { kind: 'crypto', label: `Sui${test ? ' test' : ''} network, ${shortAsset(id)}`, unit: op.asset.token(test), decimals: 6 };
  }
  return { kind: 'crypto', label: shortAsset(asset), unit: op.asset.baseUnits, decimals: null };
}

/** Signed integer string in the asset's own unit. */
export function formatAssetAmount(units: string, info: AssetInfo, ctx: Pick<FormatContext, 'locale'>): string {
  if (info.kind === 'fiat' && info.currency && info.decimals !== null) return formatSignedMoney(info.currency, units, info.decimals, ctx);
  return formatSignedUnits(units, info.decimals, info.unit, ctx);
}

/* ---------------- Treasury ---------------- */

export interface TrialRowVM {
  ledger: string;
  ledgerMode: LedgerMode;
  asset: string;
  debit: string;
  credit: string;
  net: string;
  balanced: boolean;
  status: string;
}

export interface AccountRowVM {
  key: string;
  account: string;
  asset: string;
  balance: string;
  side: string;
}

export interface CapacitySegmentVM {
  key: 'reserved' | 'consumed' | 'providerTest' | 'available';
  label: string;
  hint: string;
  amount: string;
  /** 0 to 100, two decimals. Display only. */
  percent: number;
}

export interface CapacityVM {
  currency: string;
  label: string;
  limit: string;
  available: string;
  availableNegative: boolean;
  overspent: boolean;
  segments: CapacitySegmentVM[];
  /** Segments with a non-zero share, for the bar. */
  barSegments: CapacitySegmentVM[];
}

export interface ReservationRowVM {
  key: string;
  status: string;
  count: number;
  total: string;
}

export interface ObligationRowVM {
  asset: string;
  prepayment: string;
  unapplied: string;
  refundDue: string;
  refundDueNonZero: boolean;
}

export interface PurchaseStateVM {
  key: string;
  label: string;
  tone: Tone;
  count: number;
}

export interface TreasuryVM {
  health: { balanced: boolean; label: string; detail: string };
  trialRows: TrialRowVM[];
  observed: { accounts: AccountRowVM[]; obligations: ObligationRowVM[] };
  simulated: { capacity: CapacityVM[]; reservations: ReservationRowVM[]; accounts: AccountRowVM[] };
  purchases: { total: number; totalLabel: string; items: PurchaseStateVM[] };
  /** The parsed response (unknown keys already dropped), for the support disclosure. */
  technical: TreasuryResponse;
}

const ZERO = /^-?0+$/;

function humanize(raw: string): string {
  const spaced = raw.replace(/[_:]+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : raw;
}

function accountRow(a: TreasuryResponse['ledger']['accounts'][number], ctx: OperatorContext): AccountRowVM {
  const info = describeAsset(a.asset);
  // Show the balance on its natural side: liabilities and income as positive credits, assets as positive debits.
  const debitPositive = a.balanceDebitPositive;
  const natural = a.normalSide === 'credit' ? negate(debitPositive) : debitPositive;
  return {
    key: `${a.account}|${a.asset}`,
    account: op.accountLabel[a.account] ?? humanize(a.account.replace(/^[a-z]+:/, '')),
    asset: info.label,
    balance: formatAssetAmount(natural, info, ctx),
    side: op.treasury.side[a.normalSide],
  };
}

function negate(v: string): string {
  if (ZERO.test(v)) return '0';
  return v.startsWith('-') ? v.slice(1) : `-${v}`;
}

/** Integer percentage of `part` in `whole`, to two decimals, from bigints. 0 when `whole` is not positive. */
export function percentOf(part: bigint, whole: bigint): number {
  if (whole <= 0n || part <= 0n) return 0;
  const scaled = (part * 10_000n) / whole; // hundredths of a percent
  return Number(scaled > 10_000n ? 10_000n : scaled) / 100;
}

function capacityVM(p: TreasuryResponse['simulatedCapacity'][number], ctx: OperatorContext): CapacityVM {
  const fmt = (minor: string) => formatSignedMoney(p.currency, minor, p.scale, ctx);
  const limit = BigInt(p.limitMinor);
  const reserved = BigInt(p.reservedMinor);
  const consumed = BigInt(p.cardPayableMinor);
  const providerTest = BigInt(p.providerTestBalanceUsedMinor);
  const available = BigInt(p.availableMinor);
  const used = reserved + consumed + providerTest;
  // If recorded use exceeds the limit the bar is normalised to the use, so the segments still fit the track.
  const whole = used > limit ? used : limit;
  const t = op.treasury.simulated;
  const segments: CapacitySegmentVM[] = [
    { key: 'reserved', label: t.reserved, hint: t.reservedHint, amount: fmt(p.reservedMinor), percent: percentOf(reserved, whole) },
    { key: 'consumed', label: t.consumed, hint: t.consumedHint, amount: fmt(p.cardPayableMinor), percent: percentOf(consumed, whole) },
    { key: 'providerTest', label: t.providerTest, hint: t.providerTestHint, amount: fmt(p.providerTestBalanceUsedMinor), percent: percentOf(providerTest, whole) },
    { key: 'available', label: t.available, hint: t.availableHint, amount: fmt(p.availableMinor), percent: percentOf(available, whole) },
  ];
  return {
    currency: p.currency,
    label: p.label,
    limit: fmt(p.limitMinor),
    available: fmt(p.availableMinor),
    availableNegative: available < 0n,
    overspent: used > limit,
    segments,
    barSegments: segments.filter((s) => s.percent > 0),
  };
}

const STATE_ORDER = Object.keys(op.purchaseState);

export function presentTreasury(data: TreasuryResponse, ctx: OperatorContext): TreasuryVM {
  const trialRows: TrialRowVM[] = [...data.ledger.trialBalance]
    // Observed first, so the separation reads top to bottom: observed funds, then the simulated allowance.
    .sort((a, b) => (a.ledgerMode === b.ledgerMode ? a.asset.localeCompare(b.asset) : a.ledgerMode === 'observed' ? -1 : 1))
    .map((r) => {
      const info = describeAsset(r.asset);
      return {
        ledger: op.ledgerLabel[r.ledgerMode],
        ledgerMode: r.ledgerMode,
        asset: info.label,
        debit: formatAssetAmount(r.debitTotal, info, ctx),
        credit: formatAssetAmount(r.creditTotal, info, ctx),
        net: formatAssetAmount(r.net, info, ctx),
        balanced: r.balanced,
        status: r.balanced ? op.treasury.health.rowBalanced : op.treasury.health.rowUnbalanced,
      };
    });

  const accountsOf = (mode: LedgerMode) => data.ledger.accounts.filter((a) => a.ledgerMode === mode).map((a) => accountRow(a, ctx));

  // Obligations: one row per asset that appears in any of the three maps. Observed assets only; never fiat.
  const ob = data.obligations;
  const assets = [...new Set([...Object.keys(ob.prepaymentOutstandingByAsset), ...Object.keys(ob.unappliedByAsset), ...Object.keys(ob.refundDueByAsset)])].sort();
  const obligations: ObligationRowVM[] = assets.map((asset) => {
    const info = describeAsset(asset);
    const cell = (m: Record<string, string>) => (m[asset] && !ZERO.test(m[asset]!) ? formatAssetAmount(m[asset]!, info, ctx) : op.treasury.obligations.none);
    const refund = ob.refundDueByAsset[asset];
    return {
      asset: info.label,
      prepayment: cell(ob.prepaymentOutstandingByAsset),
      unapplied: cell(ob.unappliedByAsset),
      refundDue: cell(ob.refundDueByAsset),
      refundDueNonZero: refund !== undefined && !ZERO.test(refund),
    };
  });

  const reservations: ReservationRowVM[] = [...data.reservations]
    .sort((a, b) => a.status.localeCompare(b.status) || a.currency.localeCompare(b.currency))
    .map((r) => ({
      key: `${r.status}|${r.currency}`,
      status: op.reservationStatus[r.status] ?? humanize(r.status),
      count: r.count,
      total: formatSignedMoney(r.currency, r.totalMinor, r.scale, ctx),
    }));

  const states = Object.entries(data.purchasesByState);
  const items: PurchaseStateVM[] = states
    .map(([key, count]) => ({ key, label: op.purchaseState[key]?.label ?? humanize(key), tone: op.purchaseState[key]?.tone ?? ('neutral' as Tone), count }))
    .sort((a, b) => {
      const ia = STATE_ORDER.indexOf(a.key);
      const ib = STATE_ORDER.indexOf(b.key);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.label.localeCompare(b.label);
    });
  const total = items.reduce((n, i) => n + i.count, 0);

  return {
    health: {
      balanced: data.ledger.balanced,
      label: data.ledger.balanced ? op.treasury.health.balanced : op.treasury.health.unbalanced,
      detail: data.ledger.balanced ? op.treasury.health.balancedDetail : op.treasury.health.unbalancedDetail,
    },
    trialRows,
    observed: { accounts: accountsOf('observed'), obligations },
    simulated: { capacity: data.simulatedCapacity.map((p) => capacityVM(p, ctx)), reservations, accounts: accountsOf('simulated') },
    purchases: { total, totalLabel: op.treasury.purchases.total(total), items },
    technical: data,
  };
}

/* ---------------- Connections ---------------- */

export interface ConnectionVM {
  key: string;
  name: string;
  role: string;
  /** False when the gateway did not list this integration at all. */
  reported: boolean;
  status: { label: string; tone: Tone };
  environment: string | null;
  checked: string | null;
  missing: string[];
  detail: string | null;
}

export interface BankObservationVM {
  id: string;
  kind: string;
  /** "****3456". Masked again here, whatever the gateway sent. */
  reference: string;
  amount: string;
  available: string | null;
  observed: string;
  providerTime: string | null;
  source: string;
  environment: string;
  provenance: string;
  caveats: string[];
}

export interface ConnectionsVM {
  groups: Array<{ key: 'funding' | 'merchants'; title: string; intro: string; items: ConnectionVM[] }>;
  bank: {
    title: string;
    intro: string;
    banner: string;
    connection: ConnectionVM;
    balances: BankObservationVM[];
    transactions: BankObservationVM[];
    empty: boolean;
    lastObserved: string | null;
  };
  technical: { capabilities: CapabilitiesResponse; bank: BankResponse };
}

const FUNDING = ['cardano', 'solana', 'sui', 'masumi'] as const;
const MERCHANTS = ['shopify', 'nuitee', 'atlas'] as const;

export function environmentLabel(env: string): string {
  if (/sandbox/i.test(env)) return op.environmentLabel.sandbox;
  if (/devnet|testnet|preprod|preview/i.test(env)) return op.environmentLabel.test;
  if (/production|mainnet|live/i.test(env)) return op.environmentLabel.production;
  return humanize(env);
}

/** "****1234" and nothing more. The gateway already masks; this keeps the screen safe if it ever did not. */
export function maskReference(value: string): string {
  const compact = value.replace(/[\s\-._/*•]+/g, '');
  const last4 = compact.slice(-4);
  return compact.length >= 4 && /^[0-9A-Za-z]{4}$/.test(last4) && !/[xX]/.test(last4) ? `****${last4}` : '****';
}

type Ready = CapabilitiesResponse['banking'][number];

function connectionVM(key: string, found: Ready | undefined, ctx: OperatorContext): ConnectionVM {
  const meta = op.integration[key] ?? { name: humanize(key), role: '' };
  if (!found) {
    return { key, name: meta.name, role: meta.role, reported: false, status: { label: op.connections.notReported, tone: 'neutral' }, environment: null, checked: null, missing: [], detail: op.connections.notReportedDetail };
  }
  const s = op.readiness[found.status];
  return {
    key,
    name: meta.name,
    role: meta.role,
    reported: true,
    status: { label: s.label, tone: s.tone },
    environment: environmentLabel(found.environment),
    checked: formatWhen(found.checkedAt, ctx),
    missing: found.missing,
    detail: found.detail ?? null,
  };
}

function observationVM(o: BankObservation, ctx: OperatorContext): BankObservationVM {
  // The currency code is always shown: a bare "$" is ambiguous for SGD, and an observation is only meaningful in its own currency.
  const money = (m: BankObservation['amount']) => (m ? `${formatSignedMoney(m.currency, m.amountMinor, m.scale, ctx)} ${m.currency}` : null);
  return {
    id: o.id,
    kind: op.ocbc.kind[o.kind],
    reference: maskReference(o.maskedReference),
    amount: money(o.amount) ?? op.ocbc.amountUnavailable,
    available: money(o.availableAmount),
    observed: formatWhen(o.observedAt, ctx),
    providerTime: o.providerTimestamp ? formatWhen(o.providerTimestamp, ctx) : null,
    source: o.source,
    environment: environmentLabel(o.environment),
    provenance: op.ocbc.evidence[o.provenance.evidenceMode as keyof typeof op.ocbc.evidence] ?? op.ocbc.evidenceUnknown,
    caveats: o.caveats,
  };
}

export function presentConnections(data: ConnectionsData, ctx: OperatorContext): ConnectionsVM {
  const { capabilities, bank } = data;
  const routeReady = (key: string): Ready | undefined => capabilities.routes.find((r) => r.route === key)?.readiness;
  const railReady = (key: string): Ready | undefined => capabilities.fundingRails.find((r) => r.rail === key)?.readiness;

  const funding = FUNDING.map((k) => connectionVM(k, railReady(k), ctx));
  const merchants = MERCHANTS.map((k) => connectionVM(k, routeReady(k), ctx));

  // The bank read carries a fresh readiness; fall back to the one in capabilities.
  const ocbcReady = bank.adapters.find((a) => a.component === 'ocbc') ?? capabilities.banking.find((a) => a.component === 'ocbc');

  const ocbc = bank.observations.filter((o) => o.bank === 'ocbc');
  const isTx = (o: BankObservation) => o.kind.endsWith('_transaction');
  const newest = ocbc.reduce<string | null>((best, o) => (best === null || Date.parse(o.observedAt) > Date.parse(best) ? o.observedAt : best), null);

  return {
    groups: [
      { key: 'funding', title: op.connections.groups.funding.title, intro: op.connections.groups.funding.intro, items: funding },
      { key: 'merchants', title: op.connections.groups.merchants.title, intro: op.connections.groups.merchants.intro, items: merchants },
    ],
    bank: {
      title: op.ocbc.title,
      intro: op.connections.groups.bank.intro,
      banner: op.ocbc.banner,
      connection: connectionVM('ocbc', ocbcReady, ctx),
      balances: ocbc.filter((o) => !isTx(o)).map((o) => observationVM(o, ctx)),
      transactions: ocbc.filter(isTx).map((o) => observationVM(o, ctx)),
      empty: ocbc.length === 0,
      lastObserved: newest ? formatWhen(newest, ctx) : null,
    },
    // Same masking for the support disclosure: the parsed response, with references cut down to the last four.
    technical: { capabilities, bank: { ...bank, observations: bank.observations.map((o) => ({ ...o, maskedReference: maskReference(o.maskedReference) })) } },
  };
}
