import type { PaymentRequirements, PaymentPayload } from '@x402/core/types';
import { deepEqual } from '@x402/core/utils';
import type { FundingRequirementInput } from '../../src/contracts/ports.js';
import type { SolanaPayerConfig } from './config.js';
import { NETWORK, commitment, decodeTransaction, assertTransfer } from '../../src/funding/solana/wire.js';
export function validateRequirement(payload: Pick<PaymentPayload,'x402Version'|'resource'|'accepted'>, req: PaymentRequirements, cfg: SolanaPayerConfig): FundingRequirementInput {
  if (!payload || !req || payload.x402Version !== 2 || !deepEqual(payload.accepted,req) || req.scheme !== 'exact' || req.network !== NETWORK || req.asset !== cfg.mint || req.payTo !== cfg.payee || req.extra?.feePayer !== cfg.sponsor || req.extra?.tokenAccount !== cfg.tokenAccount ||
      !/^[1-9][0-9]*$/.test(req.amount) || BigInt(req.amount) > cfg.maxPerPayment || req.maxTimeoutSeconds !== 60) throw new Error('Solana payment outside approved policy');
  const preparation=req.extra.preparation as {url?:unknown;method?:unknown;authentication?:unknown;requiresFullySignedTransaction?:unknown};
  if (cfg.settlementMode === 'payer_broadcast') {
    if (!preparation || (preparation as { mode?: unknown }).mode !== 'payer_broadcast' || preparation.requiresFullySignedTransaction !== true) throw new Error('Solana hosted preparation prerequisite mismatch');
  } else if(!preparation||preparation.url!==cfg.facilitatorUrl+'/prepare'||preparation.method!=='POST'||preparation.authentication!=='Bearer'||preparation.requiresFullySignedTransaction!==true)throw new Error('Solana preparation prerequisite mismatch');
  const f = req.extra.funding as Omit<FundingRequirementInput,'amount'|'payTo'|'description'>;
  if (!f || payload.resource?.url !== f.resourceUrl || !f.resourceUrl.startsWith(cfg.gatewayUrl+'/v1/purchases/') || Date.parse(f.expiresAt) <= Date.now() || Date.parse(f.expiresAt) > Date.now()+3600000) throw new Error('Solana quote resource or expiry mismatch');
  const input: FundingRequirementInput = { ...f, description:'Solana funding', payTo:req.payTo, amount:{network:req.network,assetId:req.asset,decimals:6,amountBaseUnits:req.amount} };
  if (!input.settlement || input.settlement.policy.mode !== 'scaled_testnet' || BigInt(input.settlement.commercialTotal.amountMinor) > cfg.maxCommercial || commitment(input,cfg.tokenAccount) !== req.extra.memo) throw new Error('Solana quote commitment or commercial cap mismatch');
  return input;
}
export function validatePayment(payload: PaymentPayload, req: PaymentRequirements, cfg: SolanaPayerConfig, signed = false): FundingRequirementInput {
  const input=validateRequirement(payload,req,cfg);
  const transaction = (payload.payload as {transaction:string}).transaction, transfer = decodeTransaction(transaction,signed);
  assertTransfer(transfer,req);
  if (transfer.payer !== cfg.payer || transfer.source !== cfg.source) throw new Error('Solana payer account mismatch');
  return input;
}
