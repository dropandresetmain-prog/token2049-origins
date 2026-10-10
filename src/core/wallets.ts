import type { Db } from '../infrastructure/db.js';
import { FundingSource } from '../contracts/presentation.js';
import type { FundingOption } from '../contracts/commerce.js';
import { CoreError } from './errors.js';

export interface WalletRecord {
 source_id: string; payer_id: string; customer_id: string; rail: string; network: string; asset_id: string;
 public_address: string; signer_ref: string; ledger_namespace: string; policy_json: string; public_json: string; enabled: boolean;
}
export async function walletRecord(db: Db, sourceId: string): Promise<WalletRecord | undefined> {
 return db.get<WalletRecord>('SELECT w.*,p.customer_id FROM registered_wallets w JOIN payer_profiles p ON p.id=w.payer_id WHERE w.source_id=$1', sourceId);
}
/** No signer initialization or RPC in listing. Ownership comes from the verified gateway actor. */
export async function registeredSources(db: Db, customerId: string): Promise<FundingSource[]> {
 const rows = await db.all<WalletRecord>('SELECT w.* FROM registered_wallets w JOIN payer_profiles p ON p.id=w.payer_id WHERE p.customer_id=$1 ORDER BY w.source_id', customerId);
 return rows.map(r => publicSource(r));
}
export function publicSource(r: Pick<WalletRecord,'public_json'|'source_id'|'rail'|'network'|'asset_id'|'public_address'|'enabled'>): FundingSource {
 const source = FundingSource.parse(JSON.parse(r.public_json));
 if (source.sourceId !== r.source_id || source.rail !== r.rail || source.network !== r.network || source.assetId !== r.asset_id || source.publicAddress !== r.public_address)
  throw new CoreError('forbidden', 'registered source identity mismatch');
 return { ...source, readiness: r.enabled ? 'configured' : 'unavailable' };
}
export async function approvedSource(db: Db, customerId: string, sourceId: string | undefined, option: FundingOption) {
 const profile = await db.get('SELECT id FROM payer_profiles WHERE customer_id=$1', customerId);
 if (!sourceId) {
  if (profile) throw new CoreError('invalid_request', 'select a registered wallet and approve it with the exact quote');
  return undefined; // Explicit compatibility for historical/external-payment customers without a payer profile.
 }
 const row = await walletRecord(db, sourceId);
 if (!row || row.customer_id !== customerId || !row.enabled) throw new CoreError('forbidden', 'selected wallet is unavailable for this customer');
 const source = publicSource(row);
 if (source.rail !== option.rail || source.network !== option.amount.network || source.assetId !== option.amount.assetId)
  throw new CoreError('invalid_request', 'selected wallet does not match the approved funding option');
 return source;
}
export async function purchaseSource(db: Db, purchaseId: string): Promise<FundingSource | undefined> {
 const row = await db.get<{ source_json: string }>('SELECT source_json FROM purchase_wallets WHERE purchase_id=$1', purchaseId);
 return row ? FundingSource.parse(JSON.parse(row.source_json)) : undefined;
}
