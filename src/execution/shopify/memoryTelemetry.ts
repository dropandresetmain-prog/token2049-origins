import { readFileSync } from 'node:fs';

type MemoryEvent = 'before_launch' | 'launched' | 'quote_complete' | 'api_quote_complete' | 'closed';

/** Fixed resource counters only: never accepts checkout state, buyer fields or URLs. */
export function logBrowserMemory(event: MemoryEvent, sink: (line: string) => void): void {
  try {
    const read = (path: string): number | null => {
      try {
        const raw = readFileSync(path, 'utf8').trim();
        return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
      } catch { return null; }
    };
    sink(JSON.stringify({ type: 'shopify.browser_memory', event, process: process.memoryUsage(),
      container: {
        currentBytes: read('/sys/fs/cgroup/memory.current') ?? read('/sys/fs/cgroup/memory/memory.usage_in_bytes'),
        limitBytes: read('/sys/fs/cgroup/memory.max') ?? read('/sys/fs/cgroup/memory/memory.limit_in_bytes'),
      } }));
  } catch { /* Telemetry cannot change checkout or cleanup outcomes. */ }
}
