import { z } from 'zod';
import { CryptoAmount } from '../../src/contracts/money.js';
import { SettlementBreakdown } from '../../src/contracts/settlement.js';
import type { FundingRequirementInput } from '../../src/contracts/ports.js';
import { assertRequirement,readCandidate } from '../../src/funding/sui/wire.js';
import type { SuiConfig } from '../../src/funding/sui/config.js';
import type { SuiLedgerEntry } from './ledger.js';
const Requirement=z.object({
 purchaseId:z.string().regex(/^pur_[A-Za-z0-9]{10,40}$/),quoteId:z.string().min(1),quoteDigest:z.string().min(1),
 amount:CryptoAmount,payTo:z.string(),resourceUrl:z.string().url(),description:z.string(),expiresAt:z.iso.datetime(),
 settlement:SettlementBreakdown.optional(),expectedPayer:z.string().optional()
}).strict();
/** Offline verifier for a pinned, protected export of historical requirements; no key/RPC/provider access. */
export function suiHistoryVerifier(input:{owner:string;requirements:unknown[];gatewayOrigins:string[];config:SuiConfig}) {
 const requirements=input.requirements.map(r=>Requirement.parse(r) as FundingRequirementInput);
 if(new Set(requirements.map(r=>r.purchaseId)).size!==requirements.length)throw Error('duplicate historical requirement');
 const origins=input.gatewayOrigins.map(value=>{
  const u=new URL(value);
  if(u.origin!==value||u.username||u.password||!(u.protocol==='https:' || (u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname))))throw Error('invalid historical gateway origin');
  return u.origin;
 });
 return async (entry:SuiLedgerEntry)=>{
  if(entry.status==='reserved')return;
  const req=requirements.find(r=>r.purchaseId===entry.id);
  if(!req || !origins.includes(new URL(req.resourceUrl).origin) || req.resourceUrl!==new URL(req.resourceUrl).origin+'/v1/purchases/'+entry.id+'/fund')throw Error('historical Sui requirement missing or mismatched');
  // A reduced current cap must not discard older committed exposure. Import checks the exact historical amount/gas.
  const historicalConfig={...input.config,maxAmount:BigInt(entry.amount),maxGasBudget:BigInt(entry.gasBudget)};
  assertRequirement(req,historicalConfig,new Date(),true);
  const decoded=await readCandidate(entry.header!,req,historicalConfig);
  if(decoded.transfer.payer!==input.owner || decoded.candidate.digest!==entry.digest || decoded.transfer.gasBudget!==entry.gasBudget || req.amount.amountBaseUnits!==entry.amount)throw Error('historical Sui signer, amount, gas or digest mismatch');
 };
}
