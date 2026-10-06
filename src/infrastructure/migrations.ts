import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { Pool } from 'pg';

/** Ordered SQL history is part of the release artifact; applied files may never be changed. */
export async function migrate(pool: Pool): Promise<void> {
  const directory = new URL('../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(name => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  if (!files.length) throw new Error('no database migrations found');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [2049000]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const applied = await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations ORDER BY version');
    for (const row of applied.rows) {
      if (!files.includes(row.version)) throw new Error(`unknown applied database migration ${row.version}`);
    }
    for (const [index, name] of files.entries()) {
      if (Number(name.slice(0, 4)) !== index + 1) throw new Error('database migration history must be contiguous');
      const sql = await readFile(new URL(name, directory), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prior = applied.rows.find(row => row.version === name);
      if (prior) {
        if (prior.checksum !== checksum) throw new Error(`database migration checksum mismatch: ${name}`);
        continue;
      }
      if (applied.rows.some(row => row.version > name)) throw new Error(`out-of-order database migration ${name}`);
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version, checksum) VALUES ($1, $2)', [name, checksum]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
