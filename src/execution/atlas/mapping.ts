import { z } from 'zod';
import { IntegerString, money, parseDecimalToMinor, type Money } from '../../contracts/money.js';
import type { FlightFulfillment, FlightIntent } from '../../contracts/intent.js';
import type { ProviderOffer, ProviderQuote } from '../../contracts/ports.js';
import { ProviderError } from '../../core/errors.js';
import { Routing, type VerifyBody } from './wire.js';

/**
 * Pure mapping between Atlas wire values and core shapes. No I/O. Every amount is exact
 * (decimal string -> minor units); a value that needs more precision than the currency
 * allows is rejected, never rounded.
 */

export const MAX_OFFERS = 10;
export const OFFER_FALLBACK_TTL_MS = 20 * 60_000;
/** Conservative: Atlas documents no verify-session lifetime. */
export const QUOTE_TTL_MS = 10 * 60_000;

/* ---------------- refs held privately by the core ---------------- */

export const OfferRef = z.object({ routingIdentifier: z.string().min(1), currency: z.string().regex(/^[A-Z]{3}$/) }).strict();

export const QuoteRef = z
  .object({
    sessionId: z.string().min(1),
    routingIdentifier: z.string().min(1),
    /** Verified total incl. taxes and any pre-order transaction fee, minor units at `scale`. */
    expectedTotalMinor: IntegerString,
    currency: z.string().regex(/^[A-Z]{3}$/),
    scale: z.number().int().min(0).max(4),
    adults: z.number().int().min(1).max(4),
    /** Kept for create-outcome reconciliation (orderList matching); not PII. */
    from: z.string(),
    to: z.string(),
    departDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
export type QuoteRef = z.infer<typeof QuoteRef>;

export function parseRef<T>(schema: z.ZodType<T>, ref: Record<string, unknown>, what: string): T {
  const r = schema.safeParse(ref);
  if (!r.success) throw new ProviderError('not_sent', 'atlas_bad_execution_ref', `${what} execution reference is not valid`);
  return r.data;
}

/* ---------------- money ---------------- */

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF', 'XPF', 'PYG', 'RWF']);
const THREE_DECIMAL = new Set(['BHD', 'KWD', 'OMR', 'JOD', 'TND']);

/** ISO-4217 minor-unit exponent for the currencies Atlas can settle in. */
export function currencyScale(currency: string): number {
  if (ZERO_DECIMAL.has(currency)) return 0;
  if (THREE_DECIMAL.has(currency)) return 3;
  return 2;
}

type Amt = string | number | null | undefined;

/** Exact minor units; absent -> 0n. Precision loss is a provider data error. */
export function toMinor(v: Amt, scale: number): bigint {
  if (v === null || v === undefined || v === '') return 0n;
  try {
    return parseDecimalToMinor(v, scale);
  } catch {
    throw new ProviderError('rejected', 'atlas_amount_unparseable', 'provider amount is not exactly representable in the currency');
  }
}

export interface Fare {
  currency: string;
  scale: number;
  baseMinor: bigint;
  taxMinor: bigint;
  feeMinor: bigint;
  totalMinor: bigint;
}

/**
 * Total = (adultPrice + adultTax) * adults + transaction fee known before order creation.
 * Fee semantics (UNVERIFIED beyond the observed `0.0` / `PER_PAX`): in PER_PAX mode the fee is
 * charged per passenger, otherwise `transactionFee` is treated as one amount for the order.
 * If this assumption is wrong the order-creation total check in execute() stops the purchase
 * before any payment.
 */
export function computeFare(
  r: { currency: string; adultPrice?: Amt; adultTax?: Amt; transactionFee?: Amt; transactionFeeMode?: Amt; transactionFeePerPax?: Amt },
  adults: number,
  overrides?: { adultPrice: Amt; adultTax: Amt },
): Fare {
  const scale = currencyScale(r.currency);
  const n = BigInt(adults);
  const price = overrides?.adultPrice ?? r.adultPrice;
  const tax = overrides?.adultTax ?? r.adultTax;
  if (price === null || price === undefined) throw new ProviderError('rejected', 'atlas_no_price', 'provider returned no adult price');
  const baseMinor = toMinor(price, scale) * n;
  const taxMinor = toMinor(tax, scale) * n;
  const perPax = String(r.transactionFeeMode ?? '').toUpperCase() === 'PER_PAX';
  const feeMinor = perPax ? toMinor(r.transactionFeePerPax ?? r.transactionFee, scale) * n : toMinor(r.transactionFee, scale);
  return { currency: r.currency, scale, baseMinor, taxMinor, feeMinor, totalMinor: baseMinor + taxMinor + feeMinor };
}

/* ---------------- time ---------------- */

/** Atlas deadline `yyyy-MM-dd HH:mm:ss` is Singapore time (UTC+8, no DST). Fixed offset, host-zone independent. */
export function atlasSgtToIso(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+08:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** `YYYYMMDDHHmm` airport-local -> `YYYY-MM-DD HH:mm` (a label, not an instant). */
export function segmentLabel(t: string | null | undefined): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(t ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : 'time unavailable';
}

/* ---------------- search -> offers ---------------- */

function itinerary(r: Routing): { title: string; lines: string[] } {
  const segs = r.fromSegments ?? [];
  const first = segs[0];
  const last = segs[segs.length - 1];
  const title = first && last ? `${first.carrier ?? ''}${first.flightNumber ?? ''} ${first.depAirport ?? '?'} to ${last.arrAirport ?? '?'}`.trim() : 'Flight';
  const lines = segs.map(
    (s) => `${s.carrier ?? ''}${s.flightNumber ?? ''} ${s.depAirport ?? '?'} ${segmentLabel(s.depTime)} -> ${s.arrAirport ?? '?'} ${segmentLabel(s.arrTime)}`.trim(),
  );
  return { title, lines };
}

export function mapSearch(body: { routings?: unknown[] | null }, intent: FlightIntent, now: Date): ProviderOffer[] {
  const raw = body.routings ?? [];
  const rows: Array<{ offer: ProviderOffer; total: bigint }> = [];
  for (const item of raw) {
    const parsed = Routing.safeParse(item);
    if (!parsed.success) continue;
    const r = parsed.data;
    // One-way only; an itinerary with return segments is outside this intent.
    if ((r.retSegments ?? []).length > 0 || (r.fromSegments ?? []).length === 0) continue;
    let fare: Fare;
    try {
      // Indicative price is the adult fare + tax only; the transaction fee is resolved at verify.
      fare = computeFare({ currency: r.currency, adultPrice: r.adultPrice, adultTax: r.adultTax }, intent.adults);
    } catch {
      continue; // skip routings with absent/inexact prices rather than guess
    }
    const exp = r.expireTime ? Date.parse(r.expireTime) : NaN;
    // expireTime is a cache lifetime and can already be past in sandbox data; fall back then.
    const expiresAt = !Number.isNaN(exp) && exp > now.getTime() ? new Date(exp) : new Date(now.getTime() + OFFER_FALLBACK_TTL_MS);
    const it = itinerary(r);
    rows.push({
      total: fare.totalMinor,
      offer: {
        title: it.title,
        description: it.lines.join('; ') || 'Flight itinerary',
        indicativePrice: money(fare.currency, fare.totalMinor, fare.scale),
        terms: [
          'Indicative price from cached search; the exact price is confirmed at quote time.',
          `${intent.adults} adult traveller(s), one way; times are airport-local.`,
          ...(r.riskSellout ? ['Provider flags this fare as at risk of selling out.'] : []),
          'Atlas sandbox booking: test data, not a real ticket.',
        ],
        executionRef: { routingIdentifier: r.routingIdentifier, currency: r.currency },
        sourceObservedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    });
  }
  rows.sort((a, b) => (a.total < b.total ? -1 : a.total > b.total ? 1 : 0));
  return rows.slice(0, MAX_OFFERS).map((x) => x.offer);
}

/* ---------------- traveller requirements ---------------- */

/** Atlas requirement field -> predicate on a supplied passenger. Only presence is checked, never values. */
const PASSENGER_FIELD_SUPPLIED: Record<string, (p: FlightFulfillment['passengers'][number]) => boolean> = {
  name: () => true,
  gender: () => true,
  birthday: () => true,
  nationality: () => true,
  passengerType: () => true,
  cardNum: (p) => !!p.document,
  cardType: (p) => !!p.document,
  cardExpired: (p) => !!p.document,
  cardIssuePlace: (p) => !!p.document,
};
const CONTACT_FIELDS_SUPPLIED = new Set(['name', 'email', 'mobile', 'phone', 'telephone']);

/**
 * Names (never values) of fields the verified booking requirement marks required that this
 * fulfillment cannot supply. Unknown required fields count as missing: submitting would only
 * earn a provider rejection after the customer has funded.
 */
export function missingTravellerFields(req: VerifyBody['bookingRequirement'], f: FlightFulfillment): string[] {
  const missing: string[] = [];
  for (const [group, fields] of Object.entries(req ?? {})) {
    for (const [name, spec] of Object.entries(fields ?? {})) {
      if (spec?.required !== true) continue;
      if (group === 'passenger') {
        const ok = PASSENGER_FIELD_SUPPLIED[name];
        if (!ok || !f.passengers.every(ok)) missing.push(`passenger.${name}`);
      } else if (group === 'contact' && CONTACT_FIELDS_SUPPLIED.has(name)) {
        continue;
      } else {
        missing.push(`${group}.${name}`);
      }
    }
  }
  return missing;
}

/** Names that cannot be sent in Atlas wire format or exceed the verified length. Field names only. */
export function invalidTravellerFields(req: VerifyBody['bookingRequirement'], f: FlightFulfillment): string[] {
  const bad: string[] = [];
  // Wire format is Latin letters and spaces (prior sandbox integration). Hyphens/apostrophes unverified: refuse early.
  const wire = /^[A-Za-z][A-Za-z ]*$/;
  f.passengers.forEach((p, i) => {
    if (!wire.test(p.familyName) || !wire.test(p.givenName)) bad.push(`passengers[${i}].name`);
  });
  const ml = req?.passenger?.name?.maxLength;
  const m = typeof ml === 'string' ? /^(\d+)\/(\d+)$/.exec(ml) : null;
  if (m) {
    const [fam, giv] = [Number(m[1]), Number(m[2])];
    f.passengers.forEach((p, i) => {
      if (p.familyName.length > fam || p.givenName.length > giv) bad.push(`passengers[${i}].name.length`);
    });
  }
  return bad;
}

/* ---------------- verify -> quote ---------------- */

export function mapVerify(body: VerifyBody, intent: FlightIntent, fulfillment: FlightFulfillment, now: Date): ProviderQuote {
  const sessionId = body.sessionId;
  const routing = body.routing;
  if (!sessionId || !routing) throw new ProviderError('rejected', 'atlas_verify_incomplete', 'verification returned no session or routing');

  const missing = missingTravellerFields(body.bookingRequirement, fulfillment);
  if (missing.length > 0) {
    throw new ProviderError('rejected', 'atlas_traveller_data_required', `provider requires traveller fields not supplied: ${missing.join(', ')}`);
  }
  const invalid = invalidTravellerFields(body.bookingRequirement, fulfillment);
  if (invalid.length > 0) {
    throw new ProviderError('rejected', 'atlas_traveller_data_invalid', `traveller fields cannot be sent to the provider: ${invalid.join(', ')}`);
  }
  if (fulfillment.passengers.length !== intent.adults) {
    throw new ProviderError('rejected', 'atlas_passenger_count_mismatch', 'traveller count does not match the search');
  }

  // A reported price change carries the verified price; otherwise the re-verified routing does.
  const pc = body.priceChange;
  const changed = pc?.isPriceChange === true && pc.newAdultPrice != null;
  const fare = computeFare(routing, intent.adults, changed ? { adultPrice: pc!.newAdultPrice, adultTax: pc!.newAdultTax ?? routing.adultTax } : undefined);

  const it = itinerary(routing);
  const m = (v: bigint): Money => money(fare.currency, v, fare.scale);
  const breakdown: ProviderQuote['breakdown'] = [
    { kind: 'item', label: `Fare, ${intent.adults} adult(s)`, amount: m(fare.baseMinor) },
    { kind: 'tax', label: 'Taxes and airport charges', amount: m(fare.taxMinor) },
  ];
  if (fare.feeMinor > 0n) breakdown.push({ kind: 'fee_included', label: 'Provider transaction fee', amount: m(fare.feeMinor) });

  const ref: QuoteRef = {
    sessionId,
    routingIdentifier: routing.routingIdentifier,
    expectedTotalMinor: fare.totalMinor.toString(),
    currency: fare.currency,
    scale: fare.scale,
    adults: intent.adults,
    from: intent.from,
    to: intent.to,
    departDate: intent.departDate,
  };
  return {
    title: it.title,
    breakdown,
    merchantTotal: m(fare.totalMinor),
    terms: [
      ...(changed ? ['The fare changed on verification; this quote reflects the verified price.'] : []),
      ...(body.maxSeats != null ? [`Provider reports up to ${body.maxSeats} seat(s) available at this fare.`] : []),
      'Booking creates a held order first; payment and ticketing are separate provider steps.',
      'Unpaid holds lapse at the provider ticketing deadline.',
      'Atlas sandbox booking: test data, not a real ticket.',
    ],
    fulfillmentSummary: `${fulfillment.passengers.length} adult traveller(s), ${intent.from} to ${intent.to} on ${intent.departDate}`,
    executionRef: ref,
    expiresAt: new Date(now.getTime() + QUOTE_TTL_MS).toISOString(),
  };
}
