/**
 * Read-only Atlas sandbox check. Reports readiness, searches one route and, if an offer exists,
 * verifies it (no traveller data, no order, no payment). Prints a sanitized summary only:
 * never credentials, provider text, session ids or routing identifiers.
 *
 *   ATLAS_BASE_URL=https://sandbox.atriptech.com ATLAS_CLIENT_ID=... ATLAS_CLIENT_SECRET=... \
 *     npx tsx scripts/atlas-check.ts [FROM TO YYYY-MM-DD]
 *
 * Creating a held order or paying is deliberately NOT part of this script.
 */
import { createAtlasExecutor } from '../src/execution/atlas/index.js';
import { FlightIntent } from '../src/contracts/intent.js';
import { formatMinor, money } from '../src/contracts/money.js';

import { demoData, demoDate } from '../src/demo/config.js';

const [from = demoData.flight.from, to = demoData.flight.to, date] = process.argv.slice(2);
const departDate = date ?? demoDate(demoData.flight.departDaysFromNow);

const ex = createAtlasExecutor(process.env);
const r = await ex.readiness();
process.stdout.write(`atlas readiness: ${r.status}${r.missing.length ? ` missing=${r.missing.join(',')}` : ''}${r.detail ? ` (${r.detail})` : ''}\n`);

if (r.status === 'EXTERNAL_CHECK_PASSED' || r.status === 'CONFIGURED_UNVERIFIED') {
  try {
    const intent = FlightIntent.parse({ category: 'flight', spendCeiling: money('USD', demoData.flight.maxCommercialMinor), from, to, departDate, adults: demoData.flight.adults });
    const offers = await ex.search(intent);
    process.stdout.write(`search ${from}-${to} ${departDate}: ${offers.length} offer(s)\n`);
    for (const o of offers.slice(0, 3)) process.stdout.write(`  ${o.title}  ${formatMinor(o.indicativePrice)}  expires ${o.expiresAt}\n`);
  } catch (e) {
    process.stdout.write(`search failed: ${e instanceof Error ? e.message : 'unknown'}\n`);
  }
}
process.stdout.write('no order was created and no payment was attempted\n');
