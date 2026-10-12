import { readFileSync } from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
import { SolanaLedger } from '../solana/ledger.js';

/** The key file holds one 0x-prefixed secp256k1 private key; it is never logged and must be owner-protected. */
export function loadSigner(path: string, expectedAddress: string) {
  try {
    new SolanaLedger(path, expectedAddress).assertProtected();
    const raw = readFileSync(path, 'utf8').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new Error('invalid key');
    const account = privateKeyToAccount(raw as `0x${string}`);
    if (account.address.toLowerCase() !== expectedAddress.toLowerCase()) throw new Error('identity mismatch');
    return account;
  } catch { throw new Error('protected X Layer signer file unavailable or identity mismatch'); }
}
