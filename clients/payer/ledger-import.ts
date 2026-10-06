/**
 * One-time import of the canonical (legacy file) Cardano payer ledger into the hosted PostgreSQL ledger.
 *
 * Guarantees:
 *  - complete: every entry (status, signed header, transfer reference, timestamps) is copied verbatim; nothing is inferred or dropped;
 *  - one-time + idempotent: a permanent marker records the wallet, network and the SHA-256 of the exact imported entries. Re-running with the
 *    same history is a verified no-op; any other history is refused;
 *  - transactional: identity binding, all rows and the marker commit together or not at all, and the stored rows are re-hashed and compared with
 *    the source inside the transaction before it commits;
 *  - fail-closed: a non-empty destination without a matching marker, a different wallet identity, a hash mismatch or a failed on-chain
 *    ownership check all refuse the import and leave the database untouched.
 */
import { createHash } from 'node:crypto';
import type { Db } from '../../src/infrastructure/db.js';
import type { LedgerEntry } from './ledger.js';

export class LedgerImportError extends Error {}

export interface LedgerImportResult {
  status: 'imported' | 'already_imported';
  entryCount: number;
  committedBaseUnits: string;
  sourceSha256: string;
}

/** Stable digest of a history: entries sorted by purchase id, fields in a fixed order, so file order never matters. */
export function ledgerSourceSha256(entries: LedgerEntry[]): string {
  const canon = [...entries].sort((a, b) => a.purchaseId.localeCompare(b.purchaseId)).map((e) => [
    e.purchaseId, e.network, e.asset, e.amountBaseUnits, e.payTo, e.status, e.header, e.transferReference, e.createdAt, e.updatedAt,
  ]);
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}

export const committedBaseUnits = (entries: LedgerEntry[]): bigint => entries.reduce((sum, e) => sum + BigInt(e.amountBaseUnits), 0n);

interface DbRow {
  purchase_id: string; network: string; asset: string; amount_base_units: string; pay_to: string; status: string;
  header: string | null; transfer_reference: string | null; created_at: string; updated_at: string;
}
const fromRow = (r: DbRow): LedgerEntry => ({
  purchaseId: r.purchase_id, network: r.network, asset: r.asset, amountBaseUnits: r.amount_base_units, payTo: r.pay_to,
  status: r.status as LedgerEntry['status'], header: r.header, transferReference: r.transfer_reference, createdAt: r.created_at, updatedAt: r.updated_at,
});

export async function importLegacyLedger(
  db: Db,
  input: {
    entries: LedgerEntry[];
    network: string;
    address: string;
    /** Hash the operator pinned when the snapshot was taken; the import refuses if the entries differ. */
    expectedSha256?: string;
    /** Throws unless the entry demonstrably belongs to this wallet (e.g. on-chain). Run before the transaction, only for a first import. */
    verifyEntry?: (entry: LedgerEntry) => Promise<void>;
    nowIso?: string;
  },
): Promise<LedgerImportResult> {
  const { entries, network, address } = input;
  const sourceSha256 = ledgerSourceSha256(entries);
  const committed = committedBaseUnits(entries).toString();
  if (input.expectedSha256 && input.expectedSha256 !== sourceSha256) throw new LedgerImportError('legacy ledger does not match the pinned snapshot hash; refusing to import');
  if (new Set(entries.map((e) => e.purchaseId)).size !== entries.length) throw new LedgerImportError('legacy ledger has duplicate purchases; refusing to import');

  const existing = await db.get<{ payer_address: string; network: string; source_sha256: string; entry_count: number }>('SELECT payer_address, network, source_sha256, entry_count FROM hosted_payer_import WHERE singleton');
  if (existing) {
    if (existing.source_sha256 !== sourceSha256 || existing.payer_address !== address || existing.network !== network) {
      throw new LedgerImportError('a different history was already imported; refusing (history is never replaced or merged)');
    }
    // Same history: verify every source entry is still stored with the same facts and signed header (later progress of the same
    // purchase and newer purchases are allowed), then report a no-op.
    const stored = new Map((await db.all<DbRow>('SELECT * FROM hosted_payer_ledger WHERE payer_address = $1', address)).map((r) => [r.purchase_id, fromRow(r)]));
    const rank = { signing: 0, signed: 1, accepted: 2 } as const;
    for (const src of entries) {
      const got = stored.get(src.purchaseId);
      const intact = !!got && got.network === src.network && got.asset === src.asset && got.amountBaseUnits === src.amountBaseUnits && got.payTo === src.payTo
        && got.createdAt === src.createdAt && (src.header === null || got.header === src.header) && rank[got.status] >= rank[src.status];
      if (!intact) throw new LedgerImportError('imported history in PostgreSQL no longer matches the source; refusing to continue');
    }
    return { status: 'already_imported', entryCount: entries.length, committedBaseUnits: committed, sourceSha256 };
  }

  // First import: prove every entry belongs to this wallet BEFORE touching the database.
  if (input.verifyEntry) for (const e of entries) await input.verifyEntry(e);

  const nowIso = input.nowIso ?? new Date().toISOString();
  await db.tx(async () => {
    // Serialize concurrent first starts (overlapping deploys): the transaction-level lock is released at commit/rollback.
    await db.run('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', 'hosted-payer-import');
    if (await db.get('SELECT 1 AS x FROM hosted_payer_import WHERE singleton')) throw new LedgerImportError('another start-up imported the history first; restart to verify it');
    const identity = await db.get<{ network: string; public_address: string }>('SELECT network, public_address FROM hosted_payer_identity WHERE singleton');
    if (identity && (identity.network !== network || identity.public_address !== address)) throw new LedgerImportError('ledger belongs to a different wallet identity; refusing to import');
    const rows = (await db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM hosted_payer_ledger'))!.n;
    if (rows > 0) throw new LedgerImportError('destination ledger already has history that was not imported from this source; refusing to merge');
    if (!identity) await db.run('INSERT INTO hosted_payer_identity(singleton, network, public_address, created_at) VALUES (TRUE,$1,$2,$3)', network, address, nowIso);
    for (const e of entries) {
      await db.run(
        `INSERT INTO hosted_payer_ledger(purchase_id, payer_address, network, asset, amount_base_units, pay_to, status, header, transfer_reference, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        e.purchaseId, address, e.network, e.asset, e.amountBaseUnits, e.payTo, e.status, e.header, e.transferReference, e.createdAt, e.updatedAt,
      );
    }
    // Re-read what was stored and compare with the source before the transaction is allowed to commit.
    const stored = (await db.all<DbRow>('SELECT * FROM hosted_payer_ledger WHERE payer_address = $1', address)).map(fromRow);
    if (stored.length !== entries.length || ledgerSourceSha256(stored) !== sourceSha256) throw new LedgerImportError('stored history does not equal the source; import rolled back');
    await db.run('INSERT INTO hosted_payer_import(singleton, payer_address, network, source_sha256, entry_count, committed_base_units, imported_at) VALUES (TRUE,$1,$2,$3,$4,$5,$6)', address, network, sourceSha256, entries.length, committed, nowIso);
  });
  return { status: 'imported', entryCount: entries.length, committedBaseUnits: committed, sourceSha256 };
}

/** Summary of the imported history, for operator reports. Never includes headers. */
export async function importMarker(db: Db): Promise<{ payerAddress: string; network: string; sourceSha256: string; entryCount: number; committedBaseUnits: string; importedAt: string } | null> {
  const r = await db.get<{ payer_address: string; network: string; source_sha256: string; entry_count: number; committed_base_units: string; imported_at: string }>('SELECT * FROM hosted_payer_import WHERE singleton');
  return r ? { payerAddress: r.payer_address, network: r.network, sourceSha256: r.source_sha256, entryCount: r.entry_count, committedBaseUnits: r.committed_base_units, importedAt: r.imported_at } : null;
}
