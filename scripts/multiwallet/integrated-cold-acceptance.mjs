import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {api,configureRenderAccess,resolveRenderKey,getEnvVars} from '../provision-hosted-mcp-render.mjs';
import {BACKUP,connect,inventory,privateWrite} from '../database/migration-tools.mjs';
const cycle=process.argv[3];
if(process.argv[2]!=='--run'||!['1','2'].includes(cycle)||process.argv.length!==5){console.log(JSON.stringify({defaultDeny:true,budget:'two independent integrated cold cycles, >=16min idle each',callerDeadlineMs:160000,signing:false,merchantWrites:false}));process.exit(0);}
const start=process.argv[4];assert.ok(start&&Number.isFinite(Date.parse(start)));const idleSeconds=(Date.now()-Date.parse(start))/1000;assert.ok(idleSeconds>=960);
configureRenderAccess({key:resolveRenderKey(),dryRun:true});
const state=JSON.parse(readFileSync(join(BACKUP,'repair-release-state.json')));assert.ok(state.phase==='wake-deploying-disabled');
async function verifyWorker(){
 const token=/^oauth_token\s*=\s*"([^"]+)"/m.exec(readFileSync('C:/Users/sethl/AppData/Roaming/xdg.config/.wrangler/config/default.toml','utf8'))?.[1];assert.ok(token,'existing Worker management credential required');
 const root='https://api.cloudflare.com/client/v4/accounts/c9e98d4cf5ad6e4eee3a5851d19639a8/workers/scripts/capsule-payer-wake-experiment';
 const get=async path=>{const r=await fetch(root+path,{headers:{authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,'Worker management read failed');return r;};
 const active=(await (await get('/deployments')).json()).result.deployments[0];assert.equal(active.versions.length,1);assert.equal(active.versions[0].version_id,'00ee6d4a-afdd-4807-ad05-f46d33fa1986');assert.equal(active.versions[0].percentage,100);
 const form=await (await get('')).formData(),parts=[];for(const [name,value] of form)if(name!=='metadata')parts.push({name,bytes:typeof value==='string'?Buffer.from(value):Buffer.from(await value.arrayBuffer())});const hash=createHash('sha256');for(const p of parts.sort((a,b)=>a.name.localeCompare(b.name)))hash.update(p.name+'\0').update(p.bytes).update('\0');assert.equal(hash.digest('hex'),'dc652cc9fc9f22de757e0d35387e15726f985ba3929f162180313dab515cbf15');
 const settings=(await (await get('/settings')).json()).result;assert.deepEqual(settings.bindings.map(b=>({name:b.name,type:b.type})).sort((a,b)=>a.name.localeCompare(b.name)),[{name:'CAPSULE_WAKE_SECRET',type:'secret_text'},{name:'WAKE_RATE_LIMITER',type:'ratelimit'}]);assert.equal((await (await get('/schedules')).json()).result.schedules.length,0);
}
await verifyWorker();
const ids=['srv-db2jgqnavr4c73e9blrg','srv-db2mnk1srm7s73c1f5c0'];
for(const [i,id] of ids.entries()){const {data:s}=await api('GET','/services/'+id);const {data:ds}=await api('GET','/services/'+id+'/deploys?limit=1');assert.equal(s.serviceDetails.plan,'free');assert.equal(ds[0].deploy.status,'live');assert.equal(ds[0].deploy.commit.id,i===0?state.candidateSha:state.payerSha);if(i===1)assert.equal((await getEnvVars(id)).get('MULTIWALLET_SIGNING_ENABLED'),'false');}
async function authorityAndHistory(){
 const db=await connect(readFileSync(join(BACKUP,'neon-authoritative-app-url'),'utf8'));
 try{const baseline=JSON.parse(readFileSync(join(state.finalBackup,'inventory.json'))),current=await inventory(db);await db.query('ROLLBACK');for(const n of Object.keys(baseline.tables))if(!n.startsWith('public.oauth_'))assert.deepEqual(current.tables[n],baseline.tables[n],'history changed '+n);
 const rows=(await db.query('SELECT w.enabled,p.customer_id,a.enabled AS signing,a.instance_id FROM registered_wallets w JOIN payer_profiles p ON p.id=w.payer_id JOIN wallet_signing_authority a USING(source_id)')).rows;assert.equal(rows.length,3);for(const r of rows){assert.equal(r.enabled,false);assert.equal(r.signing,false);assert.equal(r.customer_id,'cus_HOSTEDMCPDEMO');assert.equal(r.instance_id,state.instanceId);}
 const scopes=JSON.parse((await db.query("SELECT scopes_json FROM api_clients WHERE id='cli_HOSTEDMCPDEMO'")).rows[0].scopes_json);assert.equal(scopes.includes('purchases:write'),false);assert.equal(scopes.includes('quotes:write'),false);
 const old=(await db.query("SELECT revoked_at FROM api_clients WHERE id IN ('cli_HOSTEDPAYER','cli_HOSTEDSOLANAPAYER')")).rows;assert.equal(old.length,2);for(const r of old)assert.ok(r.revoked_at);
 }finally{await db.end();}
 assert.equal((await api('GET','/services/srv-db35psid0e5s73f7ltng')).data.suspended,'suspended');
}
await authorityAndHistory();
const logs=async(id,at)=>(await api('GET','/logs?'+new URLSearchParams({ownerId:'tea-db1tjj1srm7s73d6vra0',resource:id,type:'app',startTime:at,direction:'forward',limit:'100'}))).data;
const beforeLogs=await logs(ids[1],start);assert.equal(beforeLogs.hasMore,false);assert.equal(beforeLogs.logs.length,0,'idle payer application activity requires a new controlled window');
const tokenPath=join(BACKUP,readdirSync(BACKUP).filter(n=>/^wake-readonly-access-token-\d+\.json$/.test(n)).sort().at(-1));const token=JSON.parse(readFileSync(tokenPath));assert.ok(token.expiresAt-Date.now()>160000);
const proofFile=join(BACKUP,'wake-final-integrated-cycle-'+cycle+'.json');
if(cycle==='2'){const first=JSON.parse(readFileSync(join(BACKUP,'wake-final-integrated-cycle-1.json')));assert.equal(first.passed,true);assert.equal(first.candidateSha,state.candidateSha);assert.ok(Date.parse(start)>=Date.parse(first.completedAt));}
const began=new Date().toISOString();
// Exclusive protected marker consumes this cycle before I/O. A lost response cannot authorize a third attempt.
privateWrite(join(BACKUP,'wake-final-integrated-cycle-'+cycle+'-attempt.json'),JSON.stringify({began,idleStart:start,candidateSha:state.candidateSha}));privateWrite(join(BACKUP,'wake-integrated-start-'+Date.now()+'.json'),JSON.stringify({began,idleStart:start,idleSeconds,candidateSha:state.candidateSha,paymentAttempted:false}));
let response,result,durationMs,completedAt;
try{response=await fetch('https://token2049-origins.onrender.com/mcp/payer-readiness',{headers:{authorization:'Bearer '+token.token},redirect:'error',signal:AbortSignal.timeout(160000)});
result=await response.json();}catch(e){result={ok:false,code:e?.name==='TimeoutError'?'independent_caller_timeout':'independent_caller_transport_failure',paymentAttempted:false};}
durationMs=Date.now()-Date.parse(began);completedAt=new Date().toISOString();
privateWrite(join(BACKUP,'wake-final-integrated-cycle-'+cycle+'-terminal.json'),JSON.stringify({began,completedAt,durationMs,httpStatus:response?.status??null,result}));
let afterLogs=await logs(ids[1],began); let gatewayLogs=await logs(ids[0],began);assert.equal(afterLogs.hasMore,false);assert.equal(gatewayLogs.hasMore,false);
let events=gatewayLogs.logs.flatMap(l=>{try{return[JSON.parse(l.message.replace(/^.*?(?=\{)/,''))];}catch{return[];}}).filter(e=>['payer_wake','payer_transport','payer_payment_http'].includes(e.type));
// Render log ingestion can lag the HTTP reply. Catch up management reads only; never repeat the diagnostic/payment request.
const logDeadline=Date.now()+30000;
for(let n=0;n<8&&Date.now()<logDeadline&&(!afterLogs.logs.some(l=>/^Consolidated payer listening$/.test(l.message))||!events.some(e=>e.type==='payer_transport'&&e.outcome==='ready')||!events.some(e=>e.type==='payer_payment_http'&&e.status===400));n++){
 await new Promise(r=>setTimeout(r,Math.min(4000,1000*2**Math.min(n,2))));gatewayLogs=await logs(ids[0],began);afterLogs=await logs(ids[1],began);assert.equal(afterLogs.hasMore,false);assert.equal(gatewayLogs.hasMore,false);
 events=gatewayLogs.logs.flatMap(l=>{try{return[JSON.parse(l.message.replace(/^.*?(?=\{)/,''))];}catch{return[];}}).filter(e=>['payer_wake','payer_transport','payer_payment_http'].includes(e.type));
}
const startupObserved=afterLogs.logs.some(l=>/^Consolidated payer listening$/.test(l.message));
const sourceUrl=readFileSync(join(BACKUP,'neon-authoritative-app-url'),'utf8');const db=await connect(sourceUrl);let current;
try{current=await inventory(db);await db.query('ROLLBACK');const baseline=JSON.parse(readFileSync(join(state.finalBackup,'inventory.json')));for(const n of Object.keys(baseline.tables))if(!n.startsWith('public.oauth_'))assert.deepEqual(current.tables[n],baseline.tables[n],'history changed '+n);}finally{await db.end();}
const passed=response?.status===200&&result.ok===true&&result.postContractVerified===true&&result.paymentAttempted===false&&startupObserved&&events.some(e=>e.type==='payer_transport'&&e.status===429&&e.renderRouting==='hibernate-rate-limited')&&events.some(e=>e.type==='payer_wake'&&e.outcome==='health_response'&&e.status===200&&e.upstreamStatus===200&&e.responseCategory==='upstream_2xx')&&events.some(e=>e.type==='payer_transport'&&e.outcome==='ready')&&events.some(e=>e.type==='payer_payment_http'&&e.status===400&&e.responseCategory==='canonical_failure');
await authorityAndHistory();
await verifyWorker();
const proof={passed,cycle,workerVersion:'00ee6d4a-afdd-4807-ad05-f46d33fa1986',candidateSha:state.candidateSha,payerSha:state.payerSha,startedAt:began,completedAt,idleStart:start,idleSeconds,durationMs,httpStatus:response?.status??null,result,paymentAttempted:false,beforeLogs,afterLogs,gatewayLogs,events,startupObserved,historyUnchanged:true};
privateWrite(proofFile,JSON.stringify(proof));
console.log(JSON.stringify({proofPath:proofFile,passed,cycle,candidateSha:state.candidateSha,payerSha:state.payerSha,startedAt:began,completedAt,idleSeconds,durationMs,httpStatus:response?.status??null,result,events,startupObserved,historyUnchanged:true,paymentAttempted:false}));
assert.equal(passed,true,'Integrated cold acceptance failed; stop without retry or activation');
