import { describe,it,expect,vi } from 'vitest';
import { address } from '@solana/kit';
import { guardSponsorSigner } from '../../clients/solana/facilitator.js';
import { loadSolanaPayerConfig } from '../../clients/solana/config.js';
import { scenario } from '../support/solana.js';
import { NETWORK } from '../../src/funding/solana/wire.js';
describe('Solana sponsor financial boundaries',()=>{
  it('refuses signing and submission if quote expires during earlier verification',async()=>{
    const s=await scenario(),t=s.transfer;
    const cfg=loadSolanaPayerConfig({...s.env,SOLANA_PAYER_RPC_URL:s.env.SOLANA_RPC_URL,SOLANA_PAYER_ADDRESS:t.payer,SOLANA_PAYER_TOKEN_ACCOUNT:t.source,SOLANA_PAYER_KEY_FILE:'unused',SOLANA_LEDGER_DIRECTORY:process.cwd()+'/data/test',SOLANA_PAYER_MAX_PURCHASE_BASE_UNITS:'10000',SOLANA_PAYER_MAX_TOTAL_BASE_UNITS:'10000',SOLANA_PAYER_MAX_COMMERCIAL_USD_MINOR:'1000',SOLANA_SPONSOR_MAX_TOTAL_FEE_LAMPORTS:'100000',SOLANA_SPONSOR_KEY_FILE:'unused',SOLANA_GATEWAY_URL:'http://127.0.0.1:8787',SOLANA_GATEWAY_TOKEN_FILE:'unused'});
    const base={getAddresses:()=>[address(t.sponsor)],signTransaction:vi.fn(async()=>s.transaction),sendTransaction:vi.fn(async()=>t.signature!),simulateTransaction:async()=>{},confirmTransaction:async()=>{}};
    const guarded=guardSponsorSigner(base,{read:()=>[{id:'test',signature:t.signature,amount:'0',fee:'10001',header:s.header,createdAt:s.input.expiresAt}]},cfg);
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-06T14:11:00Z'));
    try{await expect(guarded.signTransaction(s.transaction,address(t.sponsor),NETWORK)).rejects.toThrow(/expiry/);await expect(guarded.sendTransaction(s.transaction,NETWORK)).rejects.toThrow(/expiry/);expect(base.signTransaction).not.toHaveBeenCalled();expect(base.sendTransaction).not.toHaveBeenCalled();}finally{vi.useRealTimers();}
  });
});
