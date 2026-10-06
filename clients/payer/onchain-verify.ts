/**
 * Independent proof that legacy ledger entries belong to the configured wallet: every entry with a transfer reference must be a real
 * Preprod transaction spending from that wallet's address and paying the entry's payee. Used once, before a history import. Any doubt
 * (missing reference, unknown transaction, provider error, wrong spender or payee) throws, so the import fails closed.
 */
import type { LedgerEntry } from './ledger.js';

export function blockfrostEntryVerifier(opts: { baseUrl: string; projectId: string; address: string; fetchImpl?: typeof fetch; timeoutMs?: number }) {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');
  return async (entry: LedgerEntry): Promise<void> => {
    if (!entry.transferReference || !/^[0-9a-f]{64}$/.test(entry.transferReference)) {
      throw new Error(`ledger entry ${entry.purchaseId} has no verifiable transaction reference; refusing to attribute it to this wallet`);
    }
    let res: Response;
    try {
      res = await f(`${base}/txs/${entry.transferReference}/utxos`, { headers: { project_id: opts.projectId }, redirect: 'error', signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
    } catch {
      throw new Error(`could not verify ledger entry ${entry.purchaseId} on-chain (provider unreachable)`);
    }
    if (!res.ok) throw new Error(`could not verify ledger entry ${entry.purchaseId} on-chain (provider HTTP ${res.status})`);
    const tx = (await res.json().catch(() => null)) as { inputs?: Array<{ address?: string }>; outputs?: Array<{ address?: string }> } | null;
    if (!tx || !Array.isArray(tx.inputs) || !Array.isArray(tx.outputs)) throw new Error(`unexpected provider response while verifying ledger entry ${entry.purchaseId}`);
    if (!tx.inputs.some((i) => i.address === opts.address)) throw new Error(`ledger entry ${entry.purchaseId} was not spent from the configured wallet; refusing to import`);
    if (!tx.outputs.some((o) => o.address === entry.payTo)) throw new Error(`ledger entry ${entry.purchaseId} did not pay its recorded payee on-chain; refusing to import`);
  };
}
