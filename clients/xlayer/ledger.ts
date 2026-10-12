import { closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import { NETWORK, TOKEN } from '../../src/funding/xlayer/config.js';
import { SolanaLedger, syncDirectory } from '../solana/ledger.js';

const Hash = z.string().regex(/^0x[0-9a-f]{64}$/);
export const XLayerLedgerEntrySchema = z.object({
  id: z.string().min(1),
  amount: z.string().regex(/^[1-9][0-9]*$/),
  /** Maximum OKB wei this payment can burn (gas limit x max fee per gas). */
  gasBudget: z.string().regex(/^[1-9][0-9]*$/),
  nonce: z.number().int().min(0).nullable(),
  header: z.string().min(1).nullable(),
  hash: Hash.nullable(),
  createdAt: z.iso.datetime(),
  status: z.enum(['reserved', 'signed', 'accepted']),
}).strict().refine(e => (e.header === null) === (e.hash === null) && (e.header === null) === (e.nonce === null), 'header, hash and nonce must all be set or all be null')
  .refine(e => e.status !== 'reserved' || e.header === null, 'reserved entries cannot contain a candidate')
  .refine(e => e.status === 'reserved' || e.header !== null, 'signed entries require a candidate');

export const XLayerLedgerSnapshotSchema = z.object({
  version: z.literal(1), owner: z.string().min(1), network: z.literal(NETWORK), asset: z.literal(TOKEN),
  entries: z.array(XLayerLedgerEntrySchema),
}).strict().superRefine((snapshot, ctx) => {
  const ids = new Set<string>(), hashes = new Set<string>(), nonces = new Set<number>();
  for (const entry of snapshot.entries) {
    if (ids.has(entry.id)) ctx.addIssue({ code: 'custom', message: 'duplicate purchase id' });
    ids.add(entry.id);
    if (entry.hash !== null) {
      if (hashes.has(entry.hash)) ctx.addIssue({ code: 'custom', message: 'duplicate transaction hash' });
      hashes.add(entry.hash);
    }
    if (entry.nonce !== null) {
      if (nonces.has(entry.nonce)) ctx.addIssue({ code: 'custom', message: 'duplicate signed nonce' });
      nonces.add(entry.nonce);
    }
  }
});
export type XLayerLedgerEntry = z.infer<typeof XLayerLedgerEntrySchema>;
export type XLayerLedgerSnapshot = z.infer<typeof XLayerLedgerSnapshotSchema>;
export interface XLayerSpendPolicy { maxPerPayment: bigint; maxDaily: bigint; maxTotal: bigint; maxGasPerPayment: bigint; maxGasTotal: bigint }

const positive = (value: bigint, label: string): void => { if (value <= 0n) throw new Error(`${label} must be positive`); };
const rank: Record<XLayerLedgerEntry['status'], number> = { reserved: 0, signed: 1, accepted: 2 };

/** Ledger operations may be synchronous for the local file ledger or asynchronous for hosted storage. */
export interface XLayerLedgerPort {
  read(): XLayerLedgerEntry[] | Promise<XLayerLedgerEntry[]>;
  upsert(entry: XLayerLedgerEntry): void | Promise<void>;
  assertCaps(amount: bigint, gasBudget: bigint, policy: XLayerSpendPolicy, now: Date): void | Promise<void>;
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
}

/** Pure shared cap calculation. Reservations count as committed exposure, including gas. Same rules as the Sui rail. */
export function assertXLayerCaps(entries: XLayerLedgerEntry[], amount: bigint, gasBudget: bigint, policy: XLayerSpendPolicy, now: Date): void {
  positive(amount, 'X Layer payment amount');
  positive(gasBudget, 'X Layer gas budget');
  for (const [name, cap] of Object.entries(policy)) positive(cap, `X Layer ${name} cap`);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('valid X Layer cap reference time required');
  if (amount > policy.maxPerPayment) throw new Error('X Layer per-payment cap exceeded');
  if (gasBudget > policy.maxGasPerPayment) throw new Error('X Layer per-payment gas cap exceeded');
  const committed = entries.reduce((sum, e) => sum + BigInt(e.amount), 0n);
  const committedGas = entries.reduce((sum, e) => sum + BigInt(e.gasBudget), 0n);
  const cutoff = nowMs - 24 * 60 * 60 * 1000;
  const daily = entries.reduce((sum, e) => (e.status !== 'accepted' || Date.parse(e.createdAt) >= cutoff) ? sum + BigInt(e.amount) : sum, 0n);
  if (daily + amount > policy.maxDaily) throw new Error('X Layer rolling 24-hour cap exceeded');
  if (committed + amount > policy.maxTotal) throw new Error('X Layer cumulative spend cap exceeded');
  if (committedGas + gasBudget > policy.maxGasTotal) throw new Error('X Layer cumulative gas cap exceeded');
}

/**
 * Next usable nonce for a new signature. Only the chain's pending count is authoritative; a different purchase's signed
 * candidate whose nonce is still unconsumed could be broadcast later and would collide, so it blocks new signing.
 */
export function nextNonce(entries: XLayerLedgerEntry[], purchaseId: string, chainPendingCount: number): number {
  if (entries.some(e => e.id !== purchaseId && e.nonce !== null && e.nonce >= chainPendingCount)) {
    throw new Error('another signed X Layer candidate still holds an unconsumed nonce; reconcile it before signing');
  }
  return chainPendingCount;
}

function pathPresent(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** A fail-closed local X Layer payer history. Reservations are durable before any transaction is signed. */
export class XLayerLedger implements XLayerLedgerPort {
  constructor(readonly path: string, readonly owner: string) {
    if (!isAbsolute(path)) throw new Error('absolute ledger path required');
    if (!owner.trim()) throw new Error('X Layer owner required');
  }
  private protectedAccess(): void { new SolanaLedger(this.path, this.owner).assertProtected(); }
  private snapshot(entries: XLayerLedgerEntry[]): XLayerLedgerSnapshot {
    return XLayerLedgerSnapshotSchema.parse({ version: 1, owner: this.owner, network: NETWORK, asset: TOKEN, entries });
  }
  read(): XLayerLedgerEntry[] {
    if (!existsSync(this.path)) throw new Error('X Layer ledger is missing; operator reconciliation required before signing');
    try {
      this.protectedAccess();
      const parsed = XLayerLedgerSnapshotSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')));
      if (parsed.owner !== this.owner) throw new Error('owner mismatch');
      return parsed.entries;
    } catch { throw new Error('X Layer ledger history unavailable or invalid; reconciliation required'); }
  }
  /** Initialize only a new ledger. Existing history is never replaced or reset. */
  initialize(): void {
    if (pathPresent(this.path + '.lock')) throw new Error('X Layer ledger locked; refusing initialization');
    if (existsSync(this.path)) throw new Error('X Layer ledger already exists; refusing to reset history');
    SolanaLedger.protectDirectory(dirname(this.path));
    const fd = openSync(this.path, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(this.snapshot([]))); fsyncSync(fd); } finally { closeSync(fd); }
    syncDirectory(dirname(this.path));
  }
  private write(entries: XLayerLedgerEntry[]): void {
    const contents = JSON.stringify(this.snapshot(entries)), tempPath = `${this.path}.tmp`;
    const fd = openSync(tempPath, 'wx', 0o600);
    try { writeFileSync(fd, contents); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tempPath, this.path);
    syncDirectory(dirname(this.path));
  }
  /** Must be called inside exclusive(); changing the reservation or a persisted candidate is refused. */
  upsert(entry: XLayerLedgerEntry): void {
    const candidate = XLayerLedgerEntrySchema.parse(entry), entries = this.read();
    const prior = entries.find(row => row.id === candidate.id);
    if (prior) {
      if (prior.amount !== candidate.amount || prior.gasBudget !== candidate.gasBudget || prior.createdAt !== candidate.createdAt) throw new Error('X Layer reservation is immutable');
      if (rank[candidate.status] < rank[prior.status]) throw new Error('X Layer ledger status cannot move backwards');
      if (prior.header !== null && (prior.header !== candidate.header || prior.hash !== candidate.hash || prior.nonce !== candidate.nonce)) throw new Error('signed X Layer candidate is immutable');
    }
    this.write([...entries.filter(row => row.id !== candidate.id), candidate]);
  }
  /** Lock creation is exclusive. A stale lock is left for operator reconciliation, never removed automatically. */
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    let fd: number;
    try { fd = openSync(`${this.path}.lock`, 'wx', 0o600); }
    catch { throw new Error('X Layer ledger locked; active signer or manual crash recovery required'); }
    try { this.read(); return await fn(); }
    finally { closeSync(fd); unlinkSync(`${this.path}.lock`); }
  }
  assertCaps(amount: bigint, gasBudget: bigint, policy: XLayerSpendPolicy, now: Date): void {
    assertXLayerCaps(this.read(), amount, gasBudget, policy, now);
  }
}
