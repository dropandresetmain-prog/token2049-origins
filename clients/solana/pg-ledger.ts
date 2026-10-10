import type { Db } from '../../src/infrastructure/db.js';
import { NETWORK, TEST_MINT } from '../../src/funding/solana/wire.js';
import { scanHistory, type SolanaLedgerEntry } from './ledger.js';
import type { SolanaLedgerPort } from './ledger-port.js';
import type { SolanaRpc } from '../../src/funding/solana/rpc.js';

export type SolanaRole = 'payer' | 'sponsor';
type StoredEntry = Omit<SolanaLedgerEntry, 'createdAt'> & { created_at: string; blocked: boolean };

/** No empty-ledger initialization: both identities must have a verified, pinned history import first. */
export class PgSolanaLedger implements SolanaLedgerPort {
  private constructor(private readonly db: Db, readonly role: SolanaRole, readonly owner: string, private readonly namespace?: string) {}
  private get prefix() { return this.namespace ? 'wallet_solana' : 'hosted_solana'; }
  private get roleKey() { return this.namespace ? this.namespace+':'+this.role : this.role; }

  static async open(db: Db, role: SolanaRole, owner: string, namespace?: string): Promise<PgSolanaLedger> {
    const ledger = new PgSolanaLedger(db, role, owner, namespace);
    await ledger.assertReady();
    return ledger;
  }

  async assertReady(): Promise<void> {
    if(this.namespace && await this.db.get('SELECT owner FROM hosted_solana_identity WHERE owner=$1',this.owner))throw Error('legacy Solana wallet must retain its canonical ledger namespace');
    const identity = await this.db.get<{ owner: string; network: string; mint: string }>(
      `SELECT owner, network, mint FROM ${this.prefix}_identity JOIN ${this.prefix}_import USING(role) WHERE role=$1`, this.roleKey);
    if (identity?.owner !== this.owner || identity.network !== NETWORK || identity.mint !== TEST_MINT) {
      throw new Error('Solana identity/history import missing or mismatched; refusing to sign');
    }
  }

  async assertAllowed(...ids: string[]): Promise<void> {
    await this.assertReady();
    for (const id of ids) {
      const blocked = await this.db.get('SELECT purchase_id FROM hosted_solana_blocked_history WHERE purchase_id=$1 OR message_sha256=$1 OR candidate_sha256=$1 OR payer_signature=$1', id);
      if (blocked) throw new Error('Historical unresolved Solana attempt is permanently blocked');
    }
  }

  async read(): Promise<SolanaLedgerEntry[]> {
    await this.assertReady();
    return (await this.db.all<StoredEntry>(`SELECT l.id,l.signature,l.amount,l.fee,l.header,l.created_at,(b.purchase_id IS NOT NULL) AS blocked FROM ${this.prefix}_ledger l LEFT JOIN hosted_solana_blocked_history b ON b.role=l.role AND b.purchase_id=l.id WHERE l.role=$1 ORDER BY l.id`, this.roleKey))
      .map(({ created_at, blocked, ...row }) => ({ ...row, createdAt: created_at, ...(blocked ? { historicalBlocked: true } : {}) }));
  }

  async upsert(entry: SolanaLedgerEntry): Promise<void> {
    await this.assertReady();
    await this.assertAllowed(entry.id, ...(entry.signature ? [entry.signature] : []));
    await this.db.run(`INSERT INTO ${this.prefix}_ledger(role,id,signature,amount,fee,header,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(role,id) DO UPDATE SET signature=EXCLUDED.signature,amount=EXCLUDED.amount,fee=EXCLUDED.fee,header=EXCLUDED.header,created_at=EXCLUDED.created_at`,
      this.roleKey, entry.id, entry.signature, entry.amount, entry.fee, entry.header, entry.createdAt);
  }

  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.assertReady();
    const result = await this.db.withExclusiveLock(`hosted-solana:${this.role}:${this.owner}`, async () => { await this.assertReady(); return fn(); });
    if (!result.acquired) throw new Error('Solana ledger busy; no signing attempted');
    return result.value;
  }

  async assertCaps(amount: bigint, fee: bigint, maxAmount: bigint, maxFee: bigint): Promise<void> {
    const rows = await this.read();
    if (rows.reduce((sum, e) => sum + BigInt(e.amount), 0n) + amount > maxAmount ||
        rows.reduce((sum, e) => sum + BigInt(e.fee), 0n) + fee > maxFee) throw new Error('Solana cumulative spend or fee cap exceeded');
  }

  async reconcile(rpc: SolanaRpc): Promise<void> {
    const known = new Set((await this.read()).map(e => e.signature));
    for (const entry of await scanHistory(rpc, this.owner)) {
      if (!known.has(entry.signature)) { await this.upsert(entry); known.add(entry.signature); }
    }
  }

  async summary(): Promise<Record<string, unknown>> {
    const entries = await this.read();
    const imported = await this.db.get<{ source_sha256: string; entry_count: number; committed_amount: string; committed_fee: string; imported_at: string }>(
      `SELECT * FROM ${this.prefix}_import WHERE role=$1`, this.roleKey);
    return {
      role: this.role, owner: this.owner, entries: entries.length,
      historicalBlocked: entries.filter(e => e.historicalBlocked).length,
      incomplete: entries.filter(e => !e.historicalBlocked && (!e.signature || !e.header) && !e.id.startsWith('history:')).length,
      committedBaseUnits: entries.reduce((n, e) => n + BigInt(e.amount), 0n).toString(),
      committedFeeLamports: entries.reduce((n, e) => n + BigInt(e.fee), 0n).toString(),
      imported: imported ? { sourceSha256: imported.source_sha256, entries: imported.entry_count, committedBaseUnits: imported.committed_amount, committedFeeLamports: imported.committed_fee, importedAt: imported.imported_at } : null,
    };
  }
}
