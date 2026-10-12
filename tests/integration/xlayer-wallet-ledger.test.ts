import { describe, it, expect, vi } from 'vitest';
import { createTestDb, crashTestDb, newTestSchema } from '../support/database.js';
import { PgXLayerLedger } from '../../clients/xlayer/pg-ledger.js';
import type { XLayerLedgerEntry } from '../../clients/xlayer/ledger.js';
import { registerWallets } from '../../scripts/multiwallet/registration.js';
import { xlayerPolicy, assertPinnedPolicy } from '../../clients/multiwallet/policy.js';
import { loadXLayerPayerConfig } from '../../clients/xlayer/config.js';
import { FundingSource } from '../../src/contracts/presentation.js';

const owner = '0x' + 'a'.repeat(40), hash1 = '0x' + '1'.repeat(64), hash2 = '0x' + '2'.repeat(64);
const signed: XLayerLedgerEntry = { id: 'pur_1234567890', amount: '1000', gasBudget: '1000000000000000', nonce: 7, header: 'candidate', hash: hash1, createdAt: '2026-10-13T00:00:00.000Z', status: 'signed' };
const reserved: XLayerLedgerEntry = { id: 'pur_reserved00001', amount: '1000', gasBudget: '1000000000000000', nonce: null, header: null, hash: null, createdAt: '2026-10-13T00:00:01.000Z', status: 'reserved' };
const policy = { maxPerPayment: 1000n, maxDaily: 10000n, maxTotal: 2001n, maxGasPerPayment: 10n ** 15n, maxGasTotal: 10n ** 16n };

describe('native PostgreSQL X Layer payer history', () => {
  it('requires an explicit identity, never resets it, and preserves exact candidates across restart', async () => {
    const schema = newTestSchema(), db = await createTestDb(schema);
    await expect(PgXLayerLedger.open(db, owner)).rejects.toThrow('missing');
    expect(await PgXLayerLedger.initialize(db, owner)).toBe('created');
    expect(await PgXLayerLedger.initialize(db, owner)).toBe('exists');
    const ledger = await PgXLayerLedger.open(db, owner);
    await ledger.upsert(reserved);
    await ledger.upsert(signed);
    await ledger.upsert({ ...signed, status: 'accepted' });
    await db.close();
    const reopened = await PgXLayerLedger.open(await createTestDb(schema), owner);
    const rows = await reopened.read();
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.id === signed.id)).toEqual({ ...signed, status: 'accepted' });
    expect(rows.find(r => r.id === reserved.id)).toEqual(reserved);
    await expect(reopened.upsert({ ...signed, status: 'accepted', amount: '1001' })).rejects.toThrow('immutable');
    await expect(reopened.upsert({ ...signed, status: 'accepted', header: 'different' })).rejects.toThrow('immutable');
    await expect(reopened.upsert({ ...signed, status: 'accepted', nonce: 8 })).rejects.toThrow('immutable');
    await expect(reopened.upsert({ ...signed, status: 'reserved', header: null, hash: null, nonce: null })).rejects.toThrow();
    // A different purchase can never reuse a signed hash or nonce.
    await expect(reopened.upsert({ ...signed, id: 'pur_other00000001', amount: '1', gasBudget: '1' })).rejects.toThrow();
    await expect(reopened.upsert({ ...signed, id: 'pur_other00000002', hash: hash2 })).rejects.toThrow();
  });

  it('is append-only at the database layer', async () => {
    const db = await createTestDb();
    await PgXLayerLedger.initialize(db, owner);
    const ledger = await PgXLayerLedger.open(db, owner);
    await ledger.upsert(signed);
    await expect(db.run('DELETE FROM hosted_xlayer_ledger')).rejects.toThrow('cannot be deleted');
    await expect(db.run('TRUNCATE hosted_xlayer_ledger')).rejects.toThrow('permanent');
    await expect(db.run('UPDATE hosted_xlayer_identity SET network=$1', 'x')).rejects.toThrow();
    await expect(db.run('DELETE FROM hosted_xlayer_identity')).rejects.toThrow();
  });

  it('serializes cap races across processes and refuses lost lock sessions without signing', async () => {
    const schema = newTestSchema(), db = await createTestDb(schema);
    await PgXLayerLedger.initialize(db, owner);
    const a = await PgXLayerLedger.open(db, owner), other = await createTestDb(schema), b = await PgXLayerLedger.open(other, owner);
    await a.upsert({ ...signed, amount: '1001' });
    let release!: () => void, enter!: () => void;
    const gate = new Promise<void>(r => release = r), entered = new Promise<void>(r => enter = r);
    const holding = a.exclusive(async () => { enter(); await gate; });
    await entered;
    await expect(b.exclusive(async () => {})).rejects.toThrow('busy');
    release(); await holding;
    const build = vi.fn(), submit = vi.fn();
    await expect(a.exclusive(async () => { await crashTestDb(db); await a.upsert({ ...reserved, id: 'pur_crash0000001' }); build(); submit(); })).rejects.toThrow();
    expect(build).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    const add = async (l: PgXLayerLedger, id: string) => l.exclusive(async () => {
      await l.assertCaps(1000n, 1n, policy, new Date('2026-10-13T00:00:02Z'));
      await l.upsert({ ...reserved, id, amount: '1000', gasBudget: '1' });
    });
    const results = await Promise.allSettled([add(b, 'pur_race00000001'), add(await PgXLayerLedger.open(await createTestDb(schema), owner), 'pur_race00000002')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('registers an X Layer wallet disabled against a pinned policy and existing history only', async () => {
    const db = await createTestDb(), customer = 'cus_1234567890', payer = '0x' + 'b'.repeat(40);
    await db.run("INSERT INTO customers VALUES($1,'synthetic owner','now')", customer);
    const e = { XLAYER_NETWORK: 'eip155:1952', XLAYER_CHAIN_ID: '1952', XLAYER_RPC_URL: 'https://testrpc.xlayer.tech/terigon', XLAYER_TOKEN_ADDRESS: '0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c',
      XLAYER_ASSET_DECIMALS: '6', XLAYER_TREASURY_ADDRESS: '0x' + 'c'.repeat(40), XLAYER_MAX_PAYMENT_BASE_UNITS: '10000', XLAYER_MAX_GAS_BUDGET_WEI: '1000000000000000',
      XLAYER_PAYER_ADDRESS: payer, XLAYER_PAYER_KEY_FILE: 'C:/fixture/NO_KEY_EXISTS', XLAYER_GATEWAY_URL: 'https://gateway.example.test', XLAYER_GATEWAY_TOKEN_FILE: 'C:/fixture/NO_TOKEN_EXISTS',
      XLAYER_PAYER_MAX_PAYMENT_BASE_UNITS: '10000', XLAYER_PAYER_MAX_DAILY_BASE_UNITS: '20000', XLAYER_PAYER_MAX_TOTAL_BASE_UNITS: '30000',
      XLAYER_PAYER_MAX_TOTAL_GAS_WEI: '10000000000000000', XLAYER_PAYER_MAX_COMMERCIAL_USD_MINOR: '10000' };
    const cfg = loadXLayerPayerConfig(e, { ledger: 'external' }), env = Object.fromEntries(Object.entries(e).map(([k, v]) => ['DEMO_' + k, v]));
    const source = FundingSource.parse({ sourceId: 'src_' + '2'.repeat(32), rail: 'xlayer', network: 'eip155:1952', assetId: e.XLAYER_TOKEN_ADDRESS, publicAddress: payer, displayAddress: payer.slice(0, 12), readiness: 'configured' });
    const manifest = { customerId: customer, payerId: 'payer_synthetic123', wallets: [{ source, signerRef: 'DEMO', ledgerNamespace: 'demo-xlayer', policy: xlayerPolicy(cfg) }] };
    await expect(registerWallets(db, manifest, env)).rejects.toThrow();
    await PgXLayerLedger.initialize(db, payer);
    expect(await registerWallets(db, manifest, env)).toMatchObject({ mode: 'validate-only', signingGranted: false });
    const approved = { ...env, CAPSULE_APPROVED_REGISTRATION: 'true' };
    expect(await registerWallets(db, manifest, approved, true)).toMatchObject({ mode: 'registered-disabled', signingGranted: false });
    expect((await db.get<{ enabled: boolean; rail: string }>('SELECT * FROM registered_wallets'))).toMatchObject({ enabled: false, rail: 'xlayer' });
    expect(await db.get('SELECT * FROM wallet_signing_authority')).toBeUndefined();
    await expect(registerWallets(db, manifest, { ...approved, DEMO_XLAYER_PAYER_MAX_TOTAL_BASE_UNITS: '40000' }, true)).rejects.toThrow('policy');
    expect(() => assertPinnedPolicy(JSON.stringify(xlayerPolicy(cfg)), { ...xlayerPolicy(cfg), maxTotal: '30001' })).toThrow('policy');
    await expect(db.run("UPDATE registered_wallets SET policy_json='{}'")).rejects.toThrow('immutable');
    await expect(db.run("INSERT INTO registered_wallets(source_id,payer_id,rail,network,asset_id,public_address,signer_ref,ledger_namespace,policy_json,public_json) VALUES($1,'payer_synthetic123','other','n','a','p','S','l','{}','{}')", 'src_' + '3'.repeat(32))).rejects.toThrow();
  });
});
