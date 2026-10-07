import { readFileSync } from 'node:fs';

type MemoryEvent = 'before_launch' | 'launched' | 'quote_complete' | 'api_quote_complete' | 'before_pay' | 'closed';

/** Fixed resource counters only: never accepts checkout state, buyer fields or URLs. */
export function logBrowserMemory(event: MemoryEvent, sink: (line: string) => void): void {
  try {
    const read = (path: string): number | null => {
      try {
        const raw = readFileSync(path, 'utf8').trim();
        return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
      } catch { return null; }
    };
    const counters = (path: string, names: string[]): Record<string, number | null> => {
      let content = '';
      try { content = readFileSync(path, 'utf8'); } catch { /* Missing cgroup counters stay unknown. */ }
      return Object.fromEntries(names.map(name => {
        const value = new RegExp(`^${name} ([0-9]+)$`, 'm').exec(content)?.[1];
        return [name, value && Number.isSafeInteger(Number(value)) ? Number(value) : null];
      }));
    };
    sink(JSON.stringify({ type: 'shopify.browser_memory', event, process: process.memoryUsage(),
      container: {
        currentBytes: read('/sys/fs/cgroup/memory.current') ?? read('/sys/fs/cgroup/memory/memory.usage_in_bytes'),
        limitBytes: read('/sys/fs/cgroup/memory.max') ?? read('/sys/fs/cgroup/memory/memory.limit_in_bytes'),
      } }));
    // Cumulative counters permit before/after deltas without attributing pressure from RSS alone.
    sink(JSON.stringify({ type: 'shopify.browser_pressure', event,
      swapBytes: read('/sys/fs/cgroup/memory.swap.current'),
      memory: counters('/sys/fs/cgroup/memory.events', ['high', 'max', 'oom', 'oom_kill']),
      cpu: counters('/sys/fs/cgroup/cpu.stat', ['usage_usec', 'nr_periods', 'nr_throttled', 'throttled_usec']),
    }));
  } catch { /* Telemetry cannot change checkout or cleanup outcomes. */ }
}
