/** Formatting helpers. Exact: amounts are formatted from integer strings, never via float arithmetic on totals. */
import type { CryptoAmount, Money } from '../contracts/backend.js';

export interface FormatContext {
  now: Date;
  locale: string;
  /** IANA zone; undefined means the browser's zone. Tests pin it. */
  timeZone: string | undefined;
}

export function defaultFormatContext(): FormatContext {
  return { now: new Date(), locale: 'en-US', timeZone: undefined };
}

function splitMinor(amountMinor: string, scale: number): { int: string; frac: string } {
  const s = amountMinor.padStart(scale + 1, '0');
  return scale === 0 ? { int: s, frac: '' } : { int: s.slice(0, -scale), frac: s.slice(-scale) };
}

function group(int: string, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(int));
}

/** "$286.00". The currency code is shown separately where it matters (the purchase total). */
export function formatMoney(m: Money, ctx: Pick<FormatContext, 'locale'>): string {
  const symbol = currencySymbol(m.currency, ctx.locale);
  const { int, frac } = splitMinor(m.amountMinor, m.scale);
  return `${symbol}${group(int, ctx.locale)}${frac ? `.${frac}` : ''}`;
}

function currencySymbol(code: string, locale: string): string {
  const part = new Intl.NumberFormat(locale, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' })
    .formatToParts(0)
    .find((p) => p.type === 'currency');
  return part?.value ?? `${code} `;
}

/** "0.286 test tokens" or "0.286 ADA". Trailing zeros trimmed; never rounded. */
export function formatCrypto(a: CryptoAmount, fallbackUnit: string, ctx: Pick<FormatContext, 'locale'>): string {
  const { int, frac } = splitMinor(a.amountBaseUnits, a.decimals);
  const trimmed = frac.replace(/0+$/, '');
  return `${group(int, ctx.locale)}${trimmed ? `.${trimmed}` : ''} ${a.symbol ?? fallbackUnit}`;
}

function dayKey(d: Date, ctx: FormatContext): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ctx.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** "10:14 AM" */
export function formatTime(iso: string, ctx: FormatContext): string {
  return new Intl.DateTimeFormat(ctx.locale, { timeZone: ctx.timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** "Today, 10:14 AM", "Yesterday, 9:02 PM" or "Oct 4, 10:14 AM" (year added when it differs). */
export function formatWhen(iso: string, ctx: FormatContext): string {
  const d = new Date(iso);
  const time = formatTime(iso, ctx);
  const today = dayKey(ctx.now, ctx);
  const yesterday = dayKey(new Date(ctx.now.getTime() - 86_400_000), ctx);
  const key = dayKey(d, ctx);
  if (key === today) return `Today, ${time}`;
  if (key === yesterday) return `Yesterday, ${time}`;
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  const date = new Intl.DateTimeFormat(ctx.locale, {
    timeZone: ctx.timeZone, month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d);
  return `${date}, ${time}`;
}

/** Short purchase number for people: "#4K2Q9X". The full ID is what gets copied. */
export function displayId(purchaseId: string): string {
  return `#${purchaseId.slice(-6).toUpperCase()}`;
}

export function isTestNetwork(network: string): boolean {
  return /preprod|preview|devnet|testnet|test/i.test(network);
}

/** Splits "-1234" into sign and magnitude so signed integer strings can be formatted without Number. */
function splitSign(value: string): { negative: boolean; digits: string } {
  const negative = value.startsWith('-');
  const digits = (negative ? value.slice(1) : value).replace(/^0+(?=\d)/, '');
  return { negative: negative && digits !== '0', digits };
}

/** "-$12.50" from a signed minor-unit string. Exact; no float arithmetic. */
export function formatSignedMoney(currency: string, amountMinor: string, scale: number, ctx: Pick<FormatContext, 'locale'>): string {
  const { negative, digits } = splitSign(amountMinor);
  const text = formatMoney({ currency, amountMinor: digits, scale }, ctx);
  return negative ? `-${text}` : text;
}

/** "1.5 test ADA" from signed base units. With unknown decimals the raw units are shown, labelled as such. */
export function formatSignedUnits(units: string, decimals: number | null, unit: string, ctx: Pick<FormatContext, 'locale'>): string {
  const { negative, digits } = splitSign(units);
  let body: string;
  if (decimals === null) {
    body = `${group(digits, ctx.locale)} ${unit}`;
  } else {
    const { int, frac } = splitMinor(digits, decimals);
    const trimmed = frac.replace(/0+$/, '');
    body = `${group(int, ctx.locale)}${trimmed ? `.${trimmed}` : ''} ${unit}`;
  }
  return negative ? `-${body}` : body;
}
