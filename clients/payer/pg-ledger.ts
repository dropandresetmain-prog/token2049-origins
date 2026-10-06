/**
 * PostgreSQL payer ledger for the hosted (free, diskless) payer. Same safety semantics as the file ledger:
 * one row per purchase, spend reserved before signing, exact signed header retained for identical resend, caps counted from
 * durable history. Filesystem lock files are replaced by a session-level advisory lock (released automatically if the process
 * dies) and the table itself enforces immutability (see migration 0005).
 *
 * Differences that are deliberate:
 *  - A prior `signing` row for a purchase means a signing attempt did not finish (crash or lost connection). Because that
 *    outcome is ambiguous the purchase is REFUSED (operator reconciliation), never re-signed. Failures the payer observes
 *    in-process (wallet error, build failure) call `release`, which removes only that unsent reservation.
 *  - Rows are bound to the wallet identity; a database holding a different wallet's identity refuses to start.
 */
import type { Db } from '../../src/infrastructure/db.js';
import type { LedgerEntry } from './ledger.js';

const LOCK_WAIT_MS = 30_000;

interface Row {
  purchase_id: string; network: string; asset: string; amount_base_units: string; pay_to: string; status: string;
  header: string | null; transfer_reference: string | null; created_at: string; updated_at: string;
}

const toEntry = (r: Row): LedgerEntry => ({
  purchaseId: r.purchase_id, network: r.network, asset: r.asset, amountBaseUnits: r.amount_base_units, payTo: r.pay_to,
  status: r.status as LedgerEntry['status'], header: r.header, transferReference: r.transfer_reference, createdAt: r.created_at, updatedAt: r.updated_at,
});

export class PgPayerLedger {
  /** Tells the payer to refuse (not re-sign) a purchase whose previous signing attempt never completed. */
  readonly failClosedOnStaleSigning = true;

  private constructor(private readonly db: Db, readonly network: string, readonly address: string) {}

  /**
   * Bind the ledger to the wallet identity. First start records it; any later start with a different wallet or network refuses.
   * Idempotent and safe to run concurrently from overlapping deploys.
   */
  static async open(db: Db, identity: { network: string; address: string }, nowIso = new Date().toISOString()): Promise<PgPayerLedger> {
    await db.run('INSERT INTO hosted_payer_identity(singleton, network, public_address, created_at) VALUES (TRUE,$1,$2,$3) ON CONFLICT(singleton) DO NOTHING', identity.network, identity.address, nowIso);
    const row = await db.get<{ network: string; public_address: string }>('SELECT network, public_address FROM hosted_payer_identity WHERE singleton');
    if (!row || row.network !== identity.network || row.public_address !== identity.address) {
      throw new Error('payer ledger belongs to a different wallet identity; refusing to start (history is never reset or reassigned)');
    }
    return new PgPayerLedger(db, identity.network, identity.address);
  }

  async assertReady(): Promise<void> {
    const row = await this.db.get<{ public_address: string }>('SELECT public_address FROM hosted_payer_identity WHERE singleton');
    if (row?.public_address !== this.address) throw new Error('payer ledger identity is missing or changed; refusing to sign');
  }

  /** Serialize the whole signing/send flow across every payer process on this database. Waits briefly, then fails closed. */
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.assertReady();
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      const r = await this.db.withExclusiveLock(`hosted-payer-ledger:${this.address}`, fn);
      if (r.acquired) return r.value;
      if (Date.now() >= deadline) throw new Error('payer ledger is locked; another payment is in progress');
      await new Promise((resolve) => setTimeout(resolve, 150 + Math.floor(Math.random() * 150)));
    }
  }

  async find(purchaseId: string): Promise<LedgerEntry | undefined> {
    const row = await this.db.get<Row>('SELECT * FROM hosted_payer_ledger WHERE purchase_id = $1 AND payer_address = $2', purchaseId, this.address);
    return row ? toEntry(row) : undefined;
  }

  /** Base units reserved, signed or accepted in this exact network + asset. */
  async committed(network: string, asset: string): Promise<bigint> {
    const row = await this.db.get<{ total: string | null }>(
      'SELECT COALESCE(SUM(amount_base_units::numeric), 0)::text AS total FROM hosted_payer_ledger WHERE payer_address = $1 AND network = $2 AND asset = $3', this.address, network, asset);
    return BigInt(row?.total ?? '0');
  }

  /** Pending (signing/signed) amounts from any day plus accepted amounts from today (UTC). Same rule as the file ledger. */
  async daily(network: string, asset: string, now: Date): Promise<bigint> {
    const day = now.toISOString().slice(0, 10);
    const row = await this.db.get<{ total: string | null }>(
      `SELECT COALESCE(SUM(amount_base_units::numeric), 0)::text AS total FROM hosted_payer_ledger
        WHERE payer_address = $1 AND network = $2 AND asset = $3 AND (status <> 'accepted' OR substr(updated_at, 1, 10) = $4)`, this.address, network, asset, day);
    return BigInt(row?.total ?? '0');
  }

  async upsert(entry: LedgerEntry): Promise<void> {
    await this.db.run(
      `INSERT INTO hosted_payer_ledger(purchase_id, payer_address, network, asset, amount_base_units, pay_to, status, header, transfer_reference, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(purchase_id) DO UPDATE SET status = EXCLUDED.status, header = COALESCE(hosted_payer_ledger.header, EXCLUDED.header),
         transfer_reference = EXCLUDED.transfer_reference, updated_at = EXCLUDED.updated_at
       WHERE hosted_payer_ledger.payer_address = EXCLUDED.payer_address`,
      entry.purchaseId, this.address, entry.network, entry.asset, entry.amountBaseUnits, entry.payTo, entry.status, entry.header, entry.transferReference, entry.createdAt, entry.updatedAt,
    );
  }

  /** Remove an unsent reservation after an in-process signing failure. The table refuses to delete anything that holds a signed payment. */
  async release(purchaseId: string): Promise<void> {
    await this.db.run("DELETE FROM hosted_payer_ledger WHERE purchase_id = $1 AND payer_address = $2 AND status = 'signing'", purchaseId, this.address);
  }
}
