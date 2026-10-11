import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import pg from 'pg';
import {BACKUP,protect,privateWrite,connect,inventory,dockerPg} from '../database/migration-tools.mjs';
// A consistent live backup is read-only. Restore writes only a newly named database in this project's disposable PG18 container.
const host='ep-young-recipe-b3jx46ll.c-4.ap-southeast-1.aws.neon.tech';
const container='capsule-consolidated-payer-tests';
if(process.argv.length!==3||process.argv[2]!=='--snapshot-and-rehearse'){
 console.log(JSON.stringify({planOnly:true,authoritativeHost:host,localContainer:container,signing:false,merchantWrites:false}));process.exit(0);
}
const root=join(BACKUP,'consolidation-'+Date.now());protect(root);
const qi=s=>'"'+s.replaceAll('"','""')+'"';
const docker=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],maxBuffer:16*1024*1024});
let remote,local,admin;
try {
 const url=readFileSync(join(BACKUP,'neon-authoritative-app-url'),'utf8');assert.equal(new URL(url).hostname,host);
 remote=await connect(url);const source=await inventory(remote);assert.match(source.info.version,/PostgreSQL 18\./);
 privateWrite(join(root,'inventory.json'),JSON.stringify(source));
 await dockerPg('dump',url,root,'authoritative.dump',source.snapshot);
 await remote.query('ROLLBACK');await remote.end();remote=undefined;
 const checksum=createHash('sha256').update(readFileSync(join(root,'authoritative.dump'))).digest('hex');
 privateWrite(join(root,'backup-checksum.json'),JSON.stringify({sha256:checksum,created:new Date().toISOString()}));
 const inspect=JSON.parse(docker(['inspect',container]))[0];assert.equal(inspect.Config.Image,'postgres:18');
 assert.equal(inspect.NetworkSettings.Ports['5432/tcp'][0].HostIp,'127.0.0.1');assert.equal(inspect.NetworkSettings.Ports['5432/tcp'][0].HostPort,'55436');
 const env=Object.fromEntries(inspect.Config.Env.map(v=>{const i=v.indexOf('=');return[v.slice(0,i),v.slice(i+1)];}));
 const localConfig={host:'127.0.0.1',port:55436,user:env.POSTGRES_USER||'postgres',password:env.POSTGRES_PASSWORD,database:env.POSTGRES_DB||env.POSTGRES_USER||'postgres',application_name:'capsule-disposable-restore'};
 admin=new pg.Client(localConfig);await admin.connect();assert.match((await admin.query('SELECT version() AS v')).rows[0].v,/PostgreSQL 18\./);
 const appRole=source.catalogs.roles.find(r=>r.rolname===source.info.role);assert.ok(appRole&&!appRole.rolsuper&&!appRole.rolbypassrls&&!appRole.rolreplication);
 const requiredRoles=new Set([appRole.rolname,...source.catalogs.default_acls.map(x=>x.role)]);
 // Neon can add platform-owned defaults after endpoint startup. Retain their ACLs in the disposable restore,
 // using inert NOLOGIN placeholders, never copying platform superuser, replication or bypass privileges.
 for(const acl of source.catalogs.default_acls.filter(x=>x.role==='cloud_admin')){
  assert.equal(acl.schema,'public');assert.ok(['r','S'].includes(acl.kind));
  assert.equal(acl.acl,acl.kind==='S'?'{neon_superuser=r*w*U*/cloud_admin}':'{neon_superuser=a*r*w*d*D*m*/cloud_admin}');
  requiredRoles.add('neon_superuser');
 }
 for(const role of requiredRoles){
  assert.match(role,/^(token2049_origins_db_user|capsule_owner|cloud_admin|neon_superuser)$/);
  if(!(await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount){
   const r=role===appRole.rolname?appRole:{rolcreatedb:false,rolcreaterole:false,rolcanlogin:false};
   await admin.query(`CREATE ROLE ${qi(role)} ${r.rolcanlogin?'LOGIN':'NOLOGIN'} ${r.rolcreatedb?'CREATEDB':'NOCREATEDB'} ${r.rolcreaterole?'CREATEROLE':'NOCREATEROLE'} NOSUPERUSER NOBYPASSRLS NOREPLICATION`);
  }
 }
 const database='capsule_restore_'+randomUUID().replaceAll('-','');await admin.query(`CREATE DATABASE ${qi(database)} TEMPLATE template0 OWNER ${qi(appRole.rolname)}`);
 privateWrite(join(root,'disposable-target.json'),JSON.stringify({container,database}));
 const targetPath='/tmp/'+database+'.dump';docker(['cp',join(root,'authoritative.dump'),container+':'+targetPath]);
 docker(['exec',container,'pg_restore','--exit-on-error','--single-transaction','-U',localConfig.user,'-d',database,targetPath]);
 local=new pg.Client({...localConfig,database});await local.connect();
 const target=await inventory(local);await local.query('ROLLBACK');
 privateWrite(join(root,'restored-inventory.json'),JSON.stringify(target));
 const comparison={tables:JSON.stringify(source.tables)===JSON.stringify(target.tables)};
 for(const key of ['schemas','extensions','objects','functions','indexes','constraints','triggers','policies','sequences'])comparison[key]=JSON.stringify(source.catalogs[key])===JSON.stringify(target.catalogs[key]);
 // PostgreSQL may reorder ACL array entries on restore; compare the complete grant sets, including grantors.
 const canonicalAcls=rows=>rows.map(x=>({...x,acl:x.acl.slice(1,-1).split(',').sort()}));
 comparison.default_acls=JSON.stringify(canonicalAcls(source.catalogs.default_acls))===JSON.stringify(canonicalAcls(target.catalogs.default_acls));
 for(const role of ['cloud_admin','neon_superuser'].filter(r=>requiredRoles.has(r))){
  const r=target.catalogs.roles.find(x=>x.rolname===role);
  assert.ok(r&&!r.rolsuper&&!r.rolcanlogin&&!r.rolcreaterole&&!r.rolcreatedb&&!r.rolreplication&&!r.rolbypassrls,'platform restore role must remain inert');
 }
 comparison.appRole=JSON.stringify(appRole)===JSON.stringify(target.catalogs.roles.find(r=>r.rolname===appRole.rolname));
 const proof={comparison,backupSha256:checksum,version:target.info.version,created:new Date().toISOString(),tables:Object.keys(source.tables).length,rows:Object.values(source.tables).reduce((n,x)=>n+x.count,0)};
 privateWrite(join(root,'restore-verification.json'),JSON.stringify(proof));assert.ok(Object.values(comparison).every(Boolean),'Full restore comparison failed');
 console.log(JSON.stringify({backupAndRestoreVerified:true,root, ...proof}));
}catch(error){privateWrite(join(root,'failure.json'),JSON.stringify({message:error.message,code:error.code,stack:error.stack,stderr:error.stderr?.toString()}));console.error('Backup/restore assertion failed; protected diagnostics retained, authoritative database unchanged');process.exitCode=1;}
finally{for(const c of [remote,local,admin])if(c)await c.end().catch(()=>{});}
