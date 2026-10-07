import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PgSolanaLedger } from '../../clients/solana/pg-ledger.js';
import { importSolanaHistories, parseSolanaImport, retireSolanaHistories, solanaSourceHash, type SolanaImportInput } from '../../clients/solana/ledger-import.js';
import { SolanaLedger, type SolanaLedgerEntry } from '../../clients/solana/ledger.js';
import { NETWORK, TEST_MINT } from '../../src/funding/solana/wire.js';
import { createTestDb, newTestSchema } from '../support/database.js';

const PAYER = 'payer-test-address';
const SPONSOR = 'sponsor-test-address';
const CREATED = '2026-10-06T14:00:00.000Z';
const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

const entry = (id: string, signature: string | null, amount: string, fee = '0', header: string | null = null): SolanaLedgerEntry => ({
  id, signature, amount, fee, header, createdAt: CREATED,
});
const histories = () => ({
  payer: [
    entry('history:legacy-1', 'payer-chain-1', '0'),
    entry('history:legacy-2', 'payer-chain-2', '0'),
    entry('history:legacy-3', 'payer-chain-3', '0'),
    entry('reservation:stale', null, '1050'),
    entry('reservation:stale-2', null, '1050'),
    entry('history:proof-small', 'proof-small-signature', '1050', '0', 'proof-small-header'),
    entry('history:proof-large', 'proof-large-signature', '91070', '0', 'proof-large-header'),
  ],
  sponsor: [
    entry('history:sponsor-legacy-1', 'sponsor-chain-1', '0', '5000'),
    entry('history:sponsor-legacy-2', 'sponsor-chain-2', '0'),
    entry('history:sponsor-legacy-3', 'sponsor-chain-3', '0'),
    entry('history:sponsor-legacy-4', 'sponsor-chain-4', '0'),
    entry('history:proof-small', 'proof-small-signature', '0', '10001', 'sponsor-small-header'),
    entry('history:proof-large', 'proof-large-signature', '0', '10001', 'sponsor-large-header'),
  ],
});
function input(role: 'payer' | 'sponsor', owner: string, entries: SolanaLedgerEntry[]): SolanaImportInput {
  const text = JSON.stringify({ version: 1, owner, network: NETWORK, mint: TEST_MINT, entries });
  return { role, owner, text, expectedSha256: solanaSourceHash(text) };
}
function importInputs() {
  const rows = histories();
  return [input('payer', PAYER, rows.payer), input('sponsor', SPONSOR, rows.sponsor)] as [SolanaImportInput, SolanaImportInput];
}
const verifyWithoutRpc = vi.fn(async (_owner: string, _entries: SolanaLedgerEntry[]) => { await Promise.resolve(); });


describe('PostgreSQL Solana history import', () => {
  it('refuses signer startup without the permanent history marker', async () => {
    const db = await createTestDb();
    await expect(PgSolanaLedger.open(db, 'payer', PAYER)).rejects.toThrow(/history import missing or mismatched/);
  });

  it('imports both signer roles atomically and an exact rerun is idempotent', async () => {
    const db = await createTestDb();
    const inputs = importInputs();
    verifyWithoutRpc.mockClear();
    await importSolanaHistories(db, inputs, verifyWithoutRpc);

    expect(verifyWithoutRpc).toHaveBeenCalledTimes(2);
    expect(await PgSolanaLedger.open(db, 'payer', PAYER).then((ledger) => ledger.read())).toEqual([...histories().payer].sort((a, b) => a.id.localeCompare(b.id)));
    expect(await PgSolanaLedger.open(db, 'sponsor', SPONSOR).then((ledger) => ledger.read())).toEqual([...histories().sponsor].sort((a, b) => a.id.localeCompare(b.id)));
    expect(await PgSolanaLedger.open(db, 'payer', PAYER).then((ledger) => ledger.summary())).toMatchObject({ entries: 7, incomplete: 2, committedBaseUnits: '94220', imported: { sourceSha256: inputs[0].expectedSha256, entries: 7, committedBaseUnits: '94220' } });
    expect(await PgSolanaLedger.open(db, 'sponsor', SPONSOR).then((ledger) => ledger.summary())).toMatchObject({ entries: 6, committedFeeLamports: '25002', imported: { sourceSha256: inputs[1].expectedSha256, entries: 6, committedFeeLamports: '25002' } });
    expect(await db.all('SELECT role FROM hosted_solana_import ORDER BY role')).toEqual([{ role: 'payer' }, { role: 'sponsor' }]);

    await importSolanaHistories(db, inputs, verifyWithoutRpc);
    expect(verifyWithoutRpc).toHaveBeenCalledTimes(2);
    expect(await db.all('SELECT role FROM hosted_solana_import ORDER BY role')).toEqual([{ role: 'payer' }, { role: 'sponsor' }]);
  });

  it('rolls back both roles if the second identity conflicts during import', async () => {
    const db = await createTestDb();
    await db.run('INSERT INTO hosted_solana_identity(role,owner,network,mint) VALUES($1,$2,$3,$4)', 'sponsor', SPONSOR, NETWORK, TEST_MINT);

    await expect(importSolanaHistories(db, importInputs(), verifyWithoutRpc)).rejects.toThrow();
    expect(await db.all('SELECT role FROM hosted_solana_identity')).toEqual([{ role: 'sponsor' }]);
    expect(await db.all('SELECT * FROM hosted_solana_import')).toEqual([]);
    expect(await db.all('SELECT * FROM hosted_solana_ledger')).toEqual([]);
  });

  it('rejects source hash, identity, duplicate row and marker conflicts', async () => {
    const db = await createTestDb();
    const inputs = importInputs();
    await expect(importSolanaHistories(db, [{ ...inputs[0], expectedSha256: 'f'.repeat(64) }, inputs[1]], verifyWithoutRpc)).rejects.toThrow(/hash mismatch/);
    const mismatchedText = JSON.stringify({ version: 1, owner: 'different-payer', network: NETWORK, mint: TEST_MINT, entries: histories().payer });
    const mismatchedOwner = { ...inputs[0], text: mismatchedText, expectedSha256: solanaSourceHash(mismatchedText) };
    await expect(importSolanaHistories(db, [mismatchedOwner, inputs[1]], verifyWithoutRpc)).rejects.toThrow(/identity or entry conflict/);
    const duplicated = [...histories().payer, histories().payer[0]!];
    expect(() => parseSolanaImport(input('payer', PAYER, duplicated))).toThrow(/identity or entry conflict/);
    const duplicateSignature = [...histories().payer, entry('other-id', 'payer-chain-1', '1')];
    expect(() => parseSolanaImport(input('payer', PAYER, duplicateSignature))).toThrow(/identity or entry conflict/);

    await importSolanaHistories(db, inputs, verifyWithoutRpc);
    const changedRows = [...histories().payer, entry('reservation:changed', null, '1')];
    await expect(importSolanaHistories(db, [input('payer', PAYER, changedRows), inputs[1]], verifyWithoutRpc)).rejects.toThrow(/marker conflict/);
    expect(await db.all('SELECT role FROM hosted_solana_import ORDER BY role')).toEqual([{ role: 'payer' }, { role: 'sponsor' }]);
  });

  it('counts stale reservations toward caps and makes imported facts, signatures, headers and rows permanent', async () => {
    const db = await createTestDb();
    await importSolanaHistories(db, importInputs(), verifyWithoutRpc);
    const payer = await PgSolanaLedger.open(db, 'payer', PAYER);
    const stale = (await payer.read()).find((row) => row.id === 'reservation:stale')!;

    expect(await payer.summary()).toMatchObject({ entries: 7, incomplete: 2, committedBaseUnits: '94220', committedFeeLamports: '0' });
    await expect(payer.assertCaps(7780n, 0n, 102000n, 100000n)).resolves.toBeUndefined();
    await expect(payer.assertCaps(7781n, 0n, 102000n, 100000n)).rejects.toThrow(/cap exceeded/);
    const sponsor = await PgSolanaLedger.open(db, 'sponsor', SPONSOR);
    await expect(sponsor.assertCaps(0n, 74998n, 102000n, 100000n)).resolves.toBeUndefined();
    await expect(sponsor.assertCaps(0n, 74999n, 102000n, 100000n)).rejects.toThrow(/cap exceeded/);

    await payer.upsert({ ...stale, signature: 'stale-signature', header: 'stale-header' });
    await expect(payer.upsert({ ...stale, amount: '1051', signature: 'stale-signature', header: 'stale-header' })).rejects.toThrow(/immutable/);
    await expect(payer.upsert({ ...stale, signature: 'different-signature', header: 'stale-header' })).rejects.toThrow(/signature is immutable/);
    await expect(payer.upsert({ ...stale, signature: 'stale-signature', header: 'changed-header' })).rejects.toThrow(/payload is immutable/);
    await expect(payer.upsert({ ...stale, signature: 'stale-signature', header: null })).rejects.toThrow(/immutable/);
    const unsigned = (await payer.read()).find((row) => row.id === 'reservation:stale-2')!;
    await payer.upsert({ ...unsigned, header: 'first-unsigned-header' });
    await expect(payer.upsert({ ...unsigned, header: 'replacement-unsigned-header' })).rejects.toThrow(/unsigned candidate cannot be replaced/);
    await expect(db.run('DELETE FROM hosted_solana_ledger WHERE role=$1 AND id=$2', 'payer', stale.id)).rejects.toThrow(/cannot be deleted/);
    await expect(db.run('DELETE FROM hosted_solana_import WHERE role=$1', 'payer')).rejects.toThrow(/permanent/);
    await expect(db.run('DELETE FROM hosted_solana_identity WHERE role=$1', 'payer')).rejects.toThrow(/permanent/);
  });

  it('serializes concurrent signers and a fresh database connection reads the exact stored candidate', async () => {
    const schema = newTestSchema();
    const firstDb = await createTestDb(schema);
    await importSolanaHistories(firstDb, importInputs(), verifyWithoutRpc);
    const first = await PgSolanaLedger.open(firstDb, 'payer', PAYER);
    let entered!: () => void;
    let release!: () => void;
    const inLock = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const locked = first.exclusive(async () => { entered(); await hold; });
    await inLock;

    await expect(first.exclusive(async () => 'must-not-sign')).rejects.toThrow(/ledger busy/);
    release();
    await locked;

    const restartedDb = await createTestDb(schema);
    const restarted = await PgSolanaLedger.open(restartedDb, 'payer', PAYER);
    expect((await restarted.read()).find((row) => row.id === 'history:proof-small')).toEqual(entry('history:proof-small', 'proof-small-signature', '1050', '0', 'proof-small-header'));
  });
});


type RetirementInputs = Parameters<typeof retireSolanaHistories>[0];
type RetirementInput = RetirementInputs[number];
function syntheticRetirementHistories() {
  const directory = mkdtempSync(join(tmpdir(), 'solana-retirement-test-'));
  tempDirs.push(directory);
  SolanaLedger.protectDirectory(directory);
  const rows = histories();
  const make = (role: 'payer' | 'sponsor', owner: string, entries: SolanaLedgerEntry[], path: string): RetirementInput => {
    const text = JSON.stringify({ version: 1, owner, network: NETWORK, mint: TEST_MINT, entries });
    writeFileSync(path, text, { mode: 0o600 });
    return { role, owner, path, text, expectedSha256: createHash('sha256').update(text, 'utf8').digest('hex') };
  };
  const inputs: RetirementInputs = [
    make('payer', PAYER, rows.payer, join(directory, 'payer.json')),
    make('sponsor', SPONSOR, rows.sponsor, join(directory, 'sponsor.json')),
  ];
  return { directory, inputs };
}
const retirementMarker = (input: RetirementInput) => JSON.stringify({ owner: input.owner, sourceSha256: input.expectedSha256, role: input.role });

describe('retiring legacy Solana files', () => {
  it('keeps both permanent locks and exact-hash markers after idempotent retirement', async () => {
    const { inputs } = syntheticRetirementHistories();
    await retireSolanaHistories(inputs);
    const locks = inputs.map(({ path }) => readFileSync(path + '.lock', 'utf8'));
    const markers = inputs.map(({ path }) => readFileSync(path + '.retired', 'utf8'));
    expect(locks).toEqual(inputs.map(retirementMarker));
    expect(markers).toEqual(locks);
    for (const { path, owner } of inputs) expect(() => new SolanaLedger(path, owner).read()).toThrow(/signer retired/);

    await retireSolanaHistories(inputs);
    expect(inputs.map(({ path }) => readFileSync(path + '.lock', 'utf8'))).toEqual(locks);
    expect(inputs.map(({ path }) => readFileSync(path + '.retired', 'utf8'))).toEqual(markers);
  });

  it('resumes an interrupted one-marker retirement only with the original history hashes', async () => {
    const { inputs } = syntheticRetirementHistories();
    const payer = inputs[0];
    writeFileSync(payer.path + '.lock', retirementMarker(payer), { flag: 'wx', mode: 0o600 });
    writeFileSync(inputs[1].path + '.lock', retirementMarker(inputs[1]), { flag: 'wx', mode: 0o600 });
    writeFileSync(payer.path + '.retired', retirementMarker(payer), { flag: 'wx', mode: 0o600 });

    await retireSolanaHistories(inputs);
    for (const input of inputs) {
      const expected = JSON.parse(retirementMarker(input));
      expect(JSON.parse(readFileSync(input.path + '.lock', 'utf8'))).toEqual(expected);
      expect(JSON.parse(readFileSync(input.path + '.retired', 'utf8'))).toEqual(expected);
      expect(expected.sourceSha256).toBe(input.expectedSha256);
    }
  });

  it('blocks on a mismatched active lock and preserves that lock without creating markers', async () => {
    const { inputs } = syntheticRetirementHistories();
    const activeLock = inputs[1].path + '.lock';
    writeFileSync(activeLock, 'active-or-ambiguous', { flag: 'wx', mode: 0o600 });

    await expect(retireSolanaHistories(inputs)).rejects.toThrow(/active or ambiguous lock/);
    expect(readFileSync(activeLock, 'utf8')).toBe('active-or-ambiguous');
    expect(existsSync(inputs[0].path + '.lock')).toBe(false);
    for (const input of inputs) expect(existsSync(input.path + '.retired')).toBe(false);
  });

  it('rejects a shared path or conflicting role before creating retirement files', async () => {
    const { inputs } = syntheticRetirementHistories();
    const sharedPath = [inputs[0], { ...inputs[1], path: inputs[0].path }] as RetirementInputs;
    await expect(retireSolanaHistories(sharedPath)).rejects.toThrow(/distinct legacy payer\/sponsor histories/);
    const conflictingRoles = [{ ...inputs[0], role: 'sponsor' as const }, inputs[1]] as RetirementInputs;
    await expect(retireSolanaHistories(conflictingRoles)).rejects.toThrow(/distinct legacy payer\/sponsor histories/);
    for (const input of inputs) {
      expect(existsSync(input.path + '.lock')).toBe(false);
      expect(existsSync(input.path + '.retired')).toBe(false);
    }
  });
});
