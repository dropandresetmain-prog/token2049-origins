import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CDP_MAX_ACTION_WEI, CDP_MAX_TOTAL_WEI, CDP_NETWORK, validateHistory } from './contracts.js';
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
    idempotencyKey: randomUUID(),
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

export function assertHistoryProtected(path: string, requireFile = true): void {
  if (!isAbsolute(path)) throw new Error('CDP action history path must be absolute');
  try {
    const directory = lstatSync(dirname(path));
    if (directory.isSymbolicLink() || !directory.isDirectory()) throw new Error();
    if (requireFile) {
      const file = lstatSync(path);
      if (file.isSymbolicLink() || !file.isFile()) throw new Error();
    }
    if (process.platform === 'win32') {
      const escaped = path.replaceAll("'", "''");
      const target = requireFile ? `@('${escaped}',(Split-Path -Parent '${escaped}'))` : `@((Split-Path -Parent '${escaped}'))`;
      const script = `$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $allowed=@($me,'S-1-5-18','S-1-5-32-544'); foreach($x in ${target}){ $a=Get-Acl -LiteralPath $x; $bad=@($a.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin $allowed }); if($bad.Count -gt 0){ exit 1 } }`;
      execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'pipe' });
    } else {
      if ((directory.mode & 0o077) !== 0) throw new Error();
      if (requireFile && (lstatSync(path).mode & 0o077) !== 0) throw new Error();
    }
  } catch {
    throw new Error('CDP action history directory or file is not protected; transfer blocked');
  }
}

export function protectHistoryDirectory(path: string): void {
  if (!isAbsolute(path)) throw new Error('CDP action history path must be absolute');
  const directory = dirname(path);
  try {
    const stat = lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error();
    if (process.platform === 'win32') {
      const sid = execFileSync('powershell.exe', ['-NoProfile', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], { encoding: 'utf8' }).trim();
      execFileSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { stdio: 'pipe' });
    } else chmodSync(directory, 0o700);
    assertHistoryProtected(path, false);
  } catch (error) {
    throw new Error('CDP action history directory could not be protected; provisioning blocked', { cause: error });
  }
}

export function createHistoryOnce(path: string, identity: CdpPublicIdentity): CdpActionHistory {
  if (!isAbsolute(path)) throw new Error('CDP action history path must be absolute');
  if (existsSync(path)) return readHistory(path, identity);
  protectHistoryDirectory(path);
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
  assertHistoryProtected(path);
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
  assertHistoryProtected(path);
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
  assertHistoryProtected(path);
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
