import { describe, expect, it } from 'vitest';
import { createTestDb, newTestSchema } from '../support/database.js';
import { createFundablePurchase, retailFulfillment, retailIntent, startHarness, type Harness } from '../support/harness.js';
import { seedCapacityPool } from '../../src/core/capacity.js';
import { Accounts, postEntry, trialBalance } from '../../src/core/journal.js';
import { ManualClock } from '../../src/infrastructure/clock.js';
import { loadCoreEnv } from '../../src/infrastructure/config.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function quote(h: Harness) {
  const offers = await h.call('POST', '/v1/offers/search', { token: h.alice.token, body: { intent: retailIntent() } });
  const response = await h.call('POST', '/v1/quotes', { token: h.alice.token, body: { offerId: offers.body.offers[0].offerId, fulfillment: retailFulfillment } });
  expect(response.status).toBe(201);
  const q = response.body.quote;
  return { quoteId: q.quoteId, approval: { maxTotal: q.payablePrincipal, quoteDigest: q.digest, selectedFundingOptionId: q.fundingOptions[0]!.fundingOptionId! } };
}

describe('PostgreSQL persistence and competing connections', () => {
  it('requires a PostgreSQL DATABASE_URL and never accepts a file or missing database', () => {
    for (const value of [undefined, 'file:///tmp/database', 'mysql://localhost/database']) {
      expect(() => loadCoreEnv({ DATABASE_URL: value })).toThrow(/DATABASE_URL/);
    }
  });

  it('migrates an empty schema once, tolerates competing startups, and preserves data on rerun', async () => {
    const schema = newTestSchema();
    const first = await createTestDb(schema);
    await first.run("INSERT INTO customers VALUES ('persisted', 'Migration probe', '2026-10-06T00:00:00.000Z')");
    const [second, third] = await Promise.all([createTestDb(schema), createTestDb(schema)]);
    await Promise.all([first.initialize(), second.initialize(), third.initialize()]);
    expect((await second.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM schema_migrations'))?.n).toBe(9);
    expect((await third.get<{ display_name: string }>("SELECT display_name FROM customers WHERE id = 'persisted'"))?.display_name).toBe('Migration probe');
    await first.run("UPDATE schema_migrations SET checksum = 'tampered'");
    await expect(second.initialize()).rejects.toThrow(/checksum mismatch/);
    expect(await third.get("SELECT id FROM customers WHERE id = 'persisted'")).toBeDefined();
  });

  it('rolls back an aborted transaction and a failed nested savepoint without mixing async contexts', async () => {
    const db = await createTestDb();
    await db.tx(async () => {
      await db.run("INSERT INTO customers VALUES ('outer', 'Outer', 'now')");
      await expect(db.tx(async () => {
        await db.run("INSERT INTO customers VALUES ('inner', 'Inner', 'now')");
        await db.run("INSERT INTO customers VALUES ('outer', 'Duplicate', 'now')");
      })).rejects.toMatchObject({ code: '23505' });
      expect(await db.get("SELECT id FROM customers WHERE id = 'inner'")).toBeUndefined();
    });
    await expect(db.tx(async () => {
      await db.run("INSERT INTO customers VALUES ('aborted', 'Aborted', 'now')");
      throw new Error('abort');
    })).rejects.toThrow('abort');
    await Promise.all(['one', 'two'].map(id => db.tx(async () => {
      await db.run('INSERT INTO customers VALUES ($1, $2, $3)', id, id, 'now');
      await db.tx(() => db.run('UPDATE customers SET display_name = $1 WHERE id = $2', id + '-saved', id));
    })));
    expect((await db.all<{ id: string }>('SELECT id FROM customers ORDER BY id')).map(row => row.id)).toEqual(['one', 'outer', 'two']);
  });

  it('posts one balanced immutable entry across pools and retains amounts above the safe Number range', async () => {
    const schema = newTestSchema();
    const [a, b] = await Promise.all([createTestDb(schema), createTestDb(schema)]);
    const amount = 900719925474099312345678901234567890n;
    const entry = {
      eventKey: 'concurrent-entry', purchaseId: null, kind: 'probe', ledgerMode: 'observed' as const, description: 'Probe',
      lines: [
        { account: Accounts.cryptoTreasury, asset: 'probe/exact', side: 'debit' as const, amount },
        { account: Accounts.customerPrepayment, asset: 'probe/exact', side: 'credit' as const, amount },
      ],
    };
    const posted = await Promise.all([postEntry(a, entry, 'now'), postEntry(b, entry, 'now')]);
    expect(posted.map(row => row.duplicate).sort()).toEqual([false, true]);
    expect((await a.get<{ amount: string }>('SELECT amount FROM journal_lines LIMIT 1'))?.amount).toBe(amount.toString());
    expect([...await trialBalance(a)].every(([, sum]) => sum === 0n)).toBe(true);
    await expect(b.run('DELETE FROM journal_lines')).rejects.toThrow(/immutable/);
    await expect(b.run('TRUNCATE journal_lines')).rejects.toThrow(/immutable/);
    await expect(b.run('TRUNCATE journal_entries CASCADE')).rejects.toThrow(/immutable/);
  });

  it('reuses locked connections when more operations compete than the pool can hold', async () => {
    const db = await createTestDb();
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => db.withExclusiveLock(`${db.connectionName}:${index}`, async () => {
      await db.tx(() => db.run('INSERT INTO customers VALUES ($1, $2, $3)', `pool-${index}`, 'Pool probe', 'now'));
      return index;
    })));
    expect(results.every(result => result.acquired)).toBe(true);
    expect((await db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM customers'))?.n).toBe(8);
  });

  it('completes five simultaneous nested session locks without starving the connection pool', async () => {
    const db = await createTestDb();
    const allOuterLocksHeld = deferred();
    let entered = 0;
    const results = await Promise.all(Array.from({ length:5 }, (_, index) => db.withExclusiveLock(`${db.connectionName}:outer:${index}`, async () => {
      const before = await db.get<{ pid:number }>('SELECT pg_backend_pid() AS pid');
      // Hold all five pool sessions before any callback attempts a second lock.
      if (++entered === 5) allOuterLocksHeld.resolve();
      await allOuterLocksHeld.promise;
      const nested = await db.withExclusiveLock(`${db.connectionName}:inner:${index}`, async () => {
        expect((await db.get<{ pid:number }>('SELECT pg_backend_pid() AS pid'))?.pid).toBe(before!.pid);
        await db.tx(async () => {
          await db.run('INSERT INTO customers VALUES ($1, $2, $3)', `nested-${index}`, 'Nested lock probe', 'now');
          await db.tx(() => db.run('UPDATE customers SET display_name=$1 WHERE id=$2', `saved-${index}`, `nested-${index}`));
        });
        return index;
      });
      expect((await db.get<{ pid:number }>('SELECT pg_backend_pid() AS pid'))?.pid).toBe(before!.pid);
      return nested;
    })));
    expect(results.map(result => result.acquired)).toEqual([true,true,true,true,true]);
    for (const [index,result] of results.entries()) {
      if (!result.acquired) throw new Error('Outer lock unexpectedly unavailable');
      expect(result.value).toEqual({ acquired:true, value:index });
    }
    expect(await db.all<{ id:string; display_name:string }>('SELECT id, display_name FROM customers ORDER BY id')).toEqual(
      Array.from({ length:5 }, (_, index) => ({ id:`nested-${index}`, display_name:`saved-${index}` })),
    );
  });

  it('returns one purchase for concurrent identical buy attempts through two gateways', async () => {
    const schema = newTestSchema();
    const a = await startHarness({ schema });
    const b = await startHarness({ schema, clock: a.clock });
    try {
      const body = await quote(a);
      const responses = await Promise.all([a, b].map(h => h.call('POST', '/v1/purchases', { token: a.alice.token, body, headers: { 'idempotency-key': 'postgres-same-key' } })));
      expect(responses.map(r => r.status)).toEqual([201, 201]);
      expect(new Set(responses.map(r => r.body.purchase.purchaseId)).size).toBe(1);
      expect((await a.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM reservations'))?.n).toBe(1);
      const conflicting = await b.call('POST', '/v1/purchases', { token: a.alice.token, body: { ...body, approval: { ...body.approval, quoteDigest: 'changed' } }, headers: { 'idempotency-key': 'postgres-same-key' } });
      expect(conflicting.status).toBe(409);
    } finally { await a.close(); await b.close(); }
  });

  it('preserves quote uniqueness and prevents capacity oversubscription across gateways', async () => {
    const schema = newTestSchema();
    const a = await startHarness({ schema });
    const b = await startHarness({ schema, clock: a.clock });
    try {
      const body = await quote(a);
      const responses = await Promise.all([a, b].map((h, index) => h.call('POST', '/v1/purchases', { token: a.alice.token, body, headers: { 'idempotency-key': `postgres-quote-${index}` } })));
      expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
      await a.gw.db.tx(() => seedCapacityPool(a.gw.db, 'USD', 2, 9998n, a.clock.now().toISOString()));
      const bodies = [await quote(a), await quote(a)];
      const buys = await Promise.all([a, b].map((h, index) => h.call('POST', '/v1/purchases', { token: a.alice.token, body: bodies[index], headers: { 'idempotency-key': `postgres-capacity-${index}` } })));
      expect(buys.map(r => r.status).sort()).toEqual([201, 422]);
      expect(buys.find(r => r.status === 422)?.body.error.code).toBe('insufficient_capacity');
      expect((await a.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM reservations'))?.n).toBe(2);
    } finally { await a.close(); await b.close(); }
  });

  it('skips a row locked by another connection and executes only the unlocked job', async () => {
    const schema = newTestSchema();
    const a = await startHarness({ schema });
    const b = await startHarness({ schema, clock: a.clock });
    const locked = deferred(), release = deferred();
    let holding: Promise<void> | undefined;
    try {
      for (const reference of ['first', 'second']) {
        const p = await createFundablePurchase(a);
        expect((await a.call('POST', `/v1/purchases/${p.purchase.purchaseId}/fund`, { token: a.alice.token, headers: { 'payment-signature': `fixture:${reference}:${p.required}` } })).status).toBe(202);
      }
      let purchaseId = '';
      holding = a.gw.db.tx(async () => {
        const job = await a.gw.db.get<{ purchase_id: string }>("SELECT purchase_id FROM jobs WHERE status = 'pending' ORDER BY run_after, created_at, id LIMIT 1 FOR UPDATE");
        purchaseId = job!.purchase_id;
        locked.resolve();
        await release.promise;
      }, false);
      await locked.promise;
      expect(await b.gw.worker.tick()).toBe(1);
      expect(b.retail.executeCalls).toBe(1);
      expect((await b.gw.db.get<{ state: string }>('SELECT state FROM purchases WHERE id = $1', purchaseId))?.state).toBe('funded_queued');
      release.resolve(); await holding;
      expect(await a.gw.worker.tick()).toBe(1);
      expect(a.retail.executeCalls + b.retail.executeCalls).toBe(2);
    } finally { release.resolve(); await holding; await a.close(); await b.close(); }
  });

  it('does not steal a live lease or duplicate provider execution when a second worker starts', async () => {
    const schema = newTestSchema(), clock = new ManualClock();
    const a = await startHarness({ schema, clock }), b = await startHarness({ schema, clock });
    let inflight: Promise<number> | undefined;
    try {
      const p = await createFundablePurchase(a);
      await a.call('POST', `/v1/purchases/${p.purchase.purchaseId}/fund`, { token: a.alice.token, headers: { 'payment-signature': `fixture:live-lease:${p.required}` } });
      const started = deferred(), execute = a.retail.execute.bind(a.retail);
      a.retail.block();
      a.retail.execute = async ctx => { started.resolve(); return execute(ctx); };
      inflight = a.gw.worker.tick(); await started.promise;
      expect(await b.gw.worker.recoverLeases()).toBe(0);
      expect(await b.gw.worker.tick()).toBe(0);
      clock.advance(130_000);
      // Even after lease expiry, a still-live worker holds the purchase execution lock.
      expect(await b.gw.worker.tick()).toBe(1);
      expect(b.retail.executeCalls).toBe(0);
      expect(b.retail.retrieveCalls).toBe(0);
      a.retail.unblock(); await inflight;
      clock.advance(2000); await b.gw.worker.tick();
      expect((await b.gw.db.get<{ state: string }>('SELECT state FROM purchases WHERE id = $1', p.purchase.purchaseId))?.state).toBe('succeeded');
      expect((await b.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM execution_attempts'))?.n).toBe(1);
    } finally { a.retail.unblock(); await inflight; await a.close(); await b.close(); }
  });

  it('refuses competing settlement calls before the second gateway verifies payment', async () => {
    const schema = newTestSchema();
    const a = await startHarness({ schema }), b = await startHarness({ schema, clock: a.clock });
    const entered = deferred(), release = deferred();
    let inflight: ReturnType<Harness['call']> | undefined;
    try {
      const p = await createFundablePurchase(a), verify = a.funding.verify.bind(a.funding);
      a.funding.verify = async (header, input) => { entered.resolve(); await release.promise; return verify(header, input); };
      inflight = a.call('POST', `/v1/purchases/${p.purchase.purchaseId}/fund`, { token: a.alice.token, headers: { 'payment-signature': `fixture:competing-fund:${p.required}` } });
      await entered.promise;
      const duplicate = await b.call('POST', `/v1/purchases/${p.purchase.purchaseId}/fund`, { token: a.alice.token, headers: { 'payment-signature': `fixture:second-fund:${p.required}` } });
      expect(duplicate.status).toBe(409); expect(b.funding.verifyCalls).toBe(0);
      release.resolve(); expect((await inflight).status).toBe(202);
      expect((await a.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM funding_evidence'))?.n).toBe(1);
    } finally { release.resolve(); await inflight; await a.close(); await b.close(); }
  });
});
