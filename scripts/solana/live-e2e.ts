import { loadEnvFile } from 'node:process';
import { resolve,join,dirname } from 'node:path';
import { existsSync,writeFileSync } from 'node:fs';
import { createHash,randomUUID,randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import type { AddressInfo } from 'node:net';
import { buildGateway } from '../../src/composition.js';
import { Db } from '../../src/infrastructure/db.js';
import { systemClock } from '../../src/infrastructure/clock.js';
import { createClient } from '../../src/infrastructure/auth.js';
import { FixtureExecutor } from '../../tests/support/fixtures.js';
import { createSolanaFundingAdapter } from '../../src/funding/solana/adapter.js';
import { SolanaRpc,type ChainTransaction } from '../../src/funding/solana/rpc.js';
import { decodeTransaction } from '../../src/funding/solana/wire.js';
import { loadSolanaPayerConfig } from '../../clients/solana/config.js';
import { SolanaLedger,scanHistory } from '../../clients/solana/ledger.js';
import { startSolanaFacilitator } from '../../clients/solana/facilitator.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run=promisify(execFile), root=resolve('.');
loadEnvFile(process.argv[2]??'C:/Dev/token2049-origins/.env.local');
const ledgerDirectory=join(root,'data','solana'),tokenFile=join(ledgerDirectory,'gateway-token.txt');
SolanaLedger.protectDirectory(ledgerDirectory);
const sponsorTokenFile=join(ledgerDirectory,'sponsor-token.txt');if(!existsSync(sponsorTokenFile))writeFileSync(sponsorTokenFile,randomBytes(32).toString('hex'),{mode:0o600});
// This E2E explicitly bounds valueless Devnet funds below the provisioning budget. It changes no shared env.
Object.assign(process.env,{SOLANA_FEE_PAYER_ADDRESS:process.env.SOLANA_TREASURY_ADDRESS,SOLANA_FACILITATOR_URL:'http://127.0.0.1:18992',SOLANA_MAX_PAYMENT_BASE_UNITS:'10000',
  SOLANA_FACILITATOR_TOKEN_FILE:sponsorTokenFile,SOLANA_LEDGER_DIRECTORY:ledgerDirectory,SOLANA_PAYER_MAX_PURCHASE_BASE_UNITS:'10000',SOLANA_PAYER_MAX_TOTAL_BASE_UNITS:'10000',SOLANA_PAYER_MAX_COMMERCIAL_USD_MINOR:'1000',
  SOLANA_SPONSOR_MAX_TOTAL_FEE_LAMPORTS:'100000',SOLANA_SPONSOR_KEY_FILE:process.env.SOLANA_SPONSOR_KEY_FILE??join(dirname(process.env.SOLANA_PAYER_KEY_FILE!),'treasury.json'),SOLANA_GATEWAY_URL:'http://127.0.0.1:18993',SOLANA_GATEWAY_TOKEN_FILE:tokenFile});
let cfg=loadSolanaPayerConfig(process.env),rpc=new SolanaRpc(cfg.rpcUrl);
for(const [path,owner] of [[cfg.payerLedger,cfg.payer],[cfg.sponsorLedger,cfg.sponsor]]) {
  const ledger=new SolanaLedger(path!,owner!);
  if(!existsSync(path!))ledger.initialize(await scanHistory(rpc,owner!));
  ledger.read();
}
const sponsor=await startSolanaFacilitator(cfg,18992);
const databaseUrl=process.env.DATABASE_URL??'postgresql://origins:origins_local_only@127.0.0.1:55432/origins';
const schema='solana_e2e_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:databaseUrl,max:1});
await admin.query(`CREATE SCHEMA "${schema}"`);
const db=new Db(databaseUrl,schema),hotel=new FixtureExecutor('nuitee','hotel',systemClock,100n),adapter=createSolanaFundingAdapter(process.env);
const gateway=await buildGateway({executors:[hotel],fundingAdapters:[adapter],bankAdapters:[]},{db,env:{...process.env,APP_ENV:'test',DATABASE_URL:databaseUrl,PUBLIC_BASE_URL:cfg.gatewayUrl,SERVICE_FEE_BPS:'500',QUOTE_TTL_SECONDS:'600'}});
gateway.core.deps.config.settlementPolicy={mode:'scaled_testnet',numerator:1,denominator:1000};
const server=await new Promise<import('node:http').Server>(resolve=>{const s=gateway.app.listen(18993,'127.0.0.1',()=>resolve(s));});
const client=await createClient(db,{displayName:'Solana E2E fixture buyer',channel:'test',label:'solana-live'},new Date().toISOString());
writeFileSync(tokenFile,client.token,{mode:0o600});
const call=async(method:string,path:string,body?:unknown,headers:Record<string,string>={})=>{const res=await fetch(cfg.gatewayUrl+path,{method,headers:{authorization:'Bearer '+client.token,...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json() as any};};
const evidence:any={timestamp:new Date().toISOString(),outcome:'RUNNING',real:['gateway HTTP','PostgreSQL/core/journal','official x402 Solana payer and sponsor','official Devnet RPC'],simulated:['hotel search/quote/booking/payment'],schema};
try {
  const ready=await adapter.readiness();if(ready.status!=='EXTERNAL_CHECK_PASSED')throw new Error('Solana readiness '+ready.status);
  const search=await call('POST','/v1/offers/search',{intent:{category:'hotel',destination:{cityName:'Singapore',countryCode:'SG'},checkin:'2026-10-20',checkout:'2026-10-21',occupancies:[{adults:1,childrenAges:[]}],guestNationality:'SG',spendCeiling:{currency:'USD',amountMinor:'105',scale:2}}});
  if(search.status!==200)throw new Error('hotel fixture search failed');
  const fulfillment={category:'hotel',holder:{firstName:'Fixture',lastName:'Buyer',email:'fixture@example.com',phone:'+6500000000'},guests:[{occupancyNumber:1,firstName:'Fixture',lastName:'Buyer',email:'fixture@example.com'}]};
  const quoted=await call('POST','/v1/quotes',{offerId:search.body.offers[0].offerId,fulfillment});
  if(quoted.status!==201)throw new Error('hotel fixture quote failed '+JSON.stringify(quoted.body));
  const quote=quoted.body.quote,option=quote.fundingOptions[0];if(option.rail!=='solana'||option.amount.amountBaseUnits!=='1050')throw new Error('exact scaled commercial and fee quote mismatch');
  const purchased=await call('POST','/v1/purchases',{quoteId:quote.quoteId,approval:{maxTotal:quote.payablePrincipal,quoteDigest:quote.digest,selectedFundingOptionId:option.fundingOptionId}},{'idempotency-key':'solana-live-'+randomUUID()});
  if(purchased.status!==201)throw new Error('purchase creation failed');
  const id=purchased.body.purchase.purchaseId;
  // Payer runs in a separate process holding its key. Sponsor owns only fee-signing authority.
  const paid=await run(process.execPath,['--import','tsx',join(root,'clients/solana/pay.ts'),id],{env:process.env,timeout:100000,maxBuffer:5000});
  const result=JSON.parse(paid.stdout.trim());evidence.payer={status:result.status,signature:result.signature};
  for(let n=0;n<24;n++){await gateway.core.recoverPendingFunding(id);await gateway.worker.tick();const p=await call('GET','/v1/purchases/'+id);if(p.body.purchase.state==='succeeded'){evidence.purchase=p.body.purchase;break;}await new Promise(r=>setTimeout(r,1500));}
  if(!evidence.purchase)throw new Error('purchase did not reach fixture succeeded state');
  const chain=await rpc.call<ChainTransaction>('getTransaction',[result.signature,{commitment:'finalized',encoding:'base64',maxSupportedTransactionVersion:0}]);
  const transfer=decodeTransaction(chain.transaction[0]);
  if(chain.meta?.err||transfer.signature!==result.signature||transfer.mint!==cfg.mint||transfer.destination!==cfg.tokenAccount||transfer.amount!=='1050')throw new Error('independent readback mismatch');
  evidence.chain={signature:result.signature,slot:chain.slot,blockTime:chain.blockTime,commitment:'finalized',transactionSha256:createHash('sha256').update(Buffer.from(chain.transaction[0],'base64')).digest('hex'),mint:transfer.mint,amountBaseUnits:transfer.amount,memo:transfer.memo,feeLamports:chain.meta?.fee};
  const repeat=await call('POST','/v1/purchases/'+id+'/fund',undefined,{'payment-signature':new SolanaLedger(cfg.payerLedger,cfg.payer).read().find(e=>e.id===id)!.header!});
  evidence.repeatedFundingStatus=repeat.status;
  evidence.evidenceCount=(await db.get<{n:number}>('SELECT COUNT(*)::int AS n FROM funding_evidence WHERE purchase_id=$1',id))!.n;
  evidence.journal=await db.all('SELECT l.account,l.asset,l.side,l.amount,e.ledger_mode,e.kind FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id WHERE e.purchase_id=$1',id);
  if(evidence.evidenceCount!==1||hotel.executeCalls!==1||evidence.purchase.merchantPaymentStatus!=='simulated_paid')throw new Error('journal, receipt or replay invariant failed');
  evidence.hotelExecuteCalls=hotel.executeCalls;evidence.outcome='PASS';
} catch(e) {evidence.outcome='FAIL';evidence.reason=e instanceof Error?e.message:'unexpected failure';process.exitCode=1;}
finally {
  writeFileSync(join(root,'docs/work/SOLANA_LIVE.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({outcome:evidence.outcome,reason:evidence.reason,signature:evidence.chain?.signature,slot:evidence.chain?.slot}));
  await new Promise<void>(r=>server.close(()=>r()));await new Promise<void>(r=>sponsor.close(()=>r()));await db.close();await admin.end();
}
