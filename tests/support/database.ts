import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterEach } from 'vitest';
import { Db } from '../../src/infrastructure/db.js';

export const testDatabaseUrl = process.env.DATABASE_URL ?? 'postgresql://origins:origins_local_only@127.0.0.1:55432/origins';
const databases = new Set<Db>();
const schemas = new Set<string>();
export const newTestSchema = () => `test_${randomUUID().replaceAll('-', '')}`;

/** One schema per fixture, reused explicitly for restart. No shared reset/truncate. */
export async function createTestDb(schema = newTestSchema()): Promise<Db> {
  if (!/^test_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid test schema');
  const admin = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [2048999]);
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    await client.query('COMMIT');
  } finally {
    client.release();
    await admin.end();
  }
  schemas.add(schema);
  const db = new Db(testDatabaseUrl, schema);
  databases.add(db);
  await db.initialize();
  return db;
}

/** Simulate process loss by severing only this fixture pool's server sessions and session locks. */
export async function crashTestDb(db: Db): Promise<void> {
  if (!databases.has(db)) throw new Error('cannot terminate an unowned database pool');
  const admin = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  try {
    await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1', [db.connectionName]);
  } finally {
    await admin.end();
  }
}

afterEach(async () => {
  for (const db of databases) await db.close();
  databases.clear();
  const admin = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  try {
    for (const schema of schemas) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    schemas.clear();
  } finally {
    await admin.end();
  }
});
