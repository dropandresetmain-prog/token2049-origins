#!/usr/bin/env node
/** Owner-scoped, single-use cold diagnostic. No gateway flow, payment authority or automatic retry. */
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {WAKE_UPSTREAM_TIMEOUT_MS} from '../../deploy/payer-wake/worker.ts';
import {api,configureRenderAccess,resolveRenderKey,getEnvVars} from '../provision-hosted-mcp-render.mjs';
import {BACKUP,connect,inventory,privateWrite} from '../database/migration-tools.mjs';

const CALLER_TIMEOUT_MS=110_000;
const GATEWAY_SHA='b122186ceaadc36cb75abb4fb986cde7423a3046';
const PAYER_SHA='3945f9c52cf76e1960569d53416361bcd42de175';
const GATEWAY_ID='srv-db2jgqnavr4c73e9blrg',PAYER_ID='srv-db2mnk1srm7s73c1f5c0';
const WORKER_URL='https://capsule-payer-wake-experiment.dropandreset-main.workers.dev/wake';
const CF_API='https://api.cloudflare.com/client/v4/accounts/c9e98d4cf5ad6e4eee3a5851d19639a8/workers/scripts/capsule-payer-wake-experiment';
const ATTEMPT=join(BACKUP,'wake-final-cold-ingress-20261011-attempt.json');
const options={verify:{type:'boolean'},run:{type:'boolean'},'worker-version':{type:'string'},'worker-fingerprint':{type:'string'},'source-sha':{type:'string'},'idle-start':{type:'string'}};
const {values}=parseArgs({options});
if(!values.verify&&!values.run){
 console.log(JSON.stringify({defaultDeny:true,upstreamDeadlineMs:WAKE_UPSTREAM_TIMEOUT_MS,independentCallerDeadlineMs:CALLER_TIMEOUT_MS,requires:'explicit --run, pinned Worker version/module/source SHA, verified idle >15min, disabled authority, unchanged histories',budget:'one authenticated fixed-health Worker request; no retries or gateway purchase flow',paymentAttempted:false}));
 process.exit(0);
}
assert.equal(Boolean(values.verify&&values.run),false);
assert.ok(CALLER_TIMEOUT_MS>=WAKE_UPSTREAM_TIMEOUT_MS+20_000,'caller must leave time to receive terminal classification');
assert.match(values['worker-version']??'',/^[a-f0-9-]{36}$/);
assert.match(values['worker-fingerprint']??'',/^[a-f0-9]{64}$/);
assert.ok(Number.isFinite(Date.parse(values['idle-start']??'')),'explicit controlled idle start required');
const terminal=z.object({ok:z.boolean(),category:z.enum(['upstream_2xx','redirect_refused','upstream_refused','timeout','transport_error','rate_limited','rate_limit_unavailable','invalid_request','unauthenticated','not_configured']),upstreamStatus:z.number().int().min(100).max(599).optional(),contentType:z.enum(['json','html','other']).optional(),renderRouting:z.enum(['none','other','hibernate-rate-limited']).optional(),durationMs:z.number().nonnegative().optional(),paymentAttempted:z.literal(false)}).strict();
function cfToken(){const text=readFileSync('C:/Users/sethl/AppData/Roaming/xdg.config/.wrangler/config/default.toml','utf8');const value=/^oauth_token\s*=\s*"([^"]+)"/m.exec(text)?.[1];assert.ok(value,'existing Wrangler OAuth access required');return value;}
async function cfResponse(path){return fetch(CF_API+path,{headers:{authorization:'Bearer '+cfToken()},redirect:'error',signal:AbortSignal.timeout(30_000)});}
async function cfJson(path){const response=await cfResponse(path);assert.equal(response.status,200,'Cloudflare management access failed');const body=await response.json();assert.equal(body.success,true);return body.result;}
async function verifyWorker(){
 const deployments=await cfJson('/deployments'),active=deployments.deployments[0];
 assert.equal(active.versions.length,1);assert.equal(active.versions[0].version_id,values['worker-version']);assert.equal(active.versions[0].percentage,100);
 const settings=await cfJson('/settings'),schedules=await cfJson('/schedules');assert.equal(schedules.schedules.length,0);
 assert.deepEqual(settings.bindings.map(b=>({name:b.name,type:b.type})).sort((a,b)=>a.name.localeCompare(b.name)),[{name:'CAPSULE_WAKE_SECRET',type:'secret_text'},{name:'WAKE_RATE_LIMITER',type:'ratelimit'}]);
 const response=await cfResponse('');assert.equal(response.status,200,'deployed Worker content unavailable');
 const form=await response.formData(),parts=[];
 for(const [name,value] of form)if(name!=='metadata')parts.push({name,bytes:typeof value==='string'?Buffer.from(value):Buffer.from(await value.arrayBuffer())});
 const hash=createHash('sha256');for(const p of parts.sort((a,b)=>a.name.localeCompare(b.name)))hash.update(p.name+'\0').update(p.bytes).update('\0');
 const fingerprint=hash.digest('hex');assert.equal(fingerprint,values['worker-fingerprint']);
 return {version:active.versions[0].version_id,deploymentId:active.id,fingerprint,bindings:settings.bindings.map(b=>({name:b.name,type:b.type})),scheduledTriggers:[]};
}
async function verifyState(){
 configureRenderAccess({key:resolveRenderKey(),dryRun:true});const state=JSON.parse(readFileSync(join(BACKUP,'repair-release-state.json')));
 assert.equal(state.phase,'wake-blocked-disabled');assert.equal(state.candidateSha,GATEWAY_SHA);assert.equal(state.payerSha,PAYER_SHA);
 const databaseUrl=readFileSync(join(BACKUP,'neon-authoritative-app-url'),'utf8').trim();let deployments=[];
 for(const [id,sha] of [[GATEWAY_ID,GATEWAY_SHA],[PAYER_ID,PAYER_SHA]]){
  const {data:s}=await api('GET','/services/'+id),{data:ds}=await api('GET','/services/'+id+'/deploys?limit=1');
  assert.equal(s.serviceDetails.plan,'free');assert.equal(s.suspended,'not_suspended');assert.equal(s.autoDeploy,'no');assert.equal(ds[0].deploy.status,'live');assert.equal(ds[0].deploy.commit.id,sha);
  const env=await getEnvVars(id);assert.ok(env.get('DATABASE_URL')?.trim()===databaseUrl,'canonical database binding drift');
  if(id===PAYER_ID){assert.equal(env.get('MULTIWALLET_SIGNING_ENABLED'),'false');assert.equal(env.get('MULTIWALLET_INSTANCE_ID'),state.instanceId);assert.equal(env.has('MULTIWALLET_OPERATOR_SOURCE_IDS'),false);}
  deployments.push({id,sha,deployId:ds[0].deploy.id});
 }
 assert.equal((await api('GET','/services/srv-db35psid0e5s73f7ltng')).data.suspended,'suspended');
 const db=await connect(databaseUrl);let comparedTables=0;
 try{
  const baseline=JSON.parse(readFileSync(join(state.finalBackup,'inventory.json'))),current=await inventory(db);await db.query('ROLLBACK');
  for(const name of Object.keys(baseline.tables))if(!name.startsWith('public.oauth_')){assert.deepEqual(current.tables[name],baseline.tables[name],'canonical history drift '+name);comparedTables++;}
  const rows=(await db.query('SELECT w.enabled,p.customer_id,a.enabled AS signing,a.instance_id FROM registered_wallets w JOIN payer_profiles p ON p.id=w.payer_id JOIN wallet_signing_authority a USING(source_id)')).rows;
  assert.equal(rows.length,3);for(const r of rows){assert.equal(r.enabled,false);assert.equal(r.signing,false);assert.equal(r.customer_id,'cus_HOSTEDMCPDEMO');assert.equal(r.instance_id,state.instanceId);}
  const scopes=JSON.parse((await db.query("SELECT scopes_json FROM api_clients WHERE id='cli_HOSTEDMCPDEMO'")).rows[0].scopes_json);
  assert.equal(scopes.includes('purchases:write'),false);assert.equal(scopes.includes('quotes:write'),false);
  const old=(await db.query("SELECT revoked_at FROM api_clients WHERE id IN ('cli_HOSTEDPAYER','cli_HOSTEDSOLANAPAYER')")).rows;assert.equal(old.length,2);for(const r of old)assert.ok(r.revoked_at);
 }finally{await db.end();}
 return {deployments,comparedTables,historyUnchanged:true,signingDisabled:true,grantsDisabled:true,customerWritesDisabled:true,oldSignersFenced:true};
}
async function payerEvents(start){
 const {data:logs}=await api('GET','/logs?'+new URLSearchParams({ownerId:'tea-db1tjj1srm7s73d6vra0',resource:PAYER_ID,type:'app',startTime:start,direction:'forward',limit:'100'}));assert.equal(logs.hasMore,false,'incomplete log page cannot establish inactivity');
 // Store classifications and timestamps only; unknown messages, request headers and bodies are never logged.
 return logs.logs.map(l=>({timestamp:l.timestamp,startup:l.message==='Consolidated payer listening'}));
}
async function main(){
 const worker=await verifyWorker(),before=await verifyState();
 const idleStart=values['idle-start'],beforeEvents=await payerEvents(idleStart);assert.equal(beforeEvents.length,0,'new payer activity requires another verified idle window');
 const idleSeconds=(Date.now()-Date.parse(idleStart))/1000;assert.ok(idleSeconds>=960,'at least16min controlled inactivity required');
 const preflight={verifiedAt:new Date().toISOString(),worker,...before,idleStart,idleSeconds};
 privateWrite(join(BACKUP,'wake-final-diagnostic-preflight-'+Date.now()+'.json'),JSON.stringify(preflight));
 if(values.verify){console.log(JSON.stringify(preflight));return;}
 const git=(...args)=>execFileSync('git',['-c','core.bare=false',...args],{encoding:'utf8'}).trim();
 assert.equal(git('branch','--show-current'),'codex/capsule-neon-migration');assert.equal(git('remote','get-url','origin'),'https://github.com/dropandresetmain-prog/token2049-origins.git');
 assert.equal(git('status','--porcelain'),'');assert.match(values['source-sha']??'',/^[a-f0-9]{40}$/);assert.equal(git('rev-parse','HEAD'),values['source-sha']);assert.equal(git('rev-parse','origin/codex/capsule-neon-migration'),values['source-sha']);
 assert.equal(existsSync(ATTEMPT),false,'one authorized attempt already recorded; never automatically repeat it');
 const secret=JSON.parse(readFileSync(join(BACKUP,'wake-worker-new-secret.json'))).CAPSULE_WAKE_SECRET;assert.ok(/^[a-f0-9]{64}$/.test(secret),'dedicated wake credential required');
 const startedAt=new Date().toISOString();
 // Exclusive durable marker precedes the only outbound wake; response loss cannot authorize another invocation.
 privateWrite(ATTEMPT,JSON.stringify({authorization:'owner-one-final-cold-ingress-diagnostic-20261011',startedAt,sourceSha:values['source-sha'],worker,idleStart,idleSeconds,paymentAttempted:false}));
 let result,httpStatus=null,callerOutcome='completed';
 try{
  const response=await fetch(WORKER_URL,{method:'POST',headers:{authorization:'Bearer '+secret},redirect:'error',signal:AbortSignal.timeout(CALLER_TIMEOUT_MS)});
  httpStatus=response.status;
  const mime=response.headers.get('content-type')??'';
  if(!mime.includes('application/json')){void response.body?.cancel().catch(()=>{});callerOutcome='non_json_response';}
  else {const parsed=terminal.safeParse(await response.json());if(parsed.success)result=parsed.data;else callerOutcome='invalid_terminal_response';}
 }catch(error){callerOutcome=['TimeoutError','AbortError'].includes(error?.name)?'caller_timeout':'caller_transport_failure';}
 const elapsedMs=Date.now()-Date.parse(startedAt),completedAt=new Date().toISOString();
 // Persist the terminal result before any log or database read can fail. Never store unexpected response bodies.
 privateWrite(join(BACKUP,'wake-final-diagnostic-terminal-'+Date.now()+'.json'),JSON.stringify({startedAt,completedAt,worker,elapsedMs,httpStatus,callerOutcome,result:result??null,paymentAttempted:false}));
 let events=await payerEvents(startedAt);
 // Bounded management-only log catch-up. Never repeat the Worker or contact the payer here.
 for(let n=0;n<3&&!events.some(e=>e.startup);n++){await new Promise(r=>setTimeout(r,2000*(n+1)));events=await payerEvents(startedAt);}
 const startupObserved=events.some(e=>e.startup),after=await verifyState(),currentWorker=await verifyWorker();assert.equal(currentWorker.version,worker.version);
 const passed=httpStatus===200&&result?.ok===true&&result.category==='upstream_2xx'&&result.upstreamStatus===200&&startupObserved;
 const proof={status:passed?'COLD_WORKER_DIAGNOSTIC_PASS — INTEGRATED REPEATABILITY PENDING':'BLOCKED_TECHNICAL',sourceSha:values['source-sha'],gatewaySha:GATEWAY_SHA,payerSha:PAYER_SHA,worker,startedAt,completedAt,verifiedAt:new Date().toISOString(),idleStart,idleSeconds,upstreamDeadlineMs:WAKE_UPSTREAM_TIMEOUT_MS,callerDeadlineMs:CALLER_TIMEOUT_MS,elapsedMs,httpStatus,callerOutcome,result:result??null,startupObserved,payerEvents:events,...after,workerRequests:1,paymentAttempted:false,chainBroadcasts:0,providerWrites:0};
 privateWrite(join(BACKUP,'wake-final-diagnostic-result-'+Date.now()+'.json'),JSON.stringify(proof));console.log(JSON.stringify(proof));
}
main().catch(()=>{console.error('Diagnostic gate stopped. Preserve the single-attempt marker and protected evidence; do not automatically retry or enable authority.');process.exitCode=1;});
