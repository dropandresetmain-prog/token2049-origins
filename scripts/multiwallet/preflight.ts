import {Db} from '../../src/infrastructure/db.js';
import {walletRecord,publicSource} from '../../src/core/wallets.js';
import {sourceEnv,loadWalletEngine} from '../../clients/multiwallet/engines.js';
/** Operator-only initialization check. Does not call pay, sign, submit, quote or merchant adapters. */
export async function preflightSource(db:Db,env:NodeJS.ProcessEnv,sourceId:string){
 if(env.MULTIWALLET_SIGNING_ENABLED==='true')throw Error('preflight requires signing disabled');
 if(!/^src_[a-f0-9]{32}$/.test(sourceId))throw Error('registered source ID required');
 const wallet=await walletRecord(db,sourceId);
 if(!wallet||wallet.customer_id!=='cus_HOSTEDMCPDEMO')throw Error('registered hosted demo source required');
 await loadWalletEngine(db,env,wallet);
 return {noSpend:true,source:publicSource(wallet),initialization:'validated',liveBalance:'not checked'};
}
/** Explicit operator check for one source. Never used by wallet listing or quoting; performs no signing or submission. */
export async function readSourceReadiness(db:Db,env:NodeJS.ProcessEnv,sourceId:string){
 const initialization=await preflightSource(db,env,sourceId);
 const wallet=(await walletRecord(db,sourceId))!,e=sourceEnv(env,wallet);
 let balances:unknown;
 if(wallet.rail==='cardano'){
  const {loadPayerConfig}=await import('../../clients/payer/config.js');
  const {BlockfrostClient}=await import('../../src/funding/cardano/blockfrost.js');
  const c=loadPayerConfig(e,{ledger:'external'}),rpc=new BlockfrostClient({baseUrl:c.blockfrostBaseUrl,projectId:c.blockfrostProjectId});
  if(await rpc.networkMagic()!==1||await rpc.latestBlockHeight()===null)throw Error('Preprod readiness unavailable');
  balances={check:'not checked; selected purchase validates spendability'};
 }else if(wallet.rail==='solana'){
  const {loadSolanaPayerConfig}=await import('../../clients/solana/config.js');
  const {solanaHostedBalances}=await import('../../clients/solana/hosted.js');
  const result=await solanaHostedBalances(loadSolanaPayerConfig(e,{ledger:'external'}));
  if(!result.verified)throw Error('Devnet readiness unavailable');balances=result;
 }else if(wallet.rail==='xlayer'){
  const {loadXLayerPayerConfig}=await import('../../clients/xlayer/config.js');
  const {XLayerRpc}=await import('../../src/funding/xlayer/rpc.js');
  const {xlayerClient}=await import('../../src/funding/xlayer/rpc.js');const c=loadXLayerPayerConfig(e,{ledger:'external'}),rpc=new XLayerRpc(xlayerClient(c.rpcUrl));
  await rpc.assertNetwork();await rpc.assertAsset();
  balances={usdt0:String(await rpc.tokenBalance(c.payer)),okbWei:String(await rpc.nativeBalance(c.payer))};
 }else{
  const {loadSuiPayerConfig}=await import('../../clients/sui/config.js');
  const {SuiRpc,suiClient}=await import('../../src/funding/sui/rpc.js');
  const {USDC_TYPE,SUI_TYPE}=await import('../../src/funding/sui/config.js');
  const c=loadSuiPayerConfig(e,{ledger:'external'}),client=suiClient(),rpc=new SuiRpc(client);
  await rpc.assertNetwork();await rpc.assertAsset();
  const token=await client.getBalance({owner:c.payer,coinType:USDC_TYPE,signal:AbortSignal.timeout(15000)});
  const gas=await client.getBalance({owner:c.payer,coinType:SUI_TYPE,signal:AbortSignal.timeout(15000)});
  balances={usdc:token.balance,sui:gas.balance};
 }
 return {...initialization,readiness:'read-only chain checks passed',balances,maxRssKiB:process.resourceUsage().maxRSS,nodeVersion:process.version};
}
if(process.argv[1]?.endsWith('preflight.ts')||process.argv[1]?.endsWith('preflight.js')){
 const db=new Db(process.env.DATABASE_URL??'');
 const args=process.argv.slice(2),readiness=args[1]==='--readiness';
 const result=args.length===(readiness?2:1)?(readiness?readSourceReadiness:preflightSource)(db,process.env,args[0]??''):Promise.reject(Error('use SOURCE_ID [--readiness]'));
 result.then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('Selected-source initialization or readiness rejected; check registered ownership, policy, identity and history');process.exitCode=1;}).finally(()=>db.close());
}
