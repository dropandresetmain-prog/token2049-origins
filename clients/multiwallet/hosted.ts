import { pathToFileURL } from 'node:url';
import { Db } from '../../src/infrastructure/db.js';
import { createBridge, listenHosted } from '../payer/bridge.js';
import { readSecretFile } from '../payer/config.js';
import { MultiWalletPayer } from './dispatcher.js';
import { loadWalletEngine } from './engines.js';

/** One public Render Free service; protected token and purchase-id-only API, keys remain outside gateway. */
export async function startMultiWalletPayer(env:NodeJS.ProcessEnv,opts:{db?:Db;port?:number}={}) {
 if(env.MULTIWALLET_SIGNING_ENABLED!==undefined && !['true','false'].includes(env.MULTIWALLET_SIGNING_ENABLED))throw Error('invalid MULTIWALLET_SIGNING_ENABLED');
 const instanceId=env.MULTIWALLET_INSTANCE_ID;
 if(!instanceId || !/^[A-Za-z0-9_-]{8,80}$/.test(instanceId))throw Error('MULTIWALLET_INSTANCE_ID required');
 const token=readSecretFile(env.MULTIWALLET_PAYER_TOKEN_FILE??'','MULTIWALLET_PAYER_TOKEN_FILE');
 const allowedHosts=(env.MULTIWALLET_ALLOWED_HOSTS??'').split(',').filter(Boolean);
 if(!allowedHosts.length || allowedHosts.some(h=>!/^([a-z0-9-]+\.)+[a-z0-9-]+$/.test(h)))throw Error('MULTIWALLET_ALLOWED_HOSTS invalid');
 const port=opts.port??Number(env.PORT??'10000');
 if(!Number.isInteger(port)||port<0||port>65535)throw Error('invalid PORT');
 const db=opts.db??new Db(env.DATABASE_URL??'');
 // Migrations and identity/history imports are an explicit owner-approved release step, never implicit startup writes.
 try {
  if(!(await db.get("SELECT version FROM schema_migrations WHERE version='0012_wallet_ledgers.sql'")))throw Error('consolidated payer migrations not applied');
  const payer=new MultiWalletPayer({db,enabled:env.MULTIWALLET_SIGNING_ENABLED==='true',instanceId,load:w=>loadWalletEngine(db,env,w)});
  const server=createBridge({payer,token,serializePayments:false,access:{mode:'hosted',allowedHosts}});
  await listenHosted(server,port);
  return {server,db,close:async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));if(!opts.db)await db.close();}};
 }catch(error){if(!opts.db)await db.close();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 startMultiWalletPayer(process.env).then(h=>{console.log('Consolidated payer listening');for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>void h.close().then(()=>process.exit(0)));})
 .catch(()=>{console.error('Consolidated payer configuration or history rejected');process.exitCode=1;});
}
