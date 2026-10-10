import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NETWORK, USDC_TYPE } from '../../src/funding/sui/config.js';
import { SuiLedger, assertSuiFileRetired, retireSuiFileLedger, type SuiLedgerEntry, type SuiSpendPolicy } from '../../clients/sui/ledger.js';

const OWNER = '0x' + 'a'.repeat(64);
const NOW = new Date('2026-10-08T00:00:00.000Z');
const roots: string[] = [];
const policy: SuiSpendPolicy = {
  maxPerPayment: 100n,
  maxDaily: 150n,
  maxTotal: 300n,
  maxGasPerPayment: 20n,
  maxGasTotal: 50n,
};

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sui-ledger-'));
  roots.push(root);
  const ledger = new SuiLedger(join(root, 'payer.json'), OWNER);
  ledger.initialize();
  return { root, ledger };
}

function entry(id: string, values: Partial<SuiLedgerEntry> = {}): SuiLedgerEntry {
  return {
    id,
    amount: '30',
    gasBudget: '5',
    header: null,
    digest: null,
    createdAt: NOW.toISOString(),
    status: 'reserved',
    ...values,
  };
}

async function store(ledger: SuiLedger, row: SuiLedgerEntry): Promise<void> {
  await ledger.exclusive(async () => ledger.upsert(row));
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Sui durable payer ledger', () => {
  it('initializes an identity-bound empty history and refuses to reset it', () => {
    const { ledger } = setup();
    expect(ledger.read()).toEqual([]);
    expect(() => ledger.initialize()).toThrow();
    expect(ledger.read()).toEqual([]);
  });

  it('persists all reservations across restart and counts them against rolling, total and gas caps', async () => {
    const { ledger } = setup();
    await store(ledger, entry('purchase-1', { amount: '70', gasBudget: '20', status: 'signed', header: 'opaque-signed-header', digest: 'digest-1' }));
    await store(ledger, entry('purchase-2', { amount: '40', gasBudget: '10', createdAt: new Date(NOW.getTime() + 60_000).toISOString() }));

    const restarted = new SuiLedger(ledger.path, OWNER);
    expect(restarted.read()).toHaveLength(2);
    expect(() => restarted.assertCaps(41n, 1n, policy, NOW)).toThrow(/rolling 24-hour/);
    expect(() => restarted.assertCaps(1n, 21n, policy, NOW)).toThrow(/per-payment gas/);
    expect(() => restarted.assertCaps(1n, 1n, { ...policy, maxTotal: 110n }, NOW)).toThrow(/cumulative spend/);
    expect(() => restarted.assertCaps(1n, 21n, { ...policy, maxGasTotal: 30n, maxGasPerPayment: 30n }, NOW)).toThrow(/cumulative gas/);
    expect(() => restarted.assertCaps(101n, 1n, policy, NOW)).toThrow(/per-payment cap/);
  });

  it('allows old entries outside the rolling window but counts future reservations in the window', async () => {
    const { ledger } = setup();
    await store(ledger, entry('old', { amount: '100', createdAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000 - 1).toISOString() }));
    await store(ledger, entry('future', { amount: '40', createdAt: new Date(NOW.getTime() + 1).toISOString() }));
    expect(() => ledger.assertCaps(111n, 1n, { ...policy, maxPerPayment: 200n, maxDaily: 150n, maxTotal: 300n }, NOW)).toThrow(/rolling 24-hour/);
    expect(() => ledger.assertCaps(100n, 1n, { ...policy, maxDaily: 300n, maxTotal: 300n }, NOW)).not.toThrow();
  });

  it('keeps reservation fields and persisted signed candidates immutable', async () => {
    const { ledger } = setup();
    const reserved = entry('purchase-1');
    await store(ledger, reserved);
    await expect(ledger.exclusive(async () => ledger.upsert({ ...reserved, amount: '31' }))).rejects.toThrow(/reservation is immutable/);

    const signed = { ...reserved, status: 'signed' as const, header: 'opaque-signed-header', digest: 'digest-1' };
    await store(ledger, signed);
    await expect(ledger.exclusive(async () => ledger.upsert({ ...signed, digest: 'digest-2' }))).rejects.toThrow(/candidate is immutable/);
    await expect(ledger.exclusive(async () => ledger.upsert({ ...signed, status: 'reserved', header: null, digest: null }))).rejects.toThrow(/status cannot move backwards/);

    const accepted = { ...signed, status: 'accepted' as const };
    await store(ledger, accepted);
    expect(ledger.read()).toEqual([accepted]);
  });

  it('rejects malformed status/header combinations and non-positive amounts', async () => {
    const { ledger } = setup();
    expect(() => ledger.upsert(entry('reserved-with-header', { header: 'header', digest: 'digest' }))).toThrow();
    expect(() => ledger.upsert(entry('signed-without-digest', { status: 'signed', header: 'header' }))).toThrow();
    expect(() => ledger.upsert(entry('zero', { amount: '0' }))).toThrow();
    expect(() => ledger.upsert(entry('zero-gas', { gasBudget: '0' }))).toThrow();
    expect(() => ledger.upsert(entry('bad-date', { createdAt: 'yesterday' }))).toThrow();
  });

  it('rejects reuse of a transaction digest for another purchase', async () => {
    const { ledger } = setup();
    await store(ledger, entry('purchase-1', { status: 'signed', header: 'header-1', digest: 'digest-1' }));
    await expect(store(ledger, entry('purchase-2', { status: 'signed', header: 'header-2', digest: 'digest-1' }))).rejects.toThrow();
    expect(ledger.read()).toHaveLength(1);
  });

  it('fails closed on missing, corrupt, or wrong-identity history', () => {
    const root = mkdtempSync(join(tmpdir(), 'sui-ledger-missing-'));
    roots.push(root);
    const missing = new SuiLedger(join(root, 'missing.json'), OWNER);
    expect(() => missing.read()).toThrow(/missing/);

    const { ledger } = setup();
    writeFileSync(ledger.path, '{broken');
    expect(() => ledger.read()).toThrow(/history unavailable/);

    const wrongIdentity = new SuiLedger(ledger.path, '0x' + 'b'.repeat(64));
    expect(() => wrongIdentity.read()).toThrow(/history unavailable/);
  });

  it('serializes callers and leaves stale locks for manual recovery', async () => {
    const { ledger } = setup();
    let release!: () => void;
    const held = ledger.exclusive(() => new Promise<void>(resolve => { release = resolve; }));
    await expect(ledger.exclusive(async () => undefined)).rejects.toThrow(/locked/);
    release();
    await held;

    writeFileSync(`${ledger.path}.lock`, 'stale');
    await expect(ledger.exclusive(async () => undefined)).rejects.toThrow(/locked/);
    expect(existsSync(`${ledger.path}.lock`)).toBe(true);
  });

  it('binds its stored network and asset to the official Sui configuration', () => {
    const { ledger } = setup();
    const stored = JSON.parse(readFileSync(ledger.path, 'utf8'));
    expect(stored).toMatchObject({ owner: OWNER, network: NETWORK, asset: USDC_TYPE });
  });
});

const historyHash = (ledger: SuiLedger) => createHash('sha256').update(readFileSync(ledger.path)).digest('hex');

describe('permanent Sui file signer retirement', () => {
  it('preserves exact reservations, signed candidates and gas while refusing every ordinary payment access after restart', async () => {
    const {ledger} = setup();
    await store(ledger, entry('reserved'));
    await store(ledger, entry('signed', {status:'signed',header:'opaque-candidate',digest:'digest'}));
    const original = readFileSync(ledger.path), hash = historyHash(ledger);
    retireSuiFileLedger(ledger, hash);
    const restart = new SuiLedger(ledger.path, OWNER), signing = vi.fn();
    expect(() => restart.read()).toThrow(/retired/);
    expect(() => restart.initialize()).toThrow(/retired/);
    expect(() => restart.upsert(entry('new'))).toThrow(/retired/);
    expect(() => restart.assertCaps(1n,1n,policy,NOW)).toThrow(/retired/);
    await expect(restart.exclusive(signing)).rejects.toThrow(/retired/);
    expect(signing).not.toHaveBeenCalled();
    expect(restart.readForImport()).toHaveLength(2);
    expect(readFileSync(ledger.path)).toEqual(original);
    assertSuiFileRetired(restart, hash);
    retireSuiFileLedger(restart, hash); // Idempotent for precisely the same history.
    expect(existsSync(ledger.path+'.lock')).toBe(true);
  });

  it('fails closed even on an invalid retirement marker and refuses to reinterpret it', async () => {
    const {ledger} = setup(), hash = historyHash(ledger);
    writeFileSync(ledger.path+'.retired','broken',{mode:0o600});
    expect(() => ledger.read()).toThrow(/retired/);
    await expect(ledger.exclusive(async()=>{})).rejects.toThrow(/retired/);
    expect(() => retireSuiFileLedger(ledger,hash)).toThrow();
    expect(ledger.readForImport()).toEqual([]);
  });

  it('refuses active/stale signer locks and changed history without replacing files', async () => {
    const {ledger} = setup(), hash = historyHash(ledger);
    await ledger.exclusive(async () => {
      expect(() => retireSuiFileLedger(ledger, hash)).toThrow(/fence conflict/);
      expect(existsSync(ledger.path+'.retired')).toBe(false);
    });
    expect(() => retireSuiFileLedger(ledger,'0'.repeat(64))).toThrow(/hash mismatch/);
    expect(existsSync(ledger.path+'.lock')).toBe(false);
    writeFileSync(ledger.path+'.lock','stale',{mode:0o600});
    expect(() => retireSuiFileLedger(ledger,hash)).toThrow(/fence conflict/);
    expect(readFileSync(ledger.path+'.lock','utf8')).toBe('stale');
  });

  it('resumes interrupted retirement only from its matching durable fence and requires both fences for import', async () => {
    const {ledger} = setup(), hash = historyHash(ledger);
    const marker=JSON.stringify({version:1,owner:OWNER,sourceSha256:hash});
    writeFileSync(ledger.path+'.lock',marker,{mode:0o600});
    expect(() => assertSuiFileRetired(ledger,hash)).toThrow();
    const signing=vi.fn();
    await expect(ledger.exclusive(signing)).rejects.toThrow(/locked/);
    expect(signing).not.toHaveBeenCalled();
    retireSuiFileLedger(ledger,hash);
    assertSuiFileRetired(ledger,hash);
    expect(() => assertSuiFileRetired(ledger,'0'.repeat(64))).toThrow(/hash mismatch/);
  });
});

describe('interrupted Sui retirement fence writes',()=>{
  it('keeps a partial fence closed without repairing it or modifying the history',async()=>{
    const {ledger}=setup(),original=readFileSync(ledger.path),hash=historyHash(ledger);
    writeFileSync(ledger.path+'.lock','{"version":1,',{mode:0o600});
    const signing=vi.fn();
    await expect(ledger.exclusive(signing)).rejects.toThrow(/locked/);
    expect(signing).not.toHaveBeenCalled();
    expect(()=>retireSuiFileLedger(ledger,hash)).toThrow(/fence conflict/);
    expect(()=>assertSuiFileRetired(ledger,hash)).toThrow();
    expect(readFileSync(ledger.path)).toEqual(original);
    expect(readFileSync(ledger.path+'.lock','utf8')).toBe('{"version":1,');
  });
});
