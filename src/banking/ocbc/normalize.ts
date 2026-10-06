/**
 * Pure normalisation of OCBC sandbox payloads into BankObservation facts. No I/O, never throws.
 *
 * Provenance: written fresh. Payload shapes (envelope `success/results` or `Success/Results`, singular `result`
 * on the card listing, string amounts on histories, XXX card currency) come from read-only inspection of
 * tencent-hackathon@d02f7ba68ba1c7c3ef881fa4d5a235b6e8941ebd, src/server/bank/providers/ocbc/{provider,normalize}.ts.
 * Those shapes are from public Swagger plus one day of live sandbox observation; anything not understood is
 * skipped and counted, never guessed.
 *
 * Money is exact: provider decimals go through parseDecimalToMinor at the currency's scale. A value that needs
 * more precision than the scale, is negative (Money is non-negative) or is not a decimal becomes `null`, and the
 * caveats say so. Raw account/card identifiers are returned only as `rawId` for follow-up reads and must never be
 * copied into an observation; observations carry masked references only.
 */
import { money, formatMinor, parseDecimalToMinor, type Money } from '../../contracts/money.js';
import { redactString } from '../../infrastructure/redact.js';
import { maskReference } from './mask.js';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Non-empty trimmed string; safe integers are stringified. */
function text(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v);
  return null;
}

const isFalse = (v: unknown): boolean => v === false || (typeof v === 'string' && v.trim().toLowerCase() === 'false');
const isTrue = (v: unknown): boolean => v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');

/** Arrays pass through; a lone object is wrapped (XML-derived gateways collapse 1-element lists); absent is empty. */
function listOf(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (isRec(v)) return [v];
  return v === undefined || v === null ? [] : null;
}

/** The sandbox capitalises envelope keys (`Success`, `Results`) where the docs say lowercase. Accept both. */
function canon(json: unknown): Rec | null {
  if (!isRec(json)) return null;
  const out: Rec = { ...json };
  for (const [upper, lower] of [['Success', 'success'], ['Results', 'results'], ['Result', 'result']] as const) {
    if (!(lower in out) && upper in out) out[lower] = out[upper];
  }
  return out;
}

/** Plain description: control chars collapsed, secrets/long digit runs redacted, capped. */
export function cleanDescription(v: unknown, max = 140): string | null {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = redactString(v.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim());
  return s === '' ? null : Array.from(s).slice(0, max).join('');
}

/* ---------------- money & dates ---------------- */

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF', 'PYG', 'RWF']);
const THREE_DECIMAL = new Set(['BHD', 'KWD', 'OMR', 'JOD', 'TND', 'IQD', 'LYD']);

/** ISO-4217 minor-unit exponent for the currencies we might plausibly see. XXX and unknown codes use 2. */
export function currencyScale(code: string): number {
  return ZERO_DECIMAL.has(code) ? 0 : THREE_DECIMAL.has(code) ? 3 : 2;
}

/** A well-formed 3-letter code, upper-cased; null otherwise. */
export function currencyOf(v: unknown): string | null {
  const t = text(v)?.toUpperCase();
  return t && /^[A-Z]{3}$/.test(t) ? t : null;
}

/** Exact Money from a provider decimal; null when not exactly representable or negative. */
export function toMoney(value: unknown, currency: string): { money: Money | null; issue?: string } {
  const scale = currencyScale(currency);
  try {
    let s: string | number;
    if (typeof value === 'number') s = value;
    else if (typeof value === 'string') s = value.trim().replace(/^\+/, '').replace(/,/g, '');
    else return { money: null };
    const minor = parseDecimalToMinor(s, scale);
    if (minor < 0n) return { money: null, issue: 'a negative amount was not represented (Money is non-negative)' };
    return { money: money(currency, minor, scale) };
  } catch {
    return { money: null, issue: 'an amount could not be represented exactly and was omitted' };
  }
}

/**
 * Provider dates -> ISO 8601. Accepts yyyy-mm-dd, dd-mm-yyyy, dd/mm/yyyy, yyyymmdd and ISO datetimes with an
 * explicit offset. Anything ambiguous (a datetime without offset, mm/dd) is null rather than guessed.
 */
export function parseProviderDate(value: unknown): string | null {
  const s = typeof value === 'number' && Number.isInteger(value) ? String(value) : typeof value === 'string' ? value.trim() : null;
  if (!s) return null;
  const ymd = (y: number, mo: number, d: number): string | null => {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return y >= 1970 && y <= 2100 && dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString() : null;
  };
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return ymd(+m[1]!, +m[2]!, +m[3]!);
  if ((m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s))) return ymd(+m[3]!, +m[2]!, +m[1]!);
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return ymd(+m[1]!, +m[2]!, +m[3]!);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

/* ---------------- results ---------------- */

export interface Parsed<T> {
  items: T[];
  skipped: number;
  /** Row-level notes that must travel as caveats (e.g. "a negative amount was not represented"). */
  notes: string[];
}

class Tally {
  skipped = 0;
  readonly notes = new Set<string>();
  skip(): void {
    this.skipped += 1;
  }
  result<T>(items: T[]): Parsed<T> {
    return { items, skipped: this.skipped, notes: [...this.notes] };
  }
}

/** A payload that explicitly reports failure is unusable, never "no data". */
function reportsFailure(rec: Rec): boolean {
  const success = rec.success ?? rec.Success;
  if (isFalse(success)) return true;
  return !isTrue(success) && text(rec.errorMessage ?? rec.ErrorMessage) !== null;
}

export interface AccountRow {
  /** Provider id for follow-up reads. NEVER copy into an observation. */
  rawId: string | null;
  maskedReference: string;
  currency: string;
  ledger: Money | null;
  available: Money | null;
  providerTimestamp: string | null;
  notes: string[];
}

export function parseAccountListing(json: unknown): Parsed<AccountRow> | null {
  const root = canon(json);
  if (!root || !('results' in root) || isFalse(root.success)) return null;
  const rows = listOf(root.results);
  if (rows === null) return null;
  const tally = new Tally();
  const items: AccountRow[] = [];
  for (const row of rows) {
    if (!isRec(row) || text(row.errorMessage) !== null) {
      tally.skip();
      continue;
    }
    const bal = isRec(row.balance) ? row.balance : null;
    const currency = bal ? currencyOf(bal.currencyCode) : null;
    if (!bal || !currency) {
      tally.skip(); // an unstated currency cannot be represented as Money
      continue;
    }
    const ledger = toMoney(bal.ledgerBalance, currency);
    const available = toMoney(bal.availableBalance, currency);
    if (!ledger.money && !available.money) {
      tally.skip();
      continue;
    }
    const notes = [ledger.issue, available.issue].filter((n): n is string => !!n);
    items.push({
      rawId: text(row.accountId),
      maskedReference: maskReference(row.accountMaskedNumber),
      currency,
      ledger: ledger.money,
      available: available.money,
      providerTimestamp: parseProviderDate(bal.balanceAsOfDate),
      notes,
    });
  }
  return tally.result(items);
}

export interface CardRow {
  rawId: string | null;
  maskedReference: string;
  /** Stated currency, or the XXX placeholder when the provider states none. */
  currency: string;
  currencyStated: boolean;
  amountDue: Money | null;
  available: Money | null;
  unbilled: Money | null;
  dueDate: string | null;
  label: string | null;
  notes: string[];
}

export function parseCardList(json: unknown): Parsed<CardRow> | null {
  const root = canon(json);
  if (!root || isFalse(root.success)) return null;
  const source = 'result' in root ? root.result : 'results' in root ? root.results : undefined;
  if (source === undefined) return null;
  const rows = listOf(source);
  if (rows === null) return null;
  const tally = new Tally();
  const items: CardRow[] = [];
  for (const row of rows) {
    if (!isRec(row) || text(row.errorMessage) !== null || text(row.errorCode) !== null) {
      tally.skip();
      continue;
    }
    const stated = currencyOf(row.currencyCode ?? row.currency);
    const currency = stated ?? 'XXX';
    const due = toMoney(row.amountDue, currency);
    const avail = toMoney(row.availableBalance, currency);
    const unbilled = toMoney(row.unbilledAmount, currency);
    if (!due.money && !avail.money && !unbilled.money) {
      tally.skip();
      continue;
    }
    items.push({
      rawId: text(row.cardId),
      maskedReference: maskReference(row.maskedCardNo),
      currency,
      currencyStated: stated !== null,
      amountDue: due.money,
      available: avail.money,
      unbilled: unbilled.money,
      dueDate: parseProviderDate(row.dueDate),
      label: cleanDescription(row.cardDesc, 60),
      notes: [due.issue, avail.issue, unbilled.issue].filter((n): n is string => !!n),
    });
  }
  return tally.result(items);
}

export interface TxRow {
  currency: string;
  amount: Money;
  description: string | null;
  /** Direction when the provider states it (account history); null otherwise. */
  direction: 'debit' | 'credit' | null;
  providerTimestamp: string;
}

function direction(v: unknown): 'debit' | 'credit' | null {
  const t = typeof v === 'string' ? v.trim().toUpperCase() : '';
  if (t === 'D' || t === 'DR' || t === 'DEBIT') return 'debit';
  if (t === 'C' || t === 'CR' || t === 'CREDIT') return 'credit';
  return null;
}

/** account history: results{responseList[]} (accounttransactionhistory) or results[] (corpTransHistory). */
export function parseAccountTransactions(json: unknown): Parsed<TxRow> | null {
  const root = canon(json);
  if (!root || isFalse(root.success)) return null;
  const results = root.results;
  let list: unknown[] | null;
  if (Array.isArray(results)) list = results;
  else if (isRec(results)) {
    if (reportsFailure(results)) return null;
    list = listOf(results.responseList);
  } else return null;
  if (list === null) return null;
  const tally = new Tally();
  const items: TxRow[] = [];
  for (const row of list) {
    if (!isRec(row)) {
      tally.skip();
      continue;
    }
    const currency = currencyOf(row.currencyCode);
    const at = parseProviderDate(row.transactionDate);
    const dir = direction(row.debitCreditIndicator);
    if (!currency || !at || !dir) {
      tally.skip(); // direction is not guessed from the amount sign
      continue;
    }
    const amt = toMoney(row.amount, currency);
    if (!amt.money) {
      tally.skip();
      if (amt.issue) tally.notes.add(amt.issue);
      continue;
    }
    items.push({ currency, amount: amt.money, description: cleanDescription(row.description), direction: dir, providerTimestamp: at });
  }
  return tally.result(items);
}

/** card history: results.creditCardTransactions{creditCardTransactionDetail[]}. */
export function parseCardTransactions(json: unknown): Parsed<TxRow> | null {
  const root = canon(json);
  if (!root || isFalse(root.success)) return null;
  const results = root.results;
  if (!isRec(results)) return null;
  if (text(results.errorMessage) !== null && !isTrue(root.success)) return null;
  const groups = listOf(results.creditCardTransactions);
  if (groups === null) return null;
  const tally = new Tally();
  const items: TxRow[] = [];
  for (const g of groups) {
    const details = isRec(g) ? listOf(g.creditCardTransactionDetail) : null;
    if (details === null) {
      tally.skip();
      continue;
    }
    for (const row of details) {
      if (!isRec(row)) {
        tally.skip();
        continue;
      }
      // The sandbox reports card rows as XXX; it is kept as XXX, never reinterpreted as a real currency.
      const currency = currencyOf(row.currencyCode);
      const at = parseProviderDate(row.transactionDate);
      if (!currency || !at) {
        tally.skip();
        continue;
      }
      const amt = toMoney(row.transactionAmount, currency);
      if (!amt.money) {
        tally.skip();
        if (amt.issue) tally.notes.add(amt.issue);
        continue;
      }
      items.push({ currency, amount: amt.money, description: cleanDescription(row.transactionDescription), direction: null, providerTimestamp: at });
    }
  }
  return tally.result(items);
}

/** Short human summary of a Money for observation descriptions. */
export const fmt = (m: Money | null): string => (m ? formatMinor(m) : 'n/a');
