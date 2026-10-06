import { describe, expect, it } from 'vitest';
import { BackgroundJobs } from '../../src/channels/mcp/tools.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('BackgroundJobs', () => {
  it('returns the value when the job finishes within the wait', async () => {
    const jobs = new BackgroundJobs(200);
    expect(await jobs.run('k', async () => 7)).toEqual({ pending: false, value: 7 });
  });

  it('answers "pending" after the wait, keeps the job running, and a repeat call joins it instead of starting another', async () => {
    const jobs = new BackgroundJobs(30);
    let starts = 0;
    const slow = async () => { starts++; await sleep(150); return 'quote'; };
    expect(await jobs.run('k', slow)).toEqual({ pending: true });
    expect(await jobs.run('k', slow)).toEqual({ pending: true });
    await sleep(200);
    expect(await jobs.run('k', slow)).toEqual({ pending: false, value: 'quote' });
    expect(starts).toBe(1);
  });

  it('keeps a finished result briefly (idempotent repeats) and then forgets it', async () => {
    let now = 1_000;
    const jobs = new BackgroundJobs(50, 1000, () => now);
    let starts = 0;
    const once = async () => { starts++; return starts; };
    expect(await jobs.run('k', once)).toEqual({ pending: false, value: 1 });
    expect(await jobs.run('k', once)).toEqual({ pending: false, value: 1 });
    now += 1001;
    expect(await jobs.run('k', once)).toEqual({ pending: false, value: 2 });
  });

  it('rethrows a failure exactly once, then lets the next call start fresh', async () => {
    const jobs = new BackgroundJobs(100);
    let n = 0;
    const flaky = async () => { n++; if (n === 1) throw new Error('boom'); return 'ok'; };
    await expect(jobs.run('k', flaky)).rejects.toThrow('boom');
    expect(await jobs.run('k', flaky)).toEqual({ pending: false, value: 'ok' });
  });

  it('keeps different keys independent', async () => {
    const jobs = new BackgroundJobs(100);
    expect(await jobs.run('a', async () => 'A')).toMatchObject({ value: 'A' });
    expect(await jobs.run('b', async () => 'B')).toMatchObject({ value: 'B' });
  });

  it('within(): a promise that outlives the wait keeps running and its rejection is swallowed', async () => {
    const jobs = new BackgroundJobs(20);
    let finished = false;
    const slow = (async () => { await sleep(80); finished = true; throw new Error('late failure'); })();
    expect(await jobs.within(slow)).toEqual({ pending: true });
    await sleep(120);
    expect(finished).toBe(true); // it was never cancelled and nothing crashed
    expect(await jobs.within(Promise.resolve(5))).toEqual({ pending: false, value: 5 });
  });
});
