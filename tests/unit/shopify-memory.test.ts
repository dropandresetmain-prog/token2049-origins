import { beforeEach, describe, expect, it, vi } from 'vitest';
const files = vi.hoisted(() => new Map<string,string>());
vi.mock('node:fs', () => ({ readFileSync: (path: string) => {
  if (!files.has(path)) throw new Error('unavailable');
  return files.get(path)!;
} }));
import { logBrowserMemory } from '../../src/execution/shopify/memoryTelemetry.js';
beforeEach(() => files.clear());
const capture = () => { const sink=vi.fn(); logBrowserMemory('launched',sink); return JSON.parse(sink.mock.calls[0]![0]); };
describe('browser memory telemetry', () => {
  it('records only fixed counters and cgroup v2 bytes', () => {
    files.set('/sys/fs/cgroup/memory.current','12345\n'); files.set('/sys/fs/cgroup/memory.max','536870912');
    const event=capture();
    expect(Object.keys(event)).toEqual(['type','event','process','container']);
    expect(event.container).toEqual({currentBytes:12345,limitBytes:536870912});
    expect(Object.keys(event.process).sort()).toEqual(['arrayBuffers','external','heapTotal','heapUsed','rss']);
    expect(Object.values(event.process).every(n=>typeof n==='number')).toBe(true);
  });
  it('supports cgroup v1 and missing/unlimited counters without failing checkout', () => {
    expect(capture().container).toEqual({currentBytes:null,limitBytes:null});
    files.set('/sys/fs/cgroup/memory/memory.usage_in_bytes','5678');
    files.set('/sys/fs/cgroup/memory.max','max');
    expect(capture().container).toEqual({currentBytes:5678,limitBytes:null});
  });
  it('discards malformed file contents and isolates sink failures', () => {
    files.set('/sys/fs/cgroup/memory.current','unexpected private text');
    expect(capture().container.currentBytes).toBeNull();
    expect(()=>logBrowserMemory('closed',()=>{throw new Error('sink unavailable');})).not.toThrow();
  });
});
