import { afterEach, describe, expect, it, vi } from 'vitest';
import { Worker } from '../../src/core/worker.js';
import type { CommerceCore } from '../../src/core/service.js';

afterEach(() => vi.useRealTimers());
function fixture() {
  let listener: (() => void) | undefined;
  let due: string | null = null;
  const now = new Date('2026-10-11T00:00:00Z');
  const db = { get: vi.fn(async () => ({ due })) };
  const core = { deps:{ db, clock:{ now:()=>now } }, onWorkCommitted: (fn:()=>void) => { listener=fn; return ()=>{listener=undefined;}; } } as unknown as CommerceCore;
  const worker = new Worker(core);
  vi.spyOn(worker,'recoverLeases').mockResolvedValue(0);
  vi.spyOn(worker,'recoverOrphans').mockResolvedValue(0);
  const tick = vi.spyOn(worker,'tick').mockResolvedValue(0);
  return {worker,tick,db,wake:()=>listener?.(),due:(ms:number)=>{due=new Date(now.getTime()+ms).toISOString();}};
}
describe('idle-aware durable worker timer', () => {
  it('ticks at startup, sleeps with no work, wakes committed inserts immediately, and stops idle polling', async () => {
    vi.useFakeTimers(); const h=fixture(); await h.worker.start();
    await vi.advanceTimersByTimeAsync(0);expect(h.tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29*60*1000);expect(h.tick).toHaveBeenCalledTimes(1);
    h.wake();h.wake();await vi.advanceTimersByTimeAsync(0);expect(h.tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30*60*1000);expect(h.tick).toHaveBeenCalledTimes(3);
    h.worker.stop();h.wake();await vi.advanceTimersByTimeAsync(60*60*1000);expect(h.tick).toHaveBeenCalledTimes(3);
  });
  it('honors a delayed durable deadline and coalesces wakeups while a tick is running', async () => {
    vi.useFakeTimers(); const h=fixture();h.due(15000); await h.worker.start();
    await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(14999);expect(h.tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);expect(h.tick).toHaveBeenCalledTimes(2);
    let finish!: (n:number)=>void;h.tick.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    h.wake();await vi.advanceTimersByTimeAsync(0);h.wake();h.wake();finish(0);
    await vi.advanceTimersByTimeAsync(0);expect(h.tick).toHaveBeenCalledTimes(4);h.worker.stop();
  });
  it('uses bounded reconnection after transient database failure', async () => {
    vi.useFakeTimers();const h=fixture();h.tick.mockRejectedValueOnce(Error('disconnected'));await h.worker.start();
    await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(29999);expect(h.tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);expect(h.tick).toHaveBeenCalledTimes(2);h.worker.stop();
  });
});
