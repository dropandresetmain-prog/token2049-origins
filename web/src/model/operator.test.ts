import { describe, expect, it } from 'vitest';
import { BankResponse, TreasuryResponse } from '../contracts/operator.js';
import type { ConnectionsData } from '../contracts/source.js';
import copySource from '../copy/operator.ts?raw';
import { sampleConnections, sampleTreasury } from '../source/sample.operator.js';
import { describeAsset, formatAssetAmount, maskReference, percentOf, presentConnections, presentTreasury, type OperatorContext } from './operator.js';

const NOW = Date.parse('2026-10-06T10:20:00Z');
const ctx: OperatorContext = { now: new Date(NOW), locale: 'en-US', timeZone: 'Asia/Singapore', mode: 'test' };

const ADA = 'cardano:preprod/lovelace';
const USD = 'fiat:USD/2';

describe('treasury presentation: observed and simulated stay apart', () => {
  const vm = presentTreasury(sampleTreasury(), ctx);

  it('puts observed and simulated amounts in separate sections, never in one list', () => {
    const observed = JSON.stringify(vm.observed);
    const simulated = JSON.stringify(vm.simulated);
    // Observed funds are test crypto only: no fiat, no simulated labels.
    expect(observed).not.toContain('simulated');
    expect(observed).not.toContain('$');
    expect(observed).toContain('test ADA');
    // The simulated allowance is fiat only: no test crypto.
    expect(simulated).not.toContain('test ADA');
    expect(simulated).not.toContain('test tokens');
    expect(simulated).toContain('$');
    expect(vm.observed.accounts.length).toBeGreaterThan(0);
    expect(vm.simulated.accounts.length).toBeGreaterThan(0);
  });

  it('lists the trial balance observed first, one row per ledger and asset, never summed', () => {
    const modes = vm.trialRows.map((r) => r.ledgerMode);
    expect(modes).toEqual([...modes].sort((a, b) => (a === b ? 0 : a === 'observed' ? -1 : 1)));
    expect(vm.trialRows).toHaveLength(sampleTreasury().ledger.trialBalance.length);
    expect(vm.trialRows.find((r) => r.ledgerMode === 'simulated')?.asset).toBe('USD (simulated)');
  });

  it('does not net observed assets against simulated capacity', () => {
    const big = TreasuryResponse.parse({
      ...sampleTreasury(),
      ledger: { ...sampleTreasury().ledger, accounts: sampleTreasury().ledger.accounts.map((a) => (a.asset === ADA && a.account === 'assets:crypto_treasury' ? { ...a, balanceDebitPositive: '999999000000' } : a)) },
    });
    const a = presentTreasury(sampleTreasury(), ctx).simulated.capacity;
    const b = presentTreasury(big, ctx).simulated.capacity;
    expect(b).toEqual(a);
  });

  it('shows available, reserved, consumed and provider test balance exactly', () => {
    const pool = vm.simulated.capacity[0]!;
    expect(pool.currency).toBe('USD');
    expect(pool.limit).toBe('$5,000.00');
    expect(pool.available).toBe('$3,374.00');
    const by = Object.fromEntries(pool.segments.map((s) => [s.key, s.amount]));
    expect(by).toEqual({ reserved: '$642.00', consumed: '$834.00', providerTest: '$150.00', available: '$3,374.00' });
    // Segments are a share of the limit, and together cover it exactly here.
    expect(pool.segments.reduce((n, s) => n + s.percent, 0)).toBeCloseTo(100, 5);
    expect(pool.overspent).toBe(false);
    expect(pool.availableNegative).toBe(false);
  });

  it('flags recorded use above the limit instead of hiding it', () => {
    const t = sampleTreasury();
    const over = TreasuryResponse.parse({
      ...t,
      simulatedCapacity: [{ ...t.simulatedCapacity[0]!, limitMinor: '100000', availableMinor: '-62600' }],
    });
    const pool = presentTreasury(over, ctx).simulated.capacity[0]!;
    expect(pool.overspent).toBe(true);
    expect(pool.availableNegative).toBe(true);
    expect(pool.available).toBe('-$626.00');
    expect(pool.segments.reduce((n, s) => n + s.percent, 0)).toBeLessThanOrEqual(100.01);
  });

  it('shows customer obligations per asset in that asset, with refund due called out', () => {
    const rows = vm.observed.obligations;
    const cardano = rows.find((r) => r.asset === 'Cardano test network')!;
    expect(cardano).toMatchObject({ prepayment: '120 test ADA', unapplied: '5 test ADA', refundDue: '48 test ADA', refundDueNonZero: true });
    const solana = rows.find((r) => r.asset.startsWith('Solana'))!;
    expect(solana).toMatchObject({ unapplied: 'None', refundDue: 'None', refundDueNonZero: false });
  });

  it('counts purchases by state in a stable order with friendly labels', () => {
    expect(vm.purchases.items.map((i) => i.label)).toEqual(['Awaiting payment', 'Ordering', 'Completed', 'Failed', 'Expired']);
    expect(vm.purchases.total).toBe(10);
    expect(vm.purchases.totalLabel).toBe('10 purchases in total');
  });

  it('reports ledger health and an out-of-balance ledger plainly', () => {
    expect(vm.health).toMatchObject({ balanced: true, label: 'Balanced' });
    const t = sampleTreasury();
    const bad = presentTreasury(
      TreasuryResponse.parse({ ...t, ledger: { ...t.ledger, balanced: false, trialBalance: t.ledger.trialBalance.map((r, i) => (i === 0 ? { ...r, balanced: false, net: '5' } : r)) } }),
      ctx,
    );
    expect(bad.health.label).toBe('Out of balance');
    expect(bad.trialRows.some((r) => r.status === 'Out of balance')).toBe(true);
  });

  it('shows credit-normal accounts as positive credit balances', () => {
    const fee = vm.observed.accounts.find((a) => a.account === 'Service fees earned')!;
    expect(fee).toMatchObject({ balance: '12.5 test ADA', side: 'Credit balance' });
  });

  it('presents an empty gateway without throwing', () => {
    const empty = TreasuryResponse.parse({
      note: '',
      ledger: { balanced: true, trialBalance: [], accounts: [] },
      simulatedCapacity: [],
      purchasesByState: {},
      obligations: { ledgerMode: 'observed', note: '', unappliedByAsset: {}, refundDueByAsset: {}, prepaymentOutstandingByAsset: {} },
      reservations: [],
    });
    const e = presentTreasury(empty, ctx);
    expect(e.observed.obligations).toEqual([]);
    expect(e.simulated.capacity).toEqual([]);
    expect(e.purchases.total).toBe(0);
  });
});

describe('asset labels never guess', () => {
  it('formats known assets and shows unknown ones in raw base units', () => {
    expect(formatAssetAmount('1500000', describeAsset(ADA), ctx)).toBe('1.5 test ADA');
    expect(formatAssetAmount('-1500000', describeAsset(ADA), ctx)).toBe('-1.5 test ADA');
    expect(formatAssetAmount('12345', describeAsset(USD), ctx)).toBe('$123.45');
    const unknown = describeAsset('cardano:preprod/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.00');
    expect(unknown.decimals).toBeNull();
    expect(formatAssetAmount('1234567', unknown, ctx)).toBe('1,234,567 base units');
  });

  it('only says "test" when the network id says so', () => {
    expect(describeAsset('cardano:mainnet/lovelace').label).toBe('Cardano network');
    expect(describeAsset('cardano:mainnet/lovelace').unit).toBe('ADA');
    expect(describeAsset(ADA).label).toBe('Cardano test network');
  });

  it('percentOf uses exact integers and clamps', () => {
    expect(percentOf(1n, 3n)).toBe(33.33);
    expect(percentOf(5n, 0n)).toBe(0);
    expect(percentOf(-5n, 10n)).toBe(0);
    expect(percentOf(20n, 10n)).toBe(100);
  });
});

describe('connections presentation', () => {
  const vm = presentConnections(sampleConnections(NOW), ctx);

  it('lists Cardano, Solana, Masumi, Shopify, Nuitée, Atlas and OCBC', () => {
    const names = [...vm.groups.flatMap((g) => g.items), vm.bank.connection].map((i) => i.name);
    expect(names).toEqual(['Cardano', 'Solana', 'Masumi', 'Shopify', 'Nuitée', 'Atlas', 'OCBC']);
  });

  it('maps readiness without upgrading it', () => {
    const by = Object.fromEntries([...vm.groups.flatMap((g) => g.items), vm.bank.connection].map((i) => [i.key, i.status.label]));
    expect(by).toMatchObject({
      cardano: 'External check passed',
      solana: 'Configured, not verified',
      masumi: 'Access blocked',
      nuitee: 'Local tests only',
      atlas: 'Access blocked',
    });
    const nuitee = vm.groups.flatMap((g) => g.items).find((i) => i.key === 'nuitee')!;
    expect(nuitee.missing).toEqual(['NUITEE_API_KEY']);
  });

  it('says so when the gateway does not list an integration', () => {
    const data: ConnectionsData = {
      capabilities: { ...sampleConnections(NOW).capabilities, routes: [], fundingRails: [], banking: [] },
      bank: { ...sampleConnections(NOW).bank, adapters: [], observations: [] },
    };
    const v = presentConnections(data, ctx);
    for (const i of [...v.groups.flatMap((g) => g.items), v.bank.connection]) {
      expect(i.reported).toBe(false);
      expect(i.status.label).toBe('Not reported by this gateway');
    }
    expect(v.bank.empty).toBe(true);
  });

  it('presents OCBC as a read-only observation with provenance, masked', () => {
    expect(vm.bank.banner).toMatch(/Read-only observations/);
    expect(vm.bank.banner).toMatch(/not purchase settlement/);
    expect(vm.bank.banner).toMatch(/do not show that any Capsule purchase reached a bank or card account/);
    expect(vm.bank.balances.map((o) => o.kind)).toEqual(['Account balance', 'Card summary']);
    expect(vm.bank.transactions.map((o) => o.kind)).toEqual(['Account transaction']);
    const balance = vm.bank.balances[0]!;
    expect(balance).toMatchObject({ reference: '****3456', amount: '$12,500.00 SGD', available: '$11,980.00 SGD', environment: 'Sandbox', provenance: 'Read from the OCBC sandbox' });
    expect(balance.source).toBe('ocbc:sandbox:corporateAccountListing/1.0');
    expect(balance.caveats.join(' ')).toContain('historical test data');
  });

  it('labels a stored fixture as one', () => {
    const data = sampleConnections(NOW);
    const fixture = BankResponse.parse({ ...data.bank, observations: data.bank.observations.map((o) => ({ ...o, provenance: { environment: 'fixture', evidenceMode: 'local_fixture' } })) });
    expect(presentConnections({ ...data, bank: fixture }, ctx).bank.balances[0]!.provenance).toBe('Local test fixture');
  });

  it('masks again and never lets a description through', () => {
    const data = sampleConnections(NOW);
    const leaky = BankResponse.parse({
      ...data.bank,
      observations: data.bank.observations.map((o) => ({ ...o, maskedReference: '1234567890123456', description: 'Private customer Jane Example, account 1234567890123456' })),
    });
    const v = presentConnections({ ...data, bank: leaky }, ctx);
    const text = JSON.stringify(v);
    expect(text).not.toContain('1234567890123456');
    expect(text).not.toContain('Jane Example');
    expect(v.bank.balances.every((o) => o.reference === '****3456')).toBe(true);
  });

  it('masks any reference down to its last four characters or nothing', () => {
    expect(maskReference('****3456')).toBe('****3456');
    expect(maskReference('1234567890123456')).toBe('****3456');
    expect(maskReference('12')).toBe('****');
    expect(maskReference('XXXX-XXXX-XXXX')).toBe('****');
    expect(maskReference('')).toBe('****');
  });

  it('keeps OCBC out of the payment and merchant groups', () => {
    expect(vm.groups.flatMap((g) => g.items).some((i) => i.key === 'ocbc')).toBe(false);
  });
});

describe('operator copy rules', () => {
  const source: string = copySource;

  it('has no em or en dashes', () => {
    expect(source).not.toMatch(/[–—]/);
  });

  it('never claims test crypto is cash or OCBC data settles purchases', () => {
    const lower = source.toLowerCase();
    expect(lower).toContain('test crypto is not bank cash');
    expect(lower).toContain('not purchase settlement');
    expect(lower).not.toMatch(/settled (at|by|through) ocbc/);
  });
});
