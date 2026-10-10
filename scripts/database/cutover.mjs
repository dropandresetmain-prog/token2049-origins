import { readFileSync, existsSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { api, configureRenderAccess, resolveRenderKey, getEnvVars } from '../provision-hosted-mcp-render.mjs';
import { BACKUP, protect, connect, directTls, privateWrite, inventory, withSourceAccess } from './migration-tools.mjs';
const ids=['srv-db2jgqnavr4c73e9blrg','srv-db2mnk1srm7s73c1f5c0','srv-db35psid0e5s73f7ltng'];
const known='7c09b37eaaeda2bf3eec94fc1e3456118962f636',idle='ad3d675cdeb1774c2f2a961823d6cb7107ee948e';
const [mode,...extra]=process.argv.slice(2);
if(extra.length || !['--quiesce','--switch-database','--fence-source','--resume-known-good','--verify-known-good','--deploy-idle','--status'].includes(mode)){console.log(JSON.stringify({planOnly:true,services:ids,sourceRevision:known,idleCompatibilityRevision:idle,defaultDeny:true,runbook:'docs/architecture/NEON_DATABASE_MIGRATION.md'}));process.exit(0);}
protect(BACKUP);configureRenderAccess({key:resolveRenderKey(),dryRun:mode==='--status'});
const stateFile=join(BACKUP,'cutover-state.json');
let state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):{version:1,phase:'prepared',services:{}};
function save(){const tmp=stateFile+'.'+Date.now()+'.tmp';privateWrite(tmp,JSON.stringify(state,null,2));renameSync(tmp,stateFile);}
const digest=env=>createHash('sha256').update(JSON.stringify([...env].filter(([k])=>k!=='DATABASE_URL').sort(([a],[b])=>a.localeCompare(b)))).digest('hex');
const databaseFingerprint=value=>{const u=new URL(value);return createHash('sha256').update(u.hostname+'/'+u.pathname).digest('hex');};
async function details(id){const{data:s}=await api('GET','/services/'+id);const{data:d}=await api('GET','/services/'+id+'/deploys?limit=1');const deploy=d[0]?.deploy||d[0];assert.equal(s.serviceDetails.plan,'free');assert.equal(s.autoDeploy,'no');assert.equal(s.repo.replace(/\.git$/,''),'https://github.com/dropandresetmain-prog/token2049-origins');return{s,deploy};}
try{
 if(mode==='--quiesce'){
  assert.equal(state.phase,'prepared');
  for(const id of ids){const{s,deploy}=await details(id);assert.equal(deploy.commit.id,known);assert.equal(deploy.status,'live');const env=await getEnvVars(id);assert.ok(env.get('DATABASE_URL')?.includes('db29mujncjis73dtvf70'));state.services[id]={originalDatabaseUrl:env.get('DATABASE_URL'),otherEnvSha256:digest(env),originalBranch:s.branch,revision:deploy.commit.id,quiesced:false};}save();
  for(const id of ids){await api('POST','/services/'+id+'/suspend');const{s}=await details(id);assert.equal(s.suspended,'suspended');state.services[id].quiesced=true;save();console.log(JSON.stringify({service:id,suspended:true}));}
  state.phase='quiesced';save();
 }else if(mode==='--switch-database'){
  assert.equal(state.phase,'quiesced');
  const root=join(BACKUP,readdirSync(BACKUP).filter(n=>n.startsWith('final-')&&existsSync(join(BACKUP,n,'restore-verification.json'))).sort().at(-1));
  const proof=JSON.parse(readFileSync(join(root,'restore-verification.json'),'utf8'));assert.ok(Object.values(proof.comparison).every(Boolean));
  const target=directTls(readFileSync(join(BACKUP,'neon-authoritative-app-url'),'utf8'));assert.equal(new URL(target).hostname,'ep-young-recipe-b3jx46ll.c-4.ap-southeast-1.aws.neon.tech');
  const c=await connect(target);try{const pending=(await c.query("SELECT count(*)::int AS n FROM jobs WHERE status IN ('pending','claimed')")).rows[0].n;assert.equal(pending,0);}finally{await c.end();}
  state.finalSnapshot=root;state.finalBackupSha256=JSON.parse(readFileSync(join(root,'backup-checksum.json'),'utf8')).sha256;save();
  for(const id of ids){const{s}=await details(id);assert.equal(s.suspended,'suspended');const env=await getEnvVars(id);assert.equal(digest(env),state.services[id].otherEnvSha256);await api('PUT','/services/'+id+'/env-vars/DATABASE_URL',{value:target});const after=await getEnvVars(id);assert.equal(after.get('DATABASE_URL'),target);assert.equal(digest(after),state.services[id].otherEnvSha256);state.services[id].targetDatabaseFingerprint=databaseFingerprint(target);save();console.log(JSON.stringify({service:id,targetConfigured:true,otherEnvironmentUnchanged:true}));}
  state.phase='target-configured-all-suspended';save();
 }else if(mode==='--fence-source'){
  assert.ok(['target-configured-all-suspended','requiesced-for-environment-deployment'].includes(state.phase));
  for(const id of ids){const{s,deploy}=await details(id);assert.equal(s.suspended,'suspended');assert.equal(deploy.commit.id,known);}
  const expected=JSON.parse(readFileSync(join(state.finalSnapshot,'inventory.json'),'utf8'));
  const target=await connect(readFileSync(join(BACKUP,'neon-authoritative-app-url'),'utf8'));
  try {const actual=await inventory(target);assert.deepEqual(actual.tables,expected.tables);await target.query('ROLLBACK');}finally{await target.end();}
  const root=join(BACKUP,'fence-'+Date.now());protect(root);
  await withSourceAccess(root,async()=>{
   const source=readFileSync(join(state.finalSnapshot,'source-url'),'utf8');
   const c=await connect(source);
   try {
    const actual=await inventory(c);assert.deepEqual(actual.tables,expected.tables);await c.query('ROLLBACK');
    const others=(await c.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()")).rows[0].n;assert.equal(others,0);
    const role=(await c.query('SELECT rolconfig FROM pg_roles WHERE rolname=current_user')).rows[0];assert.equal(role.rolconfig,null);
    state.sourceFence={originalRoleConfig:role.rolconfig,authorization:'Owner reply 11 October 2026: Authorize the temporary source read-only fence',requestedAt:new Date().toISOString()};save();
    await c.query('ALTER ROLE token2049_origins_db_user SET default_transaction_read_only=on');
   }finally{await c.end();}
   const verify=await connect(source);
   try {assert.equal((await verify.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only,'on');let denied=false;try{await verify.query('UPDATE jobs SET status=status WHERE false');}catch(e){denied=e.code==='25006';}assert.ok(denied);state.sourceFence.applied=true;state.sourceFence.verifiedAt=new Date().toISOString();save();}finally{await verify.end();}
  });
  state.phase='source-fenced-all-suspended';save();console.log(JSON.stringify({sourceTablesUnchanged:true,targetTablesUnchanged:true,sourceWriteDenied:true}));
 }else if(mode==='--resume-known-good'){
  assert.equal(state.phase,'source-fenced-all-suspended');assert.equal(state.sourceFence?.applied,true);
  for(const id of ids){const env=await getEnvVars(id);assert.equal(databaseFingerprint(env.get('DATABASE_URL')),state.services[id].targetDatabaseFingerprint);const{s,deploy}=await details(id);assert.equal(s.suspended,'suspended');assert.equal(deploy.commit.id,known);}
  // Resuming uses the old environment. The verified source fence blocks it until an explicit unchanged-artifact deployment applies the target URL.
  for(const id of [ids[1],ids[2],ids[0]]){const{data}=await api('POST','/services/'+id+'/resume');state.services[id].resumeRequested=true;save();console.log(JSON.stringify({service:id,resumeRequested:true}));}
  state.phase='resumed-source-fenced';save();
  for(const id of [ids[1],ids[2],ids[0]]){const{data}=await api('POST','/services/'+id+'/deploys',{deployMode:'deploy_only'});state.services[id].targetDeployId=data.id;save();console.log(JSON.stringify({service:id,deploy:data.id,unchangedArtifact:true}));}
  state.phase='known-good-target-deploy-requested';save();
 }else if(mode==='--verify-known-good'){
  assert.equal(state.phase,'known-good-target-deploy-requested');assert.equal(state.sourceFence?.applied,true);
  for(const id of ids){const{s,deploy}=await details(id);assert.equal(s.suspended,'not_suspended');assert.equal(deploy.status,'live');assert.equal(deploy.commit.id,known);assert.equal(deploy.id,state.services[id].targetDeployId);const env=await getEnvVars(id);assert.equal(digest(env),state.services[id].otherEnvSha256);assert.equal(databaseFingerprint(env.get('DATABASE_URL')),state.services[id].targetDatabaseFingerprint);}
  const c=await connect(readFileSync(join(BACKUP,'neon-authoritative-app-url'),'utf8'));
  try {const actual=await inventory(c);await c.query('ROLLBACK');const expected=JSON.parse(readFileSync(join(state.finalSnapshot,'inventory.json'),'utf8'));const changed=Object.keys(expected.tables).filter(k=>JSON.stringify(actual.tables[k])!==JSON.stringify(expected.tables[k]));assert.ok(changed.every(k=>['public.oauth_auth_requests','public.oauth_clients','public.oauth_codes','public.oauth_tokens'].includes(k)),'Non-OAuth history divergence');assert.ok(actual.catalogs.sessions.some(s=>s.application_name.startsWith('origins_')),'Actual gateway connection on target required');state.databaseVerification={verifiedAt:new Date().toISOString(),changedTables:changed,financialHistoryUnchanged:true,allKnownGoodArtifacts:true};}finally{await c.end();}
  state.phase='known-good-verified';save();console.log(JSON.stringify(state.databaseVerification));
 }else if(mode==='--deploy-idle'){

  assert.equal(state.phase,'known-good-verified');
  const id=ids[0];const{data}=await api('POST','/services/'+id+'/deploys',{commitId:idle,clearCache:'do_not_clear'});state.idleDeployId=data.id;state.phase='idle-deploy-requested';save();console.log(JSON.stringify({service:id,deploy:data.id,commit:idle}));
 }else{
  const results=[];for(const id of ids){const{s,deploy}=await details(id);const env=await getEnvVars(id);results.push({id,suspended:s.suspended,commit:deploy.commit.id,deployStatus:deploy.status,databaseFingerprint:databaseFingerprint(env.get('DATABASE_URL')),otherEnvironmentUnchanged:state.services[id]?digest(env)===state.services[id].otherEnvSha256:null});}
  console.log(JSON.stringify({phase:state.phase,services:results}));
 }
}catch(error){privateWrite(join(BACKUP,'cutover-failure-'+Date.now()+'.json'),JSON.stringify({code:error.code,message:error.message,stack:error.stack}));console.error('Cutover assertion failed; services remain at the journaled state. No automatic rollback.');process.exitCode=1;}
