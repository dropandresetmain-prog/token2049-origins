import { createHash } from 'node:crypto';
import { closeSync, lstatSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { z } from 'zod';
import { NETWORK, USDC_TYPE } from '../../src/funding/sui/config.js';
import { SolanaLedger, syncDirectory } from '../solana/ledger.js';

export const SuiLedgerEntrySchema = z.object({
  id: z.string().min(1),
  amount: z.string().regex(/^[1-9][0-9]*$/),
  gasBudget: z.string().regex(/^[1-9][0-9]*$/),
  header: z.string().min(1).nullable(),
  digest: z.string().min(1).nullable(),
  createdAt: z.iso.datetime(),
  status: z.enum(['reserved', 'signed', 'accepted']),
}).strict().refine(entry => (entry.header === null) === (entry.digest === null), 'header and digest must both be set or both be null')
  .refine(entry => entry.status !== 'reserved' || (entry.header === null && entry.digest === null), 'reserved entries cannot contain a header or digest')
  .refine(entry => entry.status === 'reserved' || (entry.header !== null && entry.digest !== null), 'signed entries require a header and digest');

export const SuiLedgerSnapshotSchema = z.object({
  version: z.literal(1),
  owner: z.string().min(1),
  network: z.literal(NETWORK),
  asset: z.literal(USDC_TYPE),
  entries: z.array(SuiLedgerEntrySchema),
}).strict().superRefine((snapshot, ctx) => {
  const ids = new Set<string>();
  const digests = new Set<string>();
  for (const entry of snapshot.entries) {
    if (ids.has(entry.id)) ctx.addIssue({ code: 'custom', message: 'duplicate purchase id' });
    ids.add(entry.id);
    if (entry.digest !== null) {
      if (digests.has(entry.digest)) ctx.addIssue({ code: 'custom', message: 'duplicate transaction digest' });
      digests.add(entry.digest);
    }
  }
});

export type SuiLedgerEntry = z.infer<typeof SuiLedgerEntrySchema>;
export type SuiLedgerSnapshot = z.infer<typeof SuiLedgerSnapshotSchema>;
const Entry = SuiLedgerEntrySchema, Snapshot = SuiLedgerSnapshotSchema;
export interface SuiSpendPolicy {
  maxPerPayment: bigint;
  maxDaily: bigint;
  maxTotal: bigint;
  maxGasPerPayment: bigint;
  maxGasTotal: bigint;
}

const positive = (value: bigint, label: string): void => {
  if (value <= 0n) throw new Error(`${label} must be positive`);
};

const rank: Record<SuiLedgerEntry['status'], number> = { reserved: 0, signed: 1, accepted: 2 };

/** Ledger operations may be synchronous for the local file ledger or asynchronous for hosted storage. */
export interface SuiLedgerPort {
  read(): SuiLedgerEntry[] | Promise<SuiLedgerEntry[]>;
  upsert(entry: SuiLedgerEntry): void | Promise<void>;
  assertCaps(amount: bigint, gasBudget: bigint, policy: SuiSpendPolicy, now: Date): void | Promise<void>;
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
}

/** Pure shared cap calculation. Reservations count as committed exposure, including gas. */
export function assertSuiCaps(entries: SuiLedgerEntry[], amount: bigint, gasBudget: bigint, policy: SuiSpendPolicy, now: Date): void {
  positive(amount, 'Sui payment amount');
  positive(gasBudget, 'Sui gas budget');
  for (const [name, cap] of Object.entries(policy)) positive(cap, `Sui ${name} cap`);
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('valid Sui cap reference time required');
  if (amount > policy.maxPerPayment) throw new Error('Sui per-payment cap exceeded');
  if (gasBudget > policy.maxGasPerPayment) throw new Error('Sui per-payment gas cap exceeded');

  const committed = entries.reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
  const committedGas = entries.reduce((sum, entry) => sum + BigInt(entry.gasBudget), 0n);
  const cutoff = nowMs - 24 * 60 * 60 * 1000;
  const daily = entries.reduce((sum, entry) => (entry.status !== 'accepted' || Date.parse(entry.createdAt) >= cutoff) ? sum + BigInt(entry.amount) : sum, 0n);
  if (daily + amount > policy.maxDaily) throw new Error('Sui rolling 24-hour cap exceeded');
  if (committed + amount > policy.maxTotal) throw new Error('Sui cumulative spend cap exceeded');
  if (committedGas + gasBudget > policy.maxGasTotal) throw new Error('Sui cumulative gas cap exceeded');
}

/** A fail-closed local Sui payer history. Reservations are durable before any transaction is submitted. */
export class SuiLedger {
  constructor(readonly path: string, readonly owner: string) {
    if (!isAbsolute(path)) throw new Error('absolute ledger path required');
    if (!owner.trim()) throw new Error('Sui owner required');
  }

  private protectedAccess(): void {
    new SolanaLedger(this.path, this.owner).assertProtected();
  }

  private snapshot(entries: SuiLedgerEntry[]): SuiLedgerSnapshot {
    return Snapshot.parse({ version: 1, owner: this.owner, network: NETWORK, asset: USDC_TYPE, entries });
  }

  private assertNotRetired(): void {
    // Any marker, including a malformed file or dangling link, removes local signing authority.
    if (pathPresent(this.path + '.retired')) throw new Error('Sui local signer permanently retired; use canonical PostgreSQL history');
  }

  read(): SuiLedgerEntry[] {
    this.assertNotRetired();
    return this.readForImport();
  }

  /** Read-only identity/permission validation for approved import; never used by payment operations. */
  readForImport(): SuiLedgerEntry[] {
    if (!existsSync(this.path)) throw new Error('Sui ledger is missing; operator reconciliation required before signing');
    try {
      this.protectedAccess();
      const parsed = Snapshot.parse(JSON.parse(readFileSync(this.path, 'utf8')));
      if (parsed.owner !== this.owner) throw new Error('owner mismatch');
      return parsed.entries;
    } catch {
      throw new Error('Sui ledger history unavailable or invalid; reconciliation required');
    }
  }

  /** Initialize only a new ledger. Existing history is never replaced or reset. */
  initialize(): void {
    this.assertNotRetired();
    if (pathPresent(this.path + '.lock')) throw new Error('Sui ledger locked; refusing initialization');
    if (existsSync(this.path)) throw new Error('Sui ledger already exists; refusing to reset history');
    SolanaLedger.protectDirectory(dirname(this.path));
    const fd = openSync(this.path, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify(this.snapshot([])));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    syncDirectory(dirname(this.path));
  }

  private write(entries: SuiLedgerEntry[]): void {
    const contents = JSON.stringify(this.snapshot(entries));
    const tempPath = `${this.path}.tmp`;
    const fd = openSync(tempPath, 'wx', 0o600);
    try {
      writeFileSync(fd, contents);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tempPath, this.path);
    syncDirectory(dirname(this.path));
  }

  /** Must be called inside exclusive(); changing the reservation or a persisted candidate is refused. */
  upsert(entry: SuiLedgerEntry): void {
    const candidate = Entry.parse(entry);
    const entries = this.read();
    const prior = entries.find(row => row.id === candidate.id);
    if (prior) {
      if (prior.amount !== candidate.amount || prior.gasBudget !== candidate.gasBudget || prior.createdAt !== candidate.createdAt) {
        throw new Error('Sui reservation is immutable');
      }
      if (rank[candidate.status] < rank[prior.status]) throw new Error('Sui ledger status cannot move backwards');
      if (prior.header !== null && (prior.header !== candidate.header || prior.digest !== candidate.digest)) {
        throw new Error('signed Sui candidate is immutable');
      }
    }
    this.write([...entries.filter(row => row.id !== candidate.id), candidate]);
  }

  /** Lock creation is exclusive. A stale lock is left for operator reconciliation, never removed automatically. */
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    this.assertNotRetired();
    let fd: number;
    try {
      fd = openSync(`${this.path}.lock`, 'wx', 0o600);
    } catch {
      throw new Error('Sui ledger locked; active signer or manual crash recovery required');
    }
    try {
      this.read(); // Check complete identity-bound history only after holding the lock.
      return await fn();
    } finally {
      closeSync(fd);
      unlinkSync(`${this.path}.lock`);
    }
  }

  assertCaps(amount: bigint, gasBudget: bigint, policy: SuiSpendPolicy, now: Date): void {
    assertSuiCaps(this.read(), amount, gasBudget, policy, now);
  }
}

const Retirement = z.object({ version: z.literal(1), owner: z.string().min(1), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

function pathPresent(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

function pinnedRetirement(ledger: SuiLedger, expectedSha256: string): string {
  ledger.readForImport();
  const hash = createHash('sha256').update(readFileSync(ledger.path)).digest('hex');
  if (hash !== expectedSha256) throw new Error('Sui retirement history hash mismatch');
  return JSON.stringify(Retirement.parse({ version: 1, owner: ledger.owner, sourceSha256: hash }));
}

function assertFenceFile(path: string, marker: string): void {
  new SolanaLedger(path, '').assertProtected();
  if (readFileSync(path, 'utf8') !== marker) throw new Error('Sui retirement fence conflict; operator reconciliation required');
}

/** Verify both fences without modifying history or permitting local signing. */
export function assertSuiFileRetired(ledger: SuiLedger, expectedSha256: string): void {
  const marker = pinnedRetirement(ledger, expectedSha256);
  assertFenceFile(ledger.path + '.retired', marker);
  assertFenceFile(ledger.path + '.lock', marker);
}

/** Operator-only cutover step, after backup and quiescence. It never resets history or removes a lock. */
export function retireSuiFileLedger(ledger: SuiLedger, expectedSha256: string): void {
  const marker = pinnedRetirement(ledger, expectedSha256);
  if (pathPresent(ledger.path + '.retired')) assertFenceFile(ledger.path + '.retired', marker);
  const lockPath = ledger.path + '.lock';
  if (pathPresent(lockPath)) {
    // An ordinary/stale signer lock is ambiguous: never reinterpret or delete it.
    assertFenceFile(lockPath, marker);
  } else {
    const fd = openSync(lockPath, 'wx', 0o600);
    try { writeFileSync(fd, marker); fsyncSync(fd); } finally { closeSync(fd); }
    syncDirectory(dirname(ledger.path));
  }
  // All earlier file signers create this lock exclusively. Keep it permanently, including on failure.
  if (pinnedRetirement(ledger, expectedSha256) !== marker) throw new Error('Sui history changed during retirement');
  if (!pathPresent(ledger.path + '.retired')) {
    const fd = openSync(ledger.path + '.retired', 'wx', 0o600);
    try { writeFileSync(fd, marker); fsyncSync(fd); } finally { closeSync(fd); }
    syncDirectory(dirname(ledger.path));
  }
  assertSuiFileRetired(ledger, expectedSha256);
}
