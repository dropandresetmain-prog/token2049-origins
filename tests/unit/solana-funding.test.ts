import { describe,it,expect } from 'vitest';
import { decodePaymentSignatureHeader,encodePaymentSignatureHeader } from '@x402/core/http';
import { address } from '@solana/kit';
import { createSolanaFundingAdapter } from '../../src/funding/solana/adapter.js';
import { scenario,clock } from '../support/solana.js';
describe('Solana exact funding',()=>{
  it('rejects a different registered payer before any broadcast',async()=>{
    const s=await scenario(),input={...s.input,expectedPayer:'11111111111111111111111111111111'};
    expect(s.adapter.prepare(s.header,input).ok).toBe(false);
    expect(await s.adapter.verify(s.header,input)).toMatchObject({ok:false,settlementAttempted:false});expect(s.submissions()).toBe(0);
  });
  it('freezes exact mint, payee token account, amount and signed quote memo',async()=>{
    const s=await scenario();expect(s.adapter.prepare(s.header,s.input)).toEqual({ok:true,transferReference:s.transfer.signature});
    expect(await s.adapter.recover(s.transfer.signature!,s.input)).toMatchObject({ok:true,funding:{rail:'solana',paymentState:'confirmed',amountBaseUnits:'1000',details:{commitment:'finalized'}}});
  });
  it.each([{amount:'999'},{amount:'1001'},{mint:'11111111111111111111111111111111'},{destination:'11111111111111111111111111111111'},{memo:'t2o:'+'a'.repeat(43)}])('rejects semantic mutation %j before settlement',async mutation=>{
    const s=await scenario(mutation);expect(s.adapter.prepare(s.header,s.input).ok).toBe(false);expect(s.submissions()).toBe(0);
  });
  it('rejects an invalid cryptographic signature before side effects',async()=>{
    const s=await scenario(),payload=decodePaymentSignatureHeader(s.header),bytes=Buffer.from((payload.payload as {transaction:string}).transaction,'base64');bytes[1]=bytes[1]!^1;payload.payload={transaction:bytes.toString('base64')};const header=encodePaymentSignatureHeader(payload);
    expect(s.adapter.prepare(header,s.input).ok).toBe(false);expect(await s.adapter.verify(header,s.input)).toMatchObject({ok:false,settlementAttempted:false});expect(s.submissions()).toBe(0);
  });
  it('refuses settlement if independent RPC reports the wrong genesis',async()=>{
    const s=await scenario();s.setFinalized(false);
    const fetchImpl=(async(url:unknown,init:any)=>JSON.parse(init.body).method==='getGenesisHash'?new Response(JSON.stringify({result:'wrong_genesis'})):s.fetchImpl(url as string,init)) as typeof fetch;
    const adapter=createSolanaFundingAdapter(s.env,{clock,fetchImpl,facilitator:s.facilitator});expect(await adapter.verify(s.header,s.input)).toMatchObject({ok:false,settlementAttempted:false});expect(s.submissions()).toBe(0);
  });
  it.each(['network','payee','quote','expiry'] as const)('rejects frozen requirement mutation %s',async kind=>{
    const s=await scenario(),input=structuredClone(s.input);if(kind==='network')input.amount.network='solana:mainnet';if(kind==='payee')input.payTo='11111111111111111111111111111111';if(kind==='quote')input.quoteDigest='other';if(kind==='expiry')input.expiresAt='2026-10-06T13:00:00Z';
    expect(s.adapter.prepare(s.header,input).ok).toBe(false);expect((await s.adapter.verify(s.header,input)).ok).toBe(false);expect(s.submissions()).toBe(0);
  });
  it('retains candidate across response loss and independently recovers after restart',async()=>{
    const s=await scenario();s.setFinalized(false);s.loseResponse();expect(s.adapter.prepare(s.header,s.input).ok).toBe(true);
    expect((await s.adapter.verify(s.header,s.input)).ok).toBe(true);expect(s.submissions()).toBe(1);
    const restarted=createSolanaFundingAdapter(s.env,{clock,fetchImpl:s.fetchImpl,facilitator:s.facilitator});
    expect((await restarted.recover(s.transfer.signature!,s.input)).ok).toBe(true);expect(s.submissions()).toBe(1);
  });
  it('rechecks expiry after awaited verification before initiating settlement',async()=>{
    const s=await scenario();s.setFinalized(false);s.facilitator.verify=async()=>{clock.advance(3600000);return {isValid:true,payer:s.transfer.payer as ReturnType<typeof address>};};
    try{expect(await s.adapter.verify(s.header,s.input)).toMatchObject({ok:false,settlementAttempted:false});expect(s.submissions()).toBe(0);}finally{clock.set('2026-10-06T14:00:00Z');}
  });
  it('recovers finalized historical payment even after payer and treasury accounts are closed',async()=>{const s=await scenario();s.closeAccounts();expect((await s.adapter.recover(s.transfer.signature!,s.input)).ok).toBe(true);});
  it('does not claim confirmation when finalized chain evidence is missing',async()=>{const s=await scenario();s.setFinalized(false);expect(await s.adapter.recover(s.transfer.signature!,s.input)).toMatchObject({ok:false,code:'payment_required'});});
  it('disables absent or wrong-network configuration without affecting other rails',async()=>{expect(createSolanaFundingAdapter({}).acceptedAsset()).toBe(null);const s=await scenario();expect(createSolanaFundingAdapter({...s.env,SOLANA_NETWORK:'mainnet'}).acceptedAsset()).toBe(null);});
});
