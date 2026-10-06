import { readFileSync } from 'node:fs';
import { createKeyPairSignerFromBytes } from '@solana/kit';
export async function loadSigner(path: string, expectedAddress: string) {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path,'utf8')); } catch { throw new Error('Solana signer file unavailable'); }
  if (!Array.isArray(raw) || raw.length !== 64 || raw.some(v=>!Number.isInteger(v)||v<0||v>255)) throw new Error('invalid Solana key file');
  const bytes = Uint8Array.from(raw);
  try { const signer = await createKeyPairSignerFromBytes(bytes); if (signer.address !== expectedAddress) throw new Error('Solana signer identity mismatch'); return signer; } finally { bytes.fill(0); raw.fill(0); }
}
