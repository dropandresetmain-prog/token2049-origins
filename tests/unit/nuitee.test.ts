/**
 * Offline tests for the Nuitee (liteAPI) executor. A fake fetch plays the provider with synthetic
 * data shaped like the recorded sandbox responses (no real identifiers, no PII).
 */
import { describe, expect, it, vi } from 'vitest';
import { PurchaseIntent, HotelFulfillment } from '../../src/contracts/intent.js';
import type { ExecutionContext, ExecutionResult } from '../../src/contracts/ports.js';
import { money, parseDecimalToMinor } from '../../src/contracts/money.js';
import { ProviderError } from '../../src/core/errors.js';
import { ManualClock } from '../../src/infrastructure/clock.js';
import { redact } from '../../src/infrastructure/redact.js';
import { createNuiteeExecutor } from '../../src/execution/nuitee/index.js';
import { clientReferenceFor } from '../../src/execution/nuitee/booking.js';
import { validateBaseUrl } from '../../src/execution/nuitee/config.js';
import { pickTotal, sumRateTotals, toMinor } from '../../src/execution/nuitee/money.js';

/* ---------------- test harness ---------------- */

const KEY = 'sand_testkey_0123456789abcdef';
const ENV = { NUITEE_API_KEY: KEY } as NodeJS.ProcessEnv;
const SEARCH = 'https://api.liteapi.travel/v3.0';
const BOOK = 'https://book.liteapi.travel/v3.0';

// Synthetic traveller data; the tests assert none of it ever appears in results or checkpoints.
const PII = ['Zaphod', 'Beeblebrox', 'Trillian', 'zaphod@example.org', 'trillian@example.org', '+6591230000'];

interface Req {
  method: string;
  url: URL;
  body: any;
  headers: Record<string, string>;
  redirect: string | undefined;
}
type Reply = { status?: number; json?: unknown; text?: string } | 'timeout' | 'network';
type Handler = (r: Req) => Reply;

function fakeFetch(handler: Handler) {
  const calls: Req[] = [];
  const impl = (async (input: any, init: any = {}) => {
    const req: Req = {
      method: init.method ?? 'GET',
      url: new URL(String(input)),
      body: init.body ? JSON.parse(init.body) : undefined,
      headers: init.headers ?? {},
      redirect: init.redirect,
    };
    calls.push(req);
    const r = handler(req);
    if (r === 'timeout') throw new DOMException('timed out', 'TimeoutError');
    if (r === 'network') throw new TypeError('fetch failed');
    const text = r.text ?? JSON.stringify(r.json ?? {});
    return new Response(text, { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const clock = () => new ManualClock();

const intent = (over: Record<string, unknown> = {}) =>
  PurchaseIntent.parse({
    category: 'hotel',
    spendCeiling: money('USD', 100000),
    destination: { cityName: 'Singapore', countryCode: 'SG' },
    checkin: '2026-12-01',
    checkout: '2026-12-03',
    occupancies: [{ adults: 2 }],
    guestNationality: 'SG',
    ...over,
  }) as import('../../src/contracts/intent.js').HotelIntent;

const fulfillment = (rooms = 1) =>
  HotelFulfillment.parse({
    category: 'hotel',
    holder: { firstName: 'Zaphod', lastName: 'Beeblebrox', email: 'zaphod@example.org', phone: '+6591230000' },
    guests: Array.from({ length: rooms }, (_, i) => ({
      occupancyNumber: i + 1,
      firstName: i === 0 ? 'Zaphod' : 'Trillian',
      lastName: 'Beeblebrox',
      email: i === 0 ? 'zaphod@example.org' : 'trillian@example.org',
    })),
  });

const total = (amount: number | string, currency = 'USD') => [{ amount, currency }];
const rate = (amount: number | string, extra: Record<string, unknown> = {}) => ({
  name: 'Deluxe Plus',
  boardName: 'Room Only',
  retailRate: { total: total(amount), taxesAndFees: [{ included: true, description: 'Sales tax', amount: 46.39, currency: 'USD' }] },
  cancellationPolicies: { cancelPolicyInfos: [], refundableTag: 'NRFN' },
  ...extra,
});
const roomType = (offerId: string, rates: unknown[], offerRetailRate?: unknown) => ({ offerId, rates, ...(offerRetailRate ? { offerRetailRate } : {}) });

const prebookJson = (over: Record<string, unknown> = {}, rates: unknown[] = [rate(541.83)]) => ({
  data: {
    prebookId: 'PB123',
    hotelId: 'lp1',
    currency: 'USD',
    price: 541.83,
    roomTypes: [{ rates }],
    priceDifferencePercent: 0,
    cancellationChanged: false,
    boardChanged: false,
    ...over,
  },
  sandbox: true,
});

const bookingData = (over: Record<string, unknown> = {}) => ({
  bookingId: 'BK1',
  clientReference: clientReferenceFor('att_01HXYZ.abc'),
  status: 'CONFIRMED',
  paymentStatus: 'succeeded',
  hotelConfirmationCode: 'HCONF',
  hotelId: 'lp1',
  price: 541.83,
  currency: 'USD',
  sandbox: 1,
  ...over,
});

/** In-memory checkpoint store + ordered event log shared with the fake provider. */
function makeCtx(over: { checkpoints?: Record<string, Record<string, unknown>>; total?: number; log?: string[]; failCheckpoint?: string } = {}) {
  const log = over.log ?? [];
  const persisted: Array<[string, Record<string, unknown>]> = [];
  const ctx: ExecutionContext = {
    purchaseId: 'pur_1',
    attemptId: 'att_1',
    idempotencyKey: 'att_01HXYZ.abc',
    quote: {
      quoteId: 'quo_1',
      merchantTotal: money('USD', over.total ?? 54183),
      executionRef: { prebookId: 'PB123', hotelId: 'lp1', expectedTotalMinor: String(over.total ?? 54183), currency: 'USD', scale: 2 },
      expiresAt: '2026-10-06T12:10:00.000Z',
    },
    fulfillment: fulfillment(),
    checkpoints: over.checkpoints ?? {},
    checkpoint: async (step, data) => {
      if (over.failCheckpoint === step) throw new Error('db down');
      log.push(`checkpoint:${step}`);
      persisted.push([step, data]);
      ctx.checkpoints[step] = data;
    },
  };
  return { ctx, log, persisted };
}

/** A well-behaved provider: book creates a booking; GET returns it. */
function provider(opts: { log?: string[]; book?: (r: Req) => Reply; get?: (r: Req) => Reply; list?: (r: Req) => Reply } = {}) {
  const log = opts.log ?? [];
  let ref = clientReferenceFor('att_01HXYZ.abc'); // what a prior POST would have registered
  return fakeFetch((r) => {
    const p = r.url.pathname;
    if (r.method === 'POST' && p.endsWith('/rates/book')) {
      log.push('POST book');
      ref = r.body.clientReference;
      return opts.book ? opts.book(r) : { json: { data: bookingData({ clientReference: ref }), sandbox: true } };
    }
    if (r.method === 'GET' && p.endsWith('/bookings')) {
      log.push('GET list');
      return opts.list ? opts.list(r) : { json: { data: [{ bookingId: 'BK1', clientReference: ref }] } };
    }
    if (r.method === 'GET' && p.includes('/bookings/')) {
      log.push('GET booking');
      return opts.get ? opts.get(r) : { json: { data: bookingData({ clientReference: ref }), sandbox: true } };
    }
    return { status: 404, json: { error: { code: 1, message: 'nope' } } };
  });
}

function mk(f: ReturnType<typeof fakeFetch>, env = ENV) {
  return createNuiteeExecutor(env, { fetchImpl: f.impl, clock: clock() });
}

const noPii = (v: unknown) => {
  const s = JSON.stringify(v);
  for (const p of PII) expect(s).not.toContain(p);
  expect(s).not.toContain(KEY);
};

/* ---------------- exact money ---------------- */

describe('nuitee money parsing', () => {
  it('parses number and string amounts exactly, never via float arithmetic', () => {
    expect(toMinor(541.83, 2)).toBe(54183n);
    expect(toMinor('541.83', 2)).toBe(54183n);
    expect(toMinor(0.1, 2)).toBe(10n);
    expect(toMinor('1012.5', 2)).toBe(101250n);
    expect(parseDecimalToMinor(541.83, 2)).toBe(54183n);
  });

  it('rejects values needing more precision than the currency scale, negatives and non-numbers', () => {
    expect(toMinor(10.001, 2)).toBeNull();
    expect(toMinor(-1, 2)).toBeNull();
    expect(toMinor('', 2)).toBeNull();
    expect(toMinor(null, 2)).toBeNull();
    expect(toMinor('abc', 2)).toBeNull();
  });

  it('sums multi-room totals exactly with mixed string/number amounts', () => {
    // 0.1 + 0.2 style trap: a float sum would be 0.30000000000000004
    const rates = [{ retailRate: { total: total(0.1) } }, { retailRate: { total: total('0.20') } }, { retailRate: { total: total(541.83) } }];
    expect(sumRateTotals(rates, 'USD', 2)).toBe(10n + 20n + 54183n);
  });

  it('refuses to price a rate with several totals or a foreign currency', () => {
    expect(sumRateTotals([{ retailRate: { total: [...total(1), ...total(2)] } }], 'USD', 2)).toBeNull();
    expect(sumRateTotals([{ retailRate: { total: total(1, 'EUR') } }], 'USD', 2)).toBeNull();
  });

  it('takes the higher of disagreeing provider totals', () => {
    expect(pickTotal([100n, 120n, null])).toEqual({ minor: 120n, disagree: true });
    expect(pickTotal([100n, 100n])).toEqual({ minor: 100n, disagree: false });
    expect(pickTotal([null])).toBeNull();
  });
});

describe('nuitee config', () => {
  it('only accepts https liteapi.travel hosts', () => {
    expect(validateBaseUrl('X', 'https://api.liteapi.travel/v3.0/')).toBe('https://api.liteapi.travel/v3.0');
    expect(() => validateBaseUrl('X', 'http://api.liteapi.travel/v3.0')).toThrow();
    expect(() => validateBaseUrl('X', 'https://evil.example.com/v3.0')).toThrow();
    expect(() => validateBaseUrl('X', 'https://liteapi.travel.evil.com')).toThrow();
    expect(() => validateBaseUrl('X', 'https://user:pw@api.liteapi.travel')).toThrow();
  });
});

describe('nuitee clientReference', () => {
  it('is deterministic, uses the allowed charset and distinguishes keys that sanitize alike', () => {
    const a = clientReferenceFor('att_1.x');
    expect(a).toBe(clientReferenceFor('att_1.x'));
    expect(a).toMatch(/^[A-Z0-9_-]+$/);
    expect(a.length).toBeLessThanOrEqual(255);
    expect(clientReferenceFor('att_1-x')).not.toBe(a);
    expect(clientReferenceFor('x'.repeat(1000)).length).toBeLessThanOrEqual(255);
  });
});

/* ---------------- search ---------------- */

describe('nuitee search', () => {
  const searchJson = () => ({
    hotels: Array.from({ length: 14 }, (_, i) => ({ id: `lp${i}`, name: `Hotel ${i}` })),
    data: Array.from({ length: 14 }, (_, i) => ({
      hotelId: `lp${i}`,
      roomTypes: [
        // The pricier room type must lose to the cheaper one for the same hotel.
        roomType(`OFFER-${i}-B`, [rate(900 + i)]),
        roomType(`OFFER-${i}-A`, [rate(500 + i * 10 + 0.05)], { amount: 500 + i * 10 + 0.05, currency: 'USD' }),
      ],
    })),
  });

  it('returns at most 10 offers, cheapest rate per hotel, cheapest hotels first, with exact prices and refs', async () => {
    const f = fakeFetch(() => ({ json: searchJson() }));
    const offers = await mk(f).search(intent());
    expect(offers).toHaveLength(10);
    expect(offers[0]!.indicativePrice).toEqual({ currency: 'USD', amountMinor: '50005', scale: 2 });
    expect(offers[1]!.indicativePrice.amountMinor).toBe('51005');
    expect(offers[0]!.executionRef).toMatchObject({ offerId: 'OFFER-0-A', hotelId: 'lp0', currency: 'USD', scale: 2 });
    expect(offers.map((o) => BigInt(o.indicativePrice.amountMinor))).toEqual([...offers.map((o) => BigInt(o.indicativePrice.amountMinor))].sort((a, b) => (a < b ? -1 : 1)));
    expect(offers[0]!.terms.join('\n')).toMatch(/Non-refundable/);
    expect(offers[0]!.terms.join('\n')).toMatch(/Room Only/);
    expect(Date.parse(offers[0]!.expiresAt) - Date.parse(offers[0]!.sourceObservedAt)).toBe(20 * 60_000);
  });

  it('calls the search host with the key header, no redirects and the intent currency', async () => {
    const f = fakeFetch(() => ({ json: { data: [], hotels: [] } }));
    await mk(f).search(intent({ spendCeiling: money('EUR', 5000), occupancies: [{ adults: 2, childrenAges: [4, 9] }, { adults: 1 }] }));
    const r = f.calls[0]!;
    expect(r.url.href).toBe(`${SEARCH}/hotels/rates`);
    expect(r.method).toBe('POST');
    expect(r.headers['X-API-Key']).toBe(KEY);
    expect(r.redirect).toBe('error');
    expect(r.body).toMatchObject({
      checkin: '2026-12-01',
      checkout: '2026-12-03',
      currency: 'EUR',
      guestNationality: 'SG',
      cityName: 'Singapore',
      countryCode: 'SG',
      occupancies: [{ adults: 2, children: [4, 9] }, { adults: 1 }],
      includeHotelData: true,
    });
  });

  it('maps coordinate and hotelId destinations', async () => {
    const f = fakeFetch(() => ({ json: { data: [] } }));
    const ex = mk(f);
    await ex.search(intent({ destination: { latitude: 1.28, longitude: 103.86, radiusM: 5000 } }));
    await ex.search(intent({ destination: { hotelIds: ['lp1'] } }));
    expect(f.calls[0]!.body).toMatchObject({ latitude: 1.28, longitude: 103.86, radius: 5000 });
    expect(f.calls[1]!.body.hotelIds).toEqual(['lp1']);
  });

  it('omits offers that cannot be priced exactly in the requested currency', async () => {
    const f = fakeFetch(() => ({
      json: {
        data: [
          { hotelId: 'lp1', roomTypes: [roomType('O1', [{ ...rate(1), retailRate: { total: total(100, 'EUR') } }])] },
          { hotelId: 'lp2', roomTypes: [roomType('O2', [{ ...rate(1), retailRate: { total: total(10.001) } }])] },
          { hotelId: 'lp3', roomTypes: [roomType('O3', [rate('120.00')])] },
        ],
      },
    }));
    const offers = await mk(f).search(intent());
    expect(offers.map((o) => (o.executionRef as any).offerId)).toEqual(['O3']);
    expect(offers[0]!.indicativePrice.amountMinor).toBe('12000');
  });

  it('prices multi-room offers as the exact sum of room totals and surfaces provider disagreement', async () => {
    const f = fakeFetch(() => ({
      json: { data: [{ hotelId: 'lp1', roomTypes: [roomType('O1', [rate(100.1), rate('200.2')], { amount: 300.0, currency: 'USD' })] }] },
    }));
    const [o] = await mk(f).search(intent({ occupancies: [{ adults: 1 }, { adults: 1 }] }));
    expect(o!.indicativePrice.amountMinor).toBe('30030'); // higher of 30000 (offer) and 30030 (sum)
    expect(o!.terms.join('\n')).toMatch(/disagreed/);
  });

  it('treats 2001 as no availability, other errors as ProviderError', async () => {
    const none = fakeFetch(() => ({ status: 400, json: { error: { code: 2001, message: 'x' } } }));
    expect(await mk(none).search(intent())).toEqual([]);
    const bad = fakeFetch(() => ({ status: 401, json: { error: { code: 1000, message: 'x' } } }));
    await expect(mk(bad).search(intent())).rejects.toBeInstanceOf(ProviderError);
    const down = fakeFetch(() => 'timeout');
    await expect(mk(down).search(intent())).rejects.toMatchObject({ outcome: 'unknown' });
  });

  it('is not sent for non-hotel intents and when unconfigured', async () => {
    const f = fakeFetch(() => ({ json: {} }));
    await expect(mk(f).search(PurchaseIntent.parse({ category: 'flight', spendCeiling: money('USD', 100), from: 'SIN', to: 'HKG', departDate: '2026-12-01', adults: 1 }))).rejects.toMatchObject({ outcome: 'not_sent' });
    await expect(mk(f, {} as NodeJS.ProcessEnv).search(intent())).rejects.toMatchObject({ outcome: 'not_sent' });
    expect(f.calls).toHaveLength(0);
  });
});

/* ---------------- quote ---------------- */

describe('nuitee quote (prebook)', () => {
  const offerRef = { offerId: 'OFFER-1', hotelId: 'lp1', currency: 'USD', scale: 2, searchTotalMinor: '54183', title: 'Hotel One - Deluxe Plus' };
  const quote = (json: unknown, f = fakeFetch(() => ({ json })), fl = fulfillment()) =>
    mk(f).quote({ executionRef: offerRef, intent: intent() }, fl).then((q) => ({ q, f }));

  it('prebooks on the booking host and returns the exact prebook price with included taxes split out', async () => {
    const { q, f } = await quote(prebookJson());
    expect(f.calls[0]!.url.href).toBe(`${BOOK}/rates/prebook`);
    expect(f.calls[0]!.body).toEqual({ offerId: 'OFFER-1', usePaymentSdk: false });
    expect(q.merchantTotal).toEqual({ currency: 'USD', amountMinor: '54183', scale: 2 });
    expect(q.executionRef).toEqual({ prebookId: 'PB123', hotelId: 'lp1', expectedTotalMinor: '54183', currency: 'USD', scale: 2 });
    expect(q.title).toBe('Hotel One - Deluxe Plus');
    // Non-payable lines sum to merchantTotal: item + included tax.
    const sum = q.breakdown.filter((l) => l.kind !== 'fee_payable_at_property').reduce((n, l) => n + BigInt(l.amount.amountMinor), 0n);
    expect(sum).toBe(54183n);
    expect(q.breakdown.find((l) => l.kind === 'tax')!.amount.amountMinor).toBe('4639');
    expect(Date.parse(q.expiresAt) - new ManualClock().now().getTime()).toBe(10 * 60_000);
    noPii(q);
  });

  it('keeps fees with included:false out of merchantTotal and says they are payable at the property', async () => {
    const withFee = rate(541.83, {
      retailRate: {
        total: total(541.83),
        taxesAndFees: [
          { included: true, description: 'Sales tax', amount: 46.39, currency: 'USD' },
          { included: false, description: 'Resort fee', amount: '25.50', currency: 'SGD' },
        ],
      },
    });
    const { q } = await quote(prebookJson({}, [withFee]));
    expect(q.merchantTotal.amountMinor).toBe('54183');
    const fee = q.breakdown.find((l) => l.kind === 'fee_payable_at_property')!;
    expect(fee.amount).toEqual({ currency: 'SGD', amountMinor: '2550', scale: 2 });
    expect(fee.label).toBe('Resort fee');
    expect(q.terms.join('\n')).toMatch(/payable at the property: Resort fee 25\.50 SGD/);
  });

  it('sums multi-room prebook totals when no price field is given', async () => {
    const { q } = await quote(prebookJson({ price: undefined }, [rate(100.1), rate('200.2')]));
    expect(q.merchantTotal.amountMinor).toBe('30030');
  });

  it('surfaces price/cancellation/board change flags and search drift in terms without failing', async () => {
    const { q } = await quote(prebookJson({ price: 560.5, priceDifferencePercent: 3.4, cancellationChanged: true, boardChanged: true }, [rate(560.5)]));
    expect(q.merchantTotal.amountMinor).toBe('56050');
    const t = q.terms.join('\n');
    expect(t).toMatch(/changed by 3\.4%/);
    expect(t).toMatch(/Cancellation terms changed/);
    expect(t).toMatch(/Board\/meal plan changed/);
    expect(t).toMatch(/differs from the search estimate of 541\.83 USD/);
  });

  it('rejects hotel/currency mismatches and unpriceable prebooks', async () => {
    await expect(quote(prebookJson({ currency: 'EUR' }))).rejects.toMatchObject({ providerCode: 'prebook_currency_mismatch' });
    await expect(quote(prebookJson({ hotelId: 'other' }))).rejects.toMatchObject({ providerCode: 'prebook_hotel_mismatch' });
    await expect(quote(prebookJson({ price: 'n/a', roomTypes: [] }))).rejects.toMatchObject({ providerCode: 'prebook_unpriceable' });
    await expect(quote({ data: {} })).rejects.toBeInstanceOf(ProviderError);
  });

  it('maps stale-offer errors to a rejection and timeouts to unknown', async () => {
    const stale = fakeFetch(() => ({ status: 408, json: { error: { code: 4040, message: 'x' } } }));
    await expect(quote(null, stale)).rejects.toMatchObject({ providerCode: '4040' });
    const t = fakeFetch(() => 'timeout');
    await expect(quote(null, t)).rejects.toMatchObject({ outcome: 'unknown' });
  });

  it('validates travellers before calling the provider', async () => {
    const f = fakeFetch(() => ({ json: prebookJson() }));
    await expect(mk(f).quote({ executionRef: offerRef, intent: intent({ occupancies: [{ adults: 1 }, { adults: 1 }] }) }, fulfillment(1))).rejects.toMatchObject({ providerCode: 'invalid_fulfillment' });
    await expect(mk(f).quote({ executionRef: offerRef, intent: intent() }, fulfillment(2))).rejects.toMatchObject({ providerCode: 'invalid_fulfillment' });
    await expect(mk(f).quote({ executionRef: { nope: 1 }, intent: intent() }, fulfillment())).rejects.toMatchObject({ providerCode: 'invalid_execution_ref' });
    expect(f.calls).toHaveLength(0);
  });
});

/* ---------------- execute ---------------- */

describe('nuitee execute', () => {
  const run = async (f = provider(), c = makeCtx(), env = ENV) => {
    const r = await mk(f, env).execute(c.ctx);
    return { r, f, ...c };
  };

  it('checkpoints book_attempt BEFORE the book request, then the booking, then reads back and succeeds', async () => {
    const log: string[] = [];
    const { r, f, persisted } = await run(provider({ log }), makeCtx({ log }));
    expect(log).toEqual(['checkpoint:book_attempt', 'POST book', 'checkpoint:booking', 'GET booking']);
    expect(r).toMatchObject({
      kind: 'succeeded',
      providerReference: 'BK1',
      commerceStatus: 'confirmed',
      merchantPaymentStatus: 'simulated_paid',
      chargedAmount: { currency: 'USD', amountMinor: '54183', scale: 2 },
    });
    const book = f.calls.find((c) => c.method === 'POST')!;
    expect(book.url.href).toBe(`${BOOK}/rates/book`);
    expect(book.body.prebookId).toBe('PB123');
    expect(book.body.payment).toEqual({ method: 'ACC_CREDIT_CARD' });
    expect(book.body.clientReference).toMatch(/^[A-Z0-9_-]+$/);
    expect(book.body.holder.email).toBe('zaphod@example.org'); // PII goes to the provider only
    expect(persisted[0]).toEqual(['book_attempt', { clientReference: book.body.clientReference }]);
    expect(persisted[1]![1]).toMatchObject({ providerReference: 'BK1' });
    expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    noPii([r, persisted]);
  });

  it('derives the same clientReference on every call for one idempotency key', async () => {
    const a = await run();
    const b = await run();
    expect(a.persisted[0]![1]).toEqual(b.persisted[0]![1]);
    expect(a.persisted[0]![1].clientReference).toBe(clientReferenceFor('att_01HXYZ.abc'));
  });

  it('reports the ACTUAL price when it differs from the quote (core flags over-charges)', async () => {
    const f = provider({ book: (r) => ({ json: { data: bookingData({ clientReference: r.body.clientReference, price: 560.5 }), sandbox: true } }), get: () => ({ json: { data: bookingData({ price: '560.50' }), sandbox: true } }) });
    const { r } = await run(f);
    expect(r).toMatchObject({ kind: 'succeeded', chargedAmount: { amountMinor: '56050' } });
    expect((r as any).evidence[0].details.priceDiffersFromQuote).toBe(true);
  });

  it('uses the higher price if book response and readback disagree', async () => {
    const f = provider({ get: () => ({ json: { data: bookingData({ price: 541.0 }), sandbox: true } }) });
    const { r } = await run(f);
    expect(r).toMatchObject({ kind: 'succeeded', chargedAmount: { amountMinor: '54183' } });
  });

  it('does not call a booking succeeded unless readback shows CONFIRMED + succeeded + sandbox', async () => {
    // [name, data overrides, root sandbox flag]
    const cases: Array<[string, Record<string, unknown>, unknown]> = [
      ['pending status', { status: 'PENDING' }, true],
      ['payment not succeeded', { paymentStatus: 'requires_capture' }, true],
      ['non-sandbox booking (data flag)', { sandbox: 0 }, true],
      ['non-sandbox booking (root flag)', { sandbox: 1 }, false],
      ['missing sandbox flag', { sandbox: undefined }, undefined],
      ['wrong hotel', { hotelId: 'other' }, true],
      ['wrong reference', { clientReference: 'SOMEONE-ELSE' }, true],
      ['wrong booking id', { bookingId: 'BK-OTHER' }, true],
      ['cancelled with charges', { status: 'CANCELLED_WITH_CHARGES' }, true],
    ];
    for (const [name, over, rootSandbox] of cases) {
      const f = provider({ get: () => ({ json: { data: bookingData(over), ...(rootSandbox === undefined ? {} : { sandbox: rootSandbox }) } }) });
      const { r } = await run(f);
      expect(r.kind, name).toBe('unknown');
      expect((r as any).providerReference, name).toBe('BK1');
    }
  });

  it('uses the book-response price if the readback omits it, but is unknown if neither has a price', async () => {
    const onlyBook = provider({ get: () => ({ json: { data: bookingData({ price: undefined }), sandbox: true } }) });
    expect((await run(onlyBook)).r).toMatchObject({ kind: 'succeeded', chargedAmount: { amountMinor: '54183' } });
    const neither = provider({
      book: (r) => ({ json: { data: bookingData({ clientReference: r.body.clientReference, price: undefined }), sandbox: true } }),
      get: () => ({ json: { data: bookingData({ price: undefined }), sandbox: true } }),
    });
    expect((await run(neither)).r).toMatchObject({ kind: 'unknown', providerReference: 'BK1' });
  });

  it('timeout / network / 5000 / 5xx on book are unknown, keep no booking reference and never retry', async () => {
    for (const reply of ['timeout', 'network', { status: 500, json: { error: { code: 5000, message: 'x' } } }, { status: 502, text: '<html>bad gateway</html>' }] as Reply[]) {
      const f = provider({ book: () => reply });
      const { r } = await run(f);
      expect(r.kind).toBe('unknown');
      expect((r as any).providerReference).toBeNull();
      expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    }
  });

  it('treats 4012 / 2001 / 4040 / validation refusals as failed_definite', async () => {
    for (const [status, code] of [[410, 4012], [400, 2001], [400, 4040], [400, 4002]] as const) {
      const f = provider({ book: () => ({ status, json: { error: { code, message: 'Rate expired for Zaphod' } } }) });
      const { r } = await run(f);
      expect(r.kind, String(code)).toBe('failed_definite');
      expect((r as any).reason).toContain(String(code));
      noPii(r); // provider message text (which could echo input) is never copied
    }
  });

  it('keeps unrecognized provider codes ambiguous', async () => {
    const f = provider({ book: () => ({ status: 400, json: { error: { code: 4999, message: 'x' } } }) });
    expect((await run(f)).r.kind).toBe('unknown');
  });

  it('4005 duplicate: reconciles by clientReference and succeeds via readback', async () => {
    const log: string[] = [];
    const f = provider({ log, book: () => ({ status: 409, json: { error: { code: 4005, message: 'dup' } } }) });
    const { r } = await run(f, makeCtx({ log }));
    expect(r).toMatchObject({ kind: 'succeeded', providerReference: 'BK1' });
    expect(log).toEqual(['checkpoint:book_attempt', 'POST book', 'GET list', 'checkpoint:booking', 'GET booking']);
    const list = f.calls.find((c) => c.url.pathname.endsWith('/bookings') && c.method === 'GET')!;
    expect(list.url.searchParams.get('clientReference')).toBe(clientReferenceFor('att_01HXYZ.abc'));
  });

  it('4005 with no matching booking found stays unknown', async () => {
    const f = provider({ book: () => ({ status: 409, json: { error: { code: 4005, message: 'dup' } } }), list: () => ({ json: { data: [] } }) });
    const { r } = await run(f);
    expect(r.kind).toBe('unknown');
    expect((r as any).reason).toMatch(/duplicate client reference/);
  });

  it('matches the clientReference client-side when the server ignores the filter', async () => {
    const f = provider({
      book: () => ({ status: 409, json: { error: { code: 4005, message: 'dup' } } }),
      list: (r) => ({ json: { data: [{ bookingId: 'OTHER', client_reference: 'NOT-OURS' }, { bookingId: 'BK1', client_reference: clientReferenceFor('att_01HXYZ.abc') }] } }),
    });
    const { r } = await run(f);
    expect(r).toMatchObject({ kind: 'succeeded', providerReference: 'BK1' });
  });

  it('book 2xx without a booking id reconciles instead of guessing', async () => {
    const f = provider({ book: () => ({ json: { data: { status: 'CONFIRMED' } } }) });
    const { r } = await run(f);
    expect(r).toMatchObject({ kind: 'succeeded' }); // found via list + readback
    const none = provider({ book: () => ({ json: { data: {} } }), list: () => ({ json: { data: [] } }) });
    expect((await run(none)).r.kind).toBe('unknown');
  });

  it('readback failure after a created booking is unknown but carries the booking reference', async () => {
    const f = provider({ get: () => 'timeout' });
    const { r } = await run(f);
    expect(r).toMatchObject({ kind: 'unknown', providerReference: 'BK1' });
  });

  it('never sends the book request if book_attempt cannot be persisted', async () => {
    const f = provider();
    const { r } = await run(f, makeCtx({ failCheckpoint: 'book_attempt' }));
    expect(r.kind).toBe('failed_definite');
    expect(f.calls).toHaveLength(0);
  });

  it('a failing booking checkpoint is unknown with the booking reference (no readback claim)', async () => {
    const { r } = await run(provider(), makeCtx({ failCheckpoint: 'booking' }));
    expect(r).toMatchObject({ kind: 'unknown', providerReference: 'BK1' });
  });

  it('resume: never re-sends book when a book_attempt or booking checkpoint already exists', async () => {
    const ref = clientReferenceFor('att_01HXYZ.abc');
    const attempted = provider();
    const a = await run(attempted, makeCtx({ checkpoints: { book_attempt: { clientReference: ref } } }));
    expect(a.r.kind).toBe('succeeded');
    expect(attempted.calls.some((c) => c.method === 'POST')).toBe(false);

    const booked = provider();
    const b = await run(booked, makeCtx({ checkpoints: { book_attempt: { clientReference: ref }, booking: { providerReference: 'BK1' } } }));
    expect(b.r.kind).toBe('succeeded');
    expect(booked.calls.map((c) => c.method + c.url.pathname.replace('/v3.0', ''))).toEqual(['GET/bookings/BK1']);
  });

  it('refuses production keys and unconfigured env without touching the network', async () => {
    const f1 = provider();
    const prod = await run(f1, makeCtx(), { NUITEE_API_KEY: 'prod_abcdef0123456789' } as NodeJS.ProcessEnv);
    expect(prod.r.kind).toBe('failed_definite');
    expect(f1.calls).toHaveLength(0);
    const f2 = provider();
    const none = await run(f2, makeCtx(), {} as NodeJS.ProcessEnv);
    expect(none.r.kind).toBe('failed_definite');
    expect(f2.calls).toHaveLength(0);
  });

  it('rejects a quote reference that is not a nuitee prebook', async () => {
    const c = makeCtx();
    c.ctx.quote.executionRef = { sku: 'x' };
    const f = provider();
    expect((await mk(f).execute(c.ctx)).kind).toBe('failed_definite');
    expect(f.calls).toHaveLength(0);
  });

  it('never emits PII, the API key or provider message text through results, checkpoints, evidence or console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const outputs: unknown[] = [];
    const replies: Reply[] = [
      { json: { data: bookingData(), sandbox: true } },
      'timeout',
      { status: 410, json: { error: { code: 4012, message: 'Zaphod Beeblebrox zaphod@example.org' } } },
      { status: 500, json: { error: { code: 5000, message: 'Trillian +6591230000' } } },
    ];
    for (const rep of replies) {
      const c = makeCtx();
      const f = provider({ book: () => rep });
      outputs.push(await mk(f).execute(c.ctx), c.persisted);
    }
    const r = await mk(provider({ book: () => 'network' })).retrieve(makeCtx().ctx);
    outputs.push(r);
    noPii(outputs);
    noPii(redact(outputs));
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
});

/* ---------------- retrieve ---------------- */

describe('nuitee retrieve', () => {
  const ref = clientReferenceFor('att_01HXYZ.abc');
  const retrieve = (get: (r: Req) => Reply, cps: Record<string, Record<string, unknown>> = { booking: { providerReference: 'BK1' } }, list?: (r: Req) => Reply) => {
    const f = provider({ get, ...(list ? { list } : {}) });
    const c = makeCtx({ checkpoints: cps });
    return mk(f)
      .retrieve(c.ctx)
      .then((r) => ({ r, f }));
  };
  const data = (over: Record<string, unknown>) => () => ({ json: { data: bookingData({ clientReference: ref, ...over }), sandbox: true } });

  it('CONFIRMED + succeeded + sandbox => succeeded simulated_paid with the exact booked price', async () => {
    const { r } = await retrieve(data({ price: '541.83' }));
    expect(r).toMatchObject({ kind: 'succeeded', commerceStatus: 'confirmed', merchantPaymentStatus: 'simulated_paid', chargedAmount: { amountMinor: '54183' } });
  });

  it('COMPLETED stays a succeeded confirmed booking', async () => {
    const { r } = await retrieve(data({ status: 'COMPLETED' }));
    expect(r.kind).toBe('succeeded');
  });

  it('CANCELLED in the sandbox is a definite no-charge failure; CANCELED spelling too', async () => {
    for (const status of ['CANCELLED', 'CANCELED']) {
      const { r } = await retrieve(data({ status }));
      expect(r).toMatchObject({ kind: 'failed_definite', providerReference: 'BK1' });
    }
  });

  it.each([
    ['bookingId', undefined], ['bookingId', null], ['bookingId', ''], ['bookingId', 'BK-OTHER'],
    ['clientReference', undefined], ['clientReference', null], ['clientReference', ''], ['clientReference', 'OTHER-ATTEMPT'],
    ['hotelId', undefined], ['hotelId', null], ['hotelId', ''], ['hotelId', 'OTHER-HOTEL'],
  ])('requires exact readback identity %s=%s for success and cancellation', async (field, value) => {
    for (const status of ['CONFIRMED', 'CANCELLED', 'CANCELED']) {
      const { r } = await retrieve(data({ [field as string]: value, status }));
      expect(r).toMatchObject({ kind: 'unknown', providerReference: 'BK1' });
      noPii(r);
    }
  });

  it('cannot finalize success or cancellation without a valid stored hotel quote', async () => {
    for (const status of ['CONFIRMED', 'CANCELLED']) {
      const c = makeCtx({ checkpoints: { booking: { providerReference: 'BK1' } } });
      c.ctx.quote.executionRef = {};
      const f = provider({ get: data({ status }) });
      expect(await mk(f).retrieve(c.ctx)).toMatchObject({ kind: 'unknown', providerReference: 'BK1' });
    }
  });
  it('CANCELLED without sandbox evidence, or with charges, stays unknown', async () => {
    const { r } = await retrieve(() => ({ json: { data: bookingData({ status: 'CANCELLED', clientReference: ref, sandbox: undefined }) } }));
    expect(r.kind).toBe('unknown');
    const { r: r2 } = await retrieve(data({ status: 'CANCELLED_WITH_CHARGES' }));
    expect(r2.kind).toBe('unknown');
  });

  it('without a booking checkpoint it looks the booking up by clientReference', async () => {
    const { r, f } = await retrieve(data({}), {}, () => ({ json: { data: [{ bookingId: 'BK1', clientReference: ref }] } }));
    expect(r).toMatchObject({ kind: 'succeeded', providerReference: 'BK1' });
    expect(f.calls[0]!.url.searchParams.get('clientReference')).toBe(ref);
  });

  it('not found (or several matches) is unknown, never a definite failure', async () => {
    const { r } = await retrieve(data({}), {}, () => ({ json: { data: [] } }));
    expect(r).toMatchObject({ kind: 'unknown', providerReference: null });
    const { r: r2 } = await retrieve(data({}), {}, () => ({ json: { data: [{ bookingId: 'A', clientReference: ref }, { bookingId: 'B', clientReference: ref }] } }));
    expect(r2.kind).toBe('unknown');
    const { r: r3 } = await retrieve(data({}), {}, () => 'timeout');
    expect(r3.kind).toBe('unknown');
  });

  it('unreachable provider or malformed body is unknown', async () => {
    expect((await retrieve(() => 'network')).r.kind).toBe('unknown');
    expect((await retrieve(() => ({ text: 'not json' }))).r.kind).toBe('unknown');
    expect((await retrieve(() => ({ json: { data: 'x' } }))).r.kind).toBe('unknown');
  });

  it('never throws when unconfigured', async () => {
    const c = makeCtx();
    const r = await mk(provider(), {} as NodeJS.ProcessEnv).retrieve(c.ctx);
    expect(r.kind).toBe('unknown');
  });
});

/* ---------------- readiness ---------------- */

describe('nuitee readiness', () => {
  it('reports MISSING_CONFIG with the variable names only', async () => {
    const f = fakeFetch(() => ({ json: {} }));
    const r = await mk(f, {} as NodeJS.ProcessEnv).readiness();
    expect(r).toMatchObject({ component: 'nuitee', status: 'MISSING_CONFIG', environment: 'sandbox', missing: ['NUITEE_API_KEY'] });
    expect(f.calls).toHaveLength(0);
  });

  it('EXTERNAL_CHECK_PASSED when the data endpoint accepts the key, and caches the result', async () => {
    const f = fakeFetch(() => ({ json: { data: [{ code: 'USD' }] } }));
    const cl = clock();
    const ex = createNuiteeExecutor(ENV, { fetchImpl: f.impl, clock: cl });
    const a = await ex.readiness();
    await ex.readiness();
    expect(a.status).toBe('EXTERNAL_CHECK_PASSED');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url.href).toBe(`${SEARCH}/data/currencies`);
    expect(JSON.stringify(a)).not.toContain(KEY);
    cl.advance(6 * 60_000);
    await ex.readiness();
    expect(f.calls).toHaveLength(2);
  });

  it('ACCESS_BLOCKED on 401/403, CONFIGURED_UNVERIFIED when the check is inconclusive, never throws', async () => {
    expect((await mk(fakeFetch(() => ({ status: 401, json: { error: { code: 1, message: 'x' } } }))).readiness()).status).toBe('ACCESS_BLOCKED');
    expect((await mk(fakeFetch(() => 'timeout')).readiness()).status).toBe('CONFIGURED_UNVERIFIED');
    expect((await mk(fakeFetch(() => ({ status: 500, text: 'boom' }))).readiness()).status).toBe('CONFIGURED_UNVERIFIED');
    const throwing = createNuiteeExecutor(ENV, { fetchImpl: (async () => { throw new Error('boom'); }) as unknown as typeof fetch, clock: clock() });
    await expect(throwing.readiness()).resolves.toMatchObject({ status: 'CONFIGURED_UNVERIFIED' });
  });

  it('flags non-sandbox key prefixes and invalid hosts without calling out or printing the key', async () => {
    const f = fakeFetch(() => ({ json: { data: [] } }));
    const prod = await mk(f, { NUITEE_API_KEY: 'prod_secretsecret' } as NodeJS.ProcessEnv).readiness();
    expect(prod.status).toBe('ACCESS_BLOCKED');
    expect(prod.detail).toMatch(/production/);
    expect(JSON.stringify(prod)).not.toContain('secretsecret');
    const bad = await mk(f, { NUITEE_API_KEY: KEY, NUITEE_SEARCH_BASE_URL: 'https://evil.example.com' } as NodeJS.ProcessEnv).readiness();
    expect(bad.status).toBe('ACCESS_BLOCKED');
    expect(JSON.stringify(bad)).not.toContain('evil.example.com');
    expect(f.calls).toHaveLength(0);
    const unknownPrefix = await mk(fakeFetch(() => ({ json: { data: [] } })), { NUITEE_API_KEY: 'abcdef0123456789' } as NodeJS.ProcessEnv).readiness();
    expect(unknownPrefix.detail).toMatch(/not recognised as a sandbox key/);
  });
});

// Keep the result type referenced so a signature change in ports.ts fails here at compile time.
export type _ResultKinds = ExecutionResult['kind'];


describe('nuitee sandbox environment guard',()=>{
  it.each(['abcdef0123456789','sandcastle_example'])('rejects unverified key environment before any booking (%s)',async key=>{
    const f=fakeFetch(()=>{throw new Error('must not call provider');});
    const ex=mk(f,{NUITEE_API_KEY:key});
    expect((await ex.readiness()).status).toBe('ACCESS_BLOCKED');
    expect((await ex.execute(makeCtx().ctx)).kind).toBe('failed_definite');
    expect(f.calls).toHaveLength(0);
  });
});
