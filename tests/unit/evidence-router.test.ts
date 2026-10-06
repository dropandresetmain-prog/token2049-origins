import { createTestDb, testDatabaseUrl } from '../support/database.js';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEvent } from '../../src/core/store.js';
import { buildGateway } from '../../src/composition.js';
import type { BankObservation, BankObservationAdapter } from '../../src/contracts/ports.js';
import { FixtureExecutor, FixtureFundingAdapter } from '../support/fixtures.js';
import { createClient, authenticate } from '../../src/infrastructure/auth.js';
import { ManualClock } from '../../src/infrastructure/clock.js';
import { createEvidenceRouter, createInspectRouter } from '../../src/evidence/router.js';
import { OCBC_APIS } from '../../src/banking/ocbc/client.js';

const TEST_ENV = {
  APP_ENV: 'test',
  DATABASE_URL: testDatabaseUrl,
  PUBLIC_BASE_URL: 'http://127.0.0.1:0',
  DEMO_PER_PURCHASE_LIMIT_USD_MINOR: '50000',
  SIMULATED_CARD_CAPACITY_USD_MINOR: '20000',
} as NodeJS.ProcessEnv;

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function setup() {
  const clock = new ManualClock();
  const db = await createTestDb();
  const bankAdapter: BankObservationAdapter = {
    bank: 'ocbc',
    readiness: async () => ({ component: 'ocbc', status: 'LOCAL_TESTS_ONLY', environment: 'sandbox', missing: [], checkedAt: clock.now().toISOString() }),
    observe: async (): Promise<BankObservation[]> => [{
      kind: 'account_balance',
      maskedReference: '1234567890123456', // Deliberately raw to exercise storage-boundary masking.
      currency: 'SGD',
      amount: { currency: 'SGD', amountMinor: '12345', scale: 2 },
      availableAmount: { currency: 'SGD', amountMinor: '12000', scale: 2 },
      description: 'Private customer Jane Example, account 1234567890123456',
      observedAt: clock.now().toISOString(),
      providerTimestamp: null,
      environment: 'sandbox',
      source: `ocbc:sandbox:${OCBC_APIS.accountListing.label}`,
      caveats: ['OCBC developer-sandbox data is historical test data.'],
    }],
  };
  const funding = new FixtureFundingAdapter(clock);
  const gw = await buildGateway({
    executors: [
      new FixtureExecutor('shopify', 'retail', clock),
      new FixtureExecutor('nuitee', 'hotel', clock, 12000n),
      new FixtureExecutor('atlas', 'flight', clock, 15000n),
    ],
    fundingAdapters: [funding],
    bankAdapters: [bankAdapter],
    extraRouters: [
      { path: '/v1/evidence', router: createEvidenceRouter({ db, clock, bankAdapters: [bankAdapter] }), auth: true },
      { path: '/inspect', router: createInspectRouter(), auth: false },
    ],
  }, { env: TEST_ENV, clock, db });

  const now = clock.now().toISOString();
  const customerScopes = ['offers:read', 'quotes:write', 'purchases:write', 'purchases:fund', 'purchases:read', 'evidence:read'] as const;
  const alice = await createClient(db, { displayName: 'Alice', channel: 'test', label: 'evidence-alice', scopes: [...customerScopes] }, now);
  const bob = await createClient(db, { displayName: 'Bob', channel: 'test', label: 'evidence-bob', scopes: [...customerScopes] }, now);
  const operator = await createClient(db, { displayName: 'Operator', channel: 'console', label: 'evidence-operator', scopes: ['operator:read'] }, now);

  const server = await new Promise<Server>((resolve) => {
    const s = gw.app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(url + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    const value = text ? response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text : null;
    return { status: response.status, body: value, headers: response.headers };
  };
  cleanup = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  };
  return { clock, db, gw, alice, bob, operator, call };
}

describe('evidence API and inspect shell', () => {
  it('keeps customer data owner-scoped and projects only curated evidence fields', async () => {
    const h = await setup();
    const actor = await authenticate(h.db, `Bearer ${h.alice.token}`, 'test-request');
    const offers = await h.gw.core.searchOffers(actor, {
      category: 'retail', query: 'test tee', quantity: 1, shipToCountry: 'SG',
      spendCeiling: { currency: 'USD', amountMinor: '10000', scale: 2 },
    });
    const quote = await h.gw.core.createQuote(actor, offers[0]!.offerId, {
      category: 'retail', email: 'buyer@example.com',
      shippingAddress: { firstName: 'Private', lastName: 'Buyer', address1: '99 Private Street', city: 'Singapore', zip: '018989', countryCode: 'SG' },
    });
    const created = await h.gw.core.createPurchase(actor, {
      quoteId: quote.quoteId,
      approval: { maxTotal: quote.payablePrincipal, quoteDigest: quote.digest, selectedFundingOptionId: quote.fundingOptions[0]!.fundingOptionId! },
    }, 'evidence-owner-test');
    const purchaseId = created.purchase.purchaseId;
    const orderGid = 'gid://shopify/Order/18933264089145';
    await h.db.run('UPDATE purchases SET provider_reference = $1 WHERE id = $2', orderGid, purchaseId);
    await appendEvent(h.db, purchaseId, 'provider.debug', { email: 'private-event@example.com', note: 'untrusted provider payload' }, h.clock.now().toISOString());

    expect((await h.call('GET', '/v1/evidence/purchases')).status).toBe(401);
    const aliceList = await h.call('GET', '/v1/evidence/purchases', h.alice.token);
    const bobList = await h.call('GET', '/v1/evidence/purchases', h.bob.token);
    expect(aliceList.status).toBe(200);
    expect(aliceList.body.purchases.map((p: { id: string }) => p.id)).toContain(purchaseId);
    expect(bobList.status).toBe(200);
    expect(bobList.body.purchases).toEqual([]);

    const own = await h.call('GET', `/v1/evidence/purchases/${purchaseId}`, h.alice.token);
    const foreign = await h.call('GET', `/v1/evidence/purchases/${purchaseId}`, h.bob.token);
    expect(own.status).toBe(200);
    expect(foreign.status).toBe(404);
    const output = JSON.stringify(own.body);
    expect(output).not.toContain('buyer@example.com');
    expect(output).not.toContain('private-event@example.com');
    expect(output).not.toContain('99 Private Street');
    expect(own.body.quote).not.toHaveProperty('fulfillmentSummary');
    expect(own.body.quote).not.toHaveProperty('fundingOptions');
    expect(own.body.events[0]).not.toHaveProperty('data');
    expect(own.body.execution.attempts[0] ?? {}).not.toHaveProperty('providerReference');

    const proof = await h.call('GET', `/v1/evidence/purchases/${purchaseId}/proof`, h.alice.token);
    expect(proof.status).toBe(200);
    expect(proof.body.proof.merchant.providerReference).toBe(orderGid);
    await h.db.run('UPDATE purchases SET provider_reference = $1 WHERE id = $2',
      'order 4111 1111 1111 1111 buyer@example.com Bearer fixture-token shpat_12345678', purchaseId);
    const redactedProof = await h.call('GET', `/v1/evidence/purchases/${purchaseId}/proof`, h.alice.token);
    expect(redactedProof.body.proof.merchant.providerReference).toBe('order [REDACTED_NUMBER][REDACTED_EMAIL] Bearer [REDACTED] [REDACTED_TOKEN]');
  });

  it('uses persisted fixture result provenance in list and detail without claiming a pending result is complete', async () => {
    const h = await setup();
    const actor = await authenticate(h.db, `Bearer ${h.alice.token}`, 'provenance-request');
    const offers = await h.gw.core.searchOffers(actor, {
      category: 'retail', query: 'test tee', quantity: 1, shipToCountry: 'SG',
      spendCeiling: { currency: 'USD', amountMinor: '10000', scale: 2 },
    });
    const quote = await h.gw.core.createQuote(actor, offers[0]!.offerId, {
      category: 'retail', email: 'buyer@example.com',
      shippingAddress: { firstName: 'Private', lastName: 'Buyer', address1: '99 Private Street', city: 'Singapore', zip: '018989', countryCode: 'SG' },
    });
    const created = await h.gw.core.createPurchase(actor, {
      quoteId: quote.quoteId,
      approval: { maxTotal: quote.payablePrincipal, quoteDigest: quote.digest, selectedFundingOptionId: quote.fundingOptions[0]!.fundingOptionId! },
    }, 'evidence-provenance-test');
    const purchaseId = created.purchase.purchaseId;
    const quoteRow = (await h.db.get<{ public_json: string }>('SELECT public_json FROM quotes WHERE id = $1', quote.quoteId))!;
    const publicQuote = JSON.parse(quoteRow.public_json) as Record<string, unknown>;
    publicQuote.providerEnvironment = 'test';
    await h.db.run('UPDATE quotes SET provider_environment = $1, public_json = $2 WHERE id = $3', 'test', JSON.stringify(publicQuote), quote.quoteId);

    const before = await h.call('GET', '/v1/evidence/purchases', h.alice.token);
    const beforeRow = before.body.purchases.find((row: { id: string }) => row.id === purchaseId);
    expect(beforeRow).toMatchObject({
      provenance: { environment: 'test', evidenceMode: 'fresh_external' },
      executionEvidenceStatus: 'not_started',
    });
    const beforeDetail = await h.call('GET', `/v1/evidence/purchases/${purchaseId}`, h.alice.token);
    expect(beforeDetail.body.purchase.provenance).toEqual(beforeRow.provenance);
    expect(beforeDetail.body.purchase.executionEvidenceStatus).toBe('not_started');

    const now = h.clock.now().toISOString();
    const result = {
      kind: 'unknown',
      reason: 'provider outcome is pending',
      providerReference: null,
      evidence: [{
        source: 'fixture:shopify',
        environment: 'fixture',
        evidenceMode: 'local_fixture',
        reference: 'fixture-result',
        observedAt: now,
        details: {},
      }],
    };
    await h.db.run(
      `INSERT INTO execution_attempts(id, purchase_id, attempt_no, idempotency_key, status, provider_reference, checkpoints_json, result_json, started_at, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      'att_evidenceprovenance01',
      purchaseId,
      1,
      'evidence-provenance-attempt-1',
      'unknown',
      null,
      '{}',
      JSON.stringify(result),
      now,
      null,
    );

    const listed = await h.call('GET', '/v1/evidence/purchases', h.alice.token);
    const row = listed.body.purchases.find((item: { id: string }) => item.id === purchaseId);
    const detail = await h.call('GET', `/v1/evidence/purchases/${purchaseId}`, h.alice.token);
    expect(row).toMatchObject({
      provenance: { environment: 'test', evidenceMode: 'local_fixture' },
      executionEvidenceStatus: 'pending',
    });
    expect(detail.body.purchase.provenance).toEqual(row.provenance);
    expect(detail.body.purchase.executionEvidenceStatus).toBe('pending');
    expect(detail.body.execution.attempts[0].provenance.evidenceMode).toBe('local_fixture');
  });

  it('requires operator scope for treasury, bank and refresh while storing masked sandbox observations', async () => {
    const h = await setup();
    expect((await h.call('GET', '/v1/evidence/treasury', h.alice.token)).status).toBe(403);
    expect((await h.call('GET', '/v1/evidence/bank', h.alice.token)).status).toBe(403);
    expect((await h.call('POST', '/v1/evidence/bank/refresh', h.alice.token)).status).toBe(403);

    const refreshed = await h.call('POST', '/v1/evidence/bank/refresh', h.operator.token);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.results).toEqual([{ bank: 'ocbc', ok: true, inserted: 1, rejected: 0 }]);
    const bank = await h.call('GET', '/v1/evidence/bank', h.operator.token);
    expect(bank.status).toBe(200);
    expect(bank.body.observations[0]).toMatchObject({ maskedReference: '****3456', environment: 'sandbox', currency: 'SGD' });
    expect(bank.body.observations[0]).not.toHaveProperty('description');
    expect(JSON.stringify(bank.body)).not.toContain('Jane Example');
    expect(JSON.stringify(bank.body)).not.toContain('1234567890123456');
    expect(JSON.stringify(bank.body)).toContain('historical test data');

    const treasury = await h.call('GET', '/v1/evidence/treasury', h.operator.token);
    expect(treasury.status).toBe(200);
    expect(treasury.body).toHaveProperty('simulatedCapacity');
    expect(treasury.body.simulatedCapacity[0]).toHaveProperty('cardPayableMinor');
    expect(treasury.body.simulatedCapacity[0]).toHaveProperty('providerTestBalanceUsedMinor');
  });

  it('serves only a generic unauthenticated shell and static script, with no private facts', async () => {
    const h = await setup();
    const page = await h.call('GET', '/inspect');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.body).toContain('Enter a gateway bearer token');
    expect(page.body).not.toContain('Jane Example');
    expect(page.body).not.toContain('12345');

    const script = await h.call('GET', '/inspect/app.js');
    expect(script.status).toBe(200);
    expect(script.body).toContain("get('/v1/evidence/purchases')");
    expect(script.body).not.toContain('localStorage');
  });
});
