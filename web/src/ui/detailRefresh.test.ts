import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDetailRefresh, LIVE_REFRESH_MS } from './detailRefresh.js';

afterEach(() => vi.useRealTimers());
describe('live detail refresh', () => {
  it('pauses hidden-page polling and resumes an active purchase once visible', async () => {
    vi.useFakeTimers();
    let hidden = true;
    const listeners = new Set<()=>void>();
    const visibility = {get visibilityState(){return hidden?'hidden':'visible';},addEventListener:(_name:string,fn:()=>void)=>listeners.add(fn),removeEventListener:(_name:string,fn:()=>void)=>listeners.delete(fn)} as unknown as Document;
    const read=vi.fn().mockResolvedValue(true);
    const controller=startDetailRefresh(read,1000,visibility);
    await vi.advanceTimersByTimeAsync(10000);expect(read).not.toHaveBeenCalled();
    hidden=false;for(const fn of listeners)fn();
    await vi.advanceTimersByTimeAsync(0);expect(read).toHaveBeenCalledTimes(1);
    hidden=true;for(const fn of listeners)fn();
    await vi.advanceTimersByTimeAsync(10000);expect(read).toHaveBeenCalledTimes(1);
    controller.stop();expect(listeners.size).toBe(0);
  });

  it('polls at 1.5s while live and stops immediately on final', async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
    startDetailRefresh(read);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS - 1);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenLastCalledWith(true);
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS);
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('never schedules a final first load and allows manual reload', async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValue(false);
    const controller = startDetailRefresh(read);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    controller.reload();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('has no overlapping reads or backlog when reads are slow or reload is pressed repeatedly', async () => {
    vi.useFakeTimers();
    let resolve!: (live: boolean) => void;
    const read = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
    const controller = startDetailRefresh(read, 1000);
    controller.reload(); controller.reload();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(1);
    resolve(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    controller.stop(); resolve(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels a pending timer on cleanup and validates configuration', async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValue(true);
    const controller = startDetailRefresh(read, 2000);
    await vi.advanceTimersByTimeAsync(0); controller.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(1);
    for (const ms of [0, 999, NaN, Infinity, 60_001, 2 ** 32]) expect(() => startDetailRefresh(read, ms)).toThrow();
  });
});
