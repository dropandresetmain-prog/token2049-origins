import { existsSync } from 'node:fs';
import { CdpClient } from '@coinbase/cdp-sdk';
import type { CdpActionHistory, CdpPublicIdentity, CdpSettings, CdpWalletProjection } from './contracts.js';
import { loadProvisioned, readNativeEthBalance } from './client.js';
import { readHistory } from './history.js';

export async function readCdpTreasury(client: CdpClient, settings: CdpSettings): Promise<CdpWalletProjection> {
  const identity: CdpPublicIdentity = await loadProvisioned(client, settings);
  const balanceWei = await readNativeEthBalance(client, identity);
  let history: CdpActionHistory | null = null;
  const reasons: string[] = [];
  if (existsSync(settings.historyFile)) {
    history = readHistory(settings.historyFile, identity);
    if (history.status === 'pending' || history.status === 'unknown' || history.status === 'submitted') reasons.push('A test transfer needs readback or operator reconciliation.');
  } else {
    reasons.push('Durable action history is not initialized.');
  }
  return {
    provider: 'coinbase-cdp',
    readiness: reasons.length ? 'blocked' : 'ready',
    network: identity.network,
    treasury: { name: identity.treasuryName, address: identity.treasuryAddress, balanceWei },
    recipient: { name: identity.recipientName, address: identity.recipientAddress },
    policy: { id: identity.policyId, enforced: true },
    lastAction: history ? { status: history.status, txHash: history.txHash } : null,
    reasons,
  };
}
