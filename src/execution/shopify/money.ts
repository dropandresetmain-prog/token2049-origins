import { z } from 'zod';
import { money, parseDecimalToMinor, type Money } from '../../contracts/money.js';
import { ProviderError } from '../../core/errors.js';

/** Shopify MoneyV2 as received: a decimal string plus an ISO currency code. */
export const MoneyV2 = z.object({ amount: z.string(), currencyCode: z.string().regex(/^[A-Z]{3}$/) });
export type MoneyV2 = z.infer<typeof MoneyV2>;

const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

/** ISO-4217 minor-unit exponent for the currencies a Shopify store can present. */
export function currencyScale(code: string): number {
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

/** Exact conversion; a value needing more precision than the currency allows is rejected, never rounded. */
export function toMoney(m: MoneyV2): Money {
  const scale = currencyScale(m.currencyCode);
  try {
    const v = parseDecimalToMinor(m.amount, scale);
    return money(m.currencyCode, v, scale);
  } catch {
    throw new ProviderError('rejected', 'shopify_amount_unparseable', `unparseable ${m.currencyCode} amount from Shopify`);
  }
}
