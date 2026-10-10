import {Db} from '../../src/infrastructure/db.js';
import {walletRecord,publicSource} from '../../src/core/wallets.js';
import {loadWalletEngine} from '../../clients/multiwallet/engines.js';
/** Operator-only initialization check. Does not call pay, sign, submit, quote or merchant adapters. */
export async function preflightSource(db:Db,env:NodeJS.ProcessEnv,sourceId:string){
 if(env.MULTIWALLET_SIGNING_ENABLED==='true')throw Error('preflight requires signing disabled');
 if(!/^src_[a-f0-9]{32}$/.test(sourceId))throw Error('registered source ID required');
 const wallet=await walletRecord(db,sourceId);
 if(!wallet||wallet.customer_id!=='cus_HOSTEDMCPDEMO')throw Error('registered hosted demo source required');
 await loadWalletEngine(db,env,wallet);
 return {noSpend:true,source:publicSource(wallet),initialization:'validated',liveBalance:'not checked'};
}
if(process.argv[1]?.endsWith('preflight.ts')||process.argv[1]?.endsWith('preflight.js')){
 const db=new Db(process.env.DATABASE_URL??'');
 preflightSource(db,process.env,process.argv[2]??'').then(r=>console.log(JSON.stringify(r))).catch(()=>{console.error('Selected-source initialization rejected; check registered ownership, policy, identity and history');process.exitCode=1;}).finally(()=>db.close());
}
