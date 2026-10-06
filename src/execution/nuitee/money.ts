import { money, parseDecimalToMinor, type Money } from '../../contracts/money.js';

/**
 * Exact amount helpers. liteAPI sends amounts as JSON numbers (sometimes strings). We never do
 * float arithmetic: the received value is converted to its shortest decimal string and parsed to
 * integer minor units (parseDecimalToMinor rejects anything needing more precision than the
 * currency scale). Sums are BigInt sums.
 */
const SCALE_0 = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const SCALE_3 = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export function currencyScale(currency: string): number {
  if (SCALE_0.has(currency)) return 0;
  if (SCALE_3.has(currency)) return 3;
  return 2;
}

/** Parse a provider amount (number or decimal string) to minor units, or null if absent/invalid/negative. */
export function toMinor(value: unknown, scale: number): bigint | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  try {
    const v = parseDecimalToMinor(value, scale);
    return v < 0n ? null : v;
  } catch {
    return null;
  }
}

export function asArray<T>(v: T | T[] | null | undefined): T[] {
  if (v === null || v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Candidate totals for one provider quantity (e.g. offer total vs sum of room totals). When the
 * provider's own figures disagree we take the HIGHER one: over-stating the payable is safe for
 * the spend ceiling, under-stating is not. `disagree` lets callers surface it in terms.
 */
export function pickTotal(candidates: Array<bigint | null>): { minor: bigint; disagree: boolean } | null {
  const present = candidates.filter((c): c is bigint => c !== null);
  if (present.length === 0) return null;
  const max = present.reduce((a, b) => (b > a ? b : a));
  return { minor: max, disagree: present.some((c) => c !== max) };
}

/** Sum of per-rate totals; null if any rate has no single parseable total in `currency`. */
export function sumRateTotals(rates: Array<{ retailRate?: { total?: unknown } | null }>, currency: string, scale: number): bigint | null {
  if (rates.length === 0) return null;
  let sum = 0n;
  for (const r of rates) {
    const totals = asArray(r.retailRate?.total as Array<{ amount?: unknown; currency?: unknown }> | { amount?: unknown; currency?: unknown } | undefined);
    // A rate must expose exactly one total in the requested currency; anything else is not priceable exactly.
    if (totals.length !== 1) return null;
    const t = totals[0]!;
    if (t.currency !== currency) return null;
    const m = toMinor(t.amount, scale);
    if (m === null) return null;
    sum += m;
  }
  return sum;
}

export function moneyOf(currency: string, minor: bigint, scale: number): Money {
  return money(currency, minor, scale);
}
