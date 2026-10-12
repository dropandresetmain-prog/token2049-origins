import type { Db } from '../../src/infrastructure/db.js';
import { NETWORK, TOKEN } from '../../src/funding/xlayer/config.js';
import { assertXLayerCaps, type XLayerLedgerEntry, type XLayerLedgerPort, type XLayerSpendPolicy } from './ledger.js';

interface StoredEntry { id: string; amount: string; gas_budget: string; nonce: string | number | null; header: string | null; hash: string | null; created_at: string; status: XLayerLedgerEntry['status'] }
const fromRow = (row: StoredEntry): XLayerLedgerEntry => ({ id: row.id, amount: row.amount, gasBudget: row.gas_budget,
  nonce: row.nonce === null ? null : Number(row.nonce), header: row.header, hash: row.hash, createdAt: row.created_at, status: row.status });
const COLUMNS = 'id, amount, gas_budget, nonce, header, hash, created_at, status';

/** Hosted X Layer ledger. A new rail has no legacy history: the identity is created once by an approved operator step. */
export class PgXLayerLedger implements XLayerLedgerPort {
  private constructor(private readonly db: Db, readonly owner: string) {}

  static async open(db: Db, owner: string): Promise<PgXLayerLedger> {
    if (!/^0x[0-9a-f]{40}$/.test(owner)) throw new Error('X Layer owner required');
    const ledger = new PgXLayerLedger(db, owner);
    await ledger.assertReady();
    return ledger;
  }

  /** Operator-only and idempotent. Never touches an existing identity or history. */
  static async initialize(db: Db, owner: string, nowIso = new Date().toISOString()): Promise<'created' | 'exists'> {
    if (!/^0x[0-9a-f]{40}$/.test(owner)) throw new Error('X Layer owner required');
    const result = await db.run('INSERT INTO hosted_xlayer_identity(owner,network,asset,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner) DO NOTHING', owner, NETWORK, TOKEN, nowIso);
    await new PgXLayerLedger(db, owner).assertReady();
    return result.changes === 0 ? 'exists' : 'created';
  }

  async assertReady(): Promise<void> {
    const row = await this.db.get<{ owner: string; network: string; asset: string }>('SELECT owner, network, asset FROM hosted_xlayer_identity WHERE owner=$1', this.owner);
    if (row?.owner !== this.owner || row.network !== NETWORK || row.asset !== TOKEN) throw new Error('X Layer identity/history missing or mismatched; refusing to sign');
  }

  async read(): Promise<XLayerLedgerEntry[]> {
    await this.assertReady();
    return (await this.db.all<StoredEntry>(`SELECT ${COLUMNS} FROM hosted_xlayer_ledger WHERE owner=$1 ORDER BY created_at,id`, this.owner)).map(fromRow);
  }

  async upsert(entry: XLayerLedgerEntry): Promise<void> {
    await this.assertReady();
    await this.db.run(`INSERT INTO hosted_xlayer_ledger(owner,id,amount,gas_budget,nonce,header,hash,created_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(owner,id) DO UPDATE SET amount=EXCLUDED.amount,gas_budget=EXCLUDED.gas_budget,created_at=EXCLUDED.created_at,nonce=EXCLUDED.nonce,header=EXCLUDED.header,hash=EXCLUDED.hash,status=EXCLUDED.status`,
      this.owner, entry.id, entry.amount, entry.gasBudget, entry.nonce, entry.header, entry.hash, entry.createdAt, entry.status);
  }

  async assertCaps(amount: bigint, gasBudget: bigint, policy: XLayerSpendPolicy, now: Date): Promise<void> {
    assertXLayerCaps(await this.read(), amount, gasBudget, policy, now);
  }

  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = await this.db.withExclusiveLock('hosted-xlayer:' + this.owner, async () => { await this.assertReady(); return fn(); });
    if (!result.acquired) throw new Error('X Layer ledger busy; no signing attempted');
    return result.value;
  }
}
