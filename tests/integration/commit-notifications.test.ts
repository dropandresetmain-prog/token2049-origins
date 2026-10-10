import { describe, expect, it } from 'vitest';
import { startHarness, createFundablePurchase } from '../support/harness.js';
import { createTestDb } from '../support/database.js';

describe('notifications follow committed durable work', () => {
  it('runs after the outer commit and discards callbacks from failed nested and outer transactions', async () => {
    const db = await createTestDb(), notifications: string[] = [];
    await db.tx(async () => {
      db.afterCommit(() => { notifications.push('outer'); });
      await db.tx(() => { db.afterCommit(() => { notifications.push('nested'); }); });
      await expect(db.tx(() => { db.afterCommit(() => { notifications.push('rolled-back-savepoint'); }); throw Error('savepoint'); })).rejects.toThrow('savepoint');
      expect(notifications).toEqual([]);
    });
    expect(notifications).toEqual(['outer', 'nested']);
    await expect(db.tx(() => { db.afterCommit(() => { notifications.push('rolled-back'); }); throw Error('abort'); })).rejects.toThrow('abort');
    expect(notifications).toEqual(['outer', 'nested']);
  });

  it('does not propagate a held signing session into asynchronous wake work', async () => {
    const db = await createTestDb();
    const result = await db.withExclusiveLock('notification:' + db.connectionName, async () => {
      const before = await db.get<{ pid:number }>('SELECT pg_backend_pid() AS pid');
      let wakeRead: ReturnType<typeof db.get<{ pid:number }>> | undefined;
      await db.tx(() => { db.afterCommit(() => { wakeRead = db.get<{ pid:number }>('SELECT pg_backend_pid() AS pid'); }); });
      expect(wakeRead).toBeDefined();
      expect((await wakeRead)?.pid).not.toBe(before?.pid);
    });
    expect(result.acquired).toBe(true);
  });
});

describe('reservation notifications',()=>{
 it('wakes an idle worker after a new purchase reservation commits',async()=>{
 const h=await startHarness();let notifications=0;let committed: Promise<unknown>|undefined;
 const unsubscribe=h.gw.core.onWorkCommitted(()=>{notifications++;committed=h.gw.db.get('SELECT id FROM reservations WHERE status=\'active\'');});
 try {await createFundablePurchase(h);expect(notifications).toBe(1);expect(await committed).toBeDefined();}
 finally{unsubscribe();await h.close();}
 });
});
