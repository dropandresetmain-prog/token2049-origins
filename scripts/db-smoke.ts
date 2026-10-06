/** Non-sensitive PostgreSQL probe; optionally starts the compiled gateway twice on loopback. */
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { Pool } from 'pg';
import { Db } from '../src/infrastructure/db.js';
import { loadCoreEnv } from '../src/infrastructure/config.js';
import { createClient } from '../src/infrastructure/auth.js';

async function smoke(): Promise<void> {
  const url = loadCoreEnv().DATABASE_URL;
  const admin = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
  const schema = `smoke_${randomUUID().replaceAll('-', '')}`;
  let db: Db | undefined;
  let child: ChildProcess | undefined;
  const stop = async () => {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    child = undefined;
  };
  try {
    const version = await admin.query<{ version: string }>("SELECT current_setting('server_version') AS version");
    process.stdout.write(`Authenticated PostgreSQL connection: ${version.rows[0]?.version}\n`);
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = new Db(url, schema);
    await db.initialize();
    const client = await createClient(db, { displayName: 'Non-sensitive migration probe', channel: 'test', label: 'probe', scopes: ['evidence:read'] }, new Date().toISOString());
    await db.close();
    db = new Db(url, schema);
    await db.initialize();
    if (!(await db.get('SELECT id FROM customers WHERE id = $1', client.customerId))) throw new Error('restart persistence probe failed');
    process.stdout.write('Isolated application write/read, pool restart, migration rerun: PASS\n');

    if (!process.argv.includes('--database-only')) {
      const socket = createServer();
      socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
      const port = (socket.address() as { port: number }).port;
      await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
      const scopedUrl = new URL(url);
      scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
      for (let restart = 0; restart < 2; restart++) {
        child = spawn(process.execPath, ['dist/src/main.js'], {
          stdio: 'ignore',
          env: {
            PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
            APP_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
            DATABASE_URL: scopedUrl.toString(), WORKER_INTERVAL_MS: '100',
          },
        });
        const base = `http://127.0.0.1:${port}`;
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          if (child.exitCode !== null) throw new Error('compiled gateway exited before health');
          try { ready = (await fetch(`${base}/health`)).status === 200; } catch { /* Startup is asynchronous. */ }
          if (ready) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!ready) throw new Error('compiled gateway health timed out');
        for (const path of ['/v1/capabilities', '/inspect', '/proof', '/proof/app.js']) {
          if ((await fetch(base + path)).status !== 200) throw new Error('public gateway smoke failed');
        }
        if ((await fetch(`${base}/v1/evidence/purchases`)).status !== 401) throw new Error('anonymous auth guard failed');
        if ((await fetch(`${base}/v1/evidence/purchases`, { headers: { authorization: `Bearer ${client.token}` } })).status !== 200) throw new Error('persisted client auth failed');
        await stop();
      }
      process.stdout.write('Compiled gateway health/auth and process restart persistence: PASS\n');
    }
  } finally {
    await stop();
    await db?.close();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}

try {
  await smoke();
} catch {
  // Raw upstream messages/connection configuration never belong in a public verification log.
  process.stderr.write('PostgreSQL smoke failed; inspect connectivity/configuration privately\n');
  process.exitCode = 1;
}
