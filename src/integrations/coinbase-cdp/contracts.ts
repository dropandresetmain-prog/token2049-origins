import { isAbsolute } from 'node:path';

export const CDP_NETWORK = 'base-sepolia' as const;
export const CDP_CHAIN_ID = 84532;
export const CDP_EXPLORER = 'https://sepolia.basescan.org';
export const CDP_TREASURY_NAME = 'capsule-treasury-test';
export const CDP_RECIPIENT_NAME = 'capsule-treasury-recipient';
export const CDP_POLICY_DESCRIPTION = 'Capsule Base Sepolia treasury test';
export const CDP_POLICY_IDEMPOTENCY_KEY = '5db11d68-1955-47e9-89d2-7d3a27a94c77';
export const CDP_POLICY_ATTACH_IDEMPOTENCY_KEY = '9750cf26-32ae-45ab-901f-e3e17b245356';
export const CDP_TRANSFER_WEI = 1_000_000_000_000n;
export const CDP_MAX_ACTION_WEI = CDP_TRANSFER_WEI;
export const CDP_MAX_TOTAL_WEI = CDP_TRANSFER_WEI;
export const CDP_TRANSFER_WEI_TEXT = CDP_TRANSFER_WEI.toString();

export interface CdpSettings {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
  identityFile: string;
  historyFile: string;
  rpcUrl: string;
}

export interface CdpPublicIdentity {
  version: 1;
  network: typeof CDP_NETWORK;
  treasuryName: typeof CDP_TREASURY_NAME;
  treasuryAddress: `0x${string}`;
  recipientName: typeof CDP_RECIPIENT_NAME;
  recipientAddress: `0x${string}`;
  policyId: string;
  createdAt: string;
}

export interface CdpActionHistory {
  version: 1;
  network: typeof CDP_NETWORK;
  treasuryAddress: `0x${string}`;
  recipientAddress: `0x${string}`;
  maxActionWei: string;
  maxTotalWei: string;
  attempted: boolean;
  status: 'idle' | 'pending' | 'submitted' | 'unknown' | 'confirmed';
  idempotencyKey: string;
  txHash: `0x${string}` | null;
  updatedAt: string;
}

export interface CdpWalletProjection {
  provider: 'coinbase-cdp';
  readiness: 'ready' | 'blocked';
  network: typeof CDP_NETWORK;
  treasury: { name: string; address: string; balanceWei: string | null };
  recipient: { name: string; address: string };
  policy: { id: string; enforced: boolean } | null;
  lastAction: { status: CdpActionHistory['status']; txHash: string | null } | null;
  reasons: string[];
}

export function requireAbsoluteFile(path: string | undefined, label: string): string {
  if (!path || !isAbsolute(path)) throw new Error(`${label} must be an absolute path`);
  return path;
}

export function validatePair(treasuryAddress: string, recipientAddress: string): { treasuryAddress: `0x${string}`; recipientAddress: `0x${string}` } {
  const addressPattern = /^0x[0-9a-fA-F]{40}$/;
  if (!addressPattern.test(treasuryAddress) || !addressPattern.test(recipientAddress)) throw new Error('CDP account addresses are invalid');
  const treasury = treasuryAddress as `0x${string}`;
  const recipient = recipientAddress as `0x${string}`;
  if (treasury.toLowerCase() === recipient.toLowerCase()) throw new Error('treasury and recipient must be separate Capsule-owned accounts');
  return { treasuryAddress: treasury, recipientAddress: recipient };
}

export function validateTransfer(amountWei: bigint, network: string, treasuryAddress: string, recipientAddress: string): void {
  const pair = validatePair(treasuryAddress, recipientAddress);
  if (network !== CDP_NETWORK) throw new Error('only Base Sepolia is allowed for this treasury action');
  if (pair.treasuryAddress.toLowerCase() === pair.recipientAddress.toLowerCase()) throw new Error('treasury cannot send to itself');
  if (amountWei <= 0n || amountWei > CDP_MAX_ACTION_WEI) throw new Error('transfer exceeds the per-action limit');
}

export function validateHistory(history: CdpActionHistory, identity: CdpPublicIdentity): void {
  if (history.version !== 1 || history.network !== CDP_NETWORK) throw new Error('CDP action history is invalid; operator reconciliation required');
  const pair = validatePair(history.treasuryAddress, history.recipientAddress);
  if (pair.treasuryAddress.toLowerCase() !== identity.treasuryAddress.toLowerCase() || pair.recipientAddress.toLowerCase() !== identity.recipientAddress.toLowerCase()) {
    throw new Error('CDP action history identity changed; operator reconciliation required');
  }
  if (history.maxActionWei !== CDP_MAX_ACTION_WEI.toString() || history.maxTotalWei !== CDP_MAX_TOTAL_WEI.toString()) {
    throw new Error('CDP action history limits changed; operator reconciliation required');
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(history.idempotencyKey)) throw new Error('CDP action history idempotency key is invalid; operator reconciliation required');
  if (history.status !== 'idle' && history.status !== 'pending' && history.status !== 'submitted' && history.status !== 'unknown' && history.status !== 'confirmed') {
    throw new Error('CDP action history status is invalid; operator reconciliation required');
  }
  if (history.status === 'idle' && history.attempted) throw new Error('CDP action history is inconsistent; operator reconciliation required');
  if ((history.status === 'pending' || history.status === 'submitted' || history.status === 'unknown' || history.status === 'confirmed') && !history.attempted) {
    throw new Error('CDP action history is inconsistent; operator reconciliation required');
  }
  if (history.txHash !== null && !/^0x[0-9a-f]{64}$/i.test(history.txHash)) throw new Error('CDP action history transaction hash is invalid; operator reconciliation required');
  if ((history.status === 'idle' || history.status === 'pending' || history.status === 'unknown') && history.txHash !== null) throw new Error('CDP action history transaction state is inconsistent; operator reconciliation required');
  if ((history.status === 'submitted' || history.status === 'confirmed') && history.txHash === null) throw new Error('CDP action history transaction state is inconsistent; operator reconciliation required');
  if (typeof history.updatedAt !== 'string' || !Number.isFinite(Date.parse(history.updatedAt))) throw new Error('CDP action history timestamp is invalid; operator reconciliation required');
  if (typeof history.attempted !== 'boolean') throw new Error('CDP action history is invalid; operator reconciliation required');
}
