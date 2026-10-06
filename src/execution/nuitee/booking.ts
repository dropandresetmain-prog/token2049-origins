import { createHash } from 'node:crypto';
import type { HotelFulfillment } from '../../contracts/intent.js';
import type { Money } from '../../contracts/money.js';
import { asArray, currencyScale, moneyOf, pickTotal, toMinor } from './money.js';
import { BookingData, BookingListResponse, BookingResponse } from './schemas.js';
import type { HttpOutcome } from './http.js';

/**
 * Deterministic provider client reference for an attempt. liteAPI requires `^[A-Z0-9_-]+$` (max 255)
 * and rejects duplicates with 4005, which makes it our provider-side idempotency key.
 * A hash of the raw key is always appended so two different keys can never sanitize to the same
 * reference (e.g. `a.b` vs `a-b`), which would turn a fresh attempt into a false "duplicate".
 */
export function clientReferenceFor(idempotencyKey: string): string {
  const safe = idempotencyKey.toUpperCase().replace(/[^A-Z0-9_-]/g, '-').slice(0, 80);
  const h = createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16).toUpperCase();
  return `T2O-${safe}-${h}`;
}

/** Request body for POST /rates/book. Contains PII: never log it or copy it into evidence. */
export function bookBody(f: HotelFulfillment, prebookId: string, clientReference: string): Record<string, unknown> {
  return {
    prebookId,
    clientReference,
    holder: { firstName: f.holder.firstName, lastName: f.holder.lastName, email: f.holder.email, phone: f.holder.phone },
    guests: f.guests.map((g) => ({ occupancyNumber: g.occupancyNumber, firstName: g.firstName, lastName: g.lastName, email: g.email })),
    // Per liteAPI docs: simulates the booking in sandbox without charging. No card data crosses this seam.
    payment: { method: 'ACC_CREDIT_CARD' },
  };
}

/* ---------------- failure classification ---------------- */

/** Provider codes meaning the booking was refused before anything was created. */
const DEFINITE_REJECTION = new Set([
  4012, // rate expired / room unavailable (HTTP 410)
  2001, // unavailable
  4040, // stale offer
  4000, // missing/unsupported payment method
  4002, // invalid/missing input
  4003, // invalid payment method
  4010, // rate validation failed
]);
/** Provider codes where a booking MAY exist. */
const AMBIGUOUS = new Set([
  4016, // timeout
  5000, // server-side processing failure
  2013, // booking not confirmed
  2014, // booking incomplete
  4011,
]);

export type BookFailure = 'definite' | 'duplicate' | 'unknown';

/**
 * Only an explicit provider refusal is definite. Unknown codes, 5xx, 408 and anything we cannot
 * parse stay `unknown` so exposure is retained and reconciled through readback.
 */
export function classifyBookFailure(o: Extract<HttpOutcome, { kind: 'provider_error' }>): BookFailure {
  if (o.code === 4005) return 'duplicate';
  if (o.code !== null && AMBIGUOUS.has(o.code)) return 'unknown';
  if (o.code !== null && DEFINITE_REJECTION.has(o.code)) return 'definite';
  if (o.code !== null) return 'unknown'; // an unrecognized provider code: do not assume nothing happened
  return [400, 401, 403, 404, 410, 422, 429].includes(o.status) ? 'definite' : 'unknown';
}

/* ---------------- booking parsing ---------------- */

/** liteAPI flags sandbox responses (root `sandbox: true`, retrieve `data.sandbox: 1`). */
export function sandboxFlag(root: unknown, data: unknown): boolean | undefined {
  const norm = (v: unknown): boolean | undefined => {
    if (v === true || v === 1 || v === '1' || v === 'true') return true;
    if (v === false || v === 0 || v === '0' || v === 'false') return false;
    return undefined;
  };
  const a = norm((root as { sandbox?: unknown } | null)?.sandbox);
  const d = norm((data as { sandbox?: unknown } | null)?.sandbox);
  // Conflicting evidence is treated as NOT sandbox: a real charge must never be labelled simulated.
  if (a === false || d === false) return false;
  return a ?? d;
}

export interface ParsedBooking {
  bookingId: string | null;
  clientReference: string | null;
  status: string | null;
  paymentStatus: string | null;
  hotelId: string | null;
  confirmationCode: string | null;
  sandbox: boolean | undefined;
  /** Exact charged total (provider-reported), if parseable. */
  price: Money | null;
  /** True when the provider's own price fields disagreed (higher was taken). */
  priceDisagrees: boolean;
}

/** Parse POST /rates/book or GET /bookings/{id} response bodies (same `data` shape). */
export function parseBooking(json: unknown, quotedUnit: { currency: string; scale: number }): ParsedBooking | null {
  const r = BookingResponse.safeParse(json);
  if (!r.success) return null;
  const d: BookingData = r.data.data;
  const currency = d.currency && /^[A-Z]{3}$/.test(d.currency) ? d.currency : null;
  const scale = currency ? (currency === quotedUnit.currency ? quotedUnit.scale : currencyScale(currency)) : 0;
  let price: Money | null = null;
  let priceDisagrees = false;
  if (currency) {
    // Candidates: the booking total, and the sum of booked room totals. Higher wins if they disagree.
    const roomSum = (() => {
      const rooms = d.bookedRooms ?? [];
      if (rooms.length === 0) return null;
      let sum = 0n;
      for (const room of rooms) {
        const totals = asArray(room.rate?.retailRate?.total);
        if (totals.length !== 1 || totals[0]!.currency !== currency) return null;
        const m = toMinor(totals[0]!.amount, scale);
        if (m === null) return null;
        sum += m;
      }
      return sum;
    })();
    const picked = pickTotal([toMinor(d.price, scale), roomSum]);
    if (picked) {
      price = moneyOf(currency, picked.minor, scale);
      priceDisagrees = picked.disagree;
    }
  }
  return {
    bookingId: d.bookingId ?? null,
    clientReference: d.clientReference ?? null,
    status: d.status ?? null,
    paymentStatus: d.paymentStatus ?? null,
    hotelId: d.hotelId ?? d.hotel?.hotelId ?? null,
    confirmationCode: d.hotelConfirmationCode ?? null,
    sandbox: sandboxFlag(r.data, d),
    price,
    priceDisagrees,
  };
}

/**
 * Bookings in a GET /bookings response whose clientReference EXACTLY equals ours. The filter
 * parameter is not in the public docs, so a server that ignores it returns other bookings; we
 * never trust the server-side filter and match client-side.
 */
export function bookingIdsForReference(json: unknown, clientReference: string): string[] {
  const r = BookingListResponse.safeParse(json);
  if (!r.success) return [];
  const ids = new Set<string>();
  for (const row of r.data.data) {
    const ref = row.clientReference ?? row.client_reference;
    // Only `bookingId` is the handle GET /bookings/{id} accepts; list rows also carry an internal `id`.
    const id = row.bookingId;
    if (ref === clientReference && id !== null && id !== undefined && String(id) !== '') ids.add(String(id));
  }
  return [...ids];
}
