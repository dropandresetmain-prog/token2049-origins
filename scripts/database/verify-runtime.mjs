import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Db } from '../../src/infrastructure/db.ts';
import { BACKUP, connect, privateWrite } from './migration-tools.mjs';
const url=readFileSync(BACKUP+'/neon-validation-app-url','utf8'),admin=await connect(url);
const schema='test_'+randomUUID().replaceAll('-',''),a=new Db(url,schema),b=new Db(url,schema);
const checks=[];
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
try{
 await admin.query(`CREATE SCHEMA "${schema}"`); await admin.query(`CREATE TABLE "${schema}".probe(id text PRIMARY KEY,value int NOT NULL)`);
 checks.push('verified-native-pg-tls');
 const held=deferred(),release=deferred();const key='neon-test:'+schema;
 const owner=a.withExclusiveLock(key,async()=>{held.resolve();await release.promise;return 1;});await held.promise;
 assert.equal((await b.withExclusiveLock(key,()=>{throw Error('competing signer entered');})).acquired,false);release.resolve();assert.equal((await owner).acquired,true);
 assert.equal((await b.withExclusiveLock(key,async()=>1)).acquired,true);checks.push('session-lock-contention-release');
 await assert.rejects(a.tx(async()=>{await a.run("INSERT INTO probe VALUES ('rollback',1)");throw Error('abort');}));assert.equal(await b.get("SELECT id FROM probe WHERE id='rollback'"),undefined);
 await a.tx(async()=>{await a.run("INSERT INTO probe VALUES ('outer',1)");await assert.rejects(a.tx(async()=>{await a.run("INSERT INTO probe VALUES ('inner',2)");throw Error('savepoint');}));await a.tx(()=>a.run("INSERT INTO probe VALUES ('nested',3)"));});
 assert.deepEqual((await b.all('SELECT id FROM probe ORDER BY id')).map(x=>x.id),['nested','outer']);checks.push('rollback-nested-savepoints');
 let notify=[];await a.tx(async()=>{a.afterCommit(()=>notify.push('outer'));await assert.rejects(a.tx(()=>{a.afterCommit(()=>notify.push('aborted'));throw Error('abort');}));assert.deepEqual(notify,[]);});assert.deepEqual(notify,['outer']);checks.push('after-commit-savepoint-notifications');
 const entered=deferred(),resume=deferred();let pid;
 const interrupted=a.withExclusiveLock(key,async()=>{pid=(await a.get('SELECT pg_backend_pid() AS pid')).pid;entered.resolve();await resume.promise;await a.get('SELECT 1');});
 await entered.promise;await admin.query('SELECT pg_terminate_backend($1)',[pid]);resume.resolve();await assert.rejects(interrupted);assert.equal((await b.withExclusiveLock(key,async()=>1)).acquired,true);checks.push('interruption-fails-held-session-reacquire');
 const contender=deferred(),unblock=deferred();const locked=a.tx(async()=>{await a.get("SELECT * FROM probe WHERE id='outer' FOR UPDATE");contender.resolve();await unblock.promise;},false);
 await contender.promise;const blocked=await b.tx(()=>b.get("SELECT * FROM probe WHERE id='outer' FOR UPDATE SKIP LOCKED"),false);assert.equal(blocked,undefined);unblock.resolve();await locked;checks.push('row-lock-skip-locked');
 const racers=await Promise.all([a,b].map(db=>db.tx(()=>db.run("INSERT INTO probe VALUES ('once',4) ON CONFLICT DO NOTHING"),false)));assert.equal(racers.reduce((n,x)=>n+x.changes,0),1);checks.push('concurrent-idempotent-insert');
 console.log(JSON.stringify({nativeNeonRuntimeVerified:true,checks}));privateWrite(BACKUP+'/native-runtime-'+Date.now()+'.json',JSON.stringify({checks,verifiedAt:new Date().toISOString()}));
}finally{await Promise.all([a.close(),b.close()]);await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
