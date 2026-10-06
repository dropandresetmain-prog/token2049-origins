import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, type Harness } from '../support/harness.js';
import { SokosumiRuntime } from '../../src/channels/sokosumi/runtime.js';
import { MasumiClient } from '../../src/integrations/masumi/client.js';
import { nonce, makeMasumiFixture } from '../support/masumi.js';
const harnesses: Harness[]=[];
afterEach(async()=>{for(const h of harnesses.splice(0))await h.close();});
async function setup() {
  const h=await startHarness();harnesses.push(h);
  const native=makeMasumiFixture();
  const identity={owner:h.alice.customerId,token:'a'.repeat(64),gatewayToken:h.alice.token};
  const runtime=new SokosumiRuntime({db:h.gw.db,masumi:native.client,gatewayUrl:h.url,identities:[identity],clock:()=>h.clock.now().getTime()});await runtime.initialize();
  const search=await h.call('POST','/v1/offers/search',{token:h.alice.token,body:{intent:{category:'hotel',destination:{cityName:'Singapore',countryCode:'SG'},checkin:'2026-11-20',checkout:'2026-11-21',occupancies:[{adults:1,childrenAges:[]}],guestNationality:'SG',spendCeiling:{currency:'USD',amountMinor:'20000',scale:2}}}});
  const quoted=await h.call('POST','/v1/quotes',{token:h.alice.token,body:{offerId:search.body.offers[0].offerId,fulfillment:{category:'hotel',holder:{firstName:'Synthetic',lastName:'Traveler',email:'synthetic@example.com',phone:'+6500000000'},guests:[{occupancyNumber:1,firstName:'Synthetic',lastName:'Traveler',email:'synthetic@example.com'}]}}});expect(quoted.status).toBe(201);const q=quoted.body.quote;
  const request={quoteId:q.quoteId,approval:{maxTotal:q.payablePrincipal,quoteDigest:q.digest,selectedFundingOptionId:q.fundingOptions[0].fundingOptionId}};
  const start={identifier_from_purchaser:nonce,input_data:{purchase_request:JSON.stringify(request)}};
  return {h,native,identity,runtime,request,start,q};
}
async function finishPrincipal(s: Awaited<ReturnType<typeof setup>>,job:any){
  const pre=await s.runtime.status(job.id,s.identity);const guidance=JSON.parse(String(pre.result));expect(guidance.type).toBe('direct_principal_funding');
  await s.h.call('POST','/v1/purchases/'+guidance.purchaseId+'/fund',{token:s.h.alice.token,headers:{'payment-signature':'fixture:principal-'+job.id+':'+s.q.fundingOptions[0].amount.amountBaseUnits},body:{}});await s.h.gw.worker.tick();
  return guidance.purchaseId;
}
describe('authenticated durable Sokosumi standard task runtime',()=>{
  it('waits direct principal then returns fresh core receipt, native result proof and identical restart result',async()=>{
    const s=await setup();const job:any=await s.runtime.start(s.start,s.identity);const duplicate=await s.runtime.start(s.start,s.identity);expect(duplicate.id).toBe(job.id);expect(s.native.calls.filter(c=>c.url.endsWith('/payment')).length).toBe(1);
    const pending=await s.runtime.status(job.id,s.identity);expect(pending.status).toBe('running');expect(JSON.parse(String(pending.result)).state).toBe('awaiting_funding');expect(s.h.hotel.executeCalls).toBe(0);expect(s.native.calls.filter(c=>c.url.endsWith('submit-result'))).toHaveLength(0);
    await finishPrincipal(s,job);expect(s.h.hotel.executeCalls).toBe(1);expect((await s.runtime.status(job.id,s.identity)).status).toBe('running');const done=await s.runtime.status(job.id,s.identity);expect(done.status).toBe('completed');expect(JSON.parse(String(done.result))).toMatchObject({state:'succeeded',serviceFeePurpose:'service_fee'});expect(JSON.parse(String(done.result)).receipt).toBeTruthy();expect(String(done.result)).not.toContain('synthetic@example.com');
    const restart=new SokosumiRuntime(s.runtime.opts);await restart.initialize();expect(await restart.start(s.start,s.identity)).toEqual(job);expect(await restart.status(job.id,s.identity)).toEqual(done);expect(s.h.hotel.executeCalls).toBe(1);
  });
  it('rejects altered task bytes/approval, unowned reads, unsupported nonce and bearer failures',async()=>{
    const s=await setup();const j:any=await s.runtime.start(s.start,s.identity);
    await expect(s.runtime.start({...s.start,input_data:{purchase_request:' '+s.start.input_data.purchase_request}},s.identity)).rejects.toMatchObject({status:409,code:'idempotency_conflict'});
    await expect(s.runtime.start({...s.start,identifier_from_purchaser:'arbitrary string'},s.identity)).rejects.toMatchObject({status:400});
    await expect(s.runtime.status(j.id,{...s.identity,owner:s.h.bob.customerId})).rejects.toMatchObject({status:404});expect(()=>s.runtime.identity('Bearer forged')).toThrow('unauthorized');expect(s.runtime.identity('Bearer '+s.identity.token)).toEqual(s.identity);
  });
  it('never duplicates native creation after a timeout/unknown response',async()=>{
    const s=await setup();s.native.failCreate();await expect(s.runtime.start(s.start,s.identity)).rejects.toMatchObject({code:'payment_creation_unknown'});await expect(s.runtime.start(s.start,s.identity)).rejects.toMatchObject({code:'payment_creation_unknown'});expect(s.native.calls.filter(c=>c.url.endsWith('/payment'))).toHaveLength(1);expect(await s.h.gw.db.get<{n:number}>('SELECT COUNT(*)::int n FROM purchases')).toEqual({n:1});
  });
  it('recovers a lost core response through the same core idempotency key',async()=>{
    const s=await setup();let lost=true;const fetchImpl:typeof fetch=async(...args)=>{const response=await fetch(...args);if(lost){lost=false;throw new Error('private transport details');}return response;};const r=new SokosumiRuntime({...s.runtime.opts,fetchImpl});await expect(r.start(s.start,s.identity)).rejects.toMatchObject({code:'gateway_outcome_unknown'});const j=await r.start(s.start,s.identity);expect(j.id).toBeTruthy();expect(await s.h.gw.db.get<{n:number}>('SELECT COUNT(*)::int n FROM purchases')).toEqual({n:1});
  });
  it('surfaces definitive submit rejection and deadline recovery without retrying or hiding core outcome',async()=>{
    const s=await setup();const j:any=await s.runtime.start(s.start,s.identity);await finishPrincipal(s,j);s.native.failSubmit(401);const result=await s.runtime.status(j.id,s.identity);expect(result.status).toBe('running');expect(JSON.parse(String(result.result)).type).toBe('native_result_reconciliation_required');expect(JSON.parse(String(result.result)).coreResult.state).toBe('succeeded');expect(String(result.result)).not.toContain('private credentials');await s.runtime.status(j.id,s.identity);expect(s.native.calls.filter(c=>c.url.endsWith('submit-result'))).toHaveLength(1);s.h.clock.advance(31*60000);expect((await s.runtime.status(j.id,s.identity)).status).toBe('failed');
  });
  it('crash before submit remains reconcile-only with a frozen result hash',async()=>{
    const s=await setup();const j:any=await s.runtime.start(s.start,s.identity);await finishPrincipal(s,j);await s.h.gw.db.run("UPDATE sokosumi_jobs SET phase='submit_attempt',result_json=$1 WHERE id=$2",'{"state":"succeeded","receipt":"frozen"}',j.id);const next=await s.runtime.status(j.id,s.identity);expect(JSON.parse(String(next.result)).type).toBe('native_result_reconciliation_required');expect(s.native.calls.filter(c=>c.url.endsWith('submit-result'))).toHaveLength(0);
  });
  it('rejects repricing the durable job store while permitting credential rotation',async()=>{
    const s=await setup();await s.runtime.start(s.start,s.identity);
    const changed=new SokosumiRuntime({...s.runtime.opts,masumi:new MasumiClient({...s.native.client.config,feeBaseUnits:'20000'})});
    await expect(changed.initialize()).rejects.toThrow();
    const rotated=new SokosumiRuntime({...s.runtime.opts,identities:[{...s.identity,token:'b'.repeat(64)}]});await rotated.initialize();expect(rotated.identity('Bearer '+'b'.repeat(64)).owner).toBe(s.identity.owner);
  });
  it('reports immutable invalid expired requests while preserving core outcome and no retry',async()=>{
    const s=await setup();const j:any=await s.runtime.start(s.start,s.identity);s.native.p.onChainState='FundsOrDatumInvalid';s.native.p.CurrentTransaction=null;s.native.p.TransactionHistory=[];s.h.clock.advance(16*60000);
    const status=await s.runtime.status(j.id,s.identity);expect(status.status).toBe('failed');expect(JSON.parse(String(status.result))).toMatchObject({type:'native_payment_invalid_expired',coreResult:{purchaseId:expect.any(String)}});expect(s.native.calls.filter(c=>c.url.endsWith('/payment'))).toHaveLength(1);
  });
  it('does not infer unpaid solely from an expired deadline when native state remains pending',async()=>{
    const s=await setup();const j:any=await s.runtime.start(s.start,s.identity);s.native.p.onChainState=null;s.h.clock.advance(16*60000);const status=await s.runtime.status(j.id,s.identity);expect(status.status).toBe('running');expect(JSON.parse(String(status.result)).type).toBe('native_payment_reconciliation_required');
  });
});
