import { createHash } from 'node:crypto';
import type { Db } from '../../src/infrastructure/db.js';
import { NETWORK, USDC_TYPE } from '../../src/funding/sui/config.js';
import { assertSuiCaps, SuiLedgerSnapshotSchema, type SuiLedgerEntry, type SuiLedgerPort, type SuiSpendPolicy } from './ledger.js';

interface StoredEntry extends Omit<SuiLedgerEntry, 'createdAt' | 'gasBudget'> { gas_budget: string; created_at: string; }
const fromRow = (row: StoredEntry): SuiLedgerEntry => {
  const { gas_budget, created_at, ...entry } = row;
  return { ...entry, gasBudget: gas_budget, createdAt: created_at };
};

/** Hosted Sui ledger. A namespace is usable only after its pinned history import exists. */
export class PgSuiLedger implements SuiLedgerPort {
  private constructor(private readonly db: Db, readonly owner: string) {}

  static async open(db: Db, owner: string): Promise<PgSuiLedger> {
    if (!owner.trim()) throw new Error('Sui owner required');
    const ledger = new PgSuiLedger(db, owner);
    await ledger.assertReady();
    return ledger;
  }

  async assertReady(): Promise<void> {
    const row = await this.db.get<{ owner: string; network: string; asset: string }>(
      'SELECT owner, network, asset FROM hosted_sui_identity WHERE owner=$1', this.owner);
    if (row?.owner !== this.owner || row.network !== NETWORK || row.asset !== USDC_TYPE) {
      throw new Error('Sui identity/history import missing or mismatched; refusing to sign');
    }
  }

  async read(): Promise<SuiLedgerEntry[]> {
    await this.assertReady();
    return (await this.db.all<StoredEntry>(
      'SELECT id, amount, gas_budget, header, digest, created_at, status FROM hosted_sui_ledger WHERE owner=$1 ORDER BY created_at,id', this.owner,
    )).map(fromRow);
  }

  async upsert(entry: SuiLedgerEntry): Promise<void> {
    await this.assertReady();
    await this.db.run(`INSERT INTO hosted_sui_ledger(owner,id,amount,gas_budget,header,digest,created_at,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT(owner,id) DO UPDATE SET header=EXCLUDED.header,digest=EXCLUDED.digest,status=EXCLUDED.status`,
      this.owner, entry.id, entry.amount, entry.gasBudget, entry.header, entry.digest, entry.createdAt, entry.status);
  }

  async assertCaps(amount: bigint, gasBudget: bigint, policy: SuiSpendPolicy, now: Date): Promise<void> {
    assertSuiCaps(await this.read(), amount, gasBudget, policy, now);
  }

  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = await this.db.withExclusiveLock('hosted_sui:' + this.owner, async () => {
      await this.assertReady();
      return fn();
    });
    if (!result.acquired) throw new Error('Sui ledger busy; no signing attempted');
    return result.value;
  }
}

export interface SuiHistoryImportResult {
  status: 'imported' | 'already_imported';
  entryCount: number;
  committedAmount: string;
  committedGas: string;
  sourceSha256: string;
}

/** Import a pinned legacy snapshot once. The callback must prove every signed candidate belongs to this owner. */
export async function importSuiHistory(
  db: Db,
  input: {
    text: string;
    owner: string;
    expectedSha256: string;
    verifyEntry: (entry: SuiLedgerEntry) => Promise<void>;
    nowIso?: string;
  },
): Promise<SuiHistoryImportResult> {
  if (!input.verifyEntry) throw new Error('Sui history candidate verifier required');
  const sourceSha256 = createHash('sha256').update(input.text, 'utf8').digest('hex');
  if (!/^[0-9a-f]{64}$/.test(input.expectedSha256) || sourceSha256 !== input.expectedSha256) {
    throw new Error('Sui history source hash mismatch');
  }
  let snapshot;
  try { snapshot = SuiLedgerSnapshotSchema.parse(JSON.parse(input.text)); }
  catch { throw new Error('Sui history snapshot invalid; refusing import'); }
  if (snapshot.owner !== input.owner || snapshot.network !== NETWORK || snapshot.asset !== USDC_TYPE) {
    throw new Error('Sui history identity mismatch; refusing import');
  }
  for (const entry of snapshot.entries) if (entry.status !== 'reserved') await input.verifyEntry(entry);
  const committedAmount = snapshot.entries.reduce((sum, entry) => sum + BigInt(entry.amount), 0n).toString();
  const committedGas = snapshot.entries.reduce((sum, entry) => sum + BigInt(entry.gasBudget), 0n).toString();
  const result = { entryCount: snapshot.entries.length, committedAmount, committedGas, sourceSha256 };
  let alreadyImported = false;

  await db.tx(async () => {
    await db.run('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', `hosted-sui-import:${input.owner}`);
    const marker = await db.get<{ owner: string; network: string; asset: string; source_sha256: string; entry_count: number; committed_amount: string; committed_gas: string; imported_at: string }>(
      'SELECT * FROM hosted_sui_identity WHERE owner=$1', input.owner);
    const rows = await db.all<StoredEntry>(
      'SELECT id, amount, gas_budget, header, digest, created_at, status FROM hosted_sui_ledger WHERE owner=$1 ORDER BY id', input.owner);
    if (marker) {
      if (marker.network !== NETWORK || marker.asset !== USDC_TYPE || marker.source_sha256 !== sourceSha256 ||
          marker.entry_count !== result.entryCount || marker.committed_amount !== committedAmount || marker.committed_gas !== committedGas) {
        throw new Error('different Sui history already imported; refusing replacement');
      }
      const stored = new Map(rows.map(row => [row.id, fromRow(row)]));
      for (const source of snapshot.entries) {
        const prior = stored.get(source.id);
        if (!prior || prior.amount !== source.amount || prior.gasBudget !== source.gasBudget || prior.createdAt !== source.createdAt ||
            (source.header !== null && (prior.header !== source.header || prior.digest !== source.digest)) ||
            (source.status === 'accepted' && prior.status !== 'accepted') ||
            (source.status === 'signed' && prior.status === 'reserved')) {
          throw new Error('stored Sui history no longer preserves the imported snapshot');
        }
      }
      alreadyImported = true;
      return;
    }
    if (rows.length > 0) throw new Error('Sui ledger already contains rows without a pinned history marker');
    const importedAt = input.nowIso ?? new Date().toISOString();
    await db.run(`INSERT INTO hosted_sui_identity(owner,network,asset,source_sha256,entry_count,committed_amount,committed_gas,imported_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, input.owner, NETWORK, USDC_TYPE, sourceSha256, result.entryCount, committedAmount, committedGas, importedAt);
    for (const entry of snapshot.entries) {
      await db.run(`INSERT INTO hosted_sui_ledger(owner,id,amount,gas_budget,header,digest,created_at,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, input.owner, entry.id, entry.amount, entry.gasBudget, entry.header, entry.digest, entry.createdAt, entry.status);
    }
    const stored = await db.all<StoredEntry>(
      'SELECT id, amount, gas_budget, header, digest, created_at, status FROM hosted_sui_ledger WHERE owner=$1 ORDER BY id', input.owner);
    const storedById = new Map(stored.map(row => [row.id, fromRow(row)]));
    if (stored.length !== snapshot.entries.length || snapshot.entries.some(entry => {
      const got = storedById.get(entry.id);
      return !got || got.amount !== entry.amount || got.gasBudget !== entry.gasBudget || got.header !== entry.header ||
        got.digest !== entry.digest || got.createdAt !== entry.createdAt || got.status !== entry.status;
    })) throw new Error('stored Sui rows do not match source snapshot; import rolled back');
  });
  return { status: alreadyImported ? 'already_imported' : 'imported', ...result };
}
