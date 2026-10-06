import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, type Harness } from '../support/harness.js';
import { SokosumiRuntime } from '../../src/channels/sokosumi/runtime.js';
import { MasumiClient } from '../../src/integrations/masumi/client.js';
import { authenticate, createClient } from '../../src/infrastructure/auth.js';
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
  it('submits a truthful reauthorization result without claiming completed commerce',async()=>{
    const s=await setup();s.h.hotel.behavior='terms_changed';const j:any=await s.runtime.start(s.start,s.identity);await finishPrincipal(s,j);
    expect((await s.runtime.status(j.id,s.identity)).status).toBe('running');
    const done=await s.runtime.status(j.id,s.identity);expect(done.status).toBe('completed');
    expect(JSON.parse(String(done.result))).toMatchObject({state:'requires_reauthorization',statusReason:'fixture price changed'});
    expect(JSON.parse(String(done.result)).receipt).toBeNull();expect(s.h.hotel.orders.size).toBe(0);
    expect(s.native.calls.filter(c=>c.url.endsWith('submit-result'))).toHaveLength(1);
    const restarted=new SokosumiRuntime(s.runtime.opts);await restarted.initialize();expect(await restarted.status(j.id,s.identity)).toEqual(done);
  });
  it('keeps an unresolved merchant outcome distinct from funding and surfaces the native deadline',async()=>{
    const s=await setup();s.h.hotel.behavior='unknown';const j:any=await s.runtime.start(s.start,s.identity);await finishPrincipal(s,j);
    const pending=await s.runtime.status(j.id,s.identity);expect(pending.status).toBe('running');
    expect(JSON.parse(String(pending.result))).toMatchObject({type:'merchant_outcome_reconciliation_required',state:'unresolved'});
    expect(JSON.parse(String(pending.result)).fundingInstructions).toBeUndefined();
    s.h.clock.advance(31*60000);const expired=await s.runtime.status(j.id,s.identity);expect(expired.status).toBe('failed');
    expect(JSON.parse(String(expired.result))).toMatchObject({type:'native_task_deadline_reconciliation_required',state:'unresolved'});
    expect(JSON.parse(String(expired.result)).fundingInstructions).toBeUndefined();
    expect(s.h.hotel.executeCalls).toBe(1);expect(s.native.calls.filter(c=>c.url.endsWith('submit-result'))).toHaveLength(0);
  });
  it('reports a funded queued purchase as progress without another funding request',async()=>{
    const s=await setup();const j:any=await s.runtime.start(s.start,s.identity);
    const guidance=JSON.parse(String((await s.runtime.status(j.id,s.identity)).result));
    const funded=await s.h.call('POST','/v1/purchases/'+guidance.purchaseId+'/fund',{token:s.h.alice.token,headers:{'payment-signature':'fixture:queued-'+j.id+':'+s.q.fundingOptions[0].amount.amountBaseUnits},body:{}});expect(funded.status).toBe(202);
    const pending=await s.runtime.status(j.id,s.identity);expect(pending.status).toBe('running');
    expect(JSON.parse(String(pending.result))).toMatchObject({type:'purchase_in_progress',state:'funded_queued'});
    expect(JSON.parse(String(pending.result)).fundingInstructions).toBeUndefined();expect(s.h.hotel.executeCalls).toBe(0);
  });
  it('preserves a late terminal receipt without starting an expired native submission',async()=>{
    const s=await setup();const j:any=await s.runtime.start(s.start,s.identity);await finishPrincipal(s,j);s.h.clock.advance(31*60000);
    const expired=await s.runtime.status(j.id,s.identity);expect(expired.status).toBe('failed');
    expect(JSON.parse(String(expired.result))).toMatchObject({type:'native_result_reconciliation_required',coreResult:{state:'succeeded',receipt:expect.any(Object)}});
    await s.runtime.status(j.id,s.identity);expect(s.native.calls.filter(c=>c.url.endsWith('submit-result'))).toHaveLength(0);expect(s.h.hotel.executeCalls).toBe(1);
  });

});

describe('isolated read-only Sokosumi commerce-search task mode',()=>{
  it('freezes a top-three non-executable search, charges only the Masumi task fee, and completes with its retained result',async()=>{
    const h=await startHarness();harnesses.push(h);const native=makeMasumiFixture();const readOnly=await createClient(h.gw.db,{customerId:h.alice.customerId,displayName:'Capsule Sokosumi Search',channel:'test',label:'sokosumi-search',scopes:['offers:read']},h.clock.now().toISOString());const identity={owner:h.alice.customerId,token:'c'.repeat(64),gatewayToken:readOnly.token};
    const calls:string[]=[];const fetchImpl:typeof fetch=async(input,init)=>{calls.push(String(input));return fetch(input,init);};
    const runtime=new SokosumiRuntime({db:h.gw.db,masumi:native.client,gatewayUrl:h.url,identities:[identity],taskMode:'commerce_search',fetchImpl,clock:()=>h.clock.now().getTime()});await runtime.initialize();
    const request={intent:{category:'hotel',destination:{cityName:'Singapore',countryCode:'SG'},checkin:'2026-11-20',checkout:'2026-11-21',occupancies:[{adults:1,childrenAges:[]}],guestNationality:'SG',spendCeiling:{currency:'USD',amountMinor:'20000',scale:2}}};
    const start={identifier_from_purchaser:nonce,input_data:{commerce_request:JSON.stringify(request)}};
    const before=await h.gw.db.get<{offers:number;quotes:number;purchases:number}>('SELECT (SELECT COUNT(*)::int FROM offers) offers,(SELECT COUNT(*)::int FROM quotes) quotes,(SELECT COUNT(*)::int FROM purchases) purchases');
    const gatewayActor=await authenticate(h.gw.db,'Bearer '+readOnly.token,'sokosumi-search-test');expect(gatewayActor.scopes.has('offers:read')).toBe(true);expect(gatewayActor.scopes.has('quotes:write')).toBe(false);expect(gatewayActor.scopes.has('purchases:write')).toBe(false);
    const job:any=await runtime.start(start,identity);const replay=await runtime.start(start,identity);
    expect(replay.id).toBe(job.id);expect(calls).toHaveLength(1);expect(calls[0]).toContain('/v1/offers/search');
    expect(calls.some(url=>/\/v1\/(quotes|purchases)/.test(url))).toBe(false);
    expect(native.calls.filter(c=>c.url.endsWith('/payment'))).toHaveLength(1);
    const stored=JSON.parse((await h.gw.db.get<{purchase_json:string}>('SELECT purchase_json FROM sokosumi_jobs WHERE id=$1',job.id))!.purchase_json);
    expect(stored).toMatchObject({kind:'commerce_search',status:'ready',executable:false});expect(stored.offers.length).toBeLessThanOrEqual(3);
    for(const offer of stored.offers){expect(offer.executable).toBe(false);expect(Date.parse(offer.expiresAt)).toBeGreaterThan(0);}
    const after=await h.gw.db.get<{offers:number;quotes:number;purchases:number}>('SELECT (SELECT COUNT(*)::int FROM offers) offers,(SELECT COUNT(*)::int FROM quotes) quotes,(SELECT COUNT(*)::int FROM purchases) purchases');
    expect(after!.offers).toBe((before!.offers??0)+stored.offers.length);expect(after!.quotes).toBe(before!.quotes);expect(after!.purchases).toBe(before!.purchases);
    const pending=await runtime.status(job.id,identity);expect(pending.status).toBe('running');
    const done=await runtime.status(job.id,identity);expect(done.status).toBe('completed');
    expect(JSON.parse(String(done.result))).toMatchObject({commerceSearch:stored,serviceFeePurpose:'service_fee'});
    const restarted=new SokosumiRuntime(runtime.opts);await restarted.initialize();expect(await restarted.status(job.id,identity)).toEqual(done);
  });

  it('does not repeat a search after an unknown gateway outcome and reports missing search fields truthfully',async()=>{
    const h=await startHarness();harnesses.push(h);const native=makeMasumiFixture();const identity={owner:h.alice.customerId,token:'d'.repeat(64),gatewayToken:h.alice.token};
    let attempts=0;const fail:typeof fetch=async()=>{attempts++;throw new Error('private transport detail');};
    const runtime=new SokosumiRuntime({db:h.gw.db,masumi:native.client,gatewayUrl:h.url,identities:[identity],taskMode:'commerce_search',fetchImpl:fail,clock:()=>h.clock.now().getTime()});await runtime.initialize();
    const request={intent:{category:'hotel',destination:{cityName:'Singapore',countryCode:'SG'},checkin:'2026-11-20',checkout:'2026-11-21',occupancies:[{adults:1,childrenAges:[]}],guestNationality:'SG',spendCeiling:{currency:'USD',amountMinor:'20000',scale:2}}};const start={identifier_from_purchaser:nonce,input_data:{commerce_request:JSON.stringify(request)}};
    await expect(runtime.start(start,identity)).rejects.toMatchObject({code:'search_outcome_unknown'});
    await expect(runtime.start(start,identity)).rejects.toMatchObject({code:'search_outcome_unknown'});expect(attempts).toBe(1);
    const otherNonce='bcdef012345abcdef0123456';const ready=new SokosumiRuntime({db:h.gw.db,masumi:native.client,gatewayUrl:h.url,identities:[identity],taskMode:'commerce_search',clock:()=>h.clock.now().getTime()});
    const incomplete=await ready.start({identifier_from_purchaser:otherNonce,input_data:{commerce_request:JSON.stringify({intent:{category:'hotel'}})}},identity);
    const snapshot=JSON.parse((await h.gw.db.get<{purchase_json:string}>('SELECT purchase_json FROM sokosumi_jobs WHERE id=$1',String(incomplete.id)))!.purchase_json);
    expect(snapshot).toMatchObject({kind:'commerce_search',status:'needs_input',executable:false,offers:[],needs_input:{status:'needs_input'}});
  });

  it('keeps MIP task and status calls behind the configured bearer and owner boundary',async()=>{
    const h=await startHarness();harnesses.push(h);const native=makeMasumiFixture();const identity={owner:h.alice.customerId,token:'e'.repeat(64),gatewayToken:h.alice.token};
    const runtime=new SokosumiRuntime({db:h.gw.db,masumi:native.client,gatewayUrl:h.url,identities:[identity],taskMode:'commerce_search',clock:()=>h.clock.now().getTime()});await runtime.initialize();
    const {createHttpApp}=await import('../../src/channels/http/app.js');const server=createHttpApp({core:h.gw.core,extraRouters:[{path:'/marketplace/mip003',router:runtime.router(),auth:false}]}).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
    const address=server.address() as import('node:net').AddressInfo;const base='http://127.0.0.1:'+address.port;
    try{
      const availability=await fetch(base+'/marketplace/mip003/availability');expect(availability.status).toBe(200);expect(await availability.json()).toMatchObject({status:'available',readinessScope:'task_store_only',externalDependenciesChecked:false});
      expect((await fetch(base+'/marketplace/mip003/input_schema')).status).toBe(200);
      expect((await fetch(base+'/marketplace/mip003/start_job',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(401);
      await expect(runtime.status('00000000-0000-4000-8000-000000000000',{...identity,owner:h.bob.customerId})).rejects.toMatchObject({status:404});
    }finally{await new Promise<void>(r=>server.close(()=>r()));}
  });
});
