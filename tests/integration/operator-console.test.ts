/**
 * The console's operator screens against the real gateway (local fixtures + local PostgreSQL).
 *
 * The console's own gateway source reads /v1/evidence/treasury, /v1/evidence/bank and /v1/capabilities over
 * HTTP, and its presenters render what comes back. This proves, end to end and without any external call:
 * - the console's schemas accept the backend's real responses (drift guard for the unschemaed read models);
 * - operator:read is enforced and a customer key gets nothing;
 * - observed and simulated money stay separate on real data;
 * - OCBC observations arrive masked, with provenance, and never carry a description;
 * - the console issues GET requests only: it never triggers a bank refresh.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OCBC_APIS } from '../../src/banking/ocbc/client.js';
import type { BankObservation, BankObservationAdapter } from '../../src/contracts/ports.js';
import { createClient } from '../../src/infrastructure/auth.js';
import { presentConnections, presentTreasury, type OperatorContext } from '../../web/src/model/operator.js';
import { createGatewaySource } from '../../web/src/source/gateway.js';
import { ConsoleError } from '../../web/src/contracts/source.js';
import { createFundablePurchase, startHarness, type Harness } from '../support/harness.js';

const ctx: OperatorContext = { now: new Date(), locale: 'en-US', timeZone: 'Asia/Singapore', mode: 'test' };

function bankAdapter(h: () => Harness): BankObservationAdapter {
  return {
    bank: 'ocbc',
    readiness: async () => ({ component: 'ocbc', status: 'LOCAL_TESTS_ONLY', environment: 'sandbox', missing: [], checkedAt: h().clock.now().toISOString() }),
    observe: async (): Promise<BankObservation[]> => [
      {
        kind: 'account_balance',
        maskedReference: '1234567890123456', // Deliberately raw: the gateway must mask it at the storage boundary.
        currency: 'SGD',
        amount: { currency: 'SGD', amountMinor: '12345', scale: 2 },
        availableAmount: { currency: 'SGD', amountMinor: '12000', scale: 2 },
        description: 'Private customer Jane Example, account 1234567890123456',
        observedAt: h().clock.now().toISOString(),
        providerTimestamp: null,
        environment: 'sandbox',
        source: `ocbc:sandbox:${OCBC_APIS.accountListing.label}`,
        caveats: ['OCBC developer-sandbox data is historical test data.'],
      },
    ],
  };
}

describe('console operator screens against the real gateway', () => {
  let h: Harness;
  let operatorToken: string;
  const requests: Array<{ method: string; path: string }> = [];

  /** The console's own source, with every request recorded. */
  const consoleSource = (token: string) =>
    createGatewaySource({
      baseUrl: h.url,
      accessKey: token,
      fetchImpl: (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        requests.push({ method: init?.method ?? 'GET', path: new URL(String(input)).pathname });
        return fetch(input, init);
      }) as typeof fetch,
    });

  beforeEach(async () => {
    requests.length = 0;
    // The adapter needs the harness clock, so it reads the harness lazily.
    h = await startHarness({ bankAdapters: [bankAdapter(() => h)] });
    const op = await createClient(
      h.gw.db,
      { displayName: 'Operator', channel: 'console', label: `operator-${Math.random().toString(36).slice(2, 8)}`, scopes: ['purchases:read', 'evidence:read', 'operator:read'] },
      h.clock.now().toISOString(),
    );
    operatorToken = op.token;
  });
  afterEach(async () => {
    await h.close();
  });

  async function completePurchase() {
    const { purchase, required } = await createFundablePurchase(h);
    const funded = await h.call('POST', `/v1/purchases/${purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:tx-op:${required}` } });
    expect(funded.status).toBe(202);
    await h.gw.worker.tick();
    return purchase.purchaseId as string;
  }

  it('refuses a customer key everywhere and returns no operator data', async () => {
    const customer = consoleSource(h.alice.token);
    expect(await customer.hasOperatorAccess()).toBe(false);
    const treasury = await customer.getTreasury().catch((e: unknown) => e);
    expect(treasury).toBeInstanceOf(ConsoleError);
    expect(treasury).toMatchObject({ code: 'forbidden', status: 403 });
    const connections = await customer.getConnections().catch((e: unknown) => e);
    expect(connections).toMatchObject({ code: 'forbidden', status: 403 });
    // The refused connections read stopped before the public capabilities call.
    expect(requests.filter((r) => r.path === '/v1/capabilities')).toHaveLength(0);
  });

  it('refuses a missing or wrong key as unauthenticated, not as "no operator access"', async () => {
    const bad = consoleSource('cgk_not_a_real_key');
    await expect(bad.hasOperatorAccess()).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('reads and presents treasury: simulated capacity apart from observed test funds', async () => {
    await completePurchase();
    const op = consoleSource(operatorToken);
    expect(await op.hasOperatorAccess()).toBe(true);
    const vm = presentTreasury(await op.getTreasury(), ctx);

    // Simulated purchasing capacity, in dollars: 20000 limit, 4999 consumed.
    const pool = vm.simulated.capacity[0]!;
    expect(pool).toMatchObject({ currency: 'USD', limit: '$200.00', available: '$150.01' });
    const by = Object.fromEntries(pool.segments.map((s) => [s.key, s.amount]));
    expect(by).toEqual({ reserved: '$0.00', consumed: '$49.99', providerTest: '$0.00', available: '$150.01' });

    // Observed funds are test crypto only, on their own network label.
    const treasuryRow = vm.observed.accounts.find((a) => a.account === 'Test crypto held in treasury')!;
    expect(treasuryRow).toMatchObject({ asset: 'Cardano test network', balance: '49.99 test USDM', side: 'Debit balance' });
    expect(JSON.stringify(vm.observed)).not.toContain('$');
    expect(JSON.stringify(vm.simulated)).not.toContain('USDM');

    // Journal health and purchases by state, from the real read model.
    expect(vm.health.balanced).toBe(true);
    expect(vm.purchases.items).toEqual([expect.objectContaining({ label: 'Completed', count: 1 })]);
    expect(new Set(vm.trialRows.map((r) => r.ledgerMode))).toEqual(new Set(['observed', 'simulated']));
  });

  it('shows an unfunded purchase as awaiting payment, with no customer obligations', async () => {
    await createFundablePurchase(h);
    const op = consoleSource(operatorToken);
    const vm = presentTreasury(await op.getTreasury(), ctx);
    expect(vm.purchases.items).toEqual([expect.objectContaining({ label: 'Awaiting payment', count: 1 })]);
    expect(vm.observed.obligations).toEqual([]);
  });

  it('reads and presents connections and stored OCBC observations, masked and read-only', async () => {
    // Observations are stored by the gateway's own refresh, which is operator tooling and not the console.
    const refreshed = await h.call('POST', '/v1/evidence/bank/refresh', { token: operatorToken });
    expect(refreshed.status).toBe(200);
    requests.length = 0;

    const op = consoleSource(operatorToken);
    const data = await op.getConnections();
    const vm = presentConnections(data, ctx);

    const all = [...vm.groups.flatMap((g) => g.items), vm.bank.connection];
    const by = Object.fromEntries(all.map((i) => [i.key, i]));
    expect(by.cardano).toMatchObject({ reported: true, status: { label: 'Local tests only' } });
    expect(by.shopify?.reported && by.nuitee?.reported && by.atlas?.reported).toBe(true);
    // The harness has no Solana or Masumi adapter, and the console says so rather than inventing a state.
    expect(by.solana).toMatchObject({ reported: false, status: { label: 'Not reported by this gateway' } });
    expect(by.masumi).toMatchObject({ reported: false });

    expect(vm.bank.empty).toBe(false);
    expect(vm.bank.banner).toMatch(/do not show that any Capsule purchase reached a bank or card account/);
    expect(vm.bank.balances[0]).toMatchObject({ kind: 'Account balance', reference: '****3456', amount: '$123.45 SGD', environment: 'Sandbox' });
    expect(vm.bank.balances[0]!.source).toBe(`ocbc:sandbox:${OCBC_APIS.accountListing.label}`);
    expect(vm.bank.balances[0]!.caveats.join(' ')).toContain('historical test data');

    const everything = JSON.stringify([data, vm]);
    expect(everything).not.toContain('Jane Example');
    expect(everything).not.toContain('1234567890123456');
  });

  it('never issues anything but GET from the console source, and never touches the refresh route', async () => {
    const op = consoleSource(operatorToken);
    await op.hasOperatorAccess();
    await op.getTreasury();
    await op.getConnections();
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
    expect(requests.some((r) => r.path.includes('refresh'))).toBe(false);
    // Reading stored observations did not cause any to be stored.
    expect((await op.getConnections()).bank.observations).toEqual([]);
  });
});
