import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, unlinkSync } from 'node:fs';
import type { Db } from '../../src/infrastructure/db.js';
import { dirname } from 'node:path';
import { NETWORK, TEST_MINT } from '../../src/funding/solana/wire.js';
import { SolanaSnapshot, scanHistory, syncDirectory, type SolanaLedgerEntry } from './ledger.js';
import type { SolanaRole } from './pg-ledger.js';
import type { SolanaRpc } from '../../src/funding/solana/rpc.js';
import { blockedHistoryEvidence, type HistoricalBlockPolicy } from './blocked-history.js';

export const solanaSourceHash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
export interface SolanaImportInput { role: SolanaRole; owner: string; text: string; expectedSha256: string; }

export function parseSolanaImport(input: SolanaImportInput): SolanaLedgerEntry[] {
  if (!/^[0-9a-f]{64}$/.test(input.expectedSha256) || solanaSourceHash(input.text) !== input.expectedSha256) throw new Error('Solana import source hash mismatch');
  const snapshot = SolanaSnapshot.parse(JSON.parse(input.text));
  const entries = snapshot.entries;
  const signatures = entries.flatMap(e => e.signature ? [e.signature] : []);
  if (snapshot.owner !== input.owner || new Set(entries.map(e => e.id)).size !== entries.length || new Set(signatures).size !== signatures.length) {
    throw new Error('Solana import identity or entry conflict');
  }
  return entries;
}

/** Complete finalized history must be covered; pending reservations remain committed without inventing outcomes. */
export async function verifySolanaImport(rpc: SolanaRpc, owner: string, entries: SolanaLedgerEntry[]): Promise<void> {
  const history = await scanHistory(rpc, owner);
  for (const observed of history) {
    const entry = entries.find(e => e.signature === observed.signature);
    if (!entry || BigInt(entry.amount) < BigInt(observed.amount) || BigInt(entry.fee) < BigInt(observed.fee)) {
      throw new Error('Solana import omits finalized spend or fees');
    }
  }
  for (const entry of entries) {
    if (entry.id.startsWith('history:') && !history.some(e => e.signature === entry.signature)) throw new Error('Solana imported history cannot be independently verified');
  }
}

/** Both roles import in one transaction. Any conflict rolls back identities, rows and permanent markers together. */
export async function importSolanaHistories(db: Db, inputs: [SolanaImportInput, SolanaImportInput], verify: (owner: string, entries: SolanaLedgerEntry[]) => Promise<void>, blockPolicy?: HistoricalBlockPolicy): Promise<void> {
  if (inputs[0].role !== 'payer' || inputs[1].role !== 'sponsor' || inputs[0].owner === inputs[1].owner) throw new Error('distinct payer and sponsor imports required');
  const parsed = inputs.map(input => ({ input, entries: parseSolanaImport(input) }));
  const blocked = blockPolicy ? blockedHistoryEvidence(blockPolicy, inputs, parsed.map(p => p.entries)) : [];
  const policyText = JSON.stringify(blockPolicy ?? { mode: 'chain_verified' });
  // Option B preserves unresolved exposure with a permanent replay ban; it asserts no chain outcome.
  const prior = await db.all<{ role: string }>('SELECT role FROM hosted_solana_import');
  if (prior.length !== 0 && prior.length !== 2) throw new Error('partial Solana import requires reconciliation');
  if (!prior.length && !blockPolicy) for (const { input, entries } of parsed) await verify(input.owner, entries);
  await db.tx(async () => {
    for (const { input, entries } of parsed) {
      const identity = await db.get<{ owner: string; network: string; mint: string }>('SELECT * FROM hosted_solana_identity WHERE role=$1', input.role);
      if (identity && (identity.owner !== input.owner || identity.network !== NETWORK || identity.mint !== TEST_MINT)) throw new Error('Solana imported identity mismatch');
      const marker = await db.get<{ source_sha256: string; entry_count: number; committed_amount: string; committed_fee: string }>('SELECT * FROM hosted_solana_import WHERE role=$1', input.role);
      const amount = entries.reduce((n, e) => n + BigInt(e.amount), 0n).toString();
      const fee = entries.reduce((n, e) => n + BigInt(e.fee), 0n).toString();
      if (marker) {
        if (marker.source_sha256 !== input.expectedSha256 || marker.entry_count !== entries.length || marker.committed_amount !== amount || marker.committed_fee !== fee) throw new Error('Solana import marker conflict');
        const archive = await db.get<{ source_text: string; policy_text: string }>('SELECT * FROM hosted_solana_source_archive WHERE role=$1', input.role);
        if (!archive || archive.source_text !== input.text || archive.policy_text !== policyText) throw new Error('Solana source archive or policy conflict');
        for (const entry of entries) {
          const row = await db.get<{ signature: string | null; amount: string; fee: string; header: string | null; created_at: string }>('SELECT * FROM hosted_solana_ledger WHERE role=$1 AND id=$2', input.role, entry.id);
          if (!row || row.amount !== entry.amount || row.fee !== entry.fee || row.created_at !== entry.createdAt || row.signature !== entry.signature || row.header !== entry.header) throw new Error('Solana imported entry conflict');
        }
        continue;
      }
      const existing = await db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM hosted_solana_ledger WHERE role=$1', input.role);
      if (identity || existing?.n) throw new Error('Solana import refuses pre-existing unmarked history');
      await db.run('INSERT INTO hosted_solana_identity(role,owner,network,mint) VALUES($1,$2,$3,$4)', input.role, input.owner, NETWORK, TEST_MINT);
      for (const entry of entries) await db.run('INSERT INTO hosted_solana_ledger(role,id,signature,amount,fee,header,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', input.role, entry.id, entry.signature, entry.amount, entry.fee, entry.header, entry.createdAt);
      await db.run('INSERT INTO hosted_solana_import(role,source_sha256,entry_count,committed_amount,committed_fee,imported_at) VALUES($1,$2,$3,$4,$5,$6)', input.role, input.expectedSha256, entries.length, amount, fee, new Date().toISOString());
      await db.run('INSERT INTO hosted_solana_source_archive(role,source_text,policy_text) VALUES($1,$2,$3)', input.role, input.text, policyText);
    }
    const stored = await db.all<{ purchase_id: string; message_sha256: string; candidate_sha256: string; payer_signature: string; evidence: string }>('SELECT * FROM hosted_solana_blocked_history ORDER BY purchase_id');
    if (prior.length && stored.length !== blocked.length) throw new Error('Solana blocked history count conflict');
    for (const entry of blocked) {
      const row = stored.find(r => r.purchase_id === entry.purchaseId);
      if (prior.length) {
        if (!row || row.message_sha256 !== entry.messageSha256 || row.candidate_sha256 !== entry.candidateSha256 || row.payer_signature !== entry.payerSignature || row.evidence !== entry.evidence) throw new Error('Solana blocked history evidence conflict');
      } else {
        await db.run('INSERT INTO hosted_solana_blocked_history(purchase_id,message_sha256,candidate_sha256,payer_signature,classification,replay_policy,evidence) VALUES($1,$2,$3,$4,$5,$6,$7)', entry.purchaseId, entry.messageSha256, entry.candidateSha256, entry.payerSignature, 'historical_unresolved', 'permanently_blocked', entry.evidence);
      }
    }
  });
}

/** Retirement is explicit and permanent. Run only at the approved migration checkpoint, with both legacy signers stopped. */
export async function retireSolanaHistories(inputs: [SolanaImportInput & { path: string }, SolanaImportInput & { path: string }]): Promise<void> {
  if (inputs[0].role !== 'payer' || inputs[1].role !== 'sponsor' || inputs[0].owner === inputs[1].owner || inputs[0].path === inputs[1].path) throw new Error('distinct legacy payer/sponsor histories required');
  for (const input of inputs) {
    parseSolanaImport(input);
    if (readFileSync(input.path, 'utf8') !== input.text) throw new Error('legacy Solana history changed before retirement');
  }
  const markerFor = (input: SolanaImportInput & { path: string }) => JSON.stringify({ owner: input.owner, sourceSha256: input.expectedSha256, role: input.role });
  const locks: Array<{ path: string; fd: number }> = [];
  const hadMarker = inputs.some(input => existsSync(input.path + '.retired'));
  try {
    for (const input of inputs) {
      const marker = markerFor(input), lockPath = input.path + '.lock';
      if (existsSync(input.path + '.retired') && readFileSync(input.path + '.retired', 'utf8') !== marker) throw new Error('Solana retirement marker conflict');
      if (existsSync(lockPath)) {
        if (readFileSync(lockPath, 'utf8') !== marker) throw new Error('legacy Solana signer active or ambiguous lock');
      } else {
        const fd = openSync(lockPath, 'wx', 0o600);
        locks.push({ path: lockPath, fd });
        writeFileSync(fd, marker); fsyncSync(fd); syncDirectory(dirname(input.path));
      }
    }
    // Keep BOTH permanent lock files: older file signers may not understand .retired, but all of them fail on .lock.
    // Failure after either marker retains the locks and budget; an interrupted retirement resumes only for the same hash.
    for (const input of inputs) {
      if (readFileSync(input.path, 'utf8') !== input.text) throw new Error('legacy Solana history changed under retirement lock');
      const marker = markerFor(input);
      if (!existsSync(input.path + '.retired')) {
        const fd = openSync(input.path + '.retired', 'wx', 0o600);
        try { writeFileSync(fd, marker); fsyncSync(fd); } finally { closeSync(fd); }
        syncDirectory(dirname(input.path));
      }
    }
  } catch (error) {
    if (!hadMarker && !inputs.some(input => existsSync(input.path + '.retired'))) for (const lock of locks) unlinkSync(lock.path);
    throw error;
  } finally { for (const lock of locks) closeSync(lock.fd); }
}
