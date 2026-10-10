import {readFileSync,readdirSync,existsSync,renameSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
import {api,configureRenderAccess,resolveRenderKey} from '../provision-hosted-mcp-render.mjs';
import {BACKUP,protect,privateWrite,connect} from '../database/migration-tools.mjs';
const services=['srv-db2jgqnavr4c73e9blrg','srv-db2mnk1srm7s73c1f5c0','srv-db35psid0e5s73f7ltng'];
const expected=['ad3d675cdeb1774c2f2a961823d6cb7107ee948e','7c09b37eaaeda2bf3eec94fc1e3456118962f636','7c09b37eaaeda2bf3eec94fc1e3456118962f636'];
const [mode,...extra]=process.argv.slice(2);
if(extra.length||!['--quiesce','--status'].includes(mode)){console.log(JSON.stringify({planOnly:true,services,defaultDeny:true,actions:['quiesce only after backup/restore and permanent Sui retirement proof','status reads'],runbook:'docs/architecture/CONSOLIDATED_PAYER.md'}));process.exit(0);}
protect(BACKUP);configureRenderAccess({key:resolveRenderKey(),dryRun:mode==='--status'});
const file=join(BACKUP,'consolidated-cutover-state.json');let state=existsSync(file)?JSON.parse(readFileSync(file)):{version:1,phase:'prepared',services:{}};
const save=()=>{const temp=file+'.'+Date.now()+'.tmp';privateWrite(temp,JSON.stringify(state));renameSync(temp,file);};
async function detail(id){const{data:s}=await api('GET','/services/'+id);const{data:d}=await api('GET','/services/'+id+'/deploys?limit=1');assert.equal(s.serviceDetails.plan,'free');assert.equal(s.autoDeploy,'no');assert.equal(s.repo,'https://github.com/dropandresetmain-prog/token2049-origins');return{s,deploy:d[0].deploy};}
try{
 if(mode==='--status'){const result=[];for(const id of services){const{s,deploy}=await detail(id);result.push({id,suspended:s.suspended,revision:deploy.commit.id,status:deploy.status});}console.log(JSON.stringify({phase:state.phase,services:result}));}
 else{
  assert.ok(['prepared','quiescing'].includes(state.phase));
  const manifest=JSON.parse(readFileSync('deploy/consolidated-payer-release.json'));assert.equal(manifest.renderQuotaEvidence.paymentMethodPresent,false);
  const root=join(BACKUP,readdirSync(BACKUP).filter(n=>/^consolidation-\d+$/.test(n)).sort().at(-1));const proof=JSON.parse(readFileSync(join(root,'restore-verification.json')));assert.ok(Object.values(proof.comparison).every(Boolean));assert.equal(createHash('sha256').update(readFileSync(join(root,'authoritative.dump'))).digest('hex'),proof.backupSha256);
  const retirement=JSON.parse(readFileSync(join(BACKUP,'consolidated-preparation/sui-retirement-proof.json')));assert.ok(retirement.olderBinaryLockDenied&&retirement.modernReadDenied&&retirement.sourceUnchanged);
  for(let i=0;i<services.length;i++){const{s,deploy}=await detail(services[i]);assert.equal(deploy.commit.id,expected[i]);state.services[services[i]]={revision:deploy.commit.id,originalService:s};}
  state.candidateSha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();state.backup=root;state.phase='quiescing';save();
  for(const id of services){const{s}=await detail(id);if(s.suspended!=='suspended')await api('POST','/services/'+id+'/suspend');assert.equal((await detail(id)).s.suspended,'suspended');state.services[id].quiesced=true;save();console.log(JSON.stringify({service:id,suspended:true}));}
  const url=readFileSync(join(BACKUP,'neon-authoritative-app-url'),'utf8');assert.equal(new URL(url).hostname,'ep-young-recipe-b3jx46ll.c-4.ap-southeast-1.aws.neon.tech');const db=await connect(url);
  try{const status=(await db.query("SELECT (SELECT count(*) FROM jobs WHERE status IN ('pending','claimed'))::int AS jobs,(SELECT count(*) FROM purchases WHERE state NOT IN ('succeeded','failed','expired'))::int AS purchases,(SELECT count(*) FROM funding_attempts WHERE status='pending')::int AS funding,(SELECT count(*) FROM execution_attempts WHERE status IN ('started','unknown'))::int AS merchants,(SELECT count(*) FROM payment_handoffs WHERE status='running')::int AS handoffs")).rows[0];assert.ok(Object.values(status).every(x=>x===0));state.quiescence=status;}finally{await db.end();}
  state.phase='quiesced';save();console.log(JSON.stringify({phase:state.phase,quiescence:state.quiescence,next:'fresh final Neon backup/restore, then approved credential fencing and disabled migration/provisioning'}));
 }
}catch(e){privateWrite(join(BACKUP,'consolidated-failure-'+Date.now()+'.json'),JSON.stringify({message:e.message,code:e.code,stack:e.stack}));console.error('Consolidated cutover assertion failed; no automatic rollback; inspect protected state');process.exitCode=1;}
