import { describe,it,expect } from 'vitest';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SolanaRpc } from '../../src/funding/solana/rpc.js';
import { SolanaLedger,scanHistory } from '../../clients/solana/ledger.js';
describe('Solana shared payer ledger',()=>{
  it('reconciles gross outbound tokens and fees even when incoming tokens leave the net balance unchanged',async()=>{
    const fetchImpl=(async(_url:unknown,init:any)=>{
      const request=JSON.parse(init.body);let result:any;
      if(request.method==='getGenesisHash')result='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
      if(request.method==='getSignaturesForAddress')result=[{signature:'historical'}];
      if(request.method==='getTransaction'){
        expect(request.params[1].encoding).toBe('jsonParsed');
        const balance={accountIndex:1,mint:'4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',owner:'payer',uiTokenAmount:{amount:'20000',decimals:6}};
        result={blockTime:1,meta:{fee:5000,preTokenBalances:[balance],postTokenBalances:[balance],innerInstructions:[]},transaction:{message:{accountKeys:[{pubkey:'payer'},{pubkey:'source'}],instructions:[{programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',parsed:{type:'transferChecked',info:{source:'source',mint:balance.mint,tokenAmount:{amount:'1000'}}}}]}}};
      }
      return new Response(JSON.stringify({result}),{status:200});
    }) as typeof fetch;
    const rows=await scanHistory(new SolanaRpc('https://api.devnet.solana.com',fetchImpl),'payer');expect(rows).toMatchObject([{amount:'1000',fee:'5000'}]);
  });
  it('persists cumulative spend across restart and refuses concurrency',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'solana-ledger-'));SolanaLedger.protectDirectory(directory);
    const ledger=new SolanaLedger(join(directory,'payer.json'),'payer');ledger.initialize([]);
    try {
      await ledger.exclusive(async()=>{
        ledger.assertCaps(1000n,0n,2000n,0n);ledger.upsert({id:'purchase',signature:null,amount:'1000',fee:'0',header:null,createdAt:new Date().toISOString()});
        await expect(new SolanaLedger(ledger.path,'payer').exclusive(async()=>{})).rejects.toThrow(/locked/);
      });
      const restarted=new SolanaLedger(ledger.path,'payer');expect(restarted.read()).toHaveLength(1);
      expect(()=>restarted.assertCaps(1001n,0n,2000n,0n)).toThrow(/cap/);
      expect(()=>new SolanaLedger(ledger.path,'other').read()).toThrow(/identity/);
      writeFileSync(ledger.path,'corrupt');expect(()=>restarted.read()).toThrow(/history/);
    } finally {rmSync(directory,{recursive:true,force:true});}
  });
});
