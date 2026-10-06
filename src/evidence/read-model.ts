/**
 * Evidence read model: read-only queries over the core tables, shaped for inspection.
 *
 * Nothing here writes, and nothing here is a second source of truth: every figure is derived from the
 * journal, evidence, reservation and purchase tables through the core helpers where one exists.
 *
 * Labelling rules (CORE_CONTRACT "Money and evidence"): every external fact carries `environment` and
 * `evidenceMode`; every ledger figure carries `ledgerMode` (observed vs simulated). Those dimensions are never
 * merged. Raw `details_json`, checkpoints, fulfillment details and provider payloads are not exposed.
 */
import type { Db } from '../infrastructure/db.js';
import { EvidenceMode as EvidenceModeSchema } from '../contracts/common.js';
import type { EvidenceMode } from '../contracts/common.js';
import type { Money } from '../contracts/money.js';
import type { QuoteView, ReceiptView } from '../contracts/commerce.js';
import { entriesForPurchase, trialBalance, Accounts, SIMULATED_ACCOUNTS } from '../core/journal.js';
import { capacitySnapshot } from '../core/capacity.js';
import {
  getQuoteRow,
  getReservation,
  type AttemptRow,
  type FundingEvidenceRow,
  type PurchaseRow,
} from '../core/store.js';
import { maskReference } from '../banking/ocbc/mask.js';

export interface Provenance {
  environment: string;
  evidenceMode: EvidenceMode;
}

export type ExecutionEvidenceStatus = 'not_started' | 'pending' | 'result_recorded' | 'receipt_issued' | 'unavailable';

/** Classifies quote-source provenance only; an execution status accompanies environment-only fallback. */
export const modeForProviderEnvironment = (environment: string): EvidenceMode => (environment === 'fixture' ? 'local_fixture' : 'fresh_external');

/** Chain environment label for a funding network; fixtures never claim a chain. */
export function fundingEnvironment(network: string, mode: string): string {
  if (mode === 'local_fixture') return 'fixture';
  const n = network.toLowerCase();
  if (n.includes('preprod')) return 'cardano-preprod';
  if (n.includes('solana') && (n.includes('devnet') || n.includes('etwzsax'))) return 'solana-devnet';
  return network;
}

/** The only funding detail keys that may be shown; everything else stays private. */
const DETAIL_WHITELIST = ['txHash', 'blockHeight', 'confirmations'] as const;

function whitelistedDetails(detailsJson: string): Record<string, string | number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(detailsJson);
  } catch {
    return {};
  }
  const out: Record<string, string | number> = {};
  if (parsed && typeof parsed === 'object') {
    for (const k of DETAIL_WHITELIST) {
      const v = (parsed as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      else if (typeof v === 'string' && v.length <= 128) out[k] = v;
    }
  }
  return out;
}

const parse = <T>(s: string | null): T | null => {
  if (s === null) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

function isEvidenceMode(value: unknown): value is EvidenceMode {
  return EvidenceModeSchema.safeParse(value).success;
}

function persistedReceiptMode(receiptJson: string | null): EvidenceMode | null {
  const receipt = parse<{ evidenceMode?: unknown }>(receiptJson);
  return receipt && isEvidenceMode(receipt.evidenceMode) ? receipt.evidenceMode : null;
}

function persistedResultMode(resultJson: string | null): EvidenceMode | null {
  const result = parse<{ evidence?: unknown }>(resultJson);
  if (!result || !Array.isArray(result.evidence)) return null;
  const first = result.evidence[0];
  if (!first || typeof first !== 'object' || !('evidenceMode' in first)) return null;
  const mode = (first as { evidenceMode?: unknown }).evidenceMode;
  return isEvidenceMode(mode) ? mode : null;
}

/**
 * Receipt/result provenance overrides environment inference. When neither exists, this is only the quote
 * provider's environment provenance; executionEvidenceStatus makes clear that it is not a completed proof.
 */
function purchaseEvidenceProjection(
  environment: string,
  receiptJson: string | null,
  resultJson: string | null,
  attemptStatus: string | null,
): { provenance: Provenance; executionEvidenceStatus: ExecutionEvidenceStatus } {
  const receipt = parse<ReceiptView>(receiptJson);
  const result = parse<{ kind?: unknown }>(resultJson);
  const evidenceMode =
    persistedReceiptMode(receiptJson) ??
    persistedResultMode(resultJson) ??
    modeForProviderEnvironment(environment);

  let executionEvidenceStatus: ExecutionEvidenceStatus;
  if (receipt) executionEvidenceStatus = 'receipt_issued';
  else if (result?.kind === 'unknown' || attemptStatus === 'started' || attemptStatus === 'unknown') {
    executionEvidenceStatus = 'pending';
  } else if (result) executionEvidenceStatus = 'result_recorded';
  else if (resultJson !== null || attemptStatus !== null) executionEvidenceStatus = 'unavailable';
  else executionEvidenceStatus = 'not_started';

  return { provenance: { environment, evidenceMode }, executionEvidenceStatus };
}

/* ---------------- purchases ---------------- */

export async function listPurchases(db: Db, customerId: string, limit = 50) {
  const rows = await db.all<PurchaseRow & {
    q_category: string;
    q_route: string;
    q_env: string;
    q_public: string;
    execution_status: AttemptRow['status'] | null;
    execution_result: string | null;
  }>(
    `SELECT p.*, q.category AS q_category, q.route AS q_route, q.provider_environment AS q_env, q.public_json AS q_public,
            latest.status AS execution_status, latest.result_json AS execution_result
       FROM purchases p JOIN quotes q ON q.id = p.quote_id
       LEFT JOIN execution_attempts latest
         ON latest.purchase_id = p.id
        AND latest.attempt_no = (SELECT MAX(a.attempt_no) FROM execution_attempts a WHERE a.purchase_id = p.id)
      WHERE p.customer_id = $1
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $2`,
    customerId,
    limit,
  );
  return rows.map((p) => {
    const qv = parse<QuoteView>(p.q_public);
    const evidence = purchaseEvidenceProjection(p.q_env, p.receipt_json, p.execution_result, p.execution_status);
    return {
      id: p.id,
      state: p.state,
      route: p.q_route,
      category: p.q_category,
      paymentState: p.payment_state,
      commerceStatus: p.commerce_status,
      merchantPaymentStatus: p.merchant_payment_status,
      payable: qv?.payablePrincipal ?? null,
      createdAt: p.created_at,
      provenance: evidence.provenance,
      executionEvidenceStatus: evidence.executionEvidenceStatus,
    };
  });
}

/** Owner-scoped load. Returns undefined for unknown AND foreign purchases so the caller can 404 both alike. */
export async function loadOwnedPurchase(db: Db, customerId: string, purchaseId: string): Promise<PurchaseRow | undefined> {
  return await db.get<PurchaseRow>('SELECT * FROM purchases WHERE id = $1 AND customer_id = $2', purchaseId, customerId);
}

export async function purchaseDetail(db: Db, p: PurchaseRow) {
  const q = (await getQuoteRow(db, p.quote_id))!;
  const qv = parse<QuoteView>(q.public_json);
  const receipt = parse<ReceiptView>(p.receipt_json);
  const quoteMode = modeForProviderEnvironment(q.provider_environment);
  const latestExecution = await db.get<{ status: AttemptRow['status']; result_json: string | null }>(
    'SELECT status, result_json FROM execution_attempts WHERE purchase_id = $1 ORDER BY attempt_no DESC LIMIT 1',
    p.id,
  );
  const evidence = purchaseEvidenceProjection(
    q.provider_environment,
    p.receipt_json,
    latestExecution?.result_json ?? null,
    latestExecution?.status ?? null,
  );
  const purchaseMode = evidence.provenance.evidenceMode;
  const provenance = evidence.provenance;

  const funding = (await db
    .all<FundingEvidenceRow>('SELECT * FROM funding_evidence WHERE purchase_id = $1 ORDER BY verified_at, id', p.id))
    .map((f) => ({
      id: f.id,
      rail: f.rail,
      network: f.network,
      asset: f.asset_id,
      decimals: f.decimals,
      amountBaseUnits: f.amount_base_units,
      transferReference: f.transfer_reference,
      paymentState: f.payment_state,
      purpose: f.purpose,
      application: f.application,
      confirmations: f.confirmations,
      evidenceMode: f.evidence_mode as EvidenceMode,
      environment: fundingEnvironment(f.network, f.evidence_mode),
      observedAt: f.observed_at,
      verifiedAt: f.verified_at,
      details: whitelistedDetails(f.details_json),
    }));
  const fundingByRef = new Map(funding.map((f) => [f.transferReference, f]));

  const extRefs = new Map(
    (await db.all<{ id: string; external_reference: string | null }>('SELECT id, external_reference FROM journal_entries WHERE purchase_id = $1', p.id)).map((r) => [r.id, r.external_reference]),
  );
  const journal = (await entriesForPurchase(db, p.id)).map((e) => {
    // Observed funding entries inherit the funding row's mode; the rest follow the purchase.
    const linked = e.kind === 'funding_received' ? fundingByRef.get(extRefs.get(e.id) ?? '') : undefined;
    return {
      id: e.id,
      eventKey: e.event_key,
      kind: e.kind,
      ledgerMode: e.ledger_mode,
      externalReference: extRefs.get(e.id) ?? null,
      createdAt: e.created_at,
      lines: e.lines,
      provenance: linked
        ? ({ environment: linked.environment, evidenceMode: linked.evidenceMode } satisfies Provenance)
        : e.ledger_mode === 'simulated'
          ? { environment: 'simulated', evidenceMode: purchaseMode }
          : provenance,
    };
  });

  const attempts = (await db
    .all<Pick<AttemptRow, 'attempt_no' | 'status' | 'started_at' | 'finished_at' | 'result_json'>>(
      'SELECT attempt_no, status, started_at, finished_at, result_json FROM execution_attempts WHERE purchase_id = $1 ORDER BY attempt_no',
      p.id,
    ))
    .map((a) => ({
      attemptNo: a.attempt_no,
      status: a.status,
      startedAt: a.started_at,
      finishedAt: a.finished_at,
      provenance: {
        environment: q.provider_environment,
        evidenceMode: persistedResultMode(a.result_json) ?? purchaseMode,
      },
    }));

  const events = (await db
    .all<{ sequence: number; type: string; created_at: string }>(
      'SELECT sequence, type, created_at FROM purchase_events WHERE purchase_id = $1 ORDER BY sequence',
      p.id,
    ))
    // Event payloads are intentionally not projected: provider-controlled reasons and references can
    // contain customer data. Type and timing are enough to explain the purchase timeline.
    .map((e) => ({ sequence: e.sequence, type: e.type, at: e.created_at }));

  const res = await getReservation(db, p.id);
  return {
    purchase: {
      id: p.id,
      state: p.state,
      route: q.route,
      category: q.category,
      channel: p.channel,
      paymentState: p.payment_state,
      commerceStatus: p.commerce_status,
      merchantPaymentStatus: p.merchant_payment_status,
      fundingRail: p.funding_rail,
      payable: qv?.payablePrincipal ?? null,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      provenance,
      executionEvidenceStatus: evidence.executionEvidenceStatus,
    },
    // Curated commercial facts only. Omit provider prose, terms, customer ID, and fulfillment data.
    quote: qv
      ? {
          quoteId: qv.quoteId,
          version: qv.version,
          category: qv.category,
          route: qv.route,
          providerEnvironment: qv.providerEnvironment,
          merchantTotal: qv.merchantTotal,
          serviceFee: qv.serviceFee,
          payablePrincipal: qv.payablePrincipal,
          expiresAt: qv.expiresAt,
          digest: qv.digest,
          createdAt: qv.createdAt,
          provenance: { environment: q.provider_environment, evidenceMode: quoteMode },
        }
      : null,
    reservation: res
      ? { status: res.status, amount: { currency: res.currency, scale: res.scale, amountMinor: res.amount_minor } satisfies Money, ledgerMode: 'simulated' as const }
      : null,
    funding,
    journal,
    execution: { attempts },
    events,
    receipt,
  };
}

/* ---------------- treasury ---------------- */

interface LineRow {
  account: string;
  asset: string;
  side: string;
  amount: string;
  ledger_mode: string;
}

export async function treasuryView(db: Db) {
  const lines = await db.all<LineRow>(
    `SELECT jl.account, jl.asset, jl.side, jl.amount, je.ledger_mode
       FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id`,
  );

  // Trial balance per (ledger mode, asset): debit total, credit total, net (debit-positive).
  const tb = new Map<string, { ledgerMode: string; asset: string; debit: bigint; credit: bigint }>();
  const accts = new Map<string, { account: string; asset: string; ledgerMode: string; debit: bigint; credit: bigint }>();
  for (const l of lines) {
    const amt = BigInt(l.amount);
    const k1 = `${l.ledger_mode}|${l.asset}`;
    const t = tb.get(k1) ?? { ledgerMode: l.ledger_mode, asset: l.asset, debit: 0n, credit: 0n };
    const k2 = `${l.account}|${l.asset}`;
    const a = accts.get(k2) ?? { account: l.account, asset: l.asset, ledgerMode: SIMULATED_ACCOUNTS.has(l.account) ? 'simulated' : 'observed', debit: 0n, credit: 0n };
    if (l.side === 'debit') {
      t.debit += amt;
      a.debit += amt;
    } else {
      t.credit += amt;
      a.credit += amt;
    }
    tb.set(k1, t);
    accts.set(k2, a);
  }
  // Cross-check against the core helper: every asset must net to zero across the whole journal.
  const coreBalanced = [...(await trialBalance(db)).values()].every((v) => v === 0n);

  const trial = [...tb.values()]
    .sort((x, y) => (x.ledgerMode + x.asset).localeCompare(y.ledgerMode + y.asset))
    .map((t) => ({
      ledgerMode: t.ledgerMode,
      asset: t.asset,
      debitTotal: t.debit.toString(),
      creditTotal: t.credit.toString(),
      net: (t.debit - t.credit).toString(),
      balanced: t.debit === t.credit,
    }));

  const accounts = [...accts.values()]
    .sort((x, y) => (x.account + x.asset).localeCompare(y.account + y.asset))
    .map((a) => ({
      account: a.account,
      asset: a.asset,
      ledgerMode: a.ledgerMode,
      // Debit-positive, as accountBalance() reports; `normalSide` says which sign is the natural one.
      balanceDebitPositive: (a.debit - a.credit).toString(),
      normalSide: a.account.startsWith('assets:') || a.account === Accounts.merchantPurchases ? 'debit' : 'credit',
    }));

  const pools = await db.all<{ currency: string }>('SELECT currency FROM capacity_pools ORDER BY currency');
  const capacity = [];
  for (const p of pools) {
    const s = (await capacitySnapshot(db, p.currency))!;
    const providerTestBalanceUsedMinor = 'providerTestBalanceUsedMinor' in s
      ? String((s as typeof s & { providerTestBalanceUsedMinor: bigint }).providerTestBalanceUsedMinor)
      : '0';
    capacity.push({
      ledgerMode: 'simulated' as const,
      label: 'SIMULATED synthetic purchasing capacity: not a bank balance and not an OCBC observation',
      currency: s.currency,
      scale: s.scale,
      limitMinor: s.limitMinor.toString(),
      reservedMinor: s.reservedMinor.toString(),
      cardPayableMinor: s.cardPayableMinor.toString(),
      providerTestBalanceUsedMinor,
      availableMinor: s.availableMinor.toString(),
    });
  }

  const byState = Object.fromEntries(
    (await db.all<{ state: string; n: number }>('SELECT state, COUNT(*)::int AS n FROM purchases GROUP BY state ORDER BY state')).map((r) => [r.state, Number(r.n)]),
  );

  // Obligations to customers, per funding asset.
  // Credit-positive net per asset (these are liability accounts).
  const credit = (rows: Array<{ asset: string; side: string; amount: string }>) => {
    const m = new Map<string, bigint>();
    for (const r of rows) {
      const v = BigInt(r.amount);
      m.set(r.asset, (m.get(r.asset) ?? 0n) + (r.side === 'credit' ? v : -v));
    }
    return m;
  };
  const unapplied = credit(
    (await db.all<{ asset: string; side: string; amount: string }>('SELECT asset, side, amount FROM journal_lines WHERE account = $1', Accounts.customerUnapplied)),
  );
  const prepaymentAll = credit(
    (await db.all<{ asset: string; side: string; amount: string }>('SELECT asset, side, amount FROM journal_lines WHERE account = $1', Accounts.customerPrepayment)),
  );
  // Funds received for purchases that ended without delivery: owed back, not yet refunded by anything in this system.
  const refundDue = credit(
    (await db.all<{ asset: string; side: string; amount: string }>(
      `SELECT jl.asset, jl.side, jl.amount
         FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
         JOIN purchases p ON p.id = je.purchase_id
        WHERE jl.account = $1 AND p.state IN ('failed','expired','requires_reauthorization')`,
      Accounts.customerPrepayment,
    )),
  );
  const asObj = (m: Map<string, bigint>) => Object.fromEntries([...m.entries()].filter(([, v]) => v !== 0n).map(([k, v]) => [k, v.toString()]));

  const reservations = (await db
    .all<{ status: string; currency: string; scale: number; amount_minor: string }>('SELECT status, currency, scale, amount_minor FROM reservations'))
    .reduce<Record<string, { count: number; currency: string; scale: number; totalMinor: bigint }>>((acc, r) => {
      const k = `${r.status}|${r.currency}`;
      const cur = acc[k] ?? { count: 0, currency: r.currency, scale: r.scale, totalMinor: 0n };
      cur.count += 1;
      cur.totalMinor += BigInt(r.amount_minor);
      acc[k] = cur;
      return acc;
    }, {});

  return {
    note: 'Observed ledger = externally verified facts (testnet funding, customer obligations). Simulated ledger = synthetic card capacity and card payable. They are reported separately and never netted. Bank observations are separate: see /v1/evidence/bank.',
    ledger: {
      balanced: coreBalanced && trial.every((t) => t.balanced),
      trialBalance: trial,
      accounts,
    },
    simulatedCapacity: capacity,
    purchasesByState: byState,
    obligations: {
      ledgerMode: 'observed' as const,
      note: 'Amounts owed to customers in funding-asset base units. An obligation is a liability record, not a payment instruction.',
      unappliedByAsset: asObj(unapplied),
      refundDueByAsset: asObj(refundDue),
      prepaymentOutstandingByAsset: asObj(prepaymentAll),
    },
    reservations: Object.entries(reservations)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ status: k.split('|')[0]!, currency: v.currency, scale: v.scale, count: v.count, totalMinor: v.totalMinor.toString(), ledgerMode: 'simulated' as const })),
  };
}

/* ---------------- bank observations ---------------- */

interface BankRow {
  id: string;
  bank: string;
  kind: string;
  masked_reference: string;
  currency: string;
  amount_json: string | null;
  available_json: string | null;
  description: string | null;
  environment: string;
  source: string;
  provider_timestamp: string | null;
  observed_at: string;
  caveats_json: string;
}

/**
 * Latest stored observations. Balance/summary kinds keep only the newest row per (bank, kind, reference);
 * transactions keep the newest row per identical fact. References are re-masked on the way out even though they
 * are masked on the way in.
 */
export async function latestBankObservations(db: Db, scan = 500) {
  const rows = await db.all<BankRow>('SELECT * FROM bank_observations ORDER BY observed_at DESC, id DESC LIMIT $1', scan);
  const seen = new Set<string>();
  const out = [];
  for (const r of rows) {
    const isTx = r.kind.endsWith('_transaction');
    const key = isTx
      ? [r.bank, r.kind, r.masked_reference, r.provider_timestamp, r.amount_json, r.description].join('|')
      : [r.bank, r.kind, r.masked_reference].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: r.id,
      bank: r.bank,
      kind: r.kind,
      maskedReference: maskReference(r.masked_reference),
      currency: r.currency,
      amount: parse<Money>(r.amount_json),
      availableAmount: parse<Money>(r.available_json),
      environment: r.environment,
      source: r.source,
      providerTimestamp: r.provider_timestamp,
      observedAt: r.observed_at,
      caveats: parse<string[]>(r.caveats_json) ?? [],
      provenance: {
        environment: r.environment,
        evidenceMode: r.source.startsWith('fixture') || r.environment === 'fixture' ? 'local_fixture' : 'fresh_external',
      } satisfies Provenance,
    });
  }
  return out;
}
