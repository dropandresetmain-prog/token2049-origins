/**
 * Sanitized readiness report. Prints configuration presence and capability checks per component,
 * never values. Exit code 0 always (readiness is informational); use --strict to fail on non-passing.
 */
import { realParts } from '../src/wiring.js';
import { loadCoreEnv } from '../src/infrastructure/config.js';

const strict = process.argv.includes('--strict');
const env = loadCoreEnv();
const parts = realParts(process.env, () => undefined);
const rows: Array<{ component: string; status: string; environment: string; missing: string[]; detail?: string }> = [];
for (const e of parts.executors) rows.push(await e.readiness());
for (const f of parts.fundingAdapters) rows.push(await f.readiness());
for (const b of parts.bankAdapters) rows.push(await b.readiness());
process.stdout.write(`appEnv=${env.APP_ENV} database=${env.DATABASE_URL ? 'set' : 'unset'}\n`);
for (const r of rows) {
  process.stdout.write(`${r.component.padEnd(18)} ${r.status.padEnd(22)} env=${r.environment}${r.missing.length ? ` missing=${r.missing.join(',')}` : ''}${r.detail ? ` — ${r.detail}` : ''}\n`);
}
if (rows.length === 0) process.stdout.write('no adapters registered yet\n');
if (strict && rows.some((r) => r.status !== 'EXTERNAL_CHECK_PASSED')) process.exit(1);
