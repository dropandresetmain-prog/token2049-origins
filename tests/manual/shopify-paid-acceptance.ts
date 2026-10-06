/** Explicit one-order sandbox acceptance with local fixture funding. Not deployed or auto-run.
 * node --env-file=.env --import tsx tests/manual/shopify-paid-acceptance.ts <artifact-dir> --allow-one-bogus-order
 * Keeps its isolated loopback PostgreSQL schema for read-only reconciliation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Pool } from 'pg';
import type { Page } from 'playwright-core';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildGateway, type Gateway } from '../../src/composition.js';
import { Db } from '../../src/infrastructure/db.js';
import { createClient } from '../../src/infrastructure/auth.js';
import { systemClock } from '../../src/infrastructure/clock.js';
import { demoData } from '../../src/demo/config.js';
import { ShopifyExecutor, hasPaidTestEvidence } from '../../src/execution/shopify/index.js';
import { AdminClient } from '../../src/execution/shopify/admin.js';
import { loadShopifyConfig } from '../../src/execution/shopify/config.js';
import { FixtureFundingAdapter } from '../support/fixtures.js';
import { createEvidenceRouter } from '../../src/evidence/router.js';
import { createProofPageRouter } from '../../src/evidence/proof-page.js';
import { trialBalance } from '../../src/core/journal.js';
import { ProviderError } from '../../src/core/errors.js';
import { SearchOffersResponse, CreateQuoteResponse, PurchaseResponse } from '../../src/contracts/api.js';
import { PurchaseProof } from '../../src/evidence/proof.js';
import type { QuoteView } from '../../src/contracts/commerce.js';
import type { StorefrontCart } from '../../src/execution/shopify/storefront.js';
import { attachPaymentDiagnostics, paymentFieldDiagnostics } from './shopify-diagnostics.js';

const arg=process.argv[2];
if(!arg || !process.argv.includes('--allow-one-bogus-order'))throw new Error('explicit_one_order_authorization_required');
const outDir=path.resolve(arg),artifactRoot=path.resolve('artifacts/e2e');
if(!outDir.startsWith(artifactRoot+path.sep))throw new Error('artifact_directory_required');
if(process.env.APP_ENV!=='sandbox' || Object.keys(process.env).some(k=>/^(CARDANO_|PAYER_|BLOCKFROST_|SOLANA_)/.test(k)&&process.env[k]))throw new Error('funding_or_environment_guard');
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl)throw new Error('loopback_database_required');
if(!['127.0.0.1','localhost'].includes(new URL(databaseUrl).hostname))throw new Error('loopback_database_required');
const env:NodeJS.ProcessEnv={APP_ENV:'sandbox'};
for(const k of ['SHOPIFY_STORE_DOMAIN','SHOPIFY_API_VERSION','SHOPIFY_STOREFRONT_TOKEN','SHOPIFY_CLIENT_ID','SHOPIFY_CLIENT_SECRET','SHOPIFY_STORE_PASSWORD','SHOPIFY_DEV_STORE_CONFIRMED','SHOPIFY_BOGUS_GATEWAY_ENABLED','SHOPIFY_BROWSER_EXECUTABLE','SHOPIFY_HEADLESS'])if(process.env[k])env[k]=process.env[k];
const configReport=loadShopifyConfig(env),cfg=configReport.config;
if(cfg.storeDomain!=='token2049-test-store.myshopify.com' || !configReport.buyerReady || !configReport.adminReady || configReport.invalid.length || !cfg.devStoreConfirmed || !cfg.bogusGatewayEnabled || !cfg.browserExecutable)throw new Error('shopify_sandbox_guard');
fs.mkdirSync(outDir,{recursive:true});
const runId=randomUUID(),schema='shopify_accept_'+runId.replaceAll('-','');
fs.writeFileSync(path.join(outDir,'01-manifest.json'),JSON.stringify({runId,schema,startedAt:new Date().toISOString(),fundingMode:'local_fixture',shopifyMode:'real_bogus_sandbox',storeHost:cfg.storeDomain,privateDelegateUsed:false,cardanoTransaction:false,oneOrderAuthorized:true},null,2)+'\n',{flag:'wx'});
const emit=(kind:string,data:Record<string,unknown>={})=>{
 const entry={at:new Date().toISOString(),kind,...data};
 const fd=fs.openSync(path.join(outDir,'02-events.jsonl'),'a');
 try{fs.writeSync(fd,JSON.stringify(entry)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 console.log(JSON.stringify(entry));
};
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)??'null').digest('hex');
const fields=(c:StorefrontCart)=>({buyer:c.buyerIdentity,cost:c.cost,quantity:c.totalQuantity,lines:c.lines.nodes,attributes:c.attributes,delivery:c.deliveryGroups.nodes.map(g=>({address:g.deliveryAddress,selected:g.selectedDeliveryOption})),selectedAddresses:c.delivery?.addresses});
let phase='preflight',lastCart:StorefrontCart|null=null,baseline:Record<string,unknown>|null=null;
const requestCounts:Record<string,number>={};
const observedFetch:typeof fetch=async(url,init)=>{
 const response=await fetch(url,init);
 if(String(url)==='https://'+cfg.storeDomain+'/api/'+cfg.apiVersion+'/graphql.json'){
  const query=typeof init?.body==='string'?JSON.parse(init.body).query as string:'';
  const operation=/mutation CartCreate\b/.test(query)?'cartCreate':/mutation CartSelectDelivery\b/.test(query)?'selectDelivery':/query CartRead\b/.test(query)?'cartRead':'search';
  requestCounts[operation]=(requestCounts[operation]??0)+1;
  const raw=await response.clone().json().catch(()=>null) as {data?:{cartCreate?:{cart?:StorefrontCart};cartSelectedDeliveryOptionsUpdate?:{cart?:StorefrontCart};cart?:StorefrontCart};errors?:Array<{extensions?:{code?:string}}>}|null;
  const c=raw?.data?.cartCreate?.cart??raw?.data?.cartSelectedDeliveryOptionsUpdate?.cart??raw?.data?.cart;
  if(c)lastCart=c as StorefrontCart;
  const changed=baseline&&c?Object.entries(fields(c)).filter(([key,value])=>digest(value)!==digest(baseline![key])).map(([key])=>key):[];
  emit('storefront',{phase,operation,status:response.status,errorCodes:(raw?.errors??[]).map((e:{extensions?:{code?:string}})=>['THROTTLED','ACCESS_DENIED'].includes(e.extensions?.code??'')?e.extensions!.code:'UNKNOWN'),changedFrozenFields:changed});
 }
 return response;
};
let server:Server|undefined,db:Db|undefined,gw:Gateway|undefined,purchaseId:string|undefined,quote:QuoteView|undefined;
let executionInvoked=false,payCheckpointSeen=false;
let checkoutPage:Page|undefined;
const blockedRequests:Record<string,number>={},browserResponses:Record<string,number>={};
const captureFailure=async(step:string)=>{
 if(!checkoutPage)return;
 emit('payment_field_diagnostics',{step,...await paymentFieldDiagnostics(checkoutPage)});
 const body=await checkoutPage.locator('body').innerText({timeout:1500}).catch(()=>'');
 const invalidInputs=await checkoutPage.locator('[aria-invalid="true"]').evaluateAll(inputs=>inputs.map(input=>({tag:input.tagName,name:input.getAttribute('name'),autocomplete:input.getAttribute('autocomplete'),describedBy:input.getAttribute('aria-describedby')}))).catch(()=>[]);
 const validationMessages=body.split('\n').map(line=>line.trim()).filter(line=>/^(?:Enter |Provide |Select |Your (?:card|payment) |This field |There was |Please )/.test(line)).map(line=>line.replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+/g,'[redacted]').slice(0,180)).slice(0,20);
 emit('checkout_validation',{step,invalidInputs,validationMessages});
 const url=new URL(checkoutPage.url());
 const indicators={invalidCard:/enter a valid card number/i.test(body),invalidExpiry:/enter a valid (?:expiration|expiry) date/i.test(body),invalidSecurityCode:/enter a valid security code/i.test(body),paymentFailure:/your payment (?:could not|couldn't)|card (?:was |is )?declined|unable to process (?:your |the )?payment/i.test(body),challenge:/verify (?:that )?you are (?:a )?human|one-time (?:code|passcode)/i.test(body)};
 emit('checkout_failure_snapshot',{phase,step,host:url.hostname,routeClass:/thank[-_]?you/.test(url.pathname)?'thank_you':/\/orders\//.test(url.pathname)?'order':/^\/checkouts\//.test(url.pathname)?'checkout':'other',confirmationUrlPattern:/thank[-_]?you|\/orders\/[a-f0-9]{8,}/i.test(checkoutPage.url()),indicators,invalidFields:await checkoutPage.locator('[aria-invalid="true"]').count().catch(()=>-1),visibleAlertElements:await checkoutPage.getByRole('alert').count().catch(()=>-1),frameHosts:[...new Set(checkoutPage.frames().map(f=>{try{return new URL(f.url()).hostname||'about';}catch{return 'invalid';}}))],blockedRequests,browserResponses});
};
try{
 const adminPool=new Pool({connectionString:databaseUrl,max:1});
 try{await adminPool.query('CREATE SCHEMA "'+schema+'"');}finally{await adminPool.end();}
 db=new Db(databaseUrl,schema);
 const funding=new FixtureFundingAdapter(systemClock);
 const shopify=new ShopifyExecutor(env,{fetchImpl:observedFetch,sink:line=>{
  const step=/step=([a-z0-9_.-]+)/.exec(line)?.[1];
  if(step){if(step==='pay_click')payCheckpointSeen=true;emit('browser_step',{phase,step});}
 },checkoutObserver:{attach:page=>{checkoutPage=page;attachPaymentDiagnostics(page,emit);page.on('response',r=>{const key=new URL(r.url()).hostname+'|'+r.status();browserResponses[key]=(browserResponses[key]??0)+1;});},blocked:e=>{const key=e.hostname+'|'+e.resourceType+'|'+e.frame;blockedRequests[key]=(blockedRequests[key]??0)+1;},stepFailed:async step=>{emit('browser_step_failed',{phase,step});await captureFailure(step);},beforePay:async()=>{emit('payment_field_diagnostics',{step:'before_pay',...await paymentFieldDiagnostics(checkoutPage!)});emit('irreversible_boundary',{action:'one_bogus_pay_submission',funding:'local_fixture'});}}});
 gw=await buildGateway({executors:[shopify],fundingAdapters:[funding],bankAdapters:[],buildRouters:core=>[
  {path:'/v1/evidence',router:createEvidenceRouter({db:core.deps.db,clock:systemClock,bankAdapters:[]}),auth:true},
  {path:'/proof',router:createProofPageRouter(),auth:false},
 ]},{db,clock:systemClock,env:{APP_ENV:'test',DATABASE_URL:databaseUrl,PUBLIC_BASE_URL:'http://127.0.0.1:8787',SERVICE_FEE_BPS:'0'},log:l=>{if(l.event==='worker.error')emit('worker_error',{stage:l.stage,errorCode:l.errorCode});}});
 gw.core.deps.config.settlementPolicy=demoData.settlementPolicy;
 const client=await createClient(db,{displayName:'Shopify acceptance fixture',channel:'test',label:'one-bogus-order'},systemClock.now().toISOString());
 server=await new Promise<Server>(resolve=>{const s=gw!.app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
 gw.core.deps.config.publicBaseUrl=base;
 const call=async(method:string,p:string,body?:unknown,extra:Record<string,string>={})=>{
  const r=await fetch(base+p,{method,redirect:'error',headers:{authorization:'Bearer '+client.token,...(body?{'content-type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json() as {error?:{code?:string}};
  if(!r.ok)throw new Error('gateway_'+r.status+'_'+String(data?.error?.code??'unknown'));
  return data;
 };
 const admin=new AdminClient(cfg,fetch,systemClock);
 const startedAt=new Date().toISOString();
 phase='search';
 const search=SearchOffersResponse.parse(await call('POST','/v1/offers/search',{intent:{category:'retail',productRef:demoData.retail.productRef,quantity:demoData.retail.quantity,shipToCountry:demoData.retail.shipToCountry,spendCeiling:{currency:'USD',amountMinor:demoData.retail.maxCommercialMinor,scale:2}}}));
 if(search.offers.length!==1)throw new Error('canonical_offer_count');
 phase='quote';
 quote=CreateQuoteResponse.parse(await call('POST','/v1/quotes',{offerId:search.offers[0]!.offerId,fulfillment:{category:'retail',...demoData.buyer}})).quote;
 if(!lastCart)throw new Error('missing_cart_observation');
 baseline=fields(lastCart);
 const option=quote.fundingOptions[0];
 if(quote.fundingOptions.length!==1||!option?.fundingOptionId)throw new Error('fixture_funding_option');
 emit('exact_quote',{quoteId:quote.quoteId,total:quote.merchantTotal,breakdown:quote.breakdown.map(b=>({kind:b.kind,amount:b.amount})),expiry:quote.expiresAt,funding:'local_fixture'});
 phase='purchase';
 const creation=PurchaseResponse.parse(await call('POST','/v1/purchases',{quoteId:quote.quoteId,approval:{quoteDigest:quote.digest,maxTotal:quote.payablePrincipal,selectedFundingOptionId:option.fundingOptionId}},{'idempotency-key':'shopify-accept-'+runId}));
 purchaseId=creation.purchase.purchaseId;
 emit('purchase',{purchaseId,state:creation.purchase.state,schema});
 const blocked=(await db.get<{n:number}>('SELECT COUNT(*)::int AS n FROM execution_attempts'))!.n;
 if(blocked!==0)throw new Error('execution_before_funding');
 phase='fixture_funding';
 await call('POST','/v1/purchases/'+purchaseId+'/fund',undefined,{'payment-signature':'fixture:shopify-simulated-'+runId+':'+option.amount.amountBaseUnits});
 emit('simulated_funding',{purchaseId,amountBaseUnits:option.amount.amountBaseUnits,evidenceMode:'local_fixture',cardanoTransaction:false});
 phase='execution';executionInvoked=true;
 await gw.worker.tick(); // One explicit tick. The automatic worker timer is never started.
 phase='readback';
 const purchase=PurchaseResponse.parse(await call('GET','/v1/purchases/'+purchaseId)).purchase;
 const checkpoint=await db.get<{status:string;checkpoints_json:string}>('SELECT status,checkpoints_json FROM execution_attempts WHERE purchase_id=$1',purchaseId!);
 const saved=checkpoint?JSON.parse(checkpoint.checkpoints_json):{};
 emit('execution_result',{purchaseId,state:purchase.state,commerceStatus:purchase.commerceStatus,merchantPaymentStatus:purchase.merchantPaymentStatus,providerReference:purchase.providerReference,payCheckpointPersisted:Boolean(saved.pay_click),checkpointNames:Object.keys(saved),attemptStatus:checkpoint?.status,requestCounts});
 fs.writeFileSync(path.join(outDir,'03-execution-result.json'),JSON.stringify({purchaseId,quoteId:quote.quoteId,schema,state:purchase.state,providerReference:purchase.providerReference,checkpointNames:Object.keys(saved),fundingMode:'local_fixture'},null,2)+'\n');
 if(purchase.state!=='succeeded')throw new Error('STOP_'+purchase.state+'_no_execution_retry');
 const orders=await admin.searchOrders({createdAfter:startedAt});
 const expected=(await db.get<{execution_ref_json:string}>('SELECT execution_ref_json FROM quotes WHERE id=$1',quote.quoteId))!;
 const nonce=JSON.parse(expected.execution_ref_json).nonce;
 const bound=orders.filter(o=>o.customAttributes.some(a=>a.key==='t2o_quote'&&a.value===nonce));
 if(bound.length!==1||bound[0]!.id!==purchase.providerReference||!hasPaidTestEvidence(bound[0]!,quote.merchantTotal))throw new Error('STOP_independent_order_evidence_mismatch');
 const order=bound[0]!;
 emit('independent_admin',{orderId:order.id,orderName:order.name,test:order.test,financialStatus:order.displayFinancialStatus,total:order.totalPriceSet.presentmentMoney,nonceMatches:true,ordersSinceStart:orders.length,matchingOrders:bound.length,transactions:order.transactions.map(t=>({kind:t.kind,status:t.status,test:t.test,gateway:t.gateway,amount:t.amountSet.presentmentMoney}))});
 const counts=await db.get<{purchases:number;funding:number;attempts:number;executeJobs:number;receipts:number}>(
  "SELECT (SELECT COUNT(*)::int FROM purchases) AS purchases,(SELECT COUNT(*)::int FROM funding_evidence WHERE application='applied') AS funding,(SELECT COUNT(*)::int FROM execution_attempts) AS attempts,(SELECT COUNT(*)::int FROM jobs WHERE kind='execute_purchase') AS \"executeJobs\",(SELECT COUNT(*)::int FROM purchases WHERE receipt_json IS NOT NULL) AS receipts");
 const reservation=await db.get<{status:string}>('SELECT status FROM reservations WHERE purchase_id=$1',purchaseId!);
 const balance=[...(await trialBalance(db)).entries()].map(([asset,net])=>({asset,net:net.toString()}));
 const proof=PurchaseProof.parse((await call('GET','/v1/evidence/purchases/'+purchaseId+'/proof') as unknown as {proof:unknown}).proof);
 if(counts?.purchases!==1||counts.funding!==1||counts.attempts!==1||counts.executeJobs!==1||counts.receipts!==1||reservation?.status!=='consumed'||balance.some(b=>b.net!=='0')||funding.verifyCalls!==1||!saved.pay_click||proof.funding.transfers.length!==1||proof.funding.transfers[0]!.evidenceMode!=='local_fixture'||proof.merchant.providerReference!==order.id||!proof.receipt)throw new Error('STOP_db_proof_invariant_mismatch');
 const {chromium}=await import('playwright-core');
 const browser=await chromium.launch({executablePath:cfg.browserExecutable!,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 let proofUi:Record<string,boolean>;
 try{
  const page=await browser.newPage();
  await page.goto(base+'/proof');
  await page.locator('#token').fill(client.token);
  await page.getByRole('button',{name:'Load purchases',exact:true}).click();
  await page.locator('#purchases button').first().click();
  await page.locator('#proof').waitFor({state:'visible'});
  const text=await page.locator('#proof').innerText(); // Never log/store full page text.
  proofUi={orderReference:text.includes(order.id),receiptId:text.includes(proof.receipt.receiptId),fixtureLabel:text.includes('local_fixture'),paymentProof:text.includes('Payment proof'),merchantResult:text.includes('Merchant result')};
  if(Object.values(proofUi).some(v=>!v))throw new Error('STOP_proof_ui_mismatch');
 }finally{await browser.close();}
 const evidence={verdict:'SHOPIFY_PASS_WITH_SIMULATED_FUNDING',overallE2E:'PARTIAL',runId,schema,quoteId:quote.quoteId,purchaseId,total:quote.merchantTotal,providerReference:order.id,orderName:order.name,receiptId:proof.receipt.receiptId,counts,reservation:reservation.status,balance,fundingVerifyCalls:funding.verifyCalls,cardanoTransaction:false,fundingEvidenceMode:'local_fixture',merchantEvidenceMode:proof.merchant.evidenceMode,payCheckpointPersisted:true,proofUi,proof:{commercialAmount:proof.commercialAmount,progress:proof.progress,timeline:proof.timeline.map((s:{step:string;status:string})=>({step:s.step,status:s.status})),merchant:proof.merchant,receiptId:proof.receipt.receiptId,fundingReference:proof.funding.transfers[0]!.reference},requestCounts};
 fs.writeFileSync(path.join(outDir,'04-verification.json'),JSON.stringify(evidence,null,2)+'\n');
 emit('verified',evidence);
}catch(error){
 const code=error instanceof ProviderError?error.providerCode:error instanceof Error&&/^(?:gateway_|STOP_|canonical_|fixture_|missing_|execution_)[a-zA-Z0-9_]+$/.test(error.message)?error.message:error instanceof Error?error.name:'unknown';
 emit('stopped',{phase,code,purchaseId,executionInvoked,payCheckpointSeen,noRetry:true,schema});
 process.exitCode=1;
}finally{
 if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
 if(db)await db.close();
}
