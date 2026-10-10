import {readFileSync,readdirSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {api,configureRenderAccess,resolveRenderKey,getEnvVars} from '../provision-hosted-mcp-render.mjs';
import {BACKUP,protect,privateWrite,connect,directTls} from '../database/migration-tools.mjs';
import {Db} from '../../src/infrastructure/db.ts';
import {assertSnapshotFresh,preserveOriginalScopes} from './repair-gates.mjs';
import {alignDemoCaps} from './align-demo-caps.ts';
const ids=['srv-db2jgqnavr4c73e9blrg','srv-db2mnk1srm7s73c1f5c0'];
const old='cb7b96e9e43a09842c1e9ee031bd1d8e3ec73e78';
const sources=['src_21f098873f368133fc671af8b3716703','src_5f44db62376459a75a564e4d3bc8099a','src_fb5d190ec0b7abf66d5ff65f2e37af86'];
const modes=['--status','--quiesce','--prepare','--deploy-disabled','--normal-disabled','--activate'];
const mode=process.argv[2];
if(process.argv.length!==3||!modes.includes(mode)){console.log(JSON.stringify({mode:'plan-only',defaultDeny:true,resources:ids,previousSha:old,steps:modes.slice(1),backup:'fresh snapshot-and-rehearse required after quiescence',caps:'Solana/Sui match Cardano 5100000; gas/fees unchanged',chainBroadcast:false,merchantWrites:false}));process.exit(0);}
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
assert.equal(git('remote','get-url','origin'),'https://github.com/dropandresetmain-prog/token2049-origins.git');
assert.equal(git('branch','--show-current'),'codex/capsule-neon-migration');
configureRenderAccess({key:resolveRenderKey(),dryRun:mode==='--status'});
protect(BACKUP);
const file=join(BACKUP,'repair-release-state.json');
let state;try{state=JSON.parse(readFileSync(file));}catch(e){if(e.code!=='ENOENT')throw e;state={phase:'prepared',services:{}};}
const save=()=>{const temp=file+'.'+Date.now()+'.tmp';privateWrite(temp,JSON.stringify(state));renameSync(temp,file);};
const url=readFileSync(join(BACKUP,'neon-authoritative-app-url'),'utf8');
assert.equal(new URL(url).hostname,'ep-young-recipe-b3jx46ll.c-4.ap-southeast-1.aws.neon.tech');
async function detail(id){const {data:s}=await api('GET','/services/'+id);const {data:d}=await api('GET','/services/'+id+'/deploys?limit=1');assert.equal(s.serviceDetails.plan,'free');assert.equal(s.autoDeploy,'no');assert.equal(s.branch,'codex/capsule-neon-migration');assert.equal(s.repo,'https://github.com/dropandresetmain-prog/token2049-origins');return {s,deploy:d[0].deploy};}
function backup(after=0){const root=join(BACKUP,readdirSync(BACKUP).filter(n=>/^consolidation-\d+$/.test(n)).sort().at(-1));const proof=JSON.parse(readFileSync(join(root,'restore-verification.json')));assert.ok(Object.values(proof.comparison).every(Boolean));assertSnapshotFresh(root,after);assert.ok(Date.parse(proof.created)>after);assert.equal(createHash('sha256').update(readFileSync(join(root,'authoritative.dump'))).digest('hex'),proof.backupSha256);return root;}
const inflight="SELECT ((SELECT count(*) FROM jobs WHERE status IN ('pending','claimed'))+(SELECT count(*) FROM purchases WHERE state NOT IN ('succeeded','failed','expired'))+(SELECT count(*) FROM funding_attempts WHERE status='pending')+(SELECT count(*) FROM execution_attempts WHERE status IN ('started','unknown'))+(SELECT count(*) FROM payment_handoffs WHERE status='running'))::text AS n";
async function env(id,desired){const existing=await getEnvVars(id);for(const [key,value] of Object.entries(desired)){if(existing.get(key)!==value)await api('PUT','/services/'+id+'/env-vars/'+key,{value});}}
try{
 if(mode==='--status'){for(const id of ids){const {s,deploy}=await detail(id);console.log(JSON.stringify({id,suspended:s.suspended,sha:deploy.commit.id,status:deploy.status}));}console.log(JSON.stringify({phase:state.phase,candidateSha:state.candidateSha}));process.exit(0);}
 if(mode==='--quiesce'){
  assert.equal(state.phase,'prepared');assert.equal(git('status','--porcelain'),'');assert.equal(git('rev-parse','HEAD'),git('rev-parse','origin/codex/capsule-neon-migration'));
  state.candidateSha=git('rev-parse','HEAD');state.instanceId='capsule_'+state.candidateSha.slice(0,12);state.preBackup=backup(Date.now()-3600000);save();
  const db=await connect(url);try{assert.equal((await db.query(inflight)).rows[0].n,'0');}finally{await db.end();}
  for(const id of ids){const {s,deploy}=await detail(id);assert.equal(deploy.commit.id,old);assert.equal(deploy.status,'live');state.services[id]={previousSha:old};save();if(s.suspended!=='suspended')await api('POST','/services/'+id+'/suspend');assert.equal((await detail(id)).s.suspended,'suspended');}
  state.quiescedAt=new Date().toISOString();state.phase='quiesced';save();
 }else if(mode==='--prepare'){
  assert.equal(state.phase,'quiesced');state.finalBackup=backup(Date.parse(state.quiescedAt));
  for(const id of ids)assert.equal((await detail(id)).s.suspended,'suspended');
  assert.equal((await api('GET','/services/srv-db35psid0e5s73f7ltng')).data.suspended,'suspended');
  const db=new Db(directTls(url));try{
   assert.equal((await db.get(inflight)).n,'0');
   await db.tx(async()=>{
    preserveOriginalScopes(state,(await db.get("SELECT scopes_json FROM api_clients WHERE id='cli_HOSTEDMCPDEMO' AND customer_id='cus_HOSTEDMCPDEMO' AND revoked_at IS NULL")).scopes_json);save();
    await db.run("UPDATE api_clients SET scopes_json='[\"purchases:read\",\"offers:read\"]' WHERE id='cli_HOSTEDMCPDEMO'");
    for(const id of sources){assert.equal((await db.run('UPDATE registered_wallets SET enabled=FALSE WHERE source_id=$1',id)).changes,1);assert.equal((await db.run('UPDATE wallet_signing_authority SET enabled=FALSE,instance_id=$1 WHERE source_id=$2',state.instanceId,id)).changes,1);}
   });
   await db.initialize();state.amendments=await alignDemoCaps(db,{apply:true,authorizationReference:'owner-match-Cardano-caps-20261011'});
  }finally{await db.close();}
  state.phase='amended-disabled';save();
 }else if(mode==='--deploy-disabled'){
  assert.equal(state.phase,'amended-disabled');
  await env(ids[0],{SUI_MAX_PAYMENT_BASE_UNITS:'5100000',SOLANA_MAX_PAYMENT_BASE_UNITS:'5100000'});
  await env(ids[1],{MULTIWALLET_SIGNING_ENABLED:'false',MULTIWALLET_INSTANCE_ID:state.instanceId,MULTIWALLET_OPERATOR_SOURCE_IDS:sources.join(','),DEMO_SOLANA_SOLANA_MAX_PAYMENT_BASE_UNITS:'5100000',DEMO_SOLANA_SOLANA_PAYER_MAX_PURCHASE_BASE_UNITS:'5100000',DEMO_SOLANA_SOLANA_PAYER_MAX_DAILY_BASE_UNITS:'5100000',DEMO_SOLANA_SOLANA_PAYER_MAX_TOTAL_BASE_UNITS:'5100000',DEMO_SOLANA_SOLANA_PAYER_MAX_COMMERCIAL_USD_MINOR:'510000',DEMO_SUI_SUI_MAX_PAYMENT_BASE_UNITS:'5100000',DEMO_SUI_SUI_PAYER_MAX_PAYMENT_BASE_UNITS:'5100000',DEMO_SUI_SUI_PAYER_MAX_DAILY_BASE_UNITS:'5100000',DEMO_SUI_SUI_PAYER_MAX_TOTAL_BASE_UNITS:'5100000',DEMO_SUI_SUI_PAYER_MAX_COMMERCIAL_USD_MINOR:'510000'});
  await api('PATCH','/services/'+ids[1],{serviceDetails:{envSpecificDetails:{dockerCommand:'node dist/scripts/multiwallet/runtime-check.js'}}});
  state.deploys={};save();
  for(const id of [ids[1],ids[0]]){if((await detail(id)).s.suspended==='suspended')await api('POST','/services/'+id+'/resume');const {data:d}=await api('POST','/services/'+id+'/deploys',{clearCache:'do_not_clear',commitId:state.candidateSha});state.deploys[id]=d.id;save();}
  state.phase='deploying-disabled';save();
 }else if(mode==='--normal-disabled'){
  assert.equal(state.phase,'deploying-disabled');
  // Operator proof is saved from actual Render logs after all three selected read-only checks pass.
  const proof=JSON.parse(readFileSync(join(BACKUP,'repair-operator-proof.json')));assert.equal(proof.candidateSha,state.candidateSha);assert.deepEqual(proof.validatedSources.slice().sort(),sources.slice().sort());assert.equal(proof.signingDisabled,true);
  for(const id of ids){const {deploy}=await detail(id);assert.equal(deploy.status,'live');assert.equal(deploy.commit.id,state.candidateSha);}
  await api('DELETE','/services/'+ids[1]+'/env-vars/MULTIWALLET_OPERATOR_SOURCE_IDS');
  await api('PATCH','/services/'+ids[1],{serviceDetails:{envSpecificDetails:{dockerCommand:'node dist/clients/multiwallet/hosted.js'}}});
  const {data:d}=await api('POST','/services/'+ids[1]+'/deploys',{clearCache:'do_not_clear',commitId:state.candidateSha});state.normalDeploy=d.id;state.phase='normal-disabled';save();
 }else if(mode==='--activate'){
  assert.equal(state.phase,'normal-disabled');const proof=JSON.parse(readFileSync(join(BACKUP,'repair-disabled-hosted-proof.json')));assert.equal(proof.candidateSha,state.candidateSha);assert.equal(proof.transportContract,true);assert.equal(proof.historyUnchanged,true);assert.equal(proof.oauthMcpReadOnly,true);
  for(const id of ids){const {deploy}=await detail(id);assert.equal(deploy.status,'live');assert.equal(deploy.commit.id,state.candidateSha);}
  await env(ids[1],{MULTIWALLET_SIGNING_ENABLED:'true'});
  const {data:d}=await api('POST','/services/'+ids[1]+'/deploys',{clearCache:'do_not_clear',commitId:state.candidateSha});state.activationDeploy=d.id;state.phase='activation-pending';save();
 }
 console.log(JSON.stringify({phase:state.phase,candidateSha:state.candidateSha,signingGranted:false,chainBroadcast:false,merchantWrites:false}));
}catch(error){privateWrite(join(BACKUP,'repair-release-failure-'+Date.now()+'.json'),JSON.stringify({message:error.message,stack:error.stack}));console.error('Repair release stopped; protected state retained. Do not automatically roll back or activate signing.');process.exitCode=1;}
