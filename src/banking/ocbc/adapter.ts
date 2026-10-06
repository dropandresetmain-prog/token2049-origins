/**
 * OCBC observation adapter (read-only).
 *
 * This adapter OBSERVES OCBC sandbox account balances, a credit-card summary and a few recent transactions.
 * It has no issuance, charge, debit or transfer capability and nothing here writes to the journal or capacity
 * model: an observation is a stored, provenance-bearing fact, not a settlement (ARCHITECTURE_DECISIONS: "OCBC is
 * not an assumed card-network simulator"). No sandbox call has shown that a merchant test payment reaches OCBC.
 *
 * Provenance: written fresh; API facts from read-only inspection of
 * tencent-hackathon@d02f7ba68ba1c7c3ef881fa4d5a235b6e8941ebd (see client.ts / normalize.ts).
 *
 * Env: OCBC_API_CLIENT_ID, OCBC_API_CLIENT_SECRET (required); OCBC_API_BASE_URL (allowlisted, default
 * https://api.ocbc.com); OCBC_API_CALLS_PER_MINUTE (default 8); OCBC_SANDBOX_SESSION_TOKEN (optional customer header).
 */
import type { BankObservation, BankObservationAdapter } from '../../contracts/ports.js';
import type { Readiness, ReadinessStatus } from '../../contracts/common.js';
import { systemClock, type Clock } from '../../infrastructure/clock.js';
import {
  OCBC_APIS,
  OCBC_ENV,
  OcbcClient,
  parseOcbcConfig,
  type OcbcApi,
  type OcbcFailure,
  type OcbcResult,
} from './client.js';
import {
  fmt,
  parseAccountListing,
  parseAccountTransactions,
  parseCardList,
  parseCardTransactions,
  type AccountRow,
  type CardRow,
  type Parsed,
  type TxRow,
} from './normalize.js';

export interface OcbcAdapterOptions {
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  clock?: Clock;
  /** Include recent transactions when the call budget allows. Default true. */
  includeTransactions?: boolean;
  /** Max transaction-history calls per observe(), shared across accounts and cards. Default 3. */
  maxTransactionCalls?: number;
  /** Max transactions kept per account/card. Default 5. */
  maxTransactionsPerSource?: number;
}

/** Thrown by observe() when nothing could be observed. The message is safe to show. */
export class OcbcObservationError extends Error {
  constructor(
    readonly kind: OcbcFailure['kind'] | 'not_configured',
    message: string,
  ) {
    super(message);
    this.name = 'OcbcObservationError';
  }
}

const READINESS_TTL_MS = 60_000;
const COMPONENT = 'ocbc';
const ENVIRONMENT = 'sandbox';

const CAVEAT_HISTORICAL = 'OCBC developer-sandbox data is historical test data, not current finances.';
const CAVEAT_READ_ONLY =
  'Read-only observation: the adapter has no card issuance, charge, debit or transfer capability, and these figures are independent of the gateway simulated card capacity and ledger.';
const CAVEAT_XXX =
  'Currency is the ISO placeholder XXX (the sandbox states no currency); amounts are not asserted to be SGD or any real currency.';
const CAVEAT_DIRECTION = 'Card history does not state debit/credit direction; amounts are as provided.';

export function createOcbcAdapter(env: NodeJS.ProcessEnv, opts: OcbcAdapterOptions = {}): BankObservationAdapter {
  const clock = opts.clock ?? systemClock;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const includeTx = opts.includeTransactions ?? true;
  const maxTxCalls = Math.max(0, opts.maxTransactionCalls ?? 3);
  const maxTxPerSource = Math.max(1, opts.maxTransactionsPerSource ?? 5);

  // The client (token cache, rate-limit window) is built lazily from the env at first use and reused.
  let client: OcbcClient | null = null;
  const getClient = (): OcbcClient | { error: Readiness['status']; missing: string[]; detail: string } => {
    const cfg = parseOcbcConfig(env);
    if (!cfg.ok) {
      return cfg.reason === 'missing'
        ? { error: 'MISSING_CONFIG', missing: cfg.missing, detail: 'OCBC sandbox application credentials are not configured.' }
        : { error: 'CONFIGURED_UNVERIFIED', missing: [], detail: `invalid configuration: ${cfg.invalid.join(', ')}` };
    }
    client ??= new OcbcClient(cfg.config, fetchImpl, clock, () => env[OCBC_ENV.sessionToken]?.trim() || undefined);
    return client;
  };

  const readiness = (status: ReadinessStatus, missing: string[], detail?: string): Readiness => ({
    component: COMPONENT,
    status,
    environment: ENVIRONMENT,
    missing,
    ...(detail ? { detail } : {}),
    checkedAt: clock.now().toISOString(),
  });

  /* ---------------- readiness (cached, never throws) ---------------- */

  let cached: { at: number; value: Readiness } | null = null;
  let inFlight: Promise<Readiness> | null = null;

  async function probe(): Promise<Readiness> {
    const c = getClient();
    if (!(c instanceof OcbcClient)) return readiness(c.error, c.missing, c.detail);
    const res = await c.get(OCBC_APIS.accountListing);
    if (res.ok) {
      return readiness(
        'EXTERNAL_CHECK_PASSED',
        [],
        `token mint and ${OCBC_APIS.accountListing.label} read succeeded; sandbox data is historical and this adapter is read-only. Card and transaction APIs are not probed by readiness.`,
      );
    }
    if (res.kind === 'auth' || res.kind === 'forbidden') {
      return readiness('ACCESS_BLOCKED', [], `${res.api}: ${res.message}`);
    }
    return readiness('CONFIGURED_UNVERIFIED', [], `${res.api}: ${res.message}`);
  }

  async function checkReadiness(): Promise<Readiness> {
    try {
      const nowMs = clock.now().getTime();
      if (cached && nowMs - cached.at < READINESS_TTL_MS) return { ...cached.value };
      inFlight ??= probe().finally(() => {
        inFlight = null;
      });
      const value = await inFlight;
      // Missing-config answers are free to recompute, so only external answers are cached.
      if (value.status !== 'MISSING_CONFIG') cached = { at: nowMs, value };
      return { ...value };
    } catch {
      // Defensive: readiness must never throw, and the message of an unexpected error is not echoed.
      return readiness('CONFIGURED_UNVERIFIED', [], 'unexpected error while checking OCBC readiness');
    }
  }

  /* ---------------- observation ---------------- */

  const baseCaveats = (extra: string[] = []): string[] => [CAVEAT_HISTORICAL, CAVEAT_READ_ONLY, ...extra];

  async function observe(): Promise<BankObservation[]> {
    const c = getClient();
    if (!(c instanceof OcbcClient)) throw new OcbcObservationError('not_configured', c.detail);

    const failures: OcbcFailure[] = [];
    const take = <T>(res: OcbcResult, parse: (j: unknown) => Parsed<T> | null): { data: Parsed<T>; observedAt: string } | null => {
      if (!res.ok) {
        failures.push(res);
        return null;
      }
      const data = parse(res.json);
      if (!data || (data.items.length === 0 && data.skipped > 0)) {
        failures.push({ ok: false, kind: 'unusable', api: '(payload)', message: 'response was not in an interpretable shape' });
        return null;
      }
      return { data, observedAt: res.observedAt };
    };

    const accountsRes = take(await c.get(OCBC_APIS.accountListing), parseAccountListing);
    // Failures name the API; patch the label for payload problems after the fact.
    labelUnusable(failures, OCBC_APIS.accountListing);
    const cardsRes = take(await c.get(OCBC_APIS.creditCardList), parseCardList);
    labelUnusable(failures, OCBC_APIS.creditCardList);
    if (!accountsRes && !cardsRes) {
      const f = failures.find((x) => x.kind !== 'unusable') ?? failures[0];
      throw new OcbcObservationError(f?.kind ?? 'unavailable', failures.map((x) => `${x.api}: ${x.message}`).join(' | ') || 'nothing could be observed');
    }

    const out: BankObservation[] = [];
    const sourceNotes = new Map<string, string[]>();
    const noteFor = (ref: string, n: string) => sourceNotes.set(ref, [...(sourceNotes.get(ref) ?? []), n]);

    // Transaction reads: interleave accounts and cards so a small budget covers both, capped overall.
    const txOut: BankObservation[] = [];
    if (includeTx && maxTxCalls > 0) {
      type Target = { kind: 'account'; row: AccountRow } | { kind: 'card'; row: CardRow };
      const accts: Target[] = (accountsRes?.data.items ?? []).filter((r) => r.rawId).map((row) => ({ kind: 'account', row }));
      const cards: Target[] = (cardsRes?.data.items ?? []).filter((r) => r.rawId).map((row) => ({ kind: 'card', row }));
      const order: Target[] = [];
      for (let i = 0; i < Math.max(accts.length, cards.length); i++) {
        if (accts[i]) order.push(accts[i]!);
        if (cards[i]) order.push(cards[i]!);
      }
      for (const t of order.slice(0, maxTxCalls)) {
        const isAccount = t.kind === 'account';
        const api: OcbcApi = isAccount ? OCBC_APIS.accountTransactions : OCBC_APIS.creditCardUnbilled;
        const res = await c.get(api, isAccount ? { accountId: t.row.rawId! } : { cardId: t.row.rawId! });
        if (!res.ok) {
          noteFor(t.row.maskedReference, `Recent transactions unavailable (${res.api}: ${res.kind}).`);
          continue;
        }
        const parsed = isAccount ? parseAccountTransactions(res.json) : parseCardTransactions(res.json);
        if (!parsed) {
          noteFor(t.row.maskedReference, `Recent transactions unavailable (${api.label}: unusable payload).`);
          continue;
        }
        const recent = [...parsed.items].sort((a, b) => (a.providerTimestamp < b.providerTimestamp ? 1 : -1)).slice(0, maxTxPerSource);
        for (const tx of recent) txOut.push(txObservation(isAccount, t.row.maskedReference, tx, res.observedAt, parsed));
      }
    }

    if (accountsRes) {
      const { data, observedAt } = accountsRes;
      for (const r of data.items) {
        out.push({
          kind: 'account_balance',
          maskedReference: r.maskedReference,
          currency: r.currency,
          amount: r.ledger,
          availableAmount: r.available,
          description: `Account listing: ledger ${fmt(r.ledger)}, available ${fmt(r.available)}`,
          observedAt,
          providerTimestamp: r.providerTimestamp,
          environment: 'sandbox',
          source: `ocbc:sandbox:${OCBC_APIS.accountListing.label}`,
          caveats: baseCaveats([
            ...r.notes,
            ...(data.skipped ? [`${data.skipped} listing row(s) were skipped as uninterpretable.`] : []),
            ...(sourceNotes.get(r.maskedReference) ?? []),
            ...failureCaveats(failures),
          ]),
        });
      }
    }
    if (cardsRes) {
      const { data, observedAt } = cardsRes;
      for (const r of data.items) {
        out.push({
          kind: 'card_summary',
          maskedReference: r.maskedReference,
          currency: r.currency,
          // `amount` is the amount due; `availableAmount` is the available credit as reported.
          amount: r.amountDue,
          availableAmount: r.available,
          description: [
            r.label ?? 'Credit card summary',
            `due ${fmt(r.amountDue)}${r.dueDate ? ` by ${r.dueDate.slice(0, 10)}` : ''}`,
            `unbilled ${fmt(r.unbilled)}`,
            `available ${fmt(r.available)}`,
          ].join('; '),
          observedAt,
          providerTimestamp: null,
          environment: 'sandbox',
          source: `ocbc:sandbox:${OCBC_APIS.creditCardList.label}`,
          caveats: baseCaveats([
            ...(r.currency === 'XXX' ? [CAVEAT_XXX] : []),
            ...(r.currencyStated ? [] : ['The card listing does not state a currency.']),
            ...r.notes,
            ...(data.skipped ? [`${data.skipped} card row(s) were skipped as uninterpretable.`] : []),
            ...(sourceNotes.get(r.maskedReference) ?? []),
            ...failureCaveats(failures),
          ]),
        });
      }
    }
    return [...out, ...txOut];
  }

  function txObservation(isAccount: boolean, ref: string, tx: TxRow, observedAt: string, parsed: Parsed<TxRow>): BankObservation {
    const label = isAccount ? OCBC_APIS.accountTransactions.label : OCBC_APIS.creditCardUnbilled.label;
    return {
      kind: isAccount ? 'account_transaction' : 'card_transaction',
      maskedReference: ref,
      currency: tx.currency,
      amount: tx.amount,
      availableAmount: null,
      description: [tx.direction ? (tx.direction === 'debit' ? 'DEBIT' : 'CREDIT') : null, tx.description].filter(Boolean).join(' ') || null,
      observedAt,
      providerTimestamp: tx.providerTimestamp,
      environment: 'sandbox',
      source: `ocbc:sandbox:${label}`,
      caveats: baseCaveats([
        ...(tx.currency === 'XXX' ? [CAVEAT_XXX] : []),
        ...(tx.direction === null ? [CAVEAT_DIRECTION] : []),
        ...parsed.notes,
        ...(parsed.skipped ? [`${parsed.skipped} history row(s) were skipped as uninterpretable.`] : []),
      ]),
    };
  }

  return { bank: 'ocbc', readiness: checkReadiness, observe };
}

/** Payload failures are recorded before the API is known; name them after the fact. */
function labelUnusable(failures: OcbcFailure[], api: OcbcApi): void {
  for (const f of failures) if (f.api === '(payload)') f.api = api.label;
}

/** One caveat per failed read, so a partial observation is never mistaken for a complete one. */
function failureCaveats(failures: OcbcFailure[]): string[] {
  return failures.map((f) => `Partial observation: ${f.api} could not be read (${f.kind}).`);
}
