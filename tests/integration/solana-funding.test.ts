import { describe,it,expect } from 'vitest';
import { startHarness,createFundablePurchase,type Harness } from '../support/harness.js';
import { scenario,clock } from '../support/solana.js';
import { newTestSchema } from '../support/database.js';
import { createSolanaFundingAdapter } from '../../src/funding/solana/adapter.js';
import type { FundingRequirementInput } from '../../src/contracts/ports.js';
import { money } from '../../src/contracts/money.js';
import { Accounts,accountBalance,cryptoAsset } from '../../src/core/journal.js';
async function storedInput(h:Harness,id:string):Promise<FundingRequirementInput>{
  const p=(await h.gw.db.get<{id:string;quote_id:string;funding_requirement_json:string}>('SELECT * FROM purchases WHERE id=$1',id))!,r=JSON.parse(p.funding_requirement_json);
  return {purchaseId:id,quoteId:p.quote_id,quoteDigest:r.quoteDigest,resourceUrl:r.resourceUrl,expiresAt:r.expiresAt,description:'test',payTo:r.payTo,amount:{network:r.network,assetId:r.assetId,decimals:r.decimals,amountBaseUnits:r.amountBaseUnits},settlement:r.settlement};
}
describe('real Solana adapter with mocked RPC and real core/PostgreSQL',()=>{
  it.each([false,true])('recovers response loss after restart, late=%s, without another settlement',async late=>{
    clock.set('2026-10-06T14:00:00Z');const s=await scenario(),schema=newTestSchema();let h=await startHarness({schema,clock,settlementPolicy:{mode:'scaled_testnet',numerator:1,denominator:1000}});
    try{
      h.retail.price=money('USD',100n);h.gw.core.deps.fundingAdapters.clear();h.gw.core.deps.fundingAdapters.set('solana',s.adapter);
      const p=await createFundablePurchase(h),id=p.purchase.purchaseId,input=await storedInput(h,id),signed=await s.forRequirement(input);s.setFinalized(false);
      const original=s.adapter.verify;s.adapter.verify=async(header,requirement)=>{
        expect(await h.gw.db.get('SELECT id FROM funding_attempts WHERE purchase_id=$1',id)).toBeDefined();
        const result=await original(header,requirement);expect(result.ok).toBe(true);throw new Error('process loss after chain acceptance before journal');
      };
      const send=()=>h.call('POST','/v1/purchases/'+id+'/fund',{token:h.alice.token,headers:{'payment-signature':signed.header}});
      const responses=await Promise.all([send(),send()]);expect(responses.map(r=>r.status).sort()).toEqual([409,500]);expect(s.submissions()).toBe(1);
      expect((await h.gw.db.get<{n:number}>('SELECT COUNT(*)::int AS n FROM funding_evidence WHERE purchase_id=$1',id))!.n).toBe(0);
      await h.close();await h.gw.db.close();h=await startHarness({schema,clock});
      const restarted=createSolanaFundingAdapter(s.env,{clock,fetchImpl:s.fetchImpl,facilitator:s.facilitator});h.gw.core.deps.fundingAdapters.clear();h.gw.core.deps.fundingAdapters.set('solana',restarted);
      s.closeAccounts();if(late)clock.advance(3600000);
      expect(await h.gw.core.recoverPendingFunding(id)).toBe(true);await h.gw.worker.tick();await h.gw.worker.tick();
      expect(s.submissions()).toBe(1);expect((await h.gw.db.get<{n:number}>('SELECT COUNT(*)::int AS n FROM funding_evidence WHERE purchase_id=$1',id))!.n).toBe(1);
      const row=(await h.gw.db.get<{state:string}>('SELECT state FROM purchases WHERE id=$1',id))!;
      expect(row.state).toBe(late?'expired':'succeeded');expect(h.retail.executeCalls).toBe(late?0:1);
      if(late)expect(await accountBalance(h.gw.db,Accounts.customerUnapplied,cryptoAsset(input.amount.network,input.amount.assetId))).toBe(-1000n);
    }finally{await h.close();clock.set('2026-10-06T14:00:00Z');}
  });
});
