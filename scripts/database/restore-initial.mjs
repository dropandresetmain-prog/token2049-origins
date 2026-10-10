import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { BACKUP, protect, privateWrite, connect, inventory, dockerPg } from './migration-tools.mjs';
if (process.argv.length !== 3 || process.argv[2] !== '--apply-isolated') { console.log(JSON.stringify({planOnly:true,target:'Neon migration-validation',action:'complete atomic initial restore',requiredFlag:'--apply-isolated'})); process.exit(0); }
const root = join(BACKUP, readdirSync(BACKUP).filter(n=>n.startsWith('initial-') && readdirSync(join(BACKUP,n)).includes('backup-checksum.json')).sort().at(-1));
const source = JSON.parse(readFileSync(join(root,'inventory.json'),'utf8'));
const adminUrl = readFileSync(join(BACKUP,'neon-validation-url'),'utf8');
assert.equal(new URL(adminUrl).hostname,"ep-summer-heart-b361hnom.c-4.ap-southeast-1.aws.neon.tech",'Wrong isolated migration target');
assert.equal(createHash('sha256').update(readFileSync(join(root,'source.dump'))).digest('hex'),JSON.parse(readFileSync(join(root,'backup-checksum.json'),'utf8')).sha256,'Backup integrity mismatch');
const client = await connect(adminUrl);
try {
  const info = (await client.query("SELECT version(),current_user,current_database(),current_setting('max_connections') AS max_connections")).rows[0];
  const objects = await client.query("SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')");
  assert.equal(objects.rows[0].count,0,'Target must be empty');
  assert.match(info.version,/PostgreSQL 18\./);
  assert.deepEqual([...new Set(source.catalogs.objects.map(x=>x.owner))],[source.info.role]);
  const role=source.catalogs.roles.find(x=>x.rolname===source.info.role);
  assert.equal(role.rolsuper,false); assert.equal(role.rolbypassrls,false); assert.equal(role.rolreplication,false); assert.equal(role.rolconfig,null);
  const quote = x => '"'+x.replaceAll('"','""')+'"';
  const credentialFile=join(BACKUP,'neon-validation-app-url');
  let u;
  const found=(await client.query('SELECT rolname,rolsuper,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconfig FROM pg_roles WHERE rolname=$1',[role.rolname])).rows[0];
  if (found) { assert.deepEqual(found,role); assert.ok(existsSync(credentialFile),'Existing migration role needs retained credential');u=new URL(readFileSync(credentialFile,'utf8'));assert.equal(decodeURIComponent(u.username),role.rolname); }
  else {
    const password=randomBytes(32).toString('hex');u=new URL(adminUrl);u.username=role.rolname;u.password=password;
    privateWrite(credentialFile,u.toString());
    await client.query(`CREATE ROLE ${quote(role.rolname)} LOGIN ${role.rolcreatedb?'CREATEDB':'NOCREATEDB'} ${role.rolcreaterole?'CREATEROLE':'NOCREATEROLE'} NOSUPERUSER NOBYPASSRLS NOREPLICATION PASSWORD '${password}'`);
  }
  // Restore runs as the Neon administrator, which must inherit the imported owner's schema rights.
  const inherited=(await client.query("SELECT pg_has_role(current_user,$1,'USAGE') AS ok",[role.rolname])).rows[0].ok;
  if(!inherited) await client.query(`GRANT ${quote(role.rolname)} TO ${quote(info.current_user)} WITH INHERIT TRUE, SET TRUE`);
  await client.end();
  await dockerPg('render-sql',adminUrl,root,'source.dump');
  const originalSql=readFileSync(join(root,'restore-original.sql'),'utf8');
  const aclLines=originalSql.split('\n').filter(line=>line.startsWith('ALTER DEFAULT PRIVILEGES'));
  assert.equal(aclLines.length,4);
  for(const line of aclLines) assert.match(line,/^ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL ON (TABLES|SEQUENCES|FUNCTIONS|TYPES) TO token2049_origins_db_user;$/);
  // Render's managed superuser is absent on Neon. Map only its four future-object grants to the Neon administrator.
  const mappedSql=originalSql.replace(/^ALTER DEFAULT PRIVILEGES FOR ROLE postgres /gm,()=> 'ALTER DEFAULT PRIVILEGES FOR ROLE '+quote(info.current_user)+' ');
  if(existsSync(join(root,'restore-mapped.sql'))) assert.equal(readFileSync(join(root,'restore-mapped.sql'),'utf8'),mappedSql,'Recovery derived SQL mismatch');
  else privateWrite(join(root,'restore-mapped.sql'),mappedSql);
  if(!existsSync(join(root,'role-mapping.json'))) privateWrite(join(root,'role-mapping.json'),JSON.stringify({sourceManagedRole:'postgres',targetManagedRole:info.current_user,statements:aclLines,derivedSqlSha256:createHash('sha256').update(mappedSql).digest('hex')},null,2));
  await dockerPg('restore-sql',adminUrl,root,'restore-mapped.sql');
  const ownerAdmin=await connect(adminUrl);
  await ownerAdmin.query(`ALTER DATABASE ${quote(info.current_database)} OWNER TO ${quote(role.rolname)}`);
  await ownerAdmin.end();
  const restored=await connect(u.toString());
  const target=await inventory(restored);await restored.query('ROLLBACK');await restored.end();
  privateWrite(join(root,'target-inventory.json'),JSON.stringify(target,null,2));
  const comparison={tables:JSON.stringify(source.tables)===JSON.stringify(target.tables)};
  for(const key of ['schemas','extensions','objects','functions','indexes','constraints','triggers','policies','sequences'])comparison[key]=JSON.stringify(source.catalogs[key])===JSON.stringify(target.catalogs[key]);
  const restoredRole=target.catalogs.roles.find(x=>x.rolname===role.rolname);comparison.appRole=JSON.stringify(role)===JSON.stringify(restoredRole);
  privateWrite(join(root,'restore-verification.json'),JSON.stringify({comparison,targetVersion:target.info.version,sourceBytes:source.info.bytes,targetBytes:target.info.bytes,maxConnections:target.info.max_connections},null,2));
  assert.ok(Object.values(comparison).every(Boolean),'Complete restore mismatch');
  console.log(JSON.stringify({restoreVerified:true,comparison,version:target.info.version,maxConnections:target.info.max_connections,sourceBytes:source.info.bytes,targetBytes:target.info.bytes,tables:Object.keys(source.tables).length,rows:Object.values(source.tables).reduce((n,x)=>n+x.count,0)}));
} catch(error) {
  await client.end().catch(()=>{});
  privateWrite(join(root,'restore-failure-'+Date.now()+'.json'),JSON.stringify({message:error.message,code:error.code,stack:error.stack}));
  console.error(JSON.stringify({restoreVerified:false,errorCode:error.code || 'protected-diagnostic'}));process.exitCode=1;
}
