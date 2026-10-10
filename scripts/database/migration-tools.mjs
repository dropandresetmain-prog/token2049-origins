import { mkdirSync, writeFileSync, openSync, closeSync, fsyncSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { getCACertificates } from 'node:tls';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { SolanaLedger } from '../../clients/solana/ledger.ts';
import { api, configureRenderAccess, resolveRenderKey } from '../provision-hosted-mcp-render.mjs';

export const SOURCE = 'dpg-db29mujncjis73dtvf70-a';
export const BACKUP = 'C:/Users/sethl/.capsule/neon-migration-20261011';
const qi = s => '"' + s.replaceAll('"', '""') + '"';
const hash = data => createHash('sha256').update(data).digest('hex');
export function protect(root) {
  if (!root || !resolve(root).replaceAll('\\', '/').startsWith('C:/Users/sethl/.capsule/')) throw new Error('Private migration directory required');
  SolanaLedger.protectDirectory(root);
}
export function privateWrite(file, value) {
  const fd = openSync(file, 'wx', 0o600);
  try { writeFileSync(fd, value); fsyncSync(fd); } finally { closeSync(fd); }
}
export function directTls(value) {
  const u = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || u.hostname.includes('-pooler')) throw new Error('Direct PostgreSQL required');
  u.searchParams.set('sslmode', 'verify-full');
  u.searchParams.delete('uselibpqcompat');
  return u.toString();
}
export async function connect(value) {
  const client = new pg.Client({ connectionString: directTls(value), connectionTimeoutMillis: 20000, application_name: 'capsule-migration-readonly' });
  await client.connect();
  if (!client.connection.stream.encrypted || !client.connection.stream.authorized) { await client.end(); throw new Error('Verified TLS required'); }
  return client;
}
export async function inventory(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    const info = (await client.query("SELECT version(), pg_database_size(current_database())::text AS bytes, current_database() AS database, current_user AS role, current_setting('max_connections') AS max_connections")).rows[0];
    const catalogs = {};
    const statements = {
      schemas: `SELECT nspname, pg_get_userbyid(nspowner) AS owner, nspacl::text AS acl FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname`,
      extensions: 'SELECT extname, extversion FROM pg_extension ORDER BY extname',
      roles: `SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls, rolconfig FROM pg_roles ORDER BY rolname`,
      memberships: `SELECT pg_get_userbyid(roleid) AS role, pg_get_userbyid(member) AS member, admin_option FROM pg_auth_members ORDER BY 1,2`,
      objects: `SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind, pg_get_userbyid(c.relowner) AS owner, c.relacl::text AS acl, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' ORDER BY 1,2`,
      functions: `SELECT n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args, pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS security_definer, p.proacl::text AS acl, pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND p.prokind IN ('f','p') ORDER BY 1,2,3`,
      indexes: `SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes WHERE schemaname NOT LIKE 'pg_%' AND schemaname <> 'information_schema' ORDER BY 1,2,3`,
      constraints: `SELECT n.nspname AS schema,c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' ORDER BY 1,2,3`,
      triggers: `SELECT n.nspname AS schema,c.relname AS table_name,t.tgname,pg_get_triggerdef(t.oid) AS definition,t.tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' ORDER BY 1,2,3`,
      policies: `SELECT * FROM pg_policies WHERE schemaname NOT LIKE 'pg_%' ORDER BY schemaname,tablename,policyname`,
      default_acls: `SELECT pg_get_userbyid(defaclrole) AS role, COALESCE(n.nspname,'') AS schema,defaclobjtype AS kind,defaclacl::text AS acl FROM pg_default_acl a LEFT JOIN pg_namespace n ON n.oid=a.defaclnamespace ORDER BY 1,2,3`,
      sequences: `SELECT schemaname,sequencename,sequenceowner,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value::text FROM pg_sequences WHERE schemaname NOT LIKE 'pg_%' ORDER BY 1,2`,
      unsupported: `SELECT (SELECT count(*) FROM pg_largeobject_metadata)::text AS large_objects, (SELECT count(*) FROM pg_foreign_table)::text AS foreign_tables, (SELECT count(*) FROM pg_publication)::text AS publications, (SELECT count(*) FROM pg_subscription)::text AS subscriptions`,
      sessions: `SELECT application_name,state,usename,backend_type FROM pg_stat_activity WHERE datname=current_database() ORDER BY 1,2,3,4`,
    };
    for (const [name, sql] of Object.entries(statements)) { try { catalogs[name] = (await client.query(sql)).rows; } catch(error) { throw new Error('Inventory ' + name + ' failed (' + (error.code || 'unknown') + ')', { cause:error }); } }
    const tables = {};
    for (const table of catalogs.objects.filter(o => o.kind === 'r' || o.kind === 'p')) {
      const name = `${qi(table.schema)}.${qi(table.name)}`, digest = createHash('sha256');
      // Hash canonical textual rows in byte ordering; fetch bounded pages rather than retaining private records in memory.
      await client.query(`DECLARE migration_rows NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS row FROM ${name} t ORDER BY row_to_json(t)::text COLLATE "C"`);
      let count = 0;
      for (;;) {
        const { rows } = await client.query('FETCH 1000 FROM migration_rows');
        if (!rows.length) break;
        for (const { row } of rows) { digest.update(row + '\n'); count++; }
      }
      await client.query('CLOSE migration_rows');
      tables[`${table.schema}.${table.name}`] = { count, sha256: digest.digest('hex') };
    }
    return { snapshot, info, catalogs, tables };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
}
export async function dockerPg(operation, url, root, filename, snapshot) {
  const u = new URL(directTls(url));
  if (!existsSync(join(root, 'ca-certificates.crt'))) privateWrite(join(root, 'ca-certificates.crt'), getCACertificates('default').join('\n'));
  const escape = s => s.replaceAll('\\', '\\\\').replaceAll(':', '\\:');
  const passwordLine = [u.hostname, u.port || '5432', decodeURIComponent(u.pathname.slice(1)), decodeURIComponent(u.username), decodeURIComponent(u.password)].map(escape).join(':') + '\n';
  const flags = operation === 'render-sql' ? ['pg_restore', '-f', '/backup/restore-original.sql', '/backup/' + filename] : operation === 'restore-sql' ? ['psql', '-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', '/backup/' + filename] : operation === 'dump' ? ['pg_dump', '-Fc', '--snapshot=' + snapshot, '-f', '/backup/' + filename] : ['pg_restore', '--exit-on-error', '--single-transaction', '-d', decodeURIComponent(u.pathname.slice(1)), '/backup/' + filename];
  const args = ['run', '--rm', '-i', '--memory=512m', '--cpus=1', '--mount', `type=bind,source=${root},target=/backup`, '-e', `PGHOST=${u.hostname}`, '-e', `PGPORT=${u.port || '5432'}`, '-e', `PGDATABASE=${decodeURIComponent(u.pathname.slice(1))}`, '-e', `PGUSER=${decodeURIComponent(u.username)}`, '-e', 'PGSSLMODE=verify-full', '-e', 'PGSSLROOTCERT=/backup/ca-certificates.crt', 'postgres:18', 'sh', '-c', 'umask 077; cat > /tmp/pgpass; export PGPASSFILE=/tmp/pgpass; exec "$@"', 'pg-tool', ...flags];
  await new Promise((resolvePromise, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let errorText = '';
    child.stderr.on('data', chunk => { errorText += chunk.toString(); });
    child.on('error', () => reject(new Error('PostgreSQL tool could not start')));
    child.on('close', code => {
      if (errorText) privateWrite(join(root, filename + '.' + operation + '-' + Date.now() + '.stderr'), errorText);
      code === 0 ? resolvePromise() : reject(new Error(`PostgreSQL ${operation} failed; protected diagnostic retained`));
    });
    child.stdin.end(passwordLine);
  });
}
export async function withSourceAccess(root, fn, renderApi = api, verifyIp = publicIp) {
  const { data: before } = await renderApi('GET', `/postgres/${SOURCE}`);
  const original = before.ipAllowList;
  if (!Array.isArray(original) || original.some(x => x.cidrBlock === '0.0.0.0/0')) throw new Error('Unexpected original access policy');
  const journal = join(root, 'allowlist-' + Date.now() + '.json');
  privateWrite(journal, JSON.stringify({ source: SOURCE, original }, null, 2));
  const ip = await verifyIp();
  try {
    await renderApi('PATCH', `/postgres/${SOURCE}`, { ipAllowList: [...original, { cidrBlock: ip + '/32', description: 'capsule bounded migration export' }] });
    const { data: active } = await renderApi('GET', `/postgres/${SOURCE}`);
    if (!active.ipAllowList.some(x => x.cidrBlock === ip + '/32')) throw new Error('Exact-IP access did not apply');
    return await fn();
  } finally {
    await renderApi('PATCH', `/postgres/${SOURCE}`, { ipAllowList: original });
    const { data: after } = await renderApi('GET', `/postgres/${SOURCE}`);
    if (JSON.stringify(after.ipAllowList) !== JSON.stringify(original)) throw new Error('CRITICAL: original allowlist restoration not verified');
    console.log(JSON.stringify({ originalAllowlistRestored: true }));
  }
}
async function publicIp() {
  const values = await Promise.all(['https://api.ipify.org', 'https://checkip.amazonaws.com'].map(async url => (await fetch(url, { signal: AbortSignal.timeout(15000) })).text()));
  const [a, b] = values.map(x => x.trim());
  if (a !== b || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(a) || a.split('.').some(x => Number(x) > 255) || /^(127|10|0)\./.test(a)) throw new Error('Public IPv4 verification failed');
  return a;
}
async function main() {
  const [command, ...extra] = process.argv.slice(2);
  if (!['receive-target', 'receive-authoritative', 'export', 'export-final', 'restore-access'].includes(command) || extra.length) throw new Error('Explicit migration command required');
  protect(BACKUP);
  if (command === 'receive-target' || command === 'receive-authoritative') {
    if (process.stdin.isTTY) process.stdin.setRawMode(true); const keepAlive = setInterval(() => {}, 1000); const reader = createInterface({ input: process.stdin });
    const input = await new Promise(resolveLine => reader.once('line', resolveLine)); reader.close(); process.stdin.destroy(); clearInterval(keepAlive);
    const data = JSON.parse(input), values = (data.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
    const url = values.match(/postgres(?:ql)?:\/\/[^\s"\\]+/)?.[0];
    if (!url) throw new Error('No connection received');
    privateWrite(join(BACKUP, command === 'receive-target' ? 'neon-validation-url' : 'neon-authoritative-url'), directTls(url));
    console.log(JSON.stringify({ protectedTargetStored: true })); return;
  }
  configureRenderAccess({ key: resolveRenderKey(), dryRun: false });
  if (command === 'restore-access') {
    const fs = await import('node:fs');
    const roots = fs.readdirSync(BACKUP).filter(x => /^(initial|final)-\d+$/.test(x));
    const journals = roots.flatMap(x => fs.readdirSync(join(BACKUP,x)).filter(f=> /^allowlist-\d+\.json$/.test(f)).map(f=>join(x,f))).sort();
    if (!journals.length) throw new Error('Access snapshot missing');
    const { original, source } = JSON.parse(readFileSync(join(BACKUP, journals.at(-1)), 'utf8'));
    if (source !== SOURCE || JSON.stringify(original) !== '[{"cidrBlock":"127.0.0.1/32","description":"external-access-disabled"}]') throw new Error('Access journal conflict');
    await api('PATCH', `/postgres/${SOURCE}`, { ipAllowList: original });
    const { data } = await api('GET', `/postgres/${SOURCE}`);
    if (JSON.stringify(data.ipAllowList) !== JSON.stringify(original)) throw new Error('Access restoration mismatch');
    console.log(JSON.stringify({ originalAllowlistRestored: true })); return;
  }
  if (command === 'export-final') {
    for (const id of ['srv-db2jgqnavr4c73e9blrg','srv-db2mnk1srm7s73c1f5c0','srv-db35psid0e5s73f7ltng']) { const {data}=await api('GET','/services/'+id); if(data.suspended!=='suspended') throw new Error('All source writers must be suspended before final export'); }
  }
  const label = (command === 'export-final' ? 'final-' : 'initial-') + Date.now(), root = join(BACKUP, label); protect(root);
  await withSourceAccess(root, async () => {
    const { data } = await api('GET', `/postgres/${SOURCE}/connection-info`);
    const url = directTls(data.externalConnectionString);
    const client = await connect(url);
    try {
      const inv = await inventory(client);
      if(command==='export-final') {
        const status=(await client.query("SELECT (SELECT count(*) FROM jobs WHERE status IN ('pending','claimed'))::int AS jobs, (SELECT count(*) FROM purchases WHERE state NOT IN ('succeeded','failed','expired'))::int AS purchases, (SELECT count(*) FROM funding_attempts WHERE status='pending')::int AS funding, (SELECT count(*) FROM execution_attempts WHERE status IN ('started','unknown'))::int AS merchant_attempts, (SELECT count(*) FROM payment_handoffs WHERE status='running')::int AS handoffs, (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid())::int AS other_sessions")).rows[0];
        if(Object.values(status).some(n=>n!==0)) throw new Error('Final snapshot has active or uncertain obligations; reconcile before cutover');
        privateWrite(join(root,'quiescence.json'),JSON.stringify({status,verifiedAt:new Date().toISOString()}));
      }
      privateWrite(join(root, 'inventory.json'), JSON.stringify(inv, null, 2));
      privateWrite(join(root, 'source-url'), url);
      if (Number(inv.info.bytes) > 900000000) throw new Error('Source exceeds conservative Free target budget');
      await dockerPg('dump', url, root, 'source.dump', inv.snapshot);
      await client.query('ROLLBACK');
      const checksum = hash(readFileSync(join(root, 'source.dump')));
      privateWrite(join(root, 'backup-checksum.json'), JSON.stringify({ sha256: checksum, created: new Date().toISOString() }));
      console.log(JSON.stringify({ snapshot: label, backupSha256: checksum, sourceBytes: inv.info.bytes, tables: Object.keys(inv.tables).length, rows: Object.values(inv.tables).reduce((sum,x) => sum + x.count, 0), unsupported: inv.catalogs.unsupported }));
    } finally { await client.end(); }
  });
}



if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main().catch(error => { privateWrite(join(BACKUP, "failure-" + Date.now() + ".json"), JSON.stringify({message:error.message,code:error.code,stack:error.stack,cause:error.cause?.message})); console.error("Migration operation failed; no credentials printed. Inspect protected diagnostics and restore-access if necessary."); process.exitCode = 1; });
