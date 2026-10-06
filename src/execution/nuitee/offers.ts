import { z } from 'zod';
import { CurrencyCode, IntegerString, formatMinor, type Money } from '../../contracts/money.js';
import type { HotelIntent } from '../../contracts/intent.js';
import type { ProviderOffer, ProviderQuote } from '../../contracts/ports.js';
import { ProviderError } from '../../core/errors.js';
import { currencyScale, moneyOf, pickTotal, sumRateTotals, toMinor } from './money.js';
import { PrebookResponse, SearchResponse, type Rate, type RoomType } from './schemas.js';

/** Search offers are indicative; liteAPI documents no offer TTL, so this is a conservative gateway-side cap. */
export const OFFER_TTL_MS = 20 * 60_000;
/** prebookId TTL is undocumented; keep the quote short so execution happens while the rate is likely held. */
export const QUOTE_TTL_MS = 10 * 60_000;
export const MAX_OFFERS = 10;

/** Opaque, server-held handle for an offer (never sent to channels). */
export const OfferRef = z.object({
  offerId: z.string().min(1),
  hotelId: z.string().min(1),
  currency: CurrencyCode,
  scale: z.number().int().min(0).max(8),
  /** Indicative search total, to detect search -> prebook drift independent of provider flags. */
  searchTotalMinor: IntegerString.optional(),
  title: z.string().max(160).optional(),
});
export type OfferRef = z.infer<typeof OfferRef>;

/** Opaque handle for a quote (prebook). `expectedTotalMinor` is what the quote promised. */
export const PrebookRef = z.object({
  prebookId: z.string().min(1),
  hotelId: z.string().min(1),
  expectedTotalMinor: IntegerString,
  currency: CurrencyCode,
  scale: z.number().int().min(0).max(8),
});
export type PrebookRef = z.infer<typeof PrebookRef>;

export const SANDBOX_TERM = 'Nuitee sandbox: this booking is simulated; no real payment is taken and no real room is reserved.';

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

/** Cancellation and board lines for a rate. Amounts parsed exactly; unparseable amounts are described, not guessed. */
function rateTerms(rate: Rate | undefined): string[] {
  if (!rate) return [];
  const out: string[] = [];
  const tag = rate.cancellationPolicies?.refundableTag;
  out.push(
    tag === 'RFN'
      ? 'Refundable (free cancellation until the first charge date below, if any)'
      : tag === 'NRFN'
        ? 'Non-refundable'
        : 'Refundability not stated by provider',
  );
  for (const info of rate.cancellationPolicies?.cancelPolicyInfos ?? []) {
    if (!info.cancelTime) continue;
    const cur = info.currency && /^[A-Z]{3}$/.test(info.currency) ? info.currency : null;
    const m = cur ? toMinor(info.amount, currencyScale(cur)) : null;
    const amt = cur && m !== null ? formatMinor(moneyOf(cur, m, currencyScale(cur))) : 'a charge';
    out.push(`Cancellation charge of ${amt} applies from ${info.cancelTime}${info.timezone ? ` ${info.timezone}` : ''}`);
  }
  if (rate.boardName) out.push(`Board: ${clip(rate.boardName, 60)}`);
  return out;
}

function allRates(roomTypes: RoomType[]): Rate[] {
  return roomTypes.flatMap((rt) => rt.rates ?? []);
}

/* ---------------- search ---------------- */

export function searchBody(intent: HotelIntent): Record<string, unknown> {
  const body: Record<string, unknown> = {
    checkin: intent.checkin,
    checkout: intent.checkout,
    currency: intent.spendCeiling.currency,
    guestNationality: intent.guestNationality,
    occupancies: intent.occupancies.map((o) => ({ adults: o.adults, ...(o.childrenAges.length ? { children: o.childrenAges } : {}) })),
    maxRatesPerHotel: 3,
    includeHotelData: true,
    // Seconds liteAPI waits for live supplier rates; keeps search well inside our 15s HTTP timeout.
    timeout: 8,
  };
  const d = intent.destination;
  if ('cityName' in d) {
    body.cityName = d.cityName;
    body.countryCode = d.countryCode;
  } else if ('latitude' in d) {
    body.latitude = d.latitude;
    body.longitude = d.longitude;
    body.radius = d.radiusM;
  } else {
    body.hotelIds = d.hotelIds;
  }
  return body;
}

export function mapSearch(json: unknown, intent: HotelIntent, observedAt: Date): ProviderOffer[] {
  const parsed = SearchResponse.safeParse(json);
  if (!parsed.success) throw new ProviderError('unknown', 'malformed_search', 'search response did not match the expected shape');
  const currency = intent.spendCeiling.currency;
  const scale = intent.spendCeiling.scale;
  const names = new Map<string, string>();
  for (const h of parsed.data.hotels ?? []) if (h.id && h.name) names.set(h.id, h.name);

  const cheapest: Array<{ hotelId: string; rt: RoomType; minor: bigint; disagree: boolean }> = [];
  for (const h of parsed.data.data ?? []) {
    if (!h.hotelId) continue;
    let best: (typeof cheapest)[number] | null = null;
    for (const rt of h.roomTypes ?? []) {
      if (!rt.offerId || !rt.rates?.length) continue;
      const offerTotal = rt.offerRetailRate && rt.offerRetailRate.currency === currency ? toMinor(rt.offerRetailRate.amount, scale) : null;
      const priced = pickTotal([offerTotal, sumRateTotals(rt.rates, currency, scale)]);
      if (!priced) continue; // not exactly priceable in the requested currency: omit rather than guess
      if (!best || priced.minor < best.minor) best = { hotelId: h.hotelId, rt, ...priced };
    }
    if (best) cheapest.push(best);
  }
  // Cheapest rate per hotel (above), then the cheapest hotels overall.
  cheapest.sort((a, b) => (a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : a.hotelId.localeCompare(b.hotelId)));
  const exp = new Date(observedAt.getTime() + OFFER_TTL_MS).toISOString();
  const nights = Math.round((Date.parse(intent.checkout) - Date.parse(intent.checkin)) / 86_400_000);
  const nOcc = intent.occupancies.length;
  return cheapest.slice(0, MAX_OFFERS).map(({ hotelId, rt, minor, disagree }) => {
    const rate = rt.rates![0];
    const hotel = names.get(hotelId) ?? `Hotel ${hotelId}`;
    const room = rate?.name || rt.name || 'Room';
    const title = clip(`${hotel} - ${room}`, 160);
    const ref: OfferRef = { offerId: rt.offerId!, hotelId, currency, scale, searchTotalMinor: minor.toString(), title };
    const terms = [...rateTerms(rate), SANDBOX_TERM];
    if (disagree) terms.push('Provider price components disagreed; the higher figure is shown.');
    return {
      title,
      description: `${intent.checkin} to ${intent.checkout} (${nights} night${nights === 1 ? '' : 's'}), ${nOcc} room${nOcc === 1 ? '' : 's'}; indicative total including included taxes`,
      indicativePrice: moneyOf(currency, minor, scale),
      terms,
      executionRef: ref,
      sourceObservedAt: observedAt.toISOString(),
      expiresAt: exp,
    };
  });
}

/* ---------------- prebook / quote ---------------- */

export function prebookBody(ref: OfferRef): Record<string, unknown> {
  return { offerId: ref.offerId, usePaymentSdk: false };
}

/** Pure mapping of a prebook response to a quote (expiry is applied by the caller from its clock). */
export function mapPrebook(json: unknown, ref: OfferRef, intent: HotelIntent): Omit<ProviderQuote, 'expiresAt'> {
  const parsed = PrebookResponse.safeParse(json);
  if (!parsed.success) throw new ProviderError('unknown', 'malformed_prebook', 'prebook response did not match the expected shape');
  const root = parsed.data;
  const d = root.data;
  if (!d.prebookId) throw new ProviderError('rejected', 'prebook_missing_id', 'prebook returned no prebookId');
  if (d.hotelId && d.hotelId !== ref.hotelId) throw new ProviderError('rejected', 'prebook_hotel_mismatch', 'prebook returned a different hotel');
  const currency = d.currency ?? '';
  if (currency !== ref.currency) throw new ProviderError('rejected', 'prebook_currency_mismatch', 'prebook currency differs from the searched currency');
  const scale = ref.scale;
  const rates = allRates(d.roomTypes ?? []);
  const priced = pickTotal([toMinor(d.price, scale), toMinor(d.sellingPriceToUser, scale), sumRateTotals(rates, currency, scale)]);
  if (!priced) throw new ProviderError('rejected', 'prebook_unpriceable', 'prebook returned no exactly parseable price');
  const total = priced.minor;
  const merchantTotal = moneyOf(currency, total, scale);

  // Fees: included ones are already inside `total`; not-included ones are payable at the property.
  const includedLines: Array<{ label: string; money: Money; isTax: boolean }> = [];
  const payableLines: Array<{ label: string; money: Money }> = [];
  let unparsedPayable = 0;
  let includedSum = 0n;
  for (const rate of rates) {
    for (const fee of rate.retailRate?.taxesAndFees ?? []) {
      const label = clip(fee.description?.trim() || 'Taxes and fees', 80);
      const cur = fee.currency && /^[A-Z]{3}$/.test(fee.currency) ? fee.currency : null;
      const fs = cur ? currencyScale(cur) : scale;
      const m = cur ? toMinor(fee.amount, fs) : null;
      if (fee.included === false) {
        if (cur && m !== null) payableLines.push({ label, money: moneyOf(cur, m, fs) });
        else unparsedPayable++;
      } else if (cur === currency && m !== null && m > 0n) {
        includedLines.push({ label, money: moneyOf(cur, m, fs), isTax: /tax/i.test(label) });
        includedSum += m;
      }
    }
  }
  // Breakdown lines other than fee_payable_at_property must sum to merchantTotal. If the provider's
  // "included" fees exceed the total (inconsistent), list only the total rather than a non-summing split.
  const useIncluded = includedSum <= total;
  const itemMinor = useIncluded ? total - includedSum : total;
  const room = rates[0]?.name || 'Room';
  const breakdown: ProviderQuote['breakdown'] = [
    { kind: 'item', label: clip(`${room}, ${intent.checkin} to ${intent.checkout}`, 120), amount: moneyOf(currency, itemMinor, scale) },
    ...(useIncluded
      ? includedLines.map((l) => ({ kind: (l.isTax ? 'tax' : 'fee_included') as 'tax' | 'fee_included', label: l.label, amount: l.money }))
      : []),
    ...payableLines.map((l) => ({ kind: 'fee_payable_at_property' as const, label: l.label, amount: l.money })),
  ];

  const terms = rateTerms(rates[0]);
  if (payableLines.length || unparsedPayable) {
    const parts = payableLines.map((l) => `${l.label} ${formatMinor(l.money)}`);
    if (unparsedPayable) parts.push(`${unparsedPayable} further fee(s) with unparseable amounts`);
    terms.push(`Not included in the total and payable at the property: ${parts.join('; ')}`);
  }
  // Change flags vs the search result: surfaced, never fatal (the prebook price IS the quote).
  const pct = root.priceDifferencePercent ?? d.priceDifferencePercent;
  const pctNum = pct === undefined || pct === null ? 0 : Number(pct);
  if (Number.isFinite(pctNum) && pctNum !== 0) terms.push(`Provider reports the price changed by ${pctNum}% since search; this quote reflects the new price`);
  if (ref.searchTotalMinor !== undefined && BigInt(ref.searchTotalMinor) !== total) {
    terms.push(`Price differs from the search estimate of ${formatMinor(moneyOf(currency, BigInt(ref.searchTotalMinor), scale))}`);
  }
  if ((root.cancellationChanged ?? d.cancellationChanged) === true) terms.push('Cancellation terms changed since search; the terms above are current');
  if ((root.boardChanged ?? d.boardChanged) === true) terms.push('Board/meal plan changed since search; the terms above are current');
  if (priced.disagree) terms.push('Provider price components disagreed; the higher figure is quoted.');
  terms.push(SANDBOX_TERM);

  const nOcc = intent.occupancies.length;
  const guests = intent.occupancies.reduce((n, o) => n + o.adults + o.childrenAges.length, 0);
  const execRef: PrebookRef = { prebookId: d.prebookId, hotelId: ref.hotelId, expectedTotalMinor: total.toString(), currency, scale };
  return {
    title: ref.title ?? clip(`Hotel ${ref.hotelId} - ${room}`, 160),
    breakdown,
    merchantTotal,
    terms,
    // No traveller names here: this string reaches channels.
    fulfillmentSummary: `${guests} guest${guests === 1 ? '' : 's'} in ${nOcc} room${nOcc === 1 ? '' : 's'}, ${intent.checkin} to ${intent.checkout}`,
    executionRef: execRef,
  };
}
