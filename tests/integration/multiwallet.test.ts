import { afterEach, describe, it, expect, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMcpServer } from '../../src/channels/mcp/server.js';
import { PAYER_WAKE_URL, PAYER_WAKE_DESTINATION } from '../../src/channels/mcp/config.js';
import { startHarness, retailIntent, retailFulfillment, type Harness } from '../support/harness.js';
import { FixtureFundingAdapter, FIXTURE_ASSET, FIXTURE_TREASURY } from '../support/fixtures.js';
import { FundingSource, SOLANA_DEVNET_NETWORK, SOLANA_DEVNET_USDC_MINT, SUI_TESTNET_NETWORK, SUI_TESTNET_USDC_TYPE, maskAddress } from '../../src/contracts/presentation.js';
import type { FundingRail } from '../../src/contracts/common.js';
import type { FundingAdapter } from '../../src/contracts/ports.js';
import { MultiWalletPayer } from '../../clients/multiwallet/dispatcher.js';
import { createBridge, listenLoopback } from '../../clients/payer/bridge.js';
import { PgPayerLedger } from '../../clients/payer/pg-ledger.js';
import { createTestDb, crashTestDb, newTestSchema } from '../support/database.js';
import {walletRecord} from '../../src/core/wallets.js';
import { demoData } from '../../src/demo/config.js';
import type { AddressInfo } from 'node:net';

const active: Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of active.splice(0).reverse())await close();});
const networks={cardano:'cardano:preprod',solana:SOLANA_DEVNET_NETWORK,sui:SUI_TESTNET_NETWORK};
const assets={cardano:FIXTURE_ASSET,solana:SOLANA_DEVNET_USDC_MINT,sui:SUI_TESTNET_USDC_TYPE};
const addresses={cardano:'addr_test1fixturepayer',solana:'9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',sui:'0x'+'a'.repeat(64)};
async function register(h:Harness,rail:FundingRail,customer=h.alice.customerId,index=1) {
 if(rail==='masumi')throw Error('not a purchase rail');
 const address=index===1?addresses[rail]:rail==='cardano'?addresses[rail]+String(index):rail==='sui'?'0x'+String(index).repeat(64):'So11111111111111111111111111111111111111112';
 const source=FundingSource.parse({sourceId:'src_'+String(index).padStart(30,'0')+({cardano:'ca',solana:'50',sui:'51'}[rail]),rail,network:networks[rail],assetId:assets[rail],publicAddress:address,displayAddress:maskAddress(address),readiness:'configured'});
 const db=h.gw.db;
 await db.run("INSERT INTO payer_profiles(id,customer_id,created_at) VALUES($1,$2,'now') ON CONFLICT(customer_id) DO NOTHING",'payer_'+customer,customer);
 await db.run('INSERT INTO registered_wallets(source_id,payer_id,rail,network,asset_id,public_address,signer_ref,ledger_namespace,public_json,policy_json,enabled) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,\'{}\',TRUE)',
 source.sourceId,'payer_'+customer,rail,source.network,source.assetId,source.publicAddress,'FIXTURE_'+rail.toUpperCase(),source.sourceId,JSON.stringify(source));
 await db.run("INSERT INTO wallet_signing_authority VALUES($1,'fixture-candidate',TRUE)",source.sourceId);
 return source;
}
function adapter(h:Harness,rail:'cardano'|'solana'|'sui'):FundingAdapter {
 const fixture=new FixtureFundingAdapter(h.clock);
 return {rail,network:networks[rail],paymentHeaderName:'payment-signature',readiness:vi.fn(()=>fixture.readiness()),
 acceptedAsset:()=>({assetId:assets[rail],decimals:6,payTo:rail==='cardano'?FIXTURE_TREASURY:addresses[rail]+'treasury',supportsUsdNotional:true}),
 paymentRequirements:i=>fixture.paymentRequirements(i),
 verify:async(header,input)=>{const v=await fixture.verify(header,input);return v.ok?{ok:true,funding:{...v.funding,rail,network:networks[rail],assetId:assets[rail],payee:input.payTo,payer:input.expectedPayer??addresses[rail]}}:v;}
 };
}
async function setup(){
 const h=await startHarness({settlementPolicy:{mode:'scaled_testnet',numerator:1,denominator:1000}});active.push(()=>h.close());
 for(const rail of ['cardano','solana','sui'] as const)h.gw.core.deps.fundingAdapters.set(rail,adapter(h,rail));
 h.hotel.price=h.flight.price=h.retail.price; // bounded fixture capacity for all nine, no provider calls.
 return h;
}
const intents={
 retail:retailIntent(),
 hotel:{category:'hotel',destination:{cityName:'Singapore',countryCode:'SG'},checkin:'2026-11-10',checkout:'2026-11-11',occupancies:[{adults:1,childrenAges:[]}],guestNationality:'SG',spendCeiling:{currency:'USD',scale:2,amountMinor:'50000'}},
 flight:{category:'flight',from:'SIN',to:'BKK',departDate:'2026-11-10',adults:1,spendCeiling:{currency:'USD',scale:2,amountMinor:'50000'}}
};
const fulfillment={retail:retailFulfillment,hotel:demoData.customerProfile.hotel,flight:demoData.customerProfile.flight};
async function quote(h:Harness,category:'retail'|'hotel'|'flight'='retail'){
 const search=await h.call('POST','/v1/offers/search',{token:h.alice.token,body:{intent:intents[category]}});expect(search.status).toBe(200);
 const result=await h.call('POST','/v1/quotes',{token:h.alice.token,body:{offerId:search.body.offers[0].offerId,fulfillment:fulfillment[category]}});expect(result.status).toBe(201);return result.body.quote;
}
async function purchase(h:Harness,q:any,source:FundingSource,key='fixture-purchase-key'){
 const selected=q.fundingOptions.find((o:any)=>o.rail===source.rail);
 return h.call('POST','/v1/purchases',{token:h.alice.token,headers:{'idempotency-key':key},body:{quoteId:q.quoteId,approval:{maxTotal:q.payablePrincipal,quoteDigest:q.digest,selectedFundingOptionId:selected.fundingOptionId,selectedSourceId:source.sourceId}}});
}
function payer(h:Harness,load:ConstructorParameters<typeof MultiWalletPayer>[0]['load'],db=h.gw.db){
 return new MultiWalletPayer({db,instanceId:'fixture-candidate',enabled:true,now:()=>h.clock.now(),load});
}
describe('consolidated payer / canonical PostgreSQL / labeled fixture commerce',()=>{

 it('leaves readiness failure unclaimed and resumes only the same still-valid approval',async()=>{
  const h=await setup(),source=await register(h,'solana'),q=await quote(h);let ready=false,pays=0,statuses=0;
  const f=(async(url:unknown,init?:RequestInit)=>{
   if(String(url).startsWith('https://fixture-payer.invalid')){
    if(String(url).endsWith('/status')){statuses++;return ready?Response.json({ok:true,source:null}):Response.json({ok:false},{status:401});}
    pays++;return Response.json({ok:false,error:{code:'payment_rejected',message:'fixture unknown outcome'},retrySafe:false},{status:422});
   }
   return fetch(url as string,init);
  }) as typeof fetch;
  const mcp=createMcpServer({gatewayUrl:h.url,gatewayToken:h.alice.token,consolidatedBridge:{url:'https://fixture-payer.invalid',token:'fixture-token-123456789012345'},fetch:f},{profile:null});
  const client=new Client({name:'fixture',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await mcp.connect(a);await client.connect(b);active.push(()=>client.close());active.push(()=>mcp.close());
  const option=q.fundingOptions.find((o:any)=>o.rail==='solana');
  const args={quoteId:q.quoteId,maxTotal:q.payablePrincipal,quoteDigest:q.digest,selectedFundingOptionId:option.fundingOptionId,selectedSourceId:source.sourceId};
  const first=await client.callTool({name:'buy',arguments:args});const original=(first.structuredContent as any).purchase;
  expect((first.structuredContent as any).payment.attempted).toBe(false);expect(pays).toBe(0);
  expect(await h.gw.db.get('SELECT * FROM payment_handoffs WHERE purchase_id=$1',original.purchaseId)).toBeUndefined();
  ready=true;await client.callTool({name:'buy',arguments:args});expect(pays).toBe(1);expect(statuses).toBe(2);
  await client.callTool({name:'buy',arguments:args});expect(pays).toBe(1);
  expect((await h.gw.db.all('SELECT id FROM purchases WHERE quote_id=$1',q.quoteId))).toHaveLength(1);
 });
 it('FIXTURE: wake runs before any claim and never repeats an ambiguous payment',async()=>{
  const h=await setup(),source=await register(h,'sui'),q=await quote(h);let statuses=0,wakes=0,pays=0,allowWake=false;
  const f=(async(url:unknown,init?:RequestInit)=>{
   if(String(url)===PAYER_WAKE_URL){
    wakes++;expect(new Headers(init?.headers).get('authorization')).toBe('Bearer '+'b'.repeat(64));
    expect(await h.gw.db.all('SELECT * FROM payment_handoffs')).toHaveLength(0);
    expect(await h.gw.db.all('SELECT * FROM funding_attempts')).toHaveLength(0);
    return allowWake?Response.json({ok:true,category:'upstream_2xx',upstreamStatus:200,contentType:'json',renderRouting:'none',durationMs:1,paymentAttempted:false}):Response.json({ok:false},{status:503});
   }
   if(String(url).startsWith(PAYER_WAKE_DESTINATION)){
    if(String(url).endsWith('/status')){statuses++;return allowWake&&wakes>1?Response.json({ok:true,source:null}):new Response('',{status:429,headers:{'x-render-routing':'hibernate-rate-limited'}});}
    pays++;expect(await h.gw.db.all('SELECT * FROM payment_handoffs')).toHaveLength(1);throw Error('fixture lost payment response');
   }
   return fetch(url as string,init);
  }) as typeof fetch;
  const mcp=createMcpServer({gatewayUrl:h.url,gatewayToken:h.alice.token,consolidatedBridge:{url:PAYER_WAKE_DESTINATION,token:'fixture-payment-token-123456789',wake:{url:PAYER_WAKE_URL,token:'b'.repeat(64)}},fetch:f},{profile:null});
  const client=new Client({name:'wake-fixture',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();await mcp.connect(a);await client.connect(b);active.push(async()=>{await client.close();await mcp.close();});
  const option=q.fundingOptions.find((o:any)=>o.rail==='sui');
  const args={quoteId:q.quoteId,maxTotal:q.payablePrincipal,quoteDigest:q.digest,selectedFundingOptionId:option.fundingOptionId,selectedSourceId:source.sourceId};
  const failed=await client.callTool({name:'buy',arguments:args});expect((failed.structuredContent as any).payment).toMatchObject({attempted:false,code:'payer_not_ready'});expect(pays).toBe(0);
  allowWake=true;const resumed=await client.callTool({name:'buy',arguments:args});const purchase=(resumed.structuredContent as any).purchase;expect(pays).toBe(1);expect(wakes).toBe(2);expect(statuses).toBe(3);
  await client.callTool({name:'buy',arguments:args});await client.callTool({name:'get_purchase',arguments:{purchaseId:purchase.purchaseId}});
  expect(pays).toBe(1);expect(wakes).toBe(2);expect((await h.gw.db.all('SELECT id FROM purchases WHERE quote_id=$1',q.quoteId))).toHaveLength(1);
  expect((await h.gw.db.get('SELECT * FROM payment_handoffs WHERE purchase_id=$1',purchase.purchaseId))?.retry_safe).toBe(false);
 });
 it('appends fenced cap amendments while preserving immutable identities and original policy',async()=>{
  const h=await setup(),source=await register(h,'solana'),db=h.gw.db;
  const baseline=(await walletRecord(db,source.sourceId))!;
  const amend=()=>db.run('INSERT INTO wallet_policy_amendments VALUES($1,1,$2,$3,$4,$5)',source.sourceId,baseline.policy_json,JSON.stringify({maxPerPayment:'5100000',maxDaily:'5100000',maxTotal:'5100000',maxCommercial:'510000'}),'owner-cap-alignment-20261011','now');
  await expect(amend()).rejects.toThrow('disable');
  await db.run('UPDATE registered_wallets SET enabled=FALSE WHERE source_id=$1',source.sourceId);
  await expect(amend()).rejects.toThrow('disable');
  await db.run('UPDATE wallet_signing_authority SET enabled=FALSE WHERE source_id=$1',source.sourceId);
  await amend();
  expect(JSON.parse((await walletRecord(db,source.sourceId))!.policy_json).maxDaily).toBe('5100000');
  expect((await db.get<{policy_json:string}>('SELECT policy_json FROM registered_wallets WHERE source_id=$1',source.sourceId))!.policy_json).toBe(baseline.policy_json);
  await expect(amend()).rejects.toThrow();
  await expect(db.run("UPDATE wallet_policy_amendments SET authorization_reference='other-owner' WHERE source_id=$1",source.sourceId)).rejects.toThrow();
  await expect(db.run('DELETE FROM wallet_policy_amendments WHERE source_id=$1',source.sourceId)).rejects.toThrow();
  await expect(db.run('INSERT INTO wallet_policy_amendments VALUES($1,2,$2,$3,$4,$5)',source.sourceId,(await walletRecord(db,source.sourceId))!.policy_json,JSON.stringify({maxPerPayment:'5100000',maxDaily:'5100000',maxTotal:'5100000',maxCommercial:'510000',payee:'replacement'}),'owner-cap-alignment-20261011','now')).rejects.toThrow('identity');
 });

 for(const category of ['retail','hotel','flight'] as const)for(const rail of ['cardano','solana','sui'] as const)it('FIXTURE: '+category+' + '+rail+' through one payer and MCP',async()=>{
  const h=await setup();const sources=await Promise.all((['cardano','solana','sui'] as const).map(r=>register(h,r)));
  const selected=sources.find(s=>s.rail===rail)!;const loaded:string[]=[];
  const dispatch=payer(h,async w=>{loaded.push(w.source_id);return {pay:async id=>{
   const p=(await h.call('GET','/v1/purchases/'+id,{token:h.alice.token})).body.purchase;
   const funded=await h.call('POST','/v1/purchases/'+id+'/fund',{token:h.alice.token,headers:{'payment-signature':'fixture:matrix-'+id+':'+p.fundingRequirement.amount.amountBaseUnits}});
   expect(funded.status).toBe(202);return {transferReference:'matrix-'+id,resumed:false};
  }};});
  const bridge=createBridge({payer:dispatch,serializePayments:false,token:'fixture-bridge-token-1234567890'});await listenLoopback(bridge,0);active.push(()=>new Promise<void>(r=>bridge.close(()=>r())));
  const mcp=createMcpServer({gatewayUrl:h.url,gatewayToken:h.alice.token,consolidatedBridge:{url:'http://127.0.0.1:'+String((bridge.address() as AddressInfo).port),token:'fixture-bridge-token-1234567890'}},{profile:null});
  const client=new Client({name:'fixture',version:'1'}),[ct,st]=InMemoryTransport.createLinkedPair();await mcp.connect(st);await client.connect(ct);active.push(async()=>{await client.close();await mcp.close();});
  const q=await quote(h,category),opt=q.fundingOptions.find((o:any)=>o.rail===rail);
  const args={quoteId:q.quoteId,maxTotal:q.payablePrincipal,quoteDigest:q.digest,selectedFundingOptionId:opt.fundingOptionId,selectedSourceId:selected.sourceId};
  const missing=await client.callTool({name:'buy',arguments:{...args,selectedSourceId:undefined}});expect((missing.structuredContent as any).status).toBe('needs_input');
  const [a,b]=await Promise.all([client.callTool({name:'buy',arguments:args}),client.callTool({name:'buy',arguments:args})]);
  const p=(a.structuredContent as any).purchase;expect(p.purchaseId).toBe((b.structuredContent as any).purchase.purchaseId);expect(p.selectedSource.sourceId).toBe(selected.sourceId);
  expect(loaded).toEqual([selected.sourceId]);await h.gw.worker.tick();
  const polled=await client.callTool({name:'get_purchase',arguments:{purchaseId:p.purchaseId}});const final=(polled.structuredContent as any).purchase;
  expect(final.state).toBe('succeeded');expect(final.receipt.evidenceMode).toBe('local_fixture');expect(final.receipt.selectedSource.sourceId).toBe(selected.sourceId);
  await client.callTool({name:'buy',arguments:args});await client.callTool({name:'get_purchase',arguments:{purchaseId:p.purchaseId}});
  expect(loaded).toHaveLength(1);expect((await h.gw.db.get<{n:number}>('SELECT COUNT(*)::int AS n FROM execution_attempts'))?.n).toBe(1);
 });
 it('requires wallet choice, isolates customers and permits two wallets on one chain without readiness fan-out',async()=>{
  const h=await setup(),a=await register(h,'cardano'),b=await register(h,'cardano',h.alice.customerId,2),foreign=await register(h,'sui',h.bob.customerId,3),q=await quote(h);
  for(const a of h.gw.core.deps.fundingAdapters.values())expect(a.readiness).not.toHaveBeenCalled();
  const listed=await h.call('GET','/v1/funding-sources',{token:h.alice.token});expect(listed.body.sources.map((s:any)=>s.sourceId)).toEqual([a.sourceId,b.sourceId]);
  expect(JSON.stringify(listed.body)).not.toMatch(/signer_ref|ledger_namespace|FIXTURE_CARDANO/);
  expect((await purchase(h,q,foreign)).status).toBe(403);
  const noSource=await h.call('POST','/v1/purchases',{token:h.alice.token,headers:{'idempotency-key':'missing-wallet'},body:{quoteId:q.quoteId,approval:{maxTotal:q.payablePrincipal,quoteDigest:q.digest,selectedFundingOptionId:q.fundingOptions[0].fundingOptionId}}});expect(noSource.status).toBe(400);
  const p=await purchase(h,q,b);expect(p.status).toBe(201);expect((await purchase(h,q,a)).status).toBe(409);
  expect((await h.call('GET','/v1/purchases/'+p.body.purchase.purchaseId,{token:h.bob.token})).status).toBe(404);
  const loader=vi.fn(async (_wallet: import('../../src/core/wallets.js').WalletRecord)=>{throw Error('selected chain offline');});
  await expect(payer(h,loader).pay(p.body.purchase.purchaseId)).rejects.toThrow('selected chain offline');expect(loader.mock.calls).toHaveLength(1);expect(loader.mock.calls[0]![0].source_id).toBe(b.sourceId);
  expect((await h.call('GET','/v1/funding-sources')).status).toBe(401);
 });
 it('default-denies signing and fences stale deployments without loading any engine',async()=>{
  const h=await setup(),source=await register(h,'cardano'),p=await purchase(h,await quote(h),source),load=vi.fn();
  await expect(new MultiWalletPayer({db:h.gw.db,enabled:false,instanceId:'fixture-candidate',load}).pay(p.body.purchase.purchaseId)).rejects.toThrow('disabled');
  await expect(new MultiWalletPayer({db:h.gw.db,enabled:true,instanceId:'stale-instance',now:()=>h.clock.now(),load}).pay(p.body.purchase.purchaseId)).rejects.toThrow('authority');
  expect(load).not.toHaveBeenCalled();
 });
 it('retains legacy identity and signed history; namespaced wallets have independent caps and locks',async()=>{
  const db=await createTestDb();const a=await PgPayerLedger.open(db,{network:'cardano:preprod',address:'addr_test1legacy'});
  await expect(PgPayerLedger.open(db,{network:'cardano:preprod',address:'addr_test1different'})).rejects.toThrow('different wallet');
  await db.run("INSERT INTO wallet_cardano_identity VALUES('wallet-two','cardano:preprod','addr_test1second','now')");
  const b=await PgPayerLedger.openWallet(db,'wallet-two',{network:'cardano:preprod',address:'addr_test1second'});
  const entry={purchaseId:'pur_1234567890',network:'cardano:preprod',asset:FIXTURE_ASSET,amountBaseUnits:'50',payTo:FIXTURE_TREASURY,status:'signed' as const,header:'protected-fixture-header',transferReference:null,createdAt:'now',updatedAt:'now'};
  await a.exclusive(()=>a.upsert(entry));expect(await a.committed(entry.network,entry.asset)).toBe(50n);expect(await b.committed(entry.network,entry.asset)).toBe(0n);
  await expect(db.run('DELETE FROM hosted_payer_ledger')).rejects.toThrow('cannot be deleted');
  await expect(db.run("UPDATE hosted_payer_identity SET public_address='replacement'")).rejects.toThrow('permanent');
 });
 it('lets another selected wallet progress while one chain is stalled',async()=>{
  const h=await setup(),cardano=await register(h,'cardano'),solana=await register(h,'solana');
  const a=await purchase(h,await quote(h),cardano,'stalled-cardano'),b=await purchase(h,await quote(h),solana,'independent-solana');
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r);
  const dispatch=payer(h,async wallet=>({pay:async()=>{if(wallet.rail==='cardano'){enter();await gate;}return {transferReference:'fixture-reference',resumed:false};}}));
  const bridge=createBridge({payer:dispatch,serializePayments:false,token:'fixture-bridge-token-1234567890'});await listenLoopback(bridge,0);active.push(()=>new Promise<void>(r=>bridge.close(()=>r())));
  const url='http://127.0.0.1:'+String((bridge.address() as AddressInfo).port)+'/pay';
  const call=(id:string)=>fetch(url,{method:'POST',headers:{Authorization:'Bearer fixture-bridge-token-1234567890','content-type':'application/json'},body:JSON.stringify({purchaseId:id})});
  const first=call(a.body.purchase.purchaseId);await entered;
  try {const second=await call(b.body.purchase.purchaseId);expect(second.status).toBe(200);}finally{release();await first;}
 });

});
