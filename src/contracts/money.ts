import { z } from 'zod';

/**
 * Exact money. Never binary floating point. `amountMinor` is an integer string in minor units
 * of `currency` at `scale` decimal places (USD scale 2 => "1250" is 12.50 USD).
 */
export const IntegerString = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, 'must be a non-negative integer string');

export const SignedIntegerString = z.string().regex(/^-?(0|[1-9][0-9]*)$/, 'must be an integer string');

export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/, 'ISO-4217 code');

export const Money = z
  .object({
    currency: CurrencyCode,
    amountMinor: IntegerString,
    scale: z.number().int().min(0).max(8),
  })
  .strict();
export type Money = z.infer<typeof Money>;

/**
 * Exact crypto quantity. Identity is the full network ID + asset ID (policy/mint/unit), never a ticker.
 */
export const CryptoAmount = z
  .object({
    network: z.string().min(1),
    assetId: z.string().min(1),
    symbol: z.string().min(1).optional(),
    decimals: z.number().int().min(0).max(18),
    amountBaseUnits: IntegerString,
  })
  .strict();
export type CryptoAmount = z.infer<typeof CryptoAmount>;

export function money(currency: string, amountMinor: bigint | string | number, scale = 2): Money {
  const v = typeof amountMinor === 'bigint' ? amountMinor : BigInt(amountMinor);
  if (v < 0n) throw new RangeError('money cannot be negative');
  return { currency, amountMinor: v.toString(), scale };
}

export function minor(m: Money): bigint {
  return BigInt(m.amountMinor);
}

function assertSameUnit(a: Money, b: Money): void {
  if (a.currency !== b.currency || a.scale !== b.scale) {
    throw new RangeError(`money unit mismatch: ${a.currency}/${a.scale} vs ${b.currency}/${b.scale}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameUnit(a, b);
  return money(a.currency, minor(a) + minor(b), a.scale);
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameUnit(a, b);
  const d = minor(a) - minor(b);
  return d < 0n ? -1 : d > 0n ? 1 : 0;
}

/**
 * Parse a provider decimal (string or number as received) into exact minor units.
 * Rejects values that need more precision than `scale` rather than rounding silently.
 */
export function parseDecimalToMinor(value: string | number, scale: number): bigint {
  const s = typeof value === 'number' ? numberToPlainString(value) : value.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new RangeError(`not a decimal: ${s}`);
  const [, neg, int, fracRaw = ''] = m;
  const frac = fracRaw.replace(/0+$/, '');
  if (frac.length > scale) throw new RangeError(`precision loss parsing ${s} at scale ${scale}`);
  const v = BigInt(int! + frac.padEnd(scale, '0'));
  return neg ? -v : v;
}

function numberToPlainString(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError('non-finite number');
  // Shortest round-trip representation, then expand exponent form.
  const s = String(n);
  if (!/e/i.test(s)) return s;
  return n.toFixed(20).replace(/\.?0+$/, '');
}

export function formatMinor(m: Money): string {
  const v = minor(m);
  if (m.scale === 0) return `${v} ${m.currency}`;
  const s = v.toString().padStart(m.scale + 1, '0');
  return `${s.slice(0, -m.scale)}.${s.slice(-m.scale)} ${m.currency}`;
}

/** Rescale exactly; throws if precision would be lost. */
export function rescaleMinor(amount: bigint, fromScale: number, toScale: number): bigint {
  if (toScale >= fromScale) return amount * 10n ** BigInt(toScale - fromScale);
  const f = 10n ** BigInt(fromScale - toScale);
  if (amount % f !== 0n) throw new RangeError('precision loss in rescale');
  return amount / f;
}

/** Rescale rounding up (used when converting a payable obligation into a funding requirement). */
export function rescaleMinorCeil(amount: bigint, fromScale: number, toScale: number): bigint {
  if (toScale >= fromScale) return amount * 10n ** BigInt(toScale - fromScale);
  const f = 10n ** BigInt(fromScale - toScale);
  return (amount + f - 1n) / f;
}
