import { describe, expect, it } from 'vitest';
import { createAtlasExecutor, readOrderNo } from '../../src/execution/atlas/index.js';
import { FlightIntent, type FlightFulfillment } from '../../src/contracts/intent.js';
import { money } from '../../src/contracts/money.js';
import type { CommerceExecutor, ExecutionContext } from '../../src/contracts/ports.js';
import { ProviderError } from '../../src/core/errors.js';
import { ManualClock } from '../../src/infrastructure/clock.js';
import { redact } from '../../src/infrastructure/redact.js';

/* ---------------- synthetic data and a scripted fake Atlas ---------------- */

const SECRET_ID = 'cid-SYNTHETIC-ID-123';
const SECRET_KEY = 'secret-SYNTHETIC-KEY-456';
const LEAK = 'PROVIDER-FREE-TEXT-LEAK';
const BASE = 'https://sandbox.atriptech.com/api';

const ENV_OFF = { ATLAS_BASE_URL: BASE, ATLAS_CLIENT_ID: SECRET_ID, ATLAS_CLIENT_SECRET: SECRET_KEY } as NodeJS.ProcessEnv;
const ENV_ON = { ...ENV_OFF, ATLAS_ALLOW_TEST_BALANCE_PAYMENT: 'true' } as NodeJS.ProcessEnv;

const intent = FlightIntent.parse({ category: 'flight', spendCeiling: money('USD', 100000), from: 'MNL', to: 'CEB', departDate: '2026-11-20', adults: 2 });

const fulfillment: FlightFulfillment = {
  category: 'flight',
  contact: { familyName: 'Tester', givenName: 'Alex', email: 'alex.tester@example.com', mobile: '0065-81234567' },
  passengers: [
    { familyName: 'Doe', givenName: 'Jane', gender: 'F', birthday: '1990-05-17', nationality: 'PH', passengerType: 'adult' },
    { familyName: 'Doe', givenName: 'John', gender: 'M', birthday: '1988-02-03', nationality: 'PH', passengerType: 'adult' },
  ],
};

const segment = { carrier: 'Z2', flightNumber: 'Z2771', depAirport: 'MNL', arrAirport: 'CEB', depTime: '202611202000', arrTime: '202611202130' };
const routing = (over: Record<string, unknown> = {}) => ({
  routingIdentifier: 'RID-1',
  currency: 'USD',
  adultPrice: 159.15,
  adultTax: 0.15,
  transactionFee: 0.0,
  transactionFeeMode: 'PER_PAX',
  transactionFeePerPax: 0.0,
  expireTime: '2026-10-06T12:30:00Z',
  riskSellout: false,
  fromSegments: [segment],
  retSegments: [],
  ...over,
});
const requirement = (over: Record<string, { required: boolean }> = {}) => ({
  passenger: {
    birthday: { required: true },
    gender: { required: true },
    name: { required: true, maxLength: '32/32' },
    nationality: { required: true },
    passengerType: { required: true },
    cardNum: { required: false },
    ...over,
  },
});
const verifyBody = (over: Record<string, unknown> = {}) => ({
  status: 0,
  sessionId: 'sess-1',
  maxSeats: 9,
  priceChange: { isPriceChange: false },
  bookingRequirement: requirement(),
  routing: routing(),
  ...over,
});
const ORDER_NO = 'ATLAS-ORD-1001';
const orderBody = (over: Record<string, unknown> = {}) => ({
  status: 0,
  orderNo: ORDER_NO,
  pnrCode: 'ABC123',
  totalPrice: 318.6,
  totalTransactionFee: 0,
  currency: 'USD',
  tktLimitTime: '2026-10-06 21:30:00',
  ...over,
});
const details = (over: Record<string, unknown> = {}) => ({
  status: 0,
  orderNo: ORDER_NO,
  orderStatus: '0',
  ticketStatus: '0',
  totalPrice: 318.6,
  currency: 'USD',
  payTime: null,
  tktLimitTime: '2026-10-06 21:30:00',
  pnrCode: 'ABC123',
  paxTicketInfos: [{ ticketNos: ['0000000000001'] }, { ticketNos: [] }],
  ...over,
});

type Handler = (body: Record<string, any>) => unknown;
interface Call {
  endpoint: string;
  body: Record<string, any>;
  headers: Record<string, string>;
  init: RequestInit;
}

class FakeAtlas {
  calls: Call[] = [];
  log: string[] = []; // interleaved with checkpoint events for ordering assertions
  handlers: Record<string, Handler> = {};
  on(endpoint: string, h: Handler): this {
    this.handlers[endpoint] = h;
    return this;
  }
  count(endpoint: string): number {
    return this.calls.filter((c) => c.endpoint === endpoint).length;
  }
  fetch: typeof fetch = async (url, init) => {
    const endpoint = String(url).replace(BASE, '');
    const body = JSON.parse(String(init?.body ?? '{}'));
    this.calls.push({ endpoint, body, headers: init?.headers as Record<string, string>, init: init! });
    this.log.push(`call:${endpoint}`);
    const h = this.handlers[endpoint];
    if (!h) throw new Error(`unscripted ${endpoint}`);
    const out = h(body);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

const timeout = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' });

function setup(env: NodeJS.ProcessEnv = ENV_OFF) {
  const fake = new FakeAtlas();
  const clock = new ManualClock();
  const ex = createAtlasExecutor(env, { fetchImpl: fake.fetch, clock });
  return { fake, clock, ex };
}

const QUOTE_REF = {
  sessionId: 'sess-1',
  routingIdentifier: 'RID-1',
  expectedTotalMinor: '31860',
  currency: 'USD',
  scale: 2,
  adults: 2,
  from: 'MNL',
  to: 'CEB',
  departDate: '2026-11-20',
};

/**
 * Execution context mirroring the real worker: checkpoints persist through `redact` (and a fresh
 * context is rebuilt from that redacted copy), while the in-flight context sees raw data.
 */
class CtxHarness {
  persisted: Record<string, Record<string, unknown>> = {};
  constructor(private readonly fake: FakeAtlas, initial: Record<string, Record<string, unknown>> = {}) {
    this.persisted = initial;
  }
  ctx(over: Partial<ExecutionContext> = {}): ExecutionContext {
    const ctx: ExecutionContext = {
      purchaseId: 'pur_1',
      attemptId: 'att_1',
      idempotencyKey: 'pur_1:1',
      quote: { quoteId: 'quo_1', merchantTotal: money('USD', 31860), executionRef: { ...QUOTE_REF }, expiresAt: '2026-10-06T13:00:00.000Z' },
      fulfillment,
      checkpoints: structuredClone(this.persisted),
      checkpoint: async (step, data) => {
        this.fake.log.push(`checkpoint:${step}`);
        this.persisted[step] = redact(data);
        ctx.checkpoints[step] = data;
      },
      ...over,
    };
    return ctx;
  }
}

const CREATE_ATTEMPT = { at: '2026-10-06T12:00:00.000Z' };

function allOutputs(...xs: unknown[]): string {
  return xs.map((x) => (x instanceof Error ? `${x.name} ${x.message} ${JSON.stringify(x)}` : JSON.stringify(x))).join('\n');
}

/* ---------------- search / quote ---------------- */

describe('atlas search', () => {
  it('maps routings to offers with exact money, cap and sorting', async () => {
    const { fake, ex } = setup();
    const routings = Array.from({ length: 12 }, (_, i) => routing({ routingIdentifier: `RID-${i}`, adultPrice: 100 + i, adultTax: 0.1 }));
    routings.push(routing({ routingIdentifier: 'RID-RET', retSegments: [segment] }) as never); // return itinerary dropped
    fake.on('/search.do', () => ({ status: 0, routings: routings.reverse() }));
    const offers = await ex.search(intent);
    expect(offers).toHaveLength(10);
    // (100 + 0.10) * 2 adults = 200.20, cheapest first
    expect(offers[0]!.indicativePrice).toEqual({ currency: 'USD', amountMinor: '20020', scale: 2 });
    expect(offers[0]!.executionRef).toEqual({ routingIdentifier: 'RID-0', currency: 'USD' });
    expect(offers[0]!.expiresAt).toBe('2026-10-06T12:30:00.000Z');
    expect(offers[0]!.title).toContain('MNL to CEB');
    const c = fake.calls[0]!;
    expect(c.body).toMatchObject({ cid: SECRET_ID, tripType: '1', adultNum: 2, childNum: 0, infantNum: 0, fromCity: 'MNL', toCity: 'CEB', fromDate: '20261120' });
    expect(c.headers['x-atlas-client-id']).toBe(SECRET_ID);
    expect(c.headers['x-atlas-client-secret']).toBe(SECRET_KEY);
    expect(c.init.redirect).toBe('error');
    expect(c.init.method).toBe('POST');
  });

  it('falls back to now+20min when expireTime is absent, unparseable or already past', async () => {
    const { fake, ex } = setup();
    fake.on('/search.do', () => ({
      status: 0,
      routings: [
        routing({ routingIdentifier: 'A', expireTime: null }),
        routing({ routingIdentifier: 'B', expireTime: 'garbage', adultPrice: 160 }),
        routing({ routingIdentifier: 'C', expireTime: '2026-08-19T13:40:33Z', adultPrice: 161 }),
      ],
    }));
    const offers = await ex.search(intent);
    expect(offers.map((o) => o.expiresAt)).toEqual(Array(3).fill('2026-10-06T12:20:00.000Z'));
  });

  it('skips routings whose price is not exactly representable and rejects provider failure', async () => {
    const { fake, ex } = setup();
    fake.on('/search.do', () => ({ status: 0, routings: [routing({ adultPrice: 10.005 }), routing({ routingIdentifier: 'OK' })] }));
    expect((await ex.search(intent)).map((o) => o.executionRef.routingIdentifier)).toEqual(['OK']);
    fake.on('/search.do', () => ({ status: 7, msg: LEAK }));
    const err = await ex.search(intent).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).outcome).toBe('rejected');
    expect(allOutputs(err)).not.toContain(LEAK);
  });

  it('refuses a non-sandbox base URL without sending anything', async () => {
    const { fake, ex } = setup({ ...ENV_OFF, ATLAS_BASE_URL: 'https://api.atriptech.com' });
    const err = await ex.search(intent).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).outcome).toBe('not_sent');
    expect(fake.calls).toHaveLength(0);
  });
});

describe('atlas quote', () => {
  const offer = { executionRef: { routingIdentifier: 'RID-1', currency: 'USD' }, intent };

  it('maps verify to an exact quote with a conservative TTL', async () => {
    const { fake, ex } = setup();
    fake.on('/verify.do', () => verifyBody());
    const q = await ex.quote(offer, fulfillment);
    // (159.15 + 0.15) * 2 = 318.60
    expect(q.merchantTotal).toEqual({ currency: 'USD', amountMinor: '31860', scale: 2 });
    expect(q.breakdown.map((l) => [l.kind, l.amount.amountMinor])).toEqual([
      ['item', '31830'],
      ['tax', '30'],
    ]);
    expect(q.executionRef).toEqual({ ...QUOTE_REF });
    expect(q.expiresAt).toBe('2026-10-06T12:10:00.000Z');
    expect(fake.calls[0]!.body).toEqual({ routingIdentifier: 'RID-1', maxResponseTime: 15000 });
    expect(JSON.stringify(q)).not.toContain('Jane');
  });

  it('uses the verified price when verify reports a price change, and states it', async () => {
    const { fake, ex } = setup();
    fake.on('/verify.do', () =>
      verifyBody({ priceChange: { isPriceChange: true, newAdultPrice: 170.5, newAdultTax: 0.2 }, routing: routing({ adultPrice: 170.5, adultTax: 0.2 }) }),
    );
    const q = await ex.quote(offer, fulfillment);
    expect(q.merchantTotal.amountMinor).toBe('34140'); // (170.50 + 0.20) * 2
    expect(q.executionRef.expectedTotalMinor).toBe('34140');
    expect(q.terms.some((t) => /fare changed/i.test(t))).toBe(true);
  });

  it('includes a per-passenger transaction fee known before order creation', async () => {
    const { fake, ex } = setup();
    fake.on('/verify.do', () => verifyBody({ routing: routing({ transactionFee: 1.5, transactionFeePerPax: 1.5 }) }));
    const q = await ex.quote(offer, fulfillment);
    expect(q.merchantTotal.amountMinor).toBe('32160'); // 318.60 + 1.50 * 2 passengers
    expect(q.breakdown.find((l) => l.kind === 'fee_included')?.amount.amountMinor).toBe('300');
  });

  it('rejects with field NAMES only when required traveller data is missing', async () => {
    const { fake, ex } = setup();
    fake.on('/verify.do', () => verifyBody({ bookingRequirement: requirement({ cardNum: { required: true }, cardType: { required: true } }) }));
    const err = (await ex.quote(offer, fulfillment).catch((e) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.outcome).toBe('rejected');
    expect(err.providerCode).toBe('atlas_traveller_data_required');
    expect(err.message).toContain('passenger.cardNum');
    expect(err.message).toContain('passenger.cardType');
    expect(allOutputs(err)).not.toMatch(/Jane|John|alex\.tester|1990/);
  });

  it('accepts required document fields when every passenger supplies a document', async () => {
    const { fake, ex } = setup();
    fake.on('/verify.do', () => verifyBody({ bookingRequirement: requirement({ cardNum: { required: true } }) }));
    const withDoc: FlightFulfillment = {
      ...fulfillment,
      passengers: fulfillment.passengers.map((p) => ({ ...p, document: { type: 'passport' as const, number: 'P1234567', expiry: '2031-01-01', issuingCountry: 'PH' } })),
    };
    await expect(ex.quote(offer, withDoc)).resolves.toBeDefined();
  });

  it('rejects names that cannot be sent on the wire and a traveller count mismatch', async () => {
    const { fake, ex } = setup();
    fake.on('/verify.do', () => verifyBody());
    const hyphen: FlightFulfillment = { ...fulfillment, passengers: [{ ...fulfillment.passengers[0]!, familyName: "O'Brien" }, fulfillment.passengers[1]!] };
    const e1 = (await ex.quote(offer, hyphen).catch((e) => e)) as ProviderError;
    expect(e1.providerCode).toBe('atlas_traveller_data_invalid');
    expect(e1.message).not.toContain('Brien');
    const one: FlightFulfillment = { ...fulfillment, passengers: [fulfillment.passengers[0]!] };
    const e2 = (await ex.quote(offer, one).catch((e) => e)) as ProviderError;
    expect(e2.providerCode).toBe('atlas_passenger_count_mismatch');
  });

  it('rejects a failed or incomplete verification without surfacing provider text', async () => {
    const { fake, ex } = setup();
    fake.on('/verify.do', () => ({ status: 805, msg: LEAK }));
    const e1 = (await ex.quote(offer, fulfillment).catch((e) => e)) as ProviderError;
    expect(e1.outcome).toBe('rejected');
    expect(allOutputs(e1)).not.toContain(LEAK);
    fake.on('/verify.do', () => verifyBody({ sessionId: null }));
    expect(((await ex.quote(offer, fulfillment).catch((e) => e)) as ProviderError).providerCode).toBe('atlas_verify_incomplete');
  });
});

/* ---------------- execute: create ---------------- */

describe('atlas execute: order creation', () => {
  it('checkpoints create_attempt BEFORE order.do, and the order BEFORE any pay step', async () => {
    const { fake, ex } = setup(ENV_OFF);
    fake.on('/order.do', () => orderBody());
    const h = new CtxHarness(fake);
    const r = await ex.execute(h.ctx());
    expect(fake.log.indexOf('checkpoint:create_attempt')).toBeGreaterThanOrEqual(0);
    expect(fake.log.indexOf('checkpoint:create_attempt')).toBeLessThan(fake.log.indexOf('call:/order.do'));
    expect(fake.log.indexOf('call:/order.do')).toBeLessThan(fake.log.indexOf('checkpoint:order'));
    expect(h.persisted.order).toMatchObject({ providerReference: ORDER_NO, pnrCode: 'ABC123', tktLimitTime: '2026-10-06 21:30:00' });
    expect(r.kind).toBe('failed_definite'); // gate closed, see below
    const body = fake.calls.find((c) => c.endpoint === '/order.do')!.body;
    expect(body.sessionId).toBe('sess-1');
    expect(body.passengers[0]).toEqual({ name: 'DOE/JANE', passengerType: 0, gender: 'F', birthday: '19900517', nationality: 'PH' });
    expect(body.contact).toEqual({ name: 'Tester/Alex', email: 'alex.tester@example.com', mobile: '0065-81234567' });
    expect(body.clientOrderNo).toBeUndefined(); // ignored by Atlas: never wired to suggest idempotency
  });

  it('create timeout is unknown, carries no reference, and never pays', async () => {
    const { fake, ex } = setup(ENV_ON);
    fake.on('/order.do', () => {
      throw timeout();
    });
    const h = new CtxHarness(fake);
    const r = await ex.execute(h.ctx());
    expect(r).toMatchObject({ kind: 'unknown', providerReference: null });
    expect(fake.count('/pay.do')).toBe(0);
    expect(fake.count('/order.do')).toBe(1);
    expect(h.persisted.create_attempt).toBeDefined();
    expect(h.persisted.order).toBeUndefined();
  });

  it('a 5xx or unparseable create response is unknown; a 4xx is a definite rejection', async () => {
    for (const [status, expected] of [[502, 'unknown'], [400, 'failed_definite'], [403, 'failed_definite']] as const) {
      const { fake, ex } = setup(ENV_ON);
      fake.on('/order.do', () => new Response('x', { status }));
      const r = await ex.execute(new CtxHarness(fake).ctx());
      expect(r.kind).toBe(expected);
      expect(fake.count('/pay.do')).toBe(0);
    }
    const { fake, ex } = setup(ENV_ON);
    fake.on('/order.do', () => new Response('<html>', { status: 200 }));
    expect((await ex.execute(new CtxHarness(fake).ctx())).kind).toBe('unknown');
  });

  it('duplicate (318) and other rejections create nothing and never adopt an order', async () => {
    const { fake, ex } = setup(ENV_ON);
    fake.on('/order.do', () => ({ status: 318, msg: LEAK, duplicateOrders: ['SOMEONE-ELSES-ORDER'] }));
    const r = await ex.execute(new CtxHarness(fake).ctx());
    expect(r).toMatchObject({ kind: 'failed_definite', reason: 'atlas_duplicate_order', providerReference: null });
    expect(allOutputs(r)).not.toContain('SOMEONE-ELSES-ORDER');
    expect(allOutputs(r)).not.toContain(LEAK);
    expect(fake.count('/pay.do')).toBe(0);
  });

  it('a non-success status that names an order stays unknown with the reference preserved', async () => {
    const { fake, ex } = setup(ENV_ON);
    fake.on('/order.do', () => orderBody({ status: 500 }));
    const r = await ex.execute(new CtxHarness(fake).ctx());
    expect(r).toMatchObject({ kind: 'unknown', providerReference: ORDER_NO });
    expect(fake.count('/pay.do')).toBe(0);
  });

  it('order total mismatch is terms_changed: not paid, order still checkpointed', async () => {
    const { fake, ex } = setup(ENV_ON);
    fake.on('/order.do', () => orderBody({ totalPrice: 325.0 }));
    const h = new CtxHarness(fake);
    const r = await ex.execute(h.ctx());
    expect(r.kind).toBe('terms_changed');
    expect(r.kind === 'terms_changed' && r.reason).toContain('quoted 318.60 USD, order 325.00 USD');
    expect(fake.count('/pay.do')).toBe(0);
    expect(h.persisted.order).toBeDefined();
    // currency mismatch too
    const b = setup(ENV_ON);
    b.fake.on('/order.do', () => orderBody({ currency: 'EUR' }));
    expect((await b.ex.execute(new CtxHarness(b.fake).ctx())).kind).toBe('terms_changed');
    expect(b.fake.count('/pay.do')).toBe(0);
  });

  it('falls back to queryOrderDetails for the total when order.do omits it', async () => {
    const { fake, ex } = setup(ENV_OFF);
    fake.on('/order.do', () => orderBody({ totalPrice: null, currency: null }));
    fake.on('/queryOrderDetails.do', () => details({ totalPrice: 400 }));
    expect((await ex.execute(new CtxHarness(fake).ctx())).kind).toBe('terms_changed');
    fake.on('/queryOrderDetails.do', () => {
      throw timeout();
    });
    expect((await ex.execute(new CtxHarness(fake).ctx())).kind).toBe('unknown');
  });

  it('a resumed execute with a create_attempt checkpoint never creates again', async () => {
    const { fake, ex } = setup(ENV_ON);
    fake.on('/orderList.do', () => ({ status: 0, orders: [] }));
    const h = new CtxHarness(fake, { create_attempt: CREATE_ATTEMPT });
    const r = await ex.execute(h.ctx());
    expect(fake.count('/order.do')).toBe(0);
    expect(r.kind).toBe('unknown');
  });
});

/* ---------------- execute: payment gate ---------------- */

describe('atlas execute: payment gate', () => {
  it('gate off: hold created, definite no-charge failure with the order number, pay.do never called', async () => {
    for (const env of [ENV_OFF, { ...ENV_OFF, ATLAS_ALLOW_TEST_BALANCE_PAYMENT: 'TRUE' }, { ...ENV_OFF, ATLAS_ALLOW_TEST_BALANCE_PAYMENT: '1' }] as NodeJS.ProcessEnv[]) {
      const { fake, ex } = setup(env);
      fake.on('/order.do', () => orderBody());
      const r = await ex.execute(new CtxHarness(fake).ctx());
      expect(r).toMatchObject({ kind: 'failed_definite', reason: 'atlas_payment_mechanism_not_approved', providerReference: ORDER_NO });
      expect(fake.count('/pay.do')).toBe(0);
      expect(fake.count('/queryOrderDetails.do')).toBe(0);
      expect(r.kind === 'failed_definite' && r.evidence[0]?.details).toMatchObject({ paymentGate: 'closed' });
    }
  });

  function gateOnScript(opts: { pay?: Handler; after?: () => unknown } = {}) {
    const s = setup(ENV_ON);
    let paid = false;
    s.fake.on('/order.do', () => orderBody());
    s.fake.on('/pay.do', (b) => {
      paid = true;
      return opts.pay ? opts.pay(b) : { status: 0, orderNo: b.orderNo };
    });
    s.fake.on('/queryOrderDetails.do', () => (paid ? (opts.after ? opts.after() : details({ orderStatus: '1', payTime: '2026-10-06 20:01:00' })) : details()));
    return s;
  }

  it('gate on: pre-check, pay_attempt checkpoint, pay once, then status 1 -> succeeded/ticketing/test_balance_paid', async () => {
    const { fake, ex } = gateOnScript();
    const h = new CtxHarness(fake);
    const r = await ex.execute(h.ctx());
    expect(r).toMatchObject({
      kind: 'succeeded',
      providerReference: ORDER_NO,
      commerceStatus: 'ticketing',
      merchantPaymentStatus: 'test_balance_paid',
      chargedAmount: { currency: 'USD', amountMinor: '31860', scale: 2 },
    });
    expect(fake.count('/pay.do')).toBe(1);
    expect(fake.calls.find((c) => c.endpoint === '/pay.do')!.body).toEqual({ orderNo: ORDER_NO, paymentMethod: 1 });
    expect(fake.log.indexOf('checkpoint:order')).toBeLessThan(fake.log.indexOf('checkpoint:pay_attempt'));
    expect(fake.log.indexOf('checkpoint:pay_attempt')).toBeLessThan(fake.log.indexOf('call:/pay.do'));
    // the pre-check read happens before pay_attempt
    expect(fake.log.indexOf('call:/queryOrderDetails.do')).toBeLessThan(fake.log.indexOf('checkpoint:pay_attempt'));
  });

  it('status 2 with ticketStatus 1 is ticketed; status 2 without issued tickets stays ticketing', async () => {
    const a = gateOnScript({ after: () => details({ orderStatus: '2', ticketStatus: '1', payTime: 'x' }) });
    expect(await a.ex.execute(new CtxHarness(a.fake).ctx())).toMatchObject({ kind: 'succeeded', commerceStatus: 'ticketed' });
    const b = gateOnScript({ after: () => details({ orderStatus: '2', ticketStatus: '0', payTime: 'x' }) });
    expect(await b.ex.execute(new CtxHarness(b.fake).ctx())).toMatchObject({ kind: 'succeeded', commerceStatus: 'ticketing' });
  });

  it('reports the observed total honestly when a paid order differs from the quote', async () => {
    const { fake, ex } = gateOnScript({ after: () => details({ orderStatus: '1', payTime: 'x', totalPrice: 320 }) });
    const r = await ex.execute(new CtxHarness(fake).ctx());
    expect(r.kind === 'succeeded' && r.chargedAmount).toEqual({ currency: 'USD', amountMinor: '32000', scale: 2 });
  });

  it('cancelled after the pay step (no pay time) is a definite failure; with a pay time it stays unknown', async () => {
    const a = gateOnScript({ after: () => details({ orderStatus: '-3' }) });
    expect(await a.ex.execute(new CtxHarness(a.fake).ctx())).toMatchObject({ kind: 'failed_definite', reason: 'atlas_order_cancelled', providerReference: ORDER_NO });
    const b = gateOnScript({ after: () => details({ orderStatus: '-3', payTime: '2026-10-06 20:01:00' }) });
    expect((await b.ex.execute(new CtxHarness(b.fake).ctx())).kind).toBe('unknown');
  });

  it('pay accepted but order still held reads back as unknown (payment pending)', async () => {
    const { fake, ex } = gateOnScript({ after: () => details() });
    expect(await ex.execute(new CtxHarness(fake).ctx())).toMatchObject({ kind: 'unknown', providerReference: ORDER_NO });
    expect(fake.count('/pay.do')).toBe(1);
  });

  it('404 already paid / 402 beyond payment stage / 406 in progress are settled by readback, never re-paid', async () => {
    for (const code of [404, 402, 406]) {
      const { fake, ex } = gateOnScript({ pay: () => ({ status: code }) });
      const r = await ex.execute(new CtxHarness(fake).ctx());
      expect(r.kind).toBe('succeeded'); // readback shows status 1 after our pay attempt
      expect(fake.count('/pay.do')).toBe(1);
    }
    const held = gateOnScript({ pay: () => ({ status: 406 }), after: () => details() });
    expect((await held.ex.execute(new CtxHarness(held.fake).ctx())).kind).toBe('unknown');
  });

  it('an explicit pay rejection with the order still held is a definite no-charge failure', async () => {
    const { fake, ex } = gateOnScript({ pay: () => ({ status: 999, msg: LEAK }), after: () => details() });
    const r = await ex.execute(new CtxHarness(fake).ctx());
    expect(r).toMatchObject({ kind: 'failed_definite', providerReference: ORDER_NO });
    expect(allOutputs(r)).not.toContain(LEAK);
    expect(fake.count('/pay.do')).toBe(1);
  });

  it('a pay timeout is ambiguous: readback decides, and pay.do is not repeated', async () => {
    const mk = (after: () => unknown) =>
      gateOnScript({
        pay: () => {
          throw timeout();
        },
        after,
      });
    const held = mk(() => details());
    expect((await held.ex.execute(new CtxHarness(held.fake).ctx())).kind).toBe('unknown');
    expect(held.fake.count('/pay.do')).toBe(1);
    const paid = mk(() => details({ orderStatus: '1', payTime: 'x' }));
    expect((await paid.ex.execute(new CtxHarness(paid.fake).ctx())).kind).toBe('succeeded');
    expect(paid.fake.count('/pay.do')).toBe(1);
  });

  it('pre-check: an order already paid, cancelled, repriced or unreadable is never paid', async () => {
    const cases: Array<[Handler, string]> = [
      [() => details({ orderStatus: '1' }), 'unknown'],
      [() => details({ orderStatus: '2' }), 'unknown'],
      [() => details({ orderStatus: '-3' }), 'failed_definite'],
      [() => details({ totalPrice: 330 }), 'terms_changed'],
      [() => details({ currency: 'EUR' }), 'terms_changed'],
      [() => ({ status: 9 }), 'unknown'],
      [() => {
        throw timeout();
      }, 'unknown'],
    ];
    for (const [q, kind] of cases) {
      const { fake, ex } = setup(ENV_ON);
      fake.on('/order.do', () => orderBody());
      fake.on('/queryOrderDetails.do', q);
      fake.on('/pay.do', () => ({ status: 0 }));
      const h = new CtxHarness(fake);
      const r = await ex.execute(h.ctx());
      expect(r.kind).toBe(kind);
      expect(fake.count('/pay.do')).toBe(0);
      expect(h.persisted.pay_attempt).toBeUndefined();
    }
  });

  it('a resumed execute with a pay_attempt checkpoint reads back and never pays again', async () => {
    const { fake, ex } = setup(ENV_ON);
    fake.on('/queryOrderDetails.do', () => details({ orderStatus: '1', payTime: 'x' }));
    const h = new CtxHarness(fake, { order: { providerReference: ORDER_NO }, create_attempt: CREATE_ATTEMPT, pay_attempt: { at: CREATE_ATTEMPT.at, providerReference: ORDER_NO } });
    const r = await ex.execute(h.ctx());
    expect(r.kind).toBe('succeeded');
    expect(fake.count('/pay.do')).toBe(0);
    expect(fake.count('/order.do')).toBe(0);
  });
});

/* ---------------- retrieve ---------------- */

describe('atlas retrieve', () => {
  const orderCp = { providerReference: ORDER_NO, tktLimitTime: '2026-10-06 21:30:00' };

  it('held and unpaid without a pay attempt is unknown from retrieve (reconciler keeps exposure)', async () => {
    const { fake, ex } = setup(ENV_ON);
    fake.on('/queryOrderDetails.do', () => details());
    const r = await ex.retrieve(new CtxHarness(fake, { create_attempt: CREATE_ATTEMPT, order: orderCp }).ctx());
    expect(r).toMatchObject({ kind: 'unknown', reason: 'atlas_order_held_unpaid', providerReference: ORDER_NO });
    expect(fake.count('/pay.do')).toBe(0);
  });

  it('an unpaid hold past its ticketing deadline (SGT) is a definite no-charge failure; not before', async () => {
    const { fake, clock, ex } = setup(ENV_ON);
    fake.on('/queryOrderDetails.do', () => details());
    const ctx = () => new CtxHarness(fake, { create_attempt: CREATE_ATTEMPT, order: orderCp }).ctx();
    // 21:30 SGT = 13:30Z; clock is 12:00Z
    expect((await ex.retrieve(ctx())).kind).toBe('unknown');
    clock.set('2026-10-06T13:31:30.000Z');
    expect(await ex.retrieve(ctx())).toMatchObject({ kind: 'failed_definite', reason: 'atlas_hold_lapsed_unpaid' });
  });

  it('after a pay attempt: 0 -> unknown, 1 -> ticketing, 2 -> ticketed, -3 -> cancelled', async () => {
    const cps = { create_attempt: CREATE_ATTEMPT, order: orderCp, pay_attempt: { at: CREATE_ATTEMPT.at, providerReference: ORDER_NO } };
    const run = async (d: Record<string, unknown>) => {
      const { fake, ex } = setup(ENV_ON);
      fake.on('/queryOrderDetails.do', () => details(d));
      return ex.retrieve(new CtxHarness(fake, cps).ctx());
    };
    expect((await run({ orderStatus: '0' })).kind).toBe('unknown');
    expect(await run({ orderStatus: '1', payTime: 'x' })).toMatchObject({ kind: 'succeeded', commerceStatus: 'ticketing', merchantPaymentStatus: 'test_balance_paid' });
    expect(await run({ orderStatus: '2', ticketStatus: '1', payTime: 'x' })).toMatchObject({ kind: 'succeeded', commerceStatus: 'ticketed' });
    expect(await run({ orderStatus: '-3' })).toMatchObject({ kind: 'failed_definite' });
    expect((await run({ orderStatus: '7' })).kind).toBe('unknown');
    expect((await run({ orderStatus: null })).kind).toBe('unknown');
  });

  it('ticket numbers on a cancelled order never imply ticketing; a paid state we did not cause is not claimed', async () => {
    const { fake, ex } = setup(ENV_ON);
    fake.on('/queryOrderDetails.do', () => details({ orderStatus: '-3', ticketStatus: '1' }));
    const cancelled = await ex.retrieve(new CtxHarness(fake, { create_attempt: CREATE_ATTEMPT, order: orderCp }).ctx());
    expect(cancelled.kind).toBe('failed_definite');
    fake.on('/queryOrderDetails.do', () => details({ orderStatus: '1', payTime: 'x' }));
    const foreign = await ex.retrieve(new CtxHarness(fake, { create_attempt: CREATE_ATTEMPT, order: orderCp }).ctx());
    expect(foreign).toMatchObject({ kind: 'unknown', reason: 'atlas_order_paid_without_pay_attempt' });
  });

  it('reads the order number back from a redacted checkpoint (13-19 digit order numbers are masked by the core)', async () => {
    const numeric = '1234567890123456';
    expect(redact({ providerReference: numeric }).providerReference).toContain('REDACTED');
    const { fake, ex } = setup(ENV_ON);
    fake.on('/order.do', () => orderBody({ orderNo: numeric }));
    const h = new CtxHarness(fake);
    await ex.execute(h.ctx()); // gate closed after creating the hold; persists redacted checkpoints
    expect(readOrderNo(h.persisted.order)).toBe(numeric);
    fake.on('/queryOrderDetails.do', (b) => {
      expect(b.orderNo).toBe(numeric);
      return details({ orderNo: numeric, orderStatus: '-3' });
    });
    expect((await ex.retrieve(h.ctx())).kind).toBe('failed_definite');
  });

  it('no create_attempt checkpoint proves no create was sent: failed_definite, no provider call', async () => {
    const { fake, ex } = setup(ENV_ON);
    const r = await ex.retrieve(new CtxHarness(fake).ctx());
    expect(r).toMatchObject({ kind: 'failed_definite', reason: 'atlas_create_not_attempted', providerReference: null });
    expect(fake.calls).toHaveLength(0);
  });

  describe('create outcome unknown: orderList reconciliation', () => {
    const row = (over: Record<string, unknown> = {}) => ({
      orderNo: 'ATLAS-ORD-9',
      orderStatus: '0',
      depDate: '20261120',
      fromCity: 'MNL',
      toCity: 'CEB',
      orderCreateTimestamp: '2026-10-06 20:00:30', // SGT = 12:00:30Z
      contactEmail: 'Alex.Tester@example.com',
      paxNames: ['DOE/JOHN', 'DOE/JANE'],
      ...over,
    });
    const run = async (rows: unknown[], detailsOver: Record<string, unknown> = {}, cps: Record<string, Record<string, unknown>> = { create_attempt: CREATE_ATTEMPT }) => {
      const { fake, ex } = setup(ENV_ON);
      fake.on('/orderList.do', () => ({ status: 0, orders: rows }));
      fake.on('/queryOrderDetails.do', () => details({ orderNo: 'ATLAS-ORD-9', ...detailsOver }));
      const h = new CtxHarness(fake, cps);
      const r = await ex.retrieve(h.ctx());
      return { r, fake, h };
    };

    it('adopts a UNIQUE match (checkpointed as adopted), reads it back, and never pays it', async () => {
      const { r, fake, h } = await run([row(), row({ orderNo: 'OTHER', paxNames: ['X/Y'] })], { orderStatus: '-3' });
      expect(r).toMatchObject({ kind: 'failed_definite', providerReference: 'ATLAS-ORD-9' });
      expect(h.persisted.order).toMatchObject({ providerReference: 'ATLAS-ORD-9', adopted: true });
      expect(fake.count('/pay.do')).toBe(0);
      expect(fake.calls.find((c) => c.endpoint === '/orderList.do')!.body).toEqual({ pageNo: 1, pageSize: 50 });
    });

    it('an adopted held order stays unknown; an adopted order that is paid is not claimed', async () => {
      expect((await run([row()])).r.kind).toBe('unknown');
      const paid = await run([row()], { orderStatus: '1', payTime: 'x' });
      expect(paid.r).toMatchObject({ kind: 'unknown', reason: 'atlas_adopted_order_unexpectedly_paid' });
    });

    it('zero, several, out-of-window, wrong-traveller, wrong-route matches stay unknown', async () => {
      expect((await run([])).r).toMatchObject({ kind: 'unknown', providerReference: null });
      expect((await run([row(), row({ orderNo: 'ATLAS-ORD-10' })])).r.kind).toBe('unknown');
      expect((await run([row({ orderCreateTimestamp: '2026-10-06 19:00:00' })])).r.kind).toBe('unknown'); // before the attempt
      expect((await run([row({ paxNames: ['DOE/JANE'] })])).r.kind).toBe('unknown');
      expect((await run([row({ toCity: 'MNL' })])).r.kind).toBe('unknown');
      expect((await run([row({ orderCreateTimestamp: null })])).r.kind).toBe('unknown');
    });

    it('an unavailable order list stays unknown', async () => {
      const { fake, ex } = setup(ENV_ON);
      fake.on('/orderList.do', () => {
        throw timeout();
      });
      const r = await ex.retrieve(new CtxHarness(fake, { create_attempt: CREATE_ATTEMPT }).ctx());
      expect(r.kind).toBe('unknown');
    });
  });
});

/* ---------------- readiness ---------------- */

describe('atlas readiness', () => {
  it('reports MISSING_CONFIG with variable names only', async () => {
    const { ex } = setup({ ATLAS_CLIENT_ID: SECRET_ID } as NodeJS.ProcessEnv);
    const r = await ex.readiness();
    expect(r.status).toBe('MISSING_CONFIG');
    expect(r.missing).toEqual(['ATLAS_BASE_URL', 'ATLAS_CLIENT_SECRET']);
    expect(allOutputs(r)).not.toContain(SECRET_ID);
  });

  it('refuses a non-sandbox host as ACCESS_BLOCKED without any call', async () => {
    for (const url of ['https://api.atriptech.com', 'http://sandbox.atriptech.com', 'not a url', 'https://user:pw@sandbox.atriptech.com']) {
      const { fake, ex } = setup({ ...ENV_OFF, ATLAS_BASE_URL: url });
      expect((await ex.readiness()).status).toBe('ACCESS_BLOCKED');
      expect(fake.calls).toHaveLength(0);
    }
  });

  it('EXTERNAL_CHECK_PASSED via a cheap cached search probe, and says whether the payment gate is open', async () => {
    const { fake, clock, ex } = setup(ENV_OFF);
    fake.on('/search.do', () => ({ status: 0, routings: [] }));
    const r = await ex.readiness();
    expect(r).toMatchObject({ component: 'atlas', status: 'EXTERNAL_CHECK_PASSED', environment: 'sandbox' });
    expect(r.detail).toContain('payment gate disabled');
    expect(fake.calls[0]!.body.fromDate).toBe('20261105'); // 30 days after the clock
    await ex.readiness();
    expect(fake.count('/search.do')).toBe(1); // cached
    clock.advance(11 * 60_000);
    await ex.readiness();
    expect(fake.count('/search.do')).toBe(2);
    const on = setup(ENV_ON);
    on.fake.on('/search.do', () => ({ status: 0 }));
    expect((await on.ex.readiness()).detail).toContain('payment gate ENABLED');
  });

  it('maps 401/403 to ACCESS_BLOCKED, provider errors and outages to CONFIGURED_UNVERIFIED, and never throws', async () => {
    for (const [respond, expected] of [
      [() => new Response('no', { status: 401 }), 'ACCESS_BLOCKED'],
      [() => new Response('no', { status: 403 }), 'ACCESS_BLOCKED'],
      [() => ({ status: 5, msg: LEAK }), 'CONFIGURED_UNVERIFIED'],
      [() => new Response('boom', { status: 500 }), 'CONFIGURED_UNVERIFIED'],
      [() => {
        throw new TypeError('fetch failed');
      }, 'CONFIGURED_UNVERIFIED'],
      [() => {
        throw timeout();
      }, 'CONFIGURED_UNVERIFIED'],
    ] as const) {
      const { fake, ex } = setup(ENV_OFF);
      fake.on('/search.do', respond as Handler);
      const r = await ex.readiness();
      expect(r.status).toBe(expected);
      expect(allOutputs(r)).not.toContain(LEAK);
      expect(allOutputs(r)).not.toContain(SECRET_KEY);
    }
  });
});

/* ---------------- secrets and provider text never leak ---------------- */

describe('atlas leak safety', () => {
  it('no secret or provider free text appears in any result, error or checkpoint across failure paths', async () => {
    const outputs: unknown[] = [];
    const scenarios: Array<(f: FakeAtlas) => void> = [
      (f) => f.on('/order.do', () => ({ status: 321, msg: LEAK })),
      (f) => f.on('/order.do', () => new Response(`${LEAK} ${SECRET_KEY}`, { status: 500 })),
      (f) =>
        f.on('/order.do', () => {
          throw Object.assign(new Error(`connect failed ${SECRET_KEY} ${LEAK}`), { name: 'FetchError' });
        }),
      (f) => f.on('/order.do', () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })),
      (f) => {
        f.on('/order.do', () => orderBody());
        f.on('/queryOrderDetails.do', () => ({ ...details(), msg: LEAK }));
        f.on('/pay.do', () => ({ status: 410, msg: LEAK }));
      },
    ];
    for (const script of scenarios) {
      const { fake, ex } = setup(ENV_ON);
      script(fake);
      const h = new CtxHarness(fake);
      outputs.push(await ex.execute(h.ctx()).catch((e) => e), h.persisted);
    }
    const s = setup(ENV_ON);
    s.fake.on('/search.do', () => {
      throw new Error(`${SECRET_ID} ${SECRET_KEY}`);
    });
    outputs.push(await s.ex.search(intent).catch((e) => e));
    s.fake.on('/verify.do', () => new Response(`${LEAK}`, { status: 422 }));
    outputs.push(await s.ex.quote({ executionRef: { routingIdentifier: 'R', currency: 'USD' }, intent }, fulfillment).catch((e) => e));
    const text = allOutputs(...outputs);
    for (const forbidden of [SECRET_ID, SECRET_KEY, LEAK, 'evil.example']) expect(text).not.toContain(forbidden);
  });

  it('a redirect response is never followed and reads as an unknown create outcome', async () => {
    const { fake, ex } = setup(ENV_ON);
    fake.on('/order.do', () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }));
    const r = await ex.execute(new CtxHarness(fake).ctx());
    expect(r.kind).toBe('unknown');
    expect(fake.calls.every((c) => c.init.redirect === 'error')).toBe(true);
  });
});

describe('atlas executor identity', () => {
  it('declares route, category and environment', () => {
    const ex: CommerceExecutor = createAtlasExecutor(ENV_OFF);
    expect([ex.route, ex.category, ex.environment]).toEqual(['atlas', 'flight', 'sandbox']);
  });

  it('refuses non-flight work', async () => {
    const { ex } = setup();
    const retail = { category: 'retail', spendCeiling: money('USD', 1000), query: 'x', quantity: 1, shipToCountry: 'SG' } as never;
    await expect(ex.search(retail)).rejects.toBeInstanceOf(ProviderError);
  });
});
