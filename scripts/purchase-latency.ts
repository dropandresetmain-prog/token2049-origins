import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { LatencyRecord, purchaseLatency, formatLatency } from '../src/core/latency.js';

const [file, visibleAt] = process.argv.slice(2);
if (!file || (visibleAt && !z.iso.datetime().safeParse(visibleAt).success)) {
  process.stderr.write('Usage: npm run latency -- <technical-proof.json> [console-visible-at-UTC-ISO]\n');
  process.exitCode = 1;
} else {
  try {
    const evidence = LatencyRecord.parse(JSON.parse(await readFile(file, 'utf8')));
    process.stdout.write(formatLatency(purchaseLatency(evidence, visibleAt ?? null)) + '\n');
  } catch {
    // Input records can contain customer facts. Report neither their contents nor parser details.
    process.stderr.write('Cannot read latency evidence: expected a technical proof JSON with timestamped events.\n');
    process.exitCode = 1;
  }
}
