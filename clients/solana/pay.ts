import { readFileSync } from 'node:fs';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { decodePaymentSignatureHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentRequired, PaymentPayload } from '@x402/core/types';
import { SolanaRpc } from '../../src/funding/solana/rpc.js';
import { decodeTransaction } from '../../src/funding/solana/wire.js';
import { loadSigner } from './signer.js';
import type { SolanaLedgerPort } from './ledger-port.js';
import { SolanaLedger } from './ledger.js';
import { validatePayment,validateRequirement } from './policy.js';
import { loadSolanaPayerConfig, type SolanaPayerConfig } from './config.js';
export interface SolanaPaymentDeps { ledger?: SolanaLedgerPort; prepare?: (payload: PaymentPayload) => Promise<{ header: string; signature: string }>; broadcast?: (payload: PaymentPayload) => Promise<void>; }
export async function paySolanaPurchase(cfg: SolanaPayerConfig, purchaseId: string, deps: SolanaPaymentDeps = {}): Promise<{status:number;signature:string;header:string}> {
  if (!/^pur_[A-Za-z0-9]{10,40}$/.test(purchaseId)) throw new Error('invalid purchase id');
  if (cfg.settlementMode === 'payer_broadcast' && (!deps.ledger || !deps.prepare || !deps.broadcast)) throw new Error('hosted Solana requires durable ledger and internal sponsor');
  const rpc=new SolanaRpc(cfg.payerRpcUrl), ledger: SolanaLedgerPort=deps.ledger ?? new SolanaLedger(cfg.payerLedger,cfg.payer);
  await ledger.assertAllowed?.(purchaseId);
  const token=readFileSync(cfg.tokenFile,'utf8').trim(), resource=cfg.gatewayUrl+'/v1/purchases/'+purchaseId+'/fund';
  return ledger.exclusive(async()=>{
    let entry=(await ledger.read()).find(e=>e.id===purchaseId);
    if (!entry) {
      await rpc.assertNetwork(); await Promise.all([rpc.assertMint(cfg.mint),rpc.assertToken(cfg.source,cfg.mint,cfg.payer),rpc.assertToken(cfg.tokenAccount,cfg.mint,cfg.payee)]);
      await ledger.reconcile(rpc);
      const challenge=await fetch(resource,{method:'POST',headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(challenge.status!==402) throw new Error('gateway did not issue payment challenge');
      const required=await challenge.json() as PaymentRequired;
      if(required.x402Version!==2||required.resource.url!==resource||required.accepts.length!==1) throw new Error('invalid Solana challenge');
      const req=required.accepts[0]!;
      const bound=validateRequirement({x402Version:2,resource:required.resource,accepted:req},req,cfg);
      if(bound.purchaseId!==purchaseId||bound.resourceUrl!==resource)throw new Error('challenge purchase binding mismatch');
      await ledger.assertCaps(BigInt(req.amount),0n,cfg.maxTotal,cfg.maxFees);
      entry={id:purchaseId,signature:null,amount:req.amount,fee:'0',header:null,createdAt:new Date().toISOString()}; await ledger.upsert(entry);
      const signer=await loadSigner(cfg.keyFile,cfg.payer);
      const guardedSigner={...signer,signTransactions:async(...args:Parameters<typeof signer.signTransactions>)=>{
        validateRequirement({x402Version:2,resource:required.resource,accepted:req},req,cfg);
        return signer.signTransactions(...args);
      }};
      const scheme=new ExactSvmScheme(guardedSigner,{rpcUrl:cfg.payerRpcUrl});
      const created=await scheme.createPaymentPayload(2,req), payload:PaymentPayload={...created,accepted:req,resource:required.resource};
      validatePayment(payload,req,cfg);
      entry={...entry,header:encodePaymentSignatureHeader(payload)}; await ledger.upsert(entry);
    }
    if(!entry.header) throw new Error('reserved payer entry has no signed candidate; manual recovery required');
    let payload=decodePaymentSignatureHeader(entry.header);
    const binding = payload.accepted.extra?.funding as { purchaseId?: unknown } | undefined;
    if (payload.resource?.url !== resource || binding?.purchaseId !== purchaseId || payload.accepted.amount !== entry.amount) throw new Error('retained Solana candidate purchase binding mismatch');
    if(!entry.signature) {
      validatePayment(payload,payload.accepted,cfg);
      const requirement = payload.accepted;
      const prepared = deps.prepare ? null : await fetch(cfg.facilitatorUrl+'/prepare',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+readFileSync(cfg.facilitatorTokenFile,'utf8').trim()},body:JSON.stringify({x402Version:2,paymentPayload:payload,paymentRequirements:payload.accepted}),redirect:'error',signal:AbortSignal.timeout(45000)});
      if(prepared && !prepared.ok) throw new Error('Solana sponsor preparation unavailable');
      const body: { header: string; signature: string; invalidReason?: string } = deps.prepare ? await deps.prepare(payload) : await prepared!.json() as {header:string;signature:string;invalidReason?:string}; if(typeof body.header!=='string'||typeof body.signature!=='string')throw new Error('Solana sponsor preparation rejected: '+(/^[a-z_]{1,100}$/.test(body.invalidReason??'')?body.invalidReason:'invalid_response')); payload=decodePaymentSignatureHeader(body.header);
      validatePayment(payload,requirement,cfg,true);
      if(decodeTransaction((payload.payload as {transaction:string}).transaction).signature!==body.signature) throw new Error('sponsor signature mismatch');
      entry={...entry,header:body.header,signature:body.signature}; await ledger.upsert(entry);
    }
    if (deps.broadcast) await deps.broadcast(decodePaymentSignatureHeader(entry.header!));
    const response=await fetch(resource,{method:'POST',headers:{authorization:'Bearer '+token,'payment-signature':entry.header!},redirect:'error',signal:AbortSignal.timeout(60000)});
    // The header and spend reservation survive any response, timeout or process restart; never rebuild it.
    return {status:response.status,signature:entry.signature!,header:entry.header!};
  });
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/clients/solana/pay.ts')) {
  const result=await paySolanaPurchase(loadSolanaPayerConfig(process.env),process.argv[2]??'');
  console.log(JSON.stringify({status:result.status,signature:result.signature}));
}
