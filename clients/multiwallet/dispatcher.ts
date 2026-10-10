import type { Db } from '../../src/infrastructure/db.js';
import { Approval, QuoteView, FundingOption } from '../../src/contracts/commerce.js';
import { digestOf } from '../../src/infrastructure/ids.js';
import { walletRecord, publicSource, type WalletRecord } from '../../src/core/wallets.js';
import type { PurchaseRow, FundingRequirementRecord } from '../../src/core/store.js';
import { PayerError } from '../payer/errors.js';
import type { BridgePayer } from '../payer/bridge.js';

export type EngineLoader = (wallet: WalletRecord) => Promise<BridgePayer>;
export interface DispatchOptions { db: Db; enabled: boolean; instanceId: string; load: EngineLoader; now?: () => Date; }
/** Caller supplies only an existing purchase id. Customer, source, amount and authorization are canonical DB facts. */
export class MultiWalletPayer implements BridgePayer {
 constructor(private readonly d: DispatchOptions) {}
 async pay(purchaseId: string) {
  if (!/^pur_[A-Za-z0-9]{10,40}$/.test(purchaseId)) throw new PayerError('invalid_request','invalid purchase id');
  if (!this.d.enabled) throw new PayerError('policy_violation','consolidated signing is disabled');
  const p = await this.d.db.get<PurchaseRow>('SELECT * FROM purchases WHERE id=$1',purchaseId);
  const binding = await this.d.db.get<{ source_id:string;customer_id:string;source_json:string }>('SELECT * FROM purchase_wallets WHERE purchase_id=$1',purchaseId);
  if (!p || !binding) throw new PayerError('not_found','authorized wallet purchase not found');
  const wallet = await walletRecord(this.d.db,binding.source_id);
  if (!wallet || !wallet.enabled || wallet.customer_id!==p.customer_id || binding.customer_id!==p.customer_id)
   throw new PayerError('policy_violation','purchase wallet ownership mismatch');
  const source = publicSource(wallet);
  if (digestOf(source)!==digestOf(JSON.parse(binding.source_json))) throw new PayerError('policy_violation','registered identity differs from purchase authorization');
  const result = await this.d.db.withExclusiveLock('wallet-dispatch:'+source.network+':'+source.publicAddress, async () => {
   const authority = await this.d.db.get<{ instance_id:string;enabled:boolean }>('SELECT * FROM wallet_signing_authority WHERE source_id=$1',source.sourceId);
   if (!authority?.enabled || authority.instance_id!==this.d.instanceId) throw new PayerError('policy_violation','signer authority has not been granted for this instance');
   const current = await this.d.db.get<PurchaseRow>('SELECT * FROM purchases WHERE id=$1',purchaseId);
   if (!current) throw new PayerError('not_found','purchase not found');
   const q = await this.d.db.get<{customer_id:string;public_json:string;digest:string;expires_at:string}>('SELECT * FROM quotes WHERE id=$1',current.quote_id);
   if (!q || q.customer_id!==wallet.customer_id) throw new PayerError('policy_violation','quote ownership mismatch');
   const quote=QuoteView.parse(JSON.parse(q.public_json)), approval=Approval.parse(JSON.parse(current.approval_json));
   const req=JSON.parse(current.funding_requirement_json) as FundingRequirementRecord;
   const option=quote.fundingOptions.find(o=>o.fundingOptionId===approval.selectedFundingOptionId);
   if (!option || approval.selectedSourceId!==source.sourceId || approval.quoteDigest!==q.digest || quote.digest!==q.digest ||
    option.rail!==source.rail || current.funding_rail!==source.rail || option.amount.network!==source.network || option.amount.assetId!==source.assetId ||
    req.payerPublicAddress!==source.publicAddress || req.quoteDigest!==q.digest || req.expiresAt!==q.expires_at || req.fundingOptionId!==option.fundingOptionId ||
    digestOf(FundingOption.parse({ fundingOptionId:req.fundingOptionId,rail:req.rail,amount:{network:req.network,assetId:req.assetId,decimals:req.decimals,amountBaseUnits:req.amountBaseUnits,...(req.symbol?{symbol:req.symbol}:{})},payTo:req.payTo,...(req.settlement?{settlement:req.settlement}:{}),...(req.valuation?{valuation:req.valuation as FundingOption['valuation']}:{} ) }))!==digestOf(option) ||
    approval.maxTotal.currency!==quote.payablePrincipal.currency || approval.maxTotal.scale!==quote.payablePrincipal.scale ||
    BigInt(approval.maxTotal.amountMinor)<BigInt(quote.payablePrincipal.amountMinor)) throw new PayerError('policy_violation','canonical payment authorization mismatch');
   if (current.payment_state!=='not_received' || current.state!=='awaiting_funding') {
    const f=await this.d.db.get<{transfer_reference:string}>('SELECT transfer_reference FROM funding_evidence WHERE purchase_id=$1',purchaseId);
    return {transferReference:f?.transfer_reference??null,resumed:true};
   }
   if (Date.parse(q.expires_at)<=(this.d.now?.()??new Date()).getTime()) throw new PayerError('policy_violation','quote expired; reconcile any prior candidate');
   const handoff=await this.d.db.get<{status:string;retry_safe:boolean}>('SELECT * FROM payment_handoffs WHERE purchase_id=$1',purchaseId);
   if (handoff?.status==='failed' && !handoff.retry_safe) throw new PayerError('conflict','unknown previous handoff requires reconciliation');
   // The engine's existing wallet ledger lock additionally serializes this deployment against legacy signer processes.
   // A lost DB connection prevents reservation/candidate persistence; engines never submit unpersisted bytes.
   return (await this.d.load(wallet)).pay(purchaseId);
  });
  if (!result.acquired) throw new PayerError('conflict','selected wallet has a payment in progress');
  return result.value;
 }
}
