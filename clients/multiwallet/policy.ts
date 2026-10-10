import { digestOf } from '../../src/infrastructure/ids.js';
import type { PayerConfig } from '../payer/config.js';
import type { SolanaPayerConfig } from '../solana/config.js';
import type { SuiPayerConfig } from '../sui/config.js';
import { PayerError } from '../payer/errors.js';
/** Financial bounds are pinned with ownership. Raising a cap requires an explicit new policy/cutover, never an env edit. */
export function cardanoPolicy(c:PayerConfig) {
 return {rail:'cardano',network:c.network,asset:c.allowedAsset,payee:c.expectedPayTo,gateway:c.gatewayUrl,
 maxPerPayment:String(c.maxPerPayment),maxTotal:String(c.maxCumulative),maxDaily:String(c.maxDaily),maxFee:String(c.maxFeeLovelace),maxAdaOutput:String(c.maxAdaOutputLovelace)};
}
export function solanaPolicy(c:SolanaPayerConfig) {
 return {rail:'solana',asset:c.mint,payee:c.payee,treasuryTokenAccount:c.tokenAccount,payerTokenAccount:c.source,sponsor:c.sponsor,
 gateway:c.gatewayUrl,settlementMode:c.settlementMode,maxPerPayment:String(c.maxPerPayment),maxTotal:String(c.maxTotal),maxSponsorFees:String(c.maxFees),maxCommercial:String(c.maxCommercial)};
}
export function suiPolicy(c:SuiPayerConfig) {
 return {rail:'sui',payee:c.payee,gateway:c.gatewayUrl,maxAmount:String(c.maxAmount),maxPerPayment:String(c.policy.maxPerPayment),
 maxDaily:String(c.policy.maxDaily),maxTotal:String(c.policy.maxTotal),maxGasPerPayment:String(c.policy.maxGasPerPayment),
 maxGasTotal:String(c.policy.maxGasTotal),maxCommercial:String(c.maxCommercial)};
}
export function assertPinnedPolicy(stored:string, actual:unknown):void {
 try {if(digestOf(JSON.parse(stored))===digestOf(actual))return;}catch{}
 throw new PayerError('policy_violation','registered spending policy differs from signer configuration');
}
