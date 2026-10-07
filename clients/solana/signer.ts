import { readFileSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createKeyPairSignerFromBytes } from '@solana/kit';
/** Check local migration inputs before uploading them; never repair key permissions or replace identity implicitly. */
export function assertPrivateKeyFile(path: string): void {
  if (lstatSync(path).isSymbolicLink()) throw new Error('Solana signer links forbidden');
  if (process.platform !== 'win32') {
    if ((lstatSync(path).mode & 0o077) !== 0) throw new Error('Solana signer permissions unsafe');
    return;
  }
  const script = "$ErrorActionPreference='Stop';$p='" + path.replaceAll("'", "''") + "';" + ' $a=Get-Acl -LiteralPath $p; $me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $bad=@($a.Access | Where-Object { $_.AccessControlType -eq "Allow" -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin @($me,"S-1-5-18","S-1-5-32-544") }); if ($bad.Count -gt 0) { exit 1 }; Write-Output "protected"';
  try {
    if (execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', stdio: 'pipe' }).trim() !== 'protected') throw new Error('permission check did not complete');
  }
  catch { throw new Error('Solana signer access control unsafe'); }
}
export async function loadSigner(path: string, expectedAddress: string) {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path,'utf8')); } catch { throw new Error('Solana signer file unavailable'); }
  if (!Array.isArray(raw) || raw.length !== 64 || raw.some(v=>!Number.isInteger(v)||v<0||v>255)) throw new Error('invalid Solana key file');
  const bytes = Uint8Array.from(raw);
  try { const signer = await createKeyPairSignerFromBytes(bytes); if (signer.address !== expectedAddress) throw new Error('Solana signer identity mismatch'); return signer; } finally { bytes.fill(0); raw.fill(0); }
}
