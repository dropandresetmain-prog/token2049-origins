/**
 * Durable payer ledger at an explicitly configured absolute path. Every signed payment is recorded BEFORE it can be sent,
 * so the cumulative cap survives restarts and a restarted payer can resend the identical signed header
 * instead of building a second transaction. Holds signed (unbroadcast) payment headers: keep it 0600 and
 * gitignored (data/ is). It never holds a mnemonic or a gateway token.
 */
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { payerLedgerPath } from './config.js';
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

/** Sibling marker that permanently disables a file ledger once its history has been migrated to PostgreSQL. */
export const retiredMarkerPath = (ledgerPath: string) => `${ledgerPath}.retired`;

export interface RetiredMarker { retiredAt: string; reason: string; sourceSha256: string; entryCount: number; payerAddress: string }

/**
 * Parse a file ledger WITHOUT any signing-readiness checks (used to migrate history, never to pay). Strict: an unreadable,
 * malformed or duplicate-bearing file throws instead of yielding partial history.
 */
export function readLedgerSnapshot(path: string): LedgerEntry[] {
  payerLedgerPath(path);
  if (!existsSync(path)) throw new Error('payer ledger is missing');
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('payer ledger is unreadable');
  }
  const parsed = File.safeParse(json);
  if (!parsed.success) throw new Error('payer ledger has an unexpected shape');
  if (new Set(parsed.data.entries.map(e => e.purchaseId)).size !== parsed.data.entries.length) throw new Error('payer ledger has duplicate purchases');
  return parsed.data.entries;
}

/**
 * Retire a file ledger: after this, every PayerLedger on that path refuses to sign (CLI, bridge, e2e harness). Exclusive-create, so an
 * existing marker is never overwritten; an existing marker for a different history is an error. Idempotent for the same history.
 */
export function retireFileLedger(path: string, info: Omit<RetiredMarker, 'retiredAt'>, nowIso = new Date().toISOString()): RetiredMarker {
  const marker = retiredMarkerPath(path);
  const wanted: RetiredMarker = { retiredAt: nowIso, ...info };
  try {
    const fd = openSync(marker, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(wanted, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
    return wanted;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  const existing = JSON.parse(readFileSync(marker, 'utf8')) as RetiredMarker;
  if (existing.sourceSha256 !== info.sourceSha256 || existing.payerAddress !== info.payerAddress) throw new Error('payer ledger is already retired for a different history');
  return existing;
}

export class PayerLedger {
  constructor(private readonly path: string) { payerLedgerPath(path); }

  /** Only first-time wallet setup may establish empty history. Never call this while paying. */
  static initialize(path: string): void {
    payerLedgerPath(path);
    mkdirSync(dirname(path), { recursive: true });
    const fd = openSync(path, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify({ version: 1, entries: [] })); fsyncSync(fd); }
    finally { closeSync(fd); }
  }

  assertReady(): void { this.read(); }

  private read(): LedgerEntry[] {
    if (existsSync(retiredMarkerPath(this.path))) throw new Error('payer ledger was migrated to PostgreSQL and retired; this local signer is disabled');
    if (!existsSync(this.path)) throw new Error('payer ledger is missing; operator reconciliation required before signing');
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
    this.assertReady();
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

type Maybe<T> = T | Promise<T>;

/**
 * What the payer needs from a ledger. The file ledger implements it synchronously; the hosted payer's PostgreSQL ledger
 * implements it asynchronously. The payer awaits every call, so both satisfy the same contract.
 */
export interface LedgerPort {
  assertReady(): Maybe<void>;
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  find(purchaseId: string): Maybe<LedgerEntry | undefined>;
  committed(network: string, asset: string): Maybe<bigint>;
  daily(network: string, asset: string, now: Date): Maybe<bigint>;
  upsert(entry: LedgerEntry): Maybe<void>;
  /** True when a prior `signing` row must be refused rather than re-signed (ambiguous outcome). */
  readonly failClosedOnStaleSigning?: boolean;
  /** Remove an unsent reservation after an in-process signing failure. */
  release?(purchaseId: string): Maybe<void>;
}
