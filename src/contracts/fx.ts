import { z } from 'zod';
import { CurrencyCode, Money, money, minor } from './money.js';
import { IsoTimestamp } from './common.js';

/** One reference pair is inverted exactly for search, then reused for the payable check. */
export const FxSnapshot = z.object({
  source: z.literal('frankfurter'),
  from: CurrencyCode,
  to: CurrencyCode,
  rate: z.string().max(64).regex(/^(0|[1-9][0-9]*)(?:\.[0-9]{1,30})?$/)
    .refine(v => /[1-9]/.test(v), 'rate must be positive'),
  referenceDate: z.iso.date(),
  fetchedAt: IsoTimestamp,
}).strict().refine(v => v.from !== v.to, 'FX pair must differ');
export type FxSnapshot = z.infer<typeof FxSnapshot>;

export const SearchConversion = z.object({
  snapshot: FxSnapshot,
  userBudget: Money,
  providerSearchCeiling: Money,
}).strict();
export type SearchConversion = z.infer<typeof SearchConversion>;

export const DisplayConversion = z.object({
  snapshot: FxSnapshot,
  userBudget: Money,
  providerSearchCeiling: Money,
  convertedPayable: Money,
}).strict();
export type DisplayConversion = z.infer<typeof DisplayConversion>;

export interface FxReferenceSource {
  latest(from: string, to: string): Promise<FxSnapshot>;
}

/** BigInt rational conversion: floor inventory bounds, ceil payable amounts to avoid overspend. */
export function convertReference(amount: Money, rawSnapshot: FxSnapshot, to: string, scale: number, rounding: 'floor' | 'ceil'): Money {
  Money.parse(amount);
  const snapshot = FxSnapshot.parse(rawSnapshot);
  const [whole, fraction = ''] = snapshot.rate.split('.');
  const rateNumerator = BigInt(whole! + fraction);
  const rateDenominator = 10n ** BigInt(fraction.length);
  const forward = amount.currency === snapshot.from && to === snapshot.to;
  const reverse = amount.currency === snapshot.to && to === snapshot.from;
  if (!forward && !reverse) throw new RangeError('money does not match the reference pair');
  if (!Number.isInteger(scale) || scale < 0 || scale > 8) throw new RangeError('invalid target scale');
  const numerator = minor(amount) * (forward ? rateNumerator : rateDenominator) * 10n ** BigInt(scale);
  const denominator = (forward ? rateDenominator : rateNumerator) * 10n ** BigInt(amount.scale);
  return money(to, rounding === 'ceil' ? (numerator + denominator - 1n) / denominator : numerator / denominator, scale);
}
