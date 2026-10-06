/**
 * Durable payer ledger (data/payer-ledger.json). Every signed payment is recorded BEFORE it can be sent,
 * so the cumulative cap survives restarts and a restarted payer can resend the identical signed header
 * instead of building a second transaction. Holds signed (unbroadcast) payment headers: keep it 0600 and
 * gitignored (data/ is). It never holds a mnemonic or a gateway token.
 */
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

const Entry = z.object({
  purchaseId: z.string(),
  network: z.string(),
  asset: z.string(),
  amountBaseUnits: z.string().regex(/^[1-9][0-9]*$/),
  payTo: z.string(),
  /** `signing` = reserved against the cap, nothing sendable yet; `signed` = header exists; `accepted` = gateway took it. */
  status: z.enum(['signing', 'signed', 'accepted']),
  /** The exact PAYMENT-SIGNATURE value. Reused verbatim on every retry. */
  header: z.string().nullable(),
  transferReference: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).refine(e => e.status === 'signing' ? e.header === null : !!e.header, 'signed entries require a payment header');
export type LedgerEntry = z.infer<typeof Entry>;
const File = z.object({ version: z.literal(1), entries: z.array(Entry) });

export class PayerLedger {
  constructor(private readonly path: string) {}

  private read(): LedgerEntry[] {
    if (!existsSync(this.path)) return [];
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch {
      // A corrupt ledger must stop spending, not silently reset the cap.
      throw new Error('payer ledger is unreadable; refusing to sign');
    }
    const parsed = File.safeParse(json);
    if (!parsed.success) throw new Error('payer ledger has an unexpected shape; refusing to sign');
    if (new Set(parsed.data.entries.map(e => e.purchaseId)).size !== parsed.data.entries.length) throw new Error('payer ledger has duplicate purchases; refusing to sign');
    return parsed.data.entries;
  }

  private write(entries: LedgerEntry[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    const fd = openSync(tmp, 'w', 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ version: 1, entries }, null, 2));
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(tmp, this.path);
    try {
      chmodSync(this.path, 0o600);
    } catch {
      /* best effort on platforms without POSIX modes */
    }
  }

  /** Lock the entire signing/send flow across CLI and bridge processes. A crash leaves a lock for manual reconciliation. */
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    mkdirSync(dirname(this.path), { recursive: true });
    let fd: number;
    try { fd = openSync(`${this.path}.lock`, 'wx', 0o600); }
    catch { throw new Error('payer ledger is locked; another payer is active or crash recovery is required'); }
    try { return await fn(); }
    finally { closeSync(fd); unlinkSync(`${this.path}.lock`); }
  }

  daily(network: string, asset: string, now: Date): bigint {
    const day = now.toISOString().slice(0, 10);
    return this.read().filter(e => e.network === network && e.asset === asset && (e.status !== 'accepted' || e.updatedAt.slice(0, 10) === day))
      .reduce((total, e) => total + BigInt(e.amountBaseUnits), 0n);
  }

  find(purchaseId: string): LedgerEntry | undefined {
    return this.read().find((e) => e.purchaseId === purchaseId);
  }

  /** Base units already committed (reserved or signed or accepted) in this exact network + asset. */
  committed(network: string, asset: string): bigint {
    return this.read()
      .filter((e) => e.network === network && e.asset === asset)
      .reduce((s, e) => s + BigInt(e.amountBaseUnits), 0n);
  }

  upsert(entry: LedgerEntry): void {
    const all = this.read().filter((e) => e.purchaseId !== entry.purchaseId);
    all.push(entry);
    this.write(all);
  }
}
