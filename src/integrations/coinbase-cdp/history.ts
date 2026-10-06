import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CDP_MAX_ACTION_WEI, CDP_MAX_TOTAL_WEI, CDP_NETWORK, CDP_TRANSFER_IDEMPOTENCY_KEY, validateHistory } from './contracts.js';
import type { CdpActionHistory, CdpPublicIdentity } from './contracts.js';

export function initialHistory(identity: CdpPublicIdentity, now = new Date().toISOString()): CdpActionHistory {
  return {
    version: 1,
    network: CDP_NETWORK,
    treasuryAddress: identity.treasuryAddress,
    recipientAddress: identity.recipientAddress,
    maxActionWei: CDP_MAX_ACTION_WEI.toString(),
    maxTotalWei: CDP_MAX_TOTAL_WEI.toString(),
    attempted: false,
    status: 'idle',
    idempotencyKey: CDP_TRANSFER_IDEMPOTENCY_KEY,
    txHash: null,
    updatedAt: now,
  };
}

function syncWrite(path: string, content: string): void {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, content, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function createHistoryOnce(path: string, identity: CdpPublicIdentity): CdpActionHistory {
  if (!isAbsolute(path)) throw new Error('CDP action history path must be absolute');
  const history = initialHistory(identity);
  try {
    syncWrite(path, JSON.stringify(history, null, 2) + '\n');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return readHistory(path, identity);
    throw new Error('could not create protected CDP action history');
  }
  return history;
}

export function readHistory(path: string, identity: CdpPublicIdentity): CdpActionHistory {
  if (!isAbsolute(path)) throw new Error('CDP action history path must be absolute');
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error('CDP action history is unavailable or corrupt; operator reconciliation required'); }
  if (!value || typeof value !== 'object') throw new Error('CDP action history is invalid; operator reconciliation required');
  const history = value as CdpActionHistory;
  validateHistory(history, identity);
  return history;
}

export function writeHistoryAtomic(path: string, history: CdpActionHistory): void {
  if (!isAbsolute(path)) throw new Error('CDP action history path must be absolute');
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    syncWrite(temp, JSON.stringify(history, null, 2) + '\n');
    renameSync(temp, path);
    if (process.platform !== 'win32') {
      const directory = openSync(dirname(path), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  } catch {
    throw new Error('could not persist CDP action history; do not retry until operator reconciliation');
  }
}

export async function withHistoryLock<T>(path: string, action: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`;
  if (!isAbsolute(path)) throw new Error('CDP action history path must be absolute');
  let fd: number;
  try { fd = openSync(lockPath, 'wx', 0o600); }
  catch { throw new Error('CDP action history is locked; inspect the history and reconcile before retrying'); }
  try {
    writeFileSync(fd, `${process.pid}\n`, 'utf8');
    fsyncSync(fd);
    return await action();
  } finally {
    closeSync(fd);
    const { unlinkSync } = await import('node:fs');
    try { unlinkSync(lockPath); } catch { /* A retained lock safely blocks later actions. */ }
  }
}
