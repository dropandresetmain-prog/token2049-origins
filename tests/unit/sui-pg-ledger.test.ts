import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/infrastructure/db.js';
import { NETWORK, USDC_TYPE } from '../../src/funding/sui/config.js';
import { importSuiHistory, PgSuiLedger } from '../../clients/sui/pg-ledger.js';
import { SuiLedgerSnapshotSchema, type SuiLedgerEntry } from '../../clients/sui/ledger.js';

const OWNER = '0x' + '1'.repeat(64);

class StubDb {
  identity: Record<string, unknown> | undefined;
  rows = new Map<string, Record<string, unknown>>();
  async get<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    if (sql.includes('FROM hosted_sui_identity')) return this.identity as T | undefined;
    return undefined;
  }
  async all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    if (sql.includes('FROM hosted_sui_ledger')) return [...this.rows.values()].filter(row => row.owner === params[0]).map(({ owner, ...row }) => row as T);
    return [];
  }
  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    if (sql.includes('INSERT INTO hosted_sui_identity')) {
      const [owner, network, asset, source_sha256, entry_count, committed_amount, committed_gas, imported_at] = params;
      this.identity = { owner, network, asset, source_sha256, entry_count, committed_amount, committed_gas, imported_at };
    } else if (sql.includes('INSERT INTO hosted_sui_ledger')) {
      const [owner, id, amount, gas_budget, header, digest, created_at, status] = params;
      this.rows.set(String(id), { owner, id, amount, gas_budget, header, digest, created_at, status });
    }
    return { changes: 1 };
  }
  async tx<T>(fn: () => Promise<T>): Promise<T> { return fn(); }
  async withExclusiveLock<T>(_key: string, fn: () => Promise<T>) { return { acquired: true as const, value: await fn() }; }
}

function db(): Db { return new StubDb() as unknown as Db; }
function snapshotText(entries: SuiLedgerEntry[]): string {
  return JSON.stringify(SuiLedgerSnapshotSchema.parse({ version: 1, owner: OWNER, network: NETWORK, asset: USDC_TYPE, entries }));
}
function hash(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex'); }

describe('hosted Sui ledger glue', () => {
  const signed: SuiLedgerEntry = {
    id: 'pur_abcdefghij', amount: '250', gasBudget: '1000', header: 'candidate-stub', digest: 'digest-stub',
    createdAt: '2026-10-10T00:00:00.000Z', status: 'signed',
  };

  it('requires imported identity, imports signed history under the pinned exact-text hash, and reopens it', async () => {
    const database = db();
    await expect(PgSuiLedger.open(database, OWNER)).rejects.toThrow(/history import missing/);
    const text = snapshotText([signed]);
    const verified: string[] = [];
    const verifyEntry = async (entry: SuiLedgerEntry) => { verified.push(entry.id); };
    const imported = await importSuiHistory(database, { text, owner: OWNER, expectedSha256: hash(text), verifyEntry, nowIso: signed.createdAt });
    expect(imported).toMatchObject({ status: 'imported', entryCount: 1, committedAmount: '250', committedGas: '1000' });
    expect(verified).toEqual([signed.id]);
    const ledger = await PgSuiLedger.open(database, OWNER);
    expect(await ledger.read()).toEqual([signed]);
    expect(await importSuiHistory(database, { text, owner: OWNER, expectedSha256: hash(text), verifyEntry })).toMatchObject({ status: 'already_imported' });
  });

  it('rejects a hash mismatch and counts reserved gas in cumulative caps', async () => {
    const database = db(), text = snapshotText([{ ...signed, status: 'reserved', header: null, digest: null }]);
    const verifyEntry = async () => {};
    await expect(importSuiHistory(database, { text, owner: OWNER, expectedSha256: '0'.repeat(64), verifyEntry })).rejects.toThrow(/hash mismatch/);
    await importSuiHistory(database, { text, owner: OWNER, expectedSha256: hash(text), verifyEntry });
    const ledger = await PgSuiLedger.open(database, OWNER);
    await expect(ledger.assertCaps(1n, 1n, {
      maxPerPayment: 10n, maxDaily: 1000n, maxTotal: 1000n, maxGasPerPayment: 10n, maxGasTotal: 1000n,
    }, new Date('2026-10-10T00:00:01.000Z'))).rejects.toThrow(/cumulative gas cap/);
  });
});
