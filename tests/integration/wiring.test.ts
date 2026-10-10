import { createTestDb } from '../support/database.js';
import {describe,it,expect} from 'vitest';
import {createHmac} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer as createNetServer} from 'node:net';
import type {AddressInfo} from 'node:net';
import {realParts} from '../../src/wiring.js';
import {buildGateway} from '../../src/composition.js';
import {createHttpApp} from '../../src/channels/http/app.js';
import {startHarness,createFundablePurchase,TEST_ENV} from '../support/harness.js';

const secret='fixture-webhook-secret',shop='test-shop.myshopify.com',nonce='596fef08-64d7-4e3a-8dfd-2930d6c5b8e7';
describe('production composition boundaries (offline)',()=>{
  it('registers real adapters, reports missing credentials, and keeps inspect public while evidence requires auth',async()=>{
    const db=await createTestDb(),parts=realParts({},()=>undefined),gw=await buildGateway(parts,{env:TEST_ENV,db});
    const server=gw.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
    const url='http://127.0.0.1:'+(server.address() as AddressInfo).port;
    try {
      expect(parts.executors.map(e=>e.route).sort()).toEqual(['atlas','nuitee','shopify']);
      expect(parts.fundingAdapters.map(f=>f.rail)).toEqual(['cardano','solana','sui','masumi']);
      for(const c of [...parts.executors,...parts.fundingAdapters,...parts.bankAdapters]) expect((await c.readiness()).status).toBe('MISSING_CONFIG');
      expect((await fetch(url+'/inspect')).status).toBe(200);
      // Hosted MCP is opt-in: without MCP_HOSTED_ENABLED neither /mcp nor any OAuth endpoint exists.
      for(const path of ['/mcp','/authorize','/token','/register','/.well-known/oauth-authorization-server','/.well-known/oauth-protected-resource']) expect((await fetch(url+path,{method:path==='/mcp'?'POST':'GET',redirect:'manual'})).status,path).toBe(404);
      expect((await fetch(url+'/v1/evidence/purchases')).status).toBe(401);
      const webhook=await fetch(url+'/v1/webhooks/shopify',{method:'POST'});
      expect(webhook.status).toBe(503);expect((await webhook.json() as any).error).toMatchObject({code:'route_unavailable',requestId:expect.any(String)});
      expect((await db.get<{n:number}>('SELECT COUNT(*)::int n FROM journal_entries'))!.n).toBe(0); // Readiness and public inspection cannot create financial facts.
    } finally {await new Promise<void>(r=>server.close(()=>r()));await db.close();}
  });

  it('preserves exact HMAC bytes and durably deduplicates readback hints without trusting claimed payment',async()=>{
    const h=await startHarness();const routers=realParts({SHOPIFY_STORE_DOMAIN:shop,SHOPIFY_CLIENT_SECRET:secret},()=>undefined).buildRouters!(h.gw.core);
    const server=createHttpApp({core:h.gw.core,extraRouters:routers}).listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
    const url='http://127.0.0.1:'+(server.address() as AddressInfo).port;
    try {
      const a=await createFundablePurchase(h),id=a.purchase.purchaseId;
      await h.gw.db.run("UPDATE quotes SET execution_ref_json = jsonb_set(execution_ref_json::jsonb,'{nonce}',to_jsonb($1::text))::text WHERE id = $2",nonce,a.quote.quoteId);
      h.retail.behavior='unknown';await h.call('POST','/v1/purchases/'+id+'/fund',{token:h.alice.token,headers:{'payment-signature':'fixture:webhook-funding:'+a.required}});await h.gw.worker.tick();
      const payload=JSON.stringify({admin_graphql_api_id:'gid://shopify/Order/123',financial_status:'paid',email:'private@example.com',note_attributes:[{name:'t2o_quote',value:nonce}]},null,2)+'\n';
      const headers={'content-type':'application/json','x-shopify-shop-domain':shop,'x-shopify-topic':'orders/paid','x-shopify-webhook-id':'delivery-1','x-shopify-hmac-sha256':createHmac('sha256',secret).update(payload).digest('base64')};
      const send=(body=payload)=>fetch(url+'/v1/webhooks/shopify',{method:'POST',headers,body});
      const bad=await send(payload+' ');expect(bad.status).toBe(401);expect((await bad.json() as any).error.code).toBe('unauthenticated');
      expect((await send()).status).toBe(202);expect((await send()).status).toBe(202);
      expect((await h.gw.db.get<{n:number}>("SELECT COUNT(*)::int n FROM jobs WHERE dedupe_key='shopify_webhook:delivery-1'"))!.n).toBe(1);
      expect((await h.gw.db.get<{n:number}>("SELECT COUNT(*)::int n FROM purchase_events WHERE type='provider.webhook_received'"))!.n).toBe(1);
      expect((await h.gw.db.get<{state:string}>('SELECT state FROM purchases WHERE id = $1',id))!.state).toBe('unresolved');
      expect((await h.gw.db.get<{n:number}>("SELECT COUNT(*)::int n FROM journal_entries WHERE kind='prepayment_applied'"))!.n).toBe(0);
      let reads=0;h.retail.retrieve=async ctx=>{reads++;expect(ctx.checkpoints.webhook_order?.providerReference).toBe('gid://shopify/Order/123');return {kind:'succeeded',providerReference:'gid://shopify/Order/123',commerceStatus:'confirmed',merchantPaymentStatus:'simulated_paid',chargedAmount:ctx.quote.merchantTotal,evidence:[{source:'fixture:shopify',environment:'fixture',evidenceMode:'local_fixture',reference:'gid://shopify/Order/123',observedAt:h.clock.now().toISOString(),details:{}}]};};
      await h.gw.worker.tick();expect(reads).toBe(1);
      expect((await h.gw.db.get<{state:string}>('SELECT state FROM purchases WHERE id = $1',id))!.state).toBe('succeeded');expect((await send()).status).toBe(202);expect(reads).toBe(1);
      const stored=JSON.stringify((await h.gw.db.all('SELECT data_json FROM purchase_events')));expect(stored).not.toContain('private@example.com');
    } finally {await new Promise<void>(r=>server.close(()=>r()));await h.close();await h.gw.db.close();}
  });

  it('mounts the hosted MCP and OAuth server on the single gateway app only when explicitly enabled',async()=>{
    const root=mkdtempSync(join(tmpdir(),'wiring-hosted-')),pass=join(root,'pass');writeFileSync(pass,'owner-passcode-0123456789');
    const db=await createTestDb(),port=await new Promise<number>(r=>{const n=createNetServer();n.listen(0,'127.0.0.1',()=>{const p=(n.address() as AddressInfo).port;n.close(()=>r(p));});});
    const base='http://127.0.0.1:'+port;
    const env={MCP_HOSTED_ENABLED:'true',MCP_PUBLIC_URL:base,PUBLIC_BASE_URL:base,PORT:String(port),MCP_OAUTH_OWNER_PASSCODE_FILE:pass} as NodeJS.ProcessEnv;
    const gw=await buildGateway(realParts(env,()=>undefined),{env:{...TEST_ENV,PUBLIC_BASE_URL:base},db});
    const server=gw.app.listen(port,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
    try {
      const res=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
      expect(res.status).toBe(401);expect(res.headers.get('www-authenticate')).toContain('resource_metadata="'+base+'/.well-known/oauth-protected-resource/mcp"');
      expect(((await (await fetch(base+'/.well-known/oauth-authorization-server')).json()) as any).code_challenge_methods_supported).toEqual(['S256']);
      expect((await fetch(base+'/health')).status).toBe(200);
      expect((await fetch(base+'/inspect')).status).toBe(200); // existing public routes are untouched
      expect((await fetch(base+'/v1/offers/search',{method:'POST'})).status).toBe(401); // the gateway API is unchanged
    } finally {await new Promise<void>(r=>server.close(()=>r()));await db.close();rmSync(root,{recursive:true,force:true});}
  });
});
