import type { SettlementPolicy } from '../../src/contracts/settlement.js';
import { demoData } from '../../src/demo/config.js';
import { createTestDb, testDatabaseUrl } from './database.js';
import { buildGateway, type Gateway } from '../../src/composition.js';
import { Db } from '../../src/infrastructure/db.js';
import { ManualClock } from '../../src/infrastructure/clock.js';
import { createClient } from '../../src/infrastructure/auth.js';
import { FixtureExecutor, FixtureFundingAdapter } from './fixtures.js';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BankObservationAdapter } from '../../src/contracts/ports.js';
import { createEvidenceRouter } from '../../src/evidence/router.js';
import { createProofPageRouter } from '../../src/evidence/proof-page.js';

export interface Harness {
  gw: Gateway;
  clock: ManualClock;
  retail: FixtureExecutor;
  hotel: FixtureExecutor;
  flight: FixtureExecutor;
  funding: FixtureFundingAdapter;
  alice: { token: string; customerId: string };
  bob: { token: string; customerId: string };
  url: string;
  server: Server;
  call(method: string, path: string, opts?: { token?: string; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: any; headers: Headers }>;
  close(): Promise<void>;
}

export const TEST_ENV = {
  APP_ENV: 'test',
  DATABASE_URL: testDatabaseUrl,
  PUBLIC_BASE_URL: 'http://127.0.0.1:0',
  DEMO_PER_PURCHASE_LIMIT_USD_MINOR: '50000',
  SIMULATED_CARD_CAPACITY_USD_MINOR: '20000',
} as NodeJS.ProcessEnv;

export async function startHarness(opts: { schema?: string; db?: Db; clock?: ManualClock; bankAdapters?: BankObservationAdapter[]; settlementPolicy?: SettlementPolicy; serviceFeeBps?: number; port?: number; extraRouters?: (core: Gateway['core']) => NonNullable<Parameters<typeof buildGateway>[0]['extraRouters']> } = {}): Promise<Harness> {
  const clock = opts.clock ?? new ManualClock();
  const db = opts.db ?? await createTestDb(opts.schema);
  const retail = new FixtureExecutor('shopify', 'retail', clock);
  const hotel = new FixtureExecutor('nuitee', 'hotel', clock, 12000n);
  const flight = new FixtureExecutor('atlas', 'flight', clock, 15000n);
  const funding = new FixtureFundingAdapter(clock);
  const gw = await buildGateway(
    { executors: [retail, hotel, flight], fundingAdapters: [funding], bankAdapters: opts.bankAdapters ?? [], buildRouters: core => [
      { path: '/v1/evidence', router: createEvidenceRouter({ db: core.deps.db, clock, bankAdapters: opts.bankAdapters ?? [] }), auth: true },
      { path: '/proof', router: createProofPageRouter(), auth: false },
      ...(opts.extraRouters?.(core) ?? []),
    ] },
    { env: TEST_ENV, clock, db },
  );
  gw.core.deps.config.settlementPolicy = opts.settlementPolicy ?? { mode: 'full_notional', numerator: 1, denominator: 1 };
  gw.core.deps.config.serviceFeeBps = opts.serviceFeeBps ?? 0;
  const now = clock.now().toISOString();
  const existing = (await db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM api_clients'))!;
  const alice = await createClient(db, { displayName: 'Alice', channel: 'test', label: `alice-${existing.n}` }, now);
  const bob = await createClient(db, { displayName: 'Bob', channel: 'test', label: `bob-${existing.n}` }, now);
  const server = await new Promise<Server>((r) => {
    const s = gw.app.listen(opts.port ?? 0, '127.0.0.1', () => r(s));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call: Harness['call'] = async (method, path, o = {}) => {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(url + path, { method, headers, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
  return {
    gw,
    clock,
    retail,
    hotel,
    flight,
    funding,
    alice,
    bob,
    url,
    server,
    call,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export const retailIntent = (ceilingMinor = '10000') => ({
  category: 'retail',
  query: demoData.retail.query,
  quantity: demoData.retail.quantity,
  shipToCountry: demoData.retail.shipToCountry,
  spendCeiling: { currency: 'USD', amountMinor: ceilingMinor, scale: 2 },
});

export const retailFulfillment = {
  category: 'retail',
  ...demoData.buyer,
};

/** search -> quote -> purchase; returns ids and the funding requirement. */
export async function createFundablePurchase(h: Harness, token = h.alice.token, idem = `idem-${Math.random().toString(36).slice(2, 12)}`, ceilingMinor = '10000') {
  const s = await h.call('POST', '/v1/offers/search', { token, body: { intent: retailIntent(ceilingMinor) } });
  if (s.status !== 200) throw new Error(`search ${s.status} ${JSON.stringify(s.body)}`);
  const offerId = s.body.offers[0].offerId;
  const q = await h.call('POST', '/v1/quotes', { token, body: { offerId, fulfillment: retailFulfillment } });
  if (q.status !== 201) throw new Error(`quote ${q.status} ${JSON.stringify(q.body)}`);
  const quote = q.body.quote;
  const p = await h.call('POST', '/v1/purchases', {
    token,
    headers: { 'idempotency-key': idem },
    body: { quoteId: quote.quoteId, approval: { maxTotal: quote.payablePrincipal, quoteDigest: quote.digest, selectedFundingOptionId: quote.fundingOptions[0]!.fundingOptionId! } },
  });
  if (p.status !== 201) throw new Error(`purchase ${p.status} ${JSON.stringify(p.body)}`);
  return { quote, purchase: p.body.purchase, idem, required: quote.fundingOptions[0].amount.amountBaseUnits as string };
}
