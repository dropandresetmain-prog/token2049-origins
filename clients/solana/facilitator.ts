import { readFileSync } from 'node:fs';
import express from 'express';
import type { Server } from 'node:http';
import { createHash } from 'node:crypto';
import { toFacilitatorSvmSigner,type FacilitatorSvmSigner } from '@x402/svm';
import { ExactSvmScheme } from '@x402/svm/exact/facilitator';
import { encodePaymentSignatureHeader,decodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { address } from '@solana/kit';
import { NETWORK, decodeTransaction } from '../../src/funding/solana/wire.js';
import { SolanaRpc } from '../../src/funding/solana/rpc.js';
import { loadSigner } from './signer.js';
import { SolanaLedger } from './ledger.js';
import { validatePayment } from './policy.js';
import { loadSolanaPayerConfig, type SolanaPayerConfig } from './config.js';
export function guardSponsorSigner(baseSigner:FacilitatorSvmSigner,ledger:Pick<SolanaLedger,'read'>,cfg:SolanaPayerConfig):FacilitatorSvmSigner {
  return { ...baseSigner, signTransaction: async (tx:string,feePayer:Parameters<typeof baseSigner.signTransaction>[1],network:string)=>{
    const transfer=decodeTransaction(tx),entry=ledger.read().find(e=>e.signature===transfer.signature);
    if(network!==NETWORK||!entry?.header)throw new Error('sponsor candidate missing');
    const bound=decodePaymentSignatureHeader(entry.header);validatePayment(bound,bound.accepted,cfg,true);
    return baseSigner.signTransaction(tx,feePayer,network);
  }, sendTransaction: async (tx: string, network: string) => {
    const transfer = decodeTransaction(tx), entry = ledger.read().find(e=>e.signature===transfer.signature);
    if (network !== NETWORK || !entry?.header) throw new Error('sponsor candidate must be persisted before broadcast');
    const bound=decodePaymentSignatureHeader(entry.header);validatePayment(bound,bound.accepted,cfg,true);
    return baseSigner.sendTransaction(tx,network);
  } };
}
export async function startSolanaFacilitator(cfg: SolanaPayerConfig, port = 0): Promise<Server> {
  const rpc = new SolanaRpc(cfg.rpcUrl), ledger = new SolanaLedger(cfg.sponsorLedger,cfg.sponsor);
  ledger.read(); await rpc.assertNetwork();
  const key = await loadSigner(cfg.sponsorKeyFile,cfg.sponsor), baseSigner = toFacilitatorSvmSigner(key,{defaultRpcUrl:cfg.rpcUrl});
  const signer = guardSponsorSigner(baseSigner,ledger,cfg);
  const scheme = new ExactSvmScheme(signer,undefined,{maxComputeUnits:20000,maxPriorityFeeMicroLamports:1,maxRequiredSignatures:2});
  const app = express(), authHash=createHash('sha256').update(readFileSync(cfg.facilitatorTokenFile,'utf8').trim()).digest('hex');
  app.use((req,res,next)=>{const received=req.header('authorization');if(!received?.startsWith('Bearer ')||createHash('sha256').update(received.slice(7)).digest('hex')!==authHash){res.status(401).json({error:'facilitator authentication required'});return;}next();});
  app.use(express.json({limit:'20kb'}));
  app.get('/supported',(_req,res)=>res.json({kinds:[{x402Version:2,scheme:'exact',network:NETWORK,extra:{feePayer:cfg.sponsor,preparation:{url:cfg.facilitatorUrl+'/prepare',method:'POST',authentication:'Bearer',requiresFullySignedTransaction:true}}}],extensions:[],signers:{[NETWORK]:[cfg.sponsor]}}));
  app.post(['/prepare','/verify','/settle'],async (request,response)=>{
    try {
      const payload = request.body?.paymentPayload as PaymentPayload, requirements = request.body?.paymentRequirements as PaymentRequirements;
      const input = validatePayment(payload,requirements,cfg,request.path !== '/prepare');
      const result = await ledger.exclusive(async()=>{
        const raw = (payload.payload as {transaction:string}).transaction;
        const transfer = decodeTransaction(raw,request.path !== '/prepare');
        const id = createHash('sha256').update(transfer.message).digest('hex');
        const existing = ledger.read().find(e=>e.id===id);
        if (request.path === '/prepare' && existing?.header) return {header:existing.header,signature:existing.signature};
        if(request.path === '/prepare' && existing) throw new Error('incomplete sponsor reservation requires manual recovery');
        if (request.path !== '/prepare' && (!existing || existing.signature !== transfer.signature)) throw new Error('sponsor candidate unavailable');
        if (request.path === '/settle') {
          // Retries only rebroadcast the same immutable signed transaction. A lost RPC response cannot create another spend.
          const prior = await rpc.call<any>('getSignatureStatuses',[[transfer.signature],{searchTransactionHistory:true}]);
          if (prior.value?.[0] && !prior.value[0].err) return {success:true,network:NETWORK,transaction:transfer.signature,payer:cfg.payer};
        }
        const check = await scheme.verify(payload,requirements);
        if (!check.isValid) return check;
        if (request.path === '/verify') return check;
        if (request.path === '/prepare') {
          await ledger.reconcile(rpc);
          const fee = await rpc.call<{value:number|null}>('getFeeForMessage',[Buffer.from(transfer.message).toString('base64'),{commitment:'confirmed'}]);
          if (fee.value === null || !Number.isSafeInteger(fee.value) || fee.value > 10001) throw new Error('sponsor fee outside cap');
          ledger.assertCaps(0n,BigInt(fee.value),cfg.maxTotal,cfg.maxFees);
          // Reserve the exact fee before granting signing authority; a crash retains this liability.
          ledger.upsert({id,signature:null,amount:'0',fee:String(fee.value),header:null,createdAt:new Date().toISOString()});
          validatePayment(payload,requirements,cfg);
          const signed = await baseSigner.signTransaction(raw,address(cfg.sponsor),NETWORK);
          const signature = decodeTransaction(signed).signature!;
          const header = encodePaymentSignatureHeader({...payload,payload:{transaction:signed}});
          ledger.upsert({id,signature,amount:'0',fee:String(fee.value),header,createdAt:new Date().toISOString()});
          return {header,signature};
        }
        // SDK exact scheme validates signatures, memo, token ATA and sponsor isolation before settlement.
        return await scheme.settle(payload,requirements);
      });
      response.json(result);
    } catch { response.status(400).json({error:'Solana sponsor policy, ledger or RPC rejected request'}); }
  });
  return await new Promise(resolve=>{ const server=app.listen(port,'127.0.0.1',()=>resolve(server)); });
}
if (process.argv[1]?.replaceAll('\\','/').endsWith('/clients/solana/facilitator.ts')) {
  const cfg=loadSolanaPayerConfig(process.env), port=Number(process.env.SOLANA_FACILITATOR_LISTEN_PORT ?? new URL(cfg.facilitatorUrl).port);
  if (!Number.isSafeInteger(port)||port<1||port>65535) throw new Error('configured facilitator port required');
  await startSolanaFacilitator(cfg,port); console.log('Solana Devnet facilitator listening on loopback');
}
