import { readFileSync } from 'node:fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SolanaLedger } from '../solana/ledger.js';

export function loadSigner(path: string, expectedAddress: string): Ed25519Keypair {
  try {
    new SolanaLedger(path, expectedAddress).assertProtected();
    const key = Ed25519Keypair.fromSecretKey(readFileSync(path, 'utf8').trim());
    if (key.toSuiAddress() !== expectedAddress) throw new Error('identity mismatch');
    return key;
  } catch { throw new Error('protected Sui signer file unavailable or identity mismatch'); }
}
