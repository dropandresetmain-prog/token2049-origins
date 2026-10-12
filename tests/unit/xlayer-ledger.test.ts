import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NETWORK, TOKEN } from '../../src/funding/xlayer/config.js';
import { SolanaLedger } from '../../clients/solana/ledger.js';
import { XLayerLedger, assertXLayerCaps, nextNonce, type XLayerLedgerEntry, type XLayerSpendPolicy } from '../../clients/xlayer/ledger.js';

const OWNER = '0x' + 'a'.repeat(40);
const NOW = new Date('2026-10-08T00:00:00.000Z');
const roots: string[] = [];
const hash = (n: number) => '0x' + n.toString(16).padStart(64, '0');
const policy: XLayerSpendPolicy = { maxPerPayment: 100n, maxDaily: 150n, maxTotal: 300n, maxGasPerPayment: 20n, maxGasTotal: 50n };

/**
 * Most cases do not need the (slow, PowerShell/icacls-backed on Windows) owner-only ACL check on every read; it is stubbed
 * unless `real` is set. The `real` cases below exercise the genuine protection against a temp directory.
 */
function setup(options: { real?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'xlayer-ledger-'));
  roots.push(root);
  if (!options.real) {
    vi.spyOn(SolanaLedger.prototype, 'assertProtected').mockImplementation(() => {});
    vi.spyOn(SolanaLedger, 'protectDirectory').mockImplementation(() => {});
  }
  const ledger = new XLayerLedger(join(root, 'payer.json'), OWNER);
  ledger.initialize();
  return { root, ledger };
}
function entry(id: string, values: Partial<XLayerLedgerEntry> = {}): XLayerLedgerEntry {
  return { id, amount: '30', gasBudget: '5', nonce: null, header: null, hash: null, createdAt: NOW.toISOString(), status: 'reserved', ...values };
}
function signed(id: string, nonce: number, values: Partial<XLayerLedgerEntry> = {}): XLayerLedgerEntry {
  return entry(id, { status: 'signed', nonce, header: 'opaque-signed-header-' + id, hash: hash(nonce + 1), ...values });
}
async function store(ledger: XLayerLedger, row: XLayerLedgerEntry): Promise<void> {
  await ledger.exclusive(async () => ledger.upsert(row));
}
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('X Layer durable payer ledger', () => {
  it('initializes an identity-bound empty history and refuses to reset it', () => {
    const { ledger } = setup();
    expect(ledger.read()).toEqual([]);
    expect(() => ledger.initialize()).toThrow(/refusing to reset/);
    expect(ledger.read()).toEqual([]);
  });

  it('requires an absolute path and a non-empty owner', () => {
    expect(() => new XLayerLedger('relative/ledger.json', OWNER)).toThrow(/absolute/);
    expect(() => new XLayerLedger(join(tmpdir(), 'l.json'), '  ')).toThrow(/owner required/);
  });

  it('refuses to initialize while a lock is present', () => {
    const root = mkdtempSync(join(tmpdir(), 'xlayer-ledger-lock-'));
    roots.push(root);
    const ledger = new XLayerLedger(join(root, 'payer.json'), OWNER);
    writeFileSync(ledger.path + '.lock', 'stale');
    expect(() => ledger.initialize()).toThrow(/locked/);
    expect(existsSync(ledger.path)).toBe(false);
  });

  it('persists reservations across restart and counts them against per-payment, rolling, total and gas caps', async () => {
    const { ledger } = setup();
    await store(ledger, signed('purchase-1', 0, { amount: '70', gasBudget: '20' }));
    await store(ledger, entry('purchase-2', { amount: '40', gasBudget: '10', createdAt: new Date(NOW.getTime() + 60_000).toISOString() }));

    const restarted = new XLayerLedger(ledger.path, OWNER);
    expect(restarted.read()).toHaveLength(2);
    expect(() => restarted.assertCaps(41n, 1n, policy, NOW)).toThrow(/rolling 24-hour/);
    expect(() => restarted.assertCaps(1n, 21n, policy, NOW)).toThrow(/per-payment gas/);
    expect(() => restarted.assertCaps(1n, 1n, { ...policy, maxTotal: 110n }, NOW)).toThrow(/cumulative spend/);
    expect(() => restarted.assertCaps(1n, 21n, { ...policy, maxGasTotal: 30n, maxGasPerPayment: 30n }, NOW)).toThrow(/cumulative gas/);
    expect(() => restarted.assertCaps(101n, 1n, policy, NOW)).toThrow(/per-payment cap/);
    expect(() => restarted.assertCaps(40n, 20n, policy, NOW)).not.toThrow(); // exactly at the daily cap (70+40+40 = 150) and gas cap
  });

  it('keeps reservation fields immutable', async () => {
    const { ledger } = setup();
    const reserved = entry('purchase-1');
    await store(ledger, reserved);
    for (const change of [{ amount: '31' }, { gasBudget: '6' }, { createdAt: new Date(NOW.getTime() + 1000).toISOString() }]) {
      await expect(ledger.exclusive(async () => ledger.upsert({ ...reserved, ...change }))).rejects.toThrow(/reservation is immutable/);
    }
    expect(ledger.read()).toEqual([reserved]);
  });

  it('moves a reservation to a signed candidate, then keeps the candidate (header, hash and nonce) immutable', async () => {
    const { ledger } = setup();
    await store(ledger, entry('purchase-1'));
    const s = signed('purchase-1', 4);
    await store(ledger, s);
    expect(ledger.read()).toEqual([s]);
    await expect(ledger.exclusive(async () => ledger.upsert({ ...s, nonce: 5 }))).rejects.toThrow(/candidate is immutable/);
    await expect(ledger.exclusive(async () => ledger.upsert({ ...s, hash: hash(99) }))).rejects.toThrow(/candidate is immutable/);
    await expect(ledger.exclusive(async () => ledger.upsert({ ...s, header: 'different' }))).rejects.toThrow(/candidate is immutable/);
    await expect(ledger.exclusive(async () => ledger.upsert({ ...s, status: 'reserved', header: null, hash: null, nonce: null }))).rejects.toThrow(/status cannot move backwards/);
    expect(ledger.read()).toEqual([s]);
  });

  it('only moves status forward: reserved -> signed -> accepted, never back', async () => {
    const { ledger } = setup();
    const s = signed('purchase-1', 0);
    await store(ledger, s);
    const accepted = { ...s, status: 'accepted' as const };
    await store(ledger, accepted);
    expect(ledger.read()).toEqual([accepted]);
    await expect(ledger.exclusive(async () => ledger.upsert(s))).rejects.toThrow(/status cannot move backwards/);
    await store(ledger, accepted); // idempotent
    expect(ledger.read()).toEqual([accepted]);
  });

  it.each([
    ['header without hash and nonce', { header: 'header' }],
    ['hash without header', { hash: hash(1) }],
    ['nonce without candidate', { nonce: 3 }],
    ['reserved entry carrying a candidate', { header: 'header', hash: hash(1), nonce: 1 }],
    ['signed without candidate', { status: 'signed' as const }],
    ['accepted without candidate', { status: 'accepted' as const }],
    ['signed missing nonce', { status: 'signed' as const, header: 'h', hash: hash(1) }],
    ['negative nonce', { status: 'signed' as const, header: 'h', hash: hash(1), nonce: -1 }],
    ['fractional nonce', { status: 'signed' as const, header: 'h', hash: hash(1), nonce: 1.5 }],
    ['uppercase hash', { status: 'signed' as const, header: 'h', hash: '0x' + 'A'.repeat(64), nonce: 1 }],
    ['short hash', { status: 'signed' as const, header: 'h', hash: '0x12', nonce: 1 }],
    ['zero amount', { amount: '0' }],
    ['non-integer amount', { amount: '1.5' }],
    ['zero gas budget', { gasBudget: '0' }],
    ['bad date', { createdAt: 'yesterday' }],
    ['empty id', { id: '' }],
    ['unknown status', { status: 'broadcast' as never }],
  ])('rejects a malformed entry: %s', (_name, values) => {
    const { ledger } = setup();
    expect(() => ledger.upsert(entry('bad', values as Partial<XLayerLedgerEntry>))).toThrow();
    expect(ledger.read()).toEqual([]);
  });

  it('rejects unknown fields on an entry', () => {
    const { ledger } = setup();
    expect(() => ledger.upsert({ ...entry('x'), extra: true } as XLayerLedgerEntry)).toThrow();
  });

  it('rejects reuse of a transaction hash or a signed nonce by another purchase', async () => {
    const { ledger } = setup();
    await store(ledger, signed('purchase-1', 0, { hash: hash(1) }));
    await expect(store(ledger, signed('purchase-2', 1, { hash: hash(1) }))).rejects.toThrow();
    await expect(store(ledger, signed('purchase-3', 0, { hash: hash(3) }))).rejects.toThrow();
    expect(ledger.read().map(e => e.id)).toEqual(['purchase-1']);
    await store(ledger, signed('purchase-4', 1, { hash: hash(4) })); // distinct hash and nonce is fine
    expect(ledger.read()).toHaveLength(2);
  });

  it('allows several unsigned reservations (they share null nonce/hash)', async () => {
    const { ledger } = setup();
    await store(ledger, entry('a'));
    await store(ledger, entry('b'));
    expect(ledger.read()).toHaveLength(2);
  });

  it('fails closed on missing, corrupt, wrong-identity or unrecognized history', () => {
    const root = mkdtempSync(join(tmpdir(), 'xlayer-ledger-missing-'));
    roots.push(root);
    expect(() => new XLayerLedger(join(root, 'missing.json'), OWNER).read()).toThrow(/missing/);

    const { ledger } = setup();
    const good = readFileSync(ledger.path, 'utf8');
    writeFileSync(ledger.path, '{broken');
    expect(() => ledger.read()).toThrow(/history unavailable/);
    writeFileSync(ledger.path, good.replace(NETWORK, 'eip155:196'));
    expect(() => ledger.read()).toThrow(/history unavailable/);
    writeFileSync(ledger.path, good.replace(TOKEN, '0x' + 'e'.repeat(40)));
    expect(() => ledger.read()).toThrow(/history unavailable/);
    writeFileSync(ledger.path, good);
    expect(() => new XLayerLedger(ledger.path, '0x' + 'b'.repeat(40)).read()).toThrow(/history unavailable/);
    expect(ledger.read()).toEqual([]);
  });

  it('rejects a hand-edited history that duplicates a purchase, hash or nonce', async () => {
    const { ledger } = setup();
    await store(ledger, signed('purchase-1', 0, { hash: hash(1) }));
    const stored = JSON.parse(readFileSync(ledger.path, 'utf8'));
    for (const second of [signed('purchase-1', 1, { hash: hash(2) }), signed('purchase-2', 1, { hash: hash(1) }), signed('purchase-2', 0, { hash: hash(2) })]) {
      writeFileSync(ledger.path, JSON.stringify({ ...stored, entries: [stored.entries[0], second] }));
      expect(() => ledger.read()).toThrow(/history unavailable/);
    }
  });

  it('serializes callers, releases the lock afterwards, and leaves stale locks for manual recovery', async () => {
    const { ledger } = setup();
    let release!: () => void;
    const held = ledger.exclusive(() => new Promise<void>(resolve => { release = resolve; }));
    await expect(ledger.exclusive(async () => undefined)).rejects.toThrow(/locked/);
    release();
    await held;
    expect(existsSync(`${ledger.path}.lock`)).toBe(false);

    await expect(ledger.exclusive(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(existsSync(`${ledger.path}.lock`)).toBe(false); // released even when the critical section throws

    writeFileSync(`${ledger.path}.lock`, 'stale');
    await expect(ledger.exclusive(async () => undefined)).rejects.toThrow(/locked/);
    expect(existsSync(`${ledger.path}.lock`)).toBe(true);
  });

  it('never runs the critical section against a missing or corrupt ledger', async () => {
    const root = mkdtempSync(join(tmpdir(), 'xlayer-ledger-nofn-'));
    roots.push(root);
    const missing = new XLayerLedger(join(root, 'none.json'), OWNER);
    let ran = false;
    await expect(missing.exclusive(async () => { ran = true; })).rejects.toThrow(/missing/);
    expect(ran).toBe(false);
    expect(existsSync(`${missing.path}.lock`)).toBe(false);
  });

  it('fails closed (without losing history) when a previous write left a temp file behind', async () => {
    const { ledger } = setup();
    await store(ledger, entry('purchase-1'));
    writeFileSync(`${ledger.path}.tmp`, 'partial');
    await expect(store(ledger, entry('purchase-2'))).rejects.toThrow();
    expect(ledger.read().map(e => e.id)).toEqual(['purchase-1']);
  });

  it('binds its stored network and asset to the official X Layer Testnet configuration', () => {
    const { ledger } = setup();
    expect(JSON.parse(readFileSync(ledger.path, 'utf8'))).toMatchObject({ version: 1, owner: OWNER, network: NETWORK, asset: TOKEN, entries: [] });
  });
});

describe('X Layer shared cap calculation', () => {
  const rows = (...values: Array<Partial<XLayerLedgerEntry>>) => values.map((v, i) => entry('p' + i, v));
  const day = 24 * 60 * 60 * 1000;

  it('excludes accepted entries outside the rolling window from the daily cap but never from the total or gas cap', () => {
    const old = new Date(NOW.getTime() - day - 1).toISOString();
    const entries = rows({ amount: '100', gasBudget: '20', status: 'accepted', createdAt: old, header: 'h', hash: hash(1), nonce: 0 });
    expect(() => assertXLayerCaps(entries, 100n, 1n, { ...policy, maxDaily: 100n }, NOW)).not.toThrow();
    expect(() => assertXLayerCaps(entries, 100n, 1n, { ...policy, maxTotal: 199n }, NOW)).toThrow(/cumulative spend/);
    expect(() => assertXLayerCaps(entries, 1n, 31n, { ...policy, maxGasPerPayment: 40n }, NOW)).toThrow(/cumulative gas/);
  });

  it('counts an old reserved or signed entry in the daily window until it is accepted (conservative)', () => {
    const old = new Date(NOW.getTime() - 5 * day).toISOString();
    const entries = rows({ amount: '100', createdAt: old });
    expect(() => assertXLayerCaps(entries, 51n, 1n, policy, NOW)).toThrow(/rolling 24-hour/);
  });

  it('counts entries created exactly at the window boundary and in the future', () => {
    const boundary = new Date(NOW.getTime() - day).toISOString(), future = new Date(NOW.getTime() + 1).toISOString();
    expect(() => assertXLayerCaps(rows({ amount: '100', status: 'accepted', createdAt: boundary, header: 'h', hash: hash(1), nonce: 0 }), 51n, 1n, policy, NOW)).toThrow(/rolling 24-hour/);
    expect(() => assertXLayerCaps(rows({ amount: '100', status: 'accepted', createdAt: future, header: 'h', hash: hash(1), nonce: 0 }), 51n, 1n, policy, NOW)).toThrow(/rolling 24-hour/);
  });

  it.each([
    ['zero amount', [0n, 1n, policy]], ['zero gas', [1n, 0n, policy]], ['negative amount', [-1n, 1n, policy]],
    ['zero per-payment cap', [1n, 1n, { ...policy, maxPerPayment: 0n }]], ['zero daily cap', [1n, 1n, { ...policy, maxDaily: 0n }]],
    ['zero total cap', [1n, 1n, { ...policy, maxTotal: 0n }]], ['zero gas cap', [1n, 1n, { ...policy, maxGasTotal: 0n }]],
  ] as const)('rejects %s', (_name, [amount, gas, p]) => {
    expect(() => assertXLayerCaps([], amount, gas, p, NOW)).toThrow(/must be positive/);
  });

  it('requires a valid reference time', () => {
    expect(() => assertXLayerCaps([], 1n, 1n, policy, new Date('nope'))).toThrow(/reference time/);
  });
});

describe('X Layer nonce discipline', () => {
  it('uses the chain pending count when no other candidate holds a nonce', () => {
    expect(nextNonce([], 'pur_a', 7)).toBe(7);
    expect(nextNonce([entry('pur_b')], 'pur_a', 7)).toBe(7); // an unsigned reservation holds no nonce
    expect(nextNonce([signed('pur_b', 3)], 'pur_a', 7)).toBe(7); // consumed on-chain (3 < 7)
  });

  it('blocks while another purchase holds a nonce the chain has not yet counted', () => {
    expect(() => nextNonce([signed('pur_b', 7)], 'pur_a', 7)).toThrow(/unconsumed nonce/);
    expect(() => nextNonce([signed('pur_b', 9)], 'pur_a', 7)).toThrow(/unconsumed nonce/);
    expect(() => nextNonce([signed('pur_b', 2), signed('pur_c', 7)], 'pur_a', 7)).toThrow(/unconsumed nonce/);
    expect(() => nextNonce([signed('pur_b', 7, { status: 'accepted' })], 'pur_a', 7)).toThrow(/unconsumed nonce/);
  });

  it('is released once the chain pending count passes the held nonce', () => {
    const entries = [signed('pur_b', 7)];
    expect(() => nextNonce(entries, 'pur_a', 7)).toThrow();
    expect(nextNonce(entries, 'pur_a', 8)).toBe(8);
  });

  it('never blocks a purchase on its own candidate', () => {
    expect(nextNonce([signed('pur_a', 7)], 'pur_a', 7)).toBe(7);
    expect(nextNonce([signed('pur_a', 7)], 'pur_a', 5)).toBe(5);
  });
});

describe('X Layer ledger real file protection', () => {
  it('works end to end against a genuinely owner-protected directory', async () => {
    const { ledger } = setup({ real: true });
    await store(ledger, signed('purchase-1', 0));
    expect(new XLayerLedger(ledger.path, OWNER).read()).toEqual([signed('purchase-1', 0)]);
  });

  it('refuses to read, and therefore to sign against, a ledger that other local principals can access', () => {
    const { ledger } = setup({ real: true });
    expect(ledger.read()).toEqual([]);
    if (process.platform === 'win32') execFileSync('icacls.exe', [ledger.path, '/grant', '*S-1-1-0:(R)'], { stdio: 'pipe' });
    else { chmodSync(join(ledger.path, '..'), 0o755); chmodSync(ledger.path, 0o644); }
    expect(() => ledger.read()).toThrow(/history unavailable/);
    expect(() => ledger.upsert(entry('x'))).toThrow(/history unavailable/);
  });
});
