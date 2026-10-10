import {disposeRuntimeSecrets} from '../../clients/multiwallet/secret-files.js';
/** One-time operator runtime acceptance. Explicit sources only; never wired to customer requests or wallet listing. */
import {lstatSync,statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {Db} from '../../src/infrastructure/db.js';
import {readSourceReadiness} from './preflight.js';
import {startMultiWalletPayer} from '../../clients/multiwallet/hosted.js';
export function operatorSources(env:NodeJS.ProcessEnv):string[]{
 if(env.MULTIWALLET_SIGNING_ENABLED!=='false')throw Error('operator runtime check requires signing disabled');
 const ids=(env.MULTIWALLET_OPERATOR_SOURCE_IDS??'').split(',');
 if(ids.length<1||ids.length>3||new Set(ids).size!==ids.length||ids.some(id=>!/^src_[a-f0-9]{32}$/.test(id)))throw Error('explicit bounded operator source list required');
 return ids;
}
export async function runOperatorChecks(env:NodeJS.ProcessEnv){
 const ids=operatorSources(env),db=new Db(env.DATABASE_URL??'');
 try{for(const id of ids){
  // Only metadata is logged; Render file permissions are a runtime acceptance condition, not grounds to weaken signer checks.
  const source=await db.get<{rail:string;signer_ref:string}>('SELECT rail,signer_ref FROM registered_wallets WHERE source_id=$1',id);
  if(source?.rail==='sui'){
   const path=env[source.signer_ref+'_SUI_PAYER_KEY_FILE'];
   if(path)console.log(JSON.stringify({operator:true,rail:'sui',keyFileMode:lstatSync(path).mode&0o777,fileIsSymlink:lstatSync(path).isSymbolicLink(),resolvedFileMode:statSync(path).mode&0o777,directoryMode:lstatSync(new URL('.',pathToFileURL(path))).mode&0o777}));
  }
  console.log(JSON.stringify(await readSourceReadiness(db,env,id)));
 }}finally{await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 runOperatorChecks(process.env).then(()=>startMultiWalletPayer(process.env)).then(h=>{
  console.log('Consolidated payer operator checks passed; listening with signing disabled');
  for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>void h.close().then(()=>process.exit(0)));
 }).catch(error=>{disposeRuntimeSecrets();console.error(JSON.stringify({operatorChecksPassed:false,error:error instanceof Error?error.message:'runtime check failed'}));process.exitCode=1;});
}
