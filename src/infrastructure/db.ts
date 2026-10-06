import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { migrate } from './migrations.js';

export type SqlValue = string | number | bigint | boolean | null;
export type Row = Record<string, SqlValue>;
const CORE_WRITE_LOCK = 2049001;

/** Each async transaction owns one connection and nested savepoints. */
export class Db {
  readonly connectionName = `origins_${process.pid}_${randomUUID()}`;
  private readonly pool: Pool;
  private readonly context = new AsyncLocalStorage<{ client: PoolClient; depth: number }>();
  private closing: Promise<void> | undefined;

  constructor(databaseUrl: string, schema = 'public') {
    if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new Error('DATABASE_URL must be a PostgreSQL URL');
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('invalid database schema');
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      application_name: this.connectionName,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      options: `-c search_path=${schema} -c statement_timeout=30000 -c idle_in_transaction_session_timeout=30000`,
    });
    // Handle idle connection failures without leaking connection credentials.
    this.pool.on('error', () => process.stderr.write('PostgreSQL idle connection failed\n'));
  }

  async initialize(): Promise<void> {
    await migrate(this.pool);
  }

  async all<T = Row>(sql: string, ...params: SqlValue[]): Promise<T[]> {
    const query = this.context.getStore()?.client ?? this.pool;
    return (await query.query(sql, params)).rows as T[];
  }

  async get<T = Row>(sql: string, ...params: SqlValue[]): Promise<T | undefined> {
    return (await this.all<T>(sql, ...params))[0];
  }

  async run(sql: string, ...params: SqlValue[]): Promise<{ changes: number }> {
    const query = this.context.getStore()?.client ?? this.pool;
    return { changes: (await query.query(sql, params)).rowCount ?? 0 };
  }

  /** Session lock spans funding verification without holding a transaction across network I/O. */
  async withExclusiveLock<T>(key: string, fn: () => Promise<T>): Promise<{ acquired: false } | { acquired: true; value: T }> {
    const parent = this.context.getStore();
    // Nested provider preparation locks share the already-owned session, avoiding pool starvation.
    const reuse = parent !== undefined && parent.depth < 0;
    const client = reuse ? parent.client : await this.pool.connect();
    // A server disconnect during external I/O must fail subsequent queries, not crash the process.
    const disconnected = () => undefined;
    client.on('error', disconnected);
    let destroy = false;
    let acquired = false;
    try {
      const result = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired', [key]);
      acquired = result.rows[0]?.acquired === true;
      if (!acquired) return { acquired: false };
      // Queries and transactions reuse this connection, so concurrent funding cannot exhaust
      // the pool with idle lock holders waiting for a second connection.
      const value = await this.context.run({ client, depth: -1 }, fn);
      return { acquired: true, value };
    } finally {
      if (acquired) {
        try {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
        } catch {
          destroy = true;
        }
      }
      if (!reuse) client.release(destroy);
      client.off('error', disconnected);
    }
  }

  /**
   * Serialize short core writes across processes to preserve capacity, event sequence and
   * journal check/write invariants. External calls must stay outside transactions.
   * Job claims opt out and use row locks instead.
   */
  async tx<T>(fn: () => T | Promise<T>, serialize = true): Promise<T> {
    const parent = this.context.getStore();
    if (parent && parent.depth >= 0) {
      const name = `sp_${parent.depth + 1}`;
      await parent.client.query(`SAVEPOINT ${name}`);
      try {
        const result = await this.context.run({ client: parent.client, depth: parent.depth + 1 }, fn);
        await parent.client.query(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await parent.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        await parent.client.query(`RELEASE SAVEPOINT ${name}`);
        throw error;
      }
    }
    const client = parent?.client ?? await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (serialize) await client.query('SELECT pg_advisory_xact_lock($1)', [CORE_WRITE_LOCK]);
      const result = await this.context.run({ client, depth: 0 }, fn);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      if (!parent) client.release();
    }
  }

  async close(): Promise<void> {
    this.closing ??= this.pool.end();
    await this.closing;
  }
}
