/**
 * Fresh-run check for the Nuitee (liteAPI) sandbox lane. Needs NUITEE_API_KEY (a sandbox key).
 *
 *   npx tsx scripts/nuitee-check.ts            readiness + search (read-only)
 *   npx tsx scripts/nuitee-check.ts --quote    ... + prebook of the cheapest offer (no booking)
 *   npx tsx scripts/nuitee-check.ts --book     ... + sandbox book (ACC_CREDIT_CARD = simulated, not charged) and readback
 *
 * Uses a synthetic traveller only. Prints sanitized summaries: never the key, never provider bodies.
 * Exit code is non-zero if a requested step does not reach its expected result.
 */
import { createNuiteeExecutor } from '../src/execution/nuitee/index.js';
import { PurchaseIntent, HotelFulfillment } from '../src/contracts/intent.js';
import { formatMinor, money } from '../src/contracts/money.js';
import type { ExecutionContext, ExecutionResult } from '../src/contracts/ports.js';

const wantBook = process.argv.includes('--book');
const wantQuote = wantBook || process.argv.includes('--quote');
const out = (s: string) => process.stdout.write(`${s}\n`);
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
let failed = false;

const ex = createNuiteeExecutor(process.env);
const ready = await ex.readiness();
out(`readiness: ${ready.status}${ready.missing.length ? ` missing=${ready.missing.join(',')}` : ''}${ready.detail ? ` - ${ready.detail}` : ''}`);
if (ready.status !== 'EXTERNAL_CHECK_PASSED') process.exit(1);

const intent = PurchaseIntent.parse({
  category: 'hotel',
  spendCeiling: money('USD', 200000),
  destination: { cityName: 'Singapore', countryCode: 'SG' },
  checkin: isoDay(60),
  checkout: isoDay(62),
  occupancies: [{ adults: 1 }],
  guestNationality: 'SG',
});

const offers = await ex.search(intent);
out(`search: ${offers.length} offer(s)`);
const first = offers[0];
if (first) out(`  cheapest: ${first.title} - ${formatMinor(first.indicativePrice)}`);
if (!first) process.exit(1);

if (wantQuote) {
  const fulfillment = HotelFulfillment.parse({
    category: 'hotel',
    holder: { firstName: 'Test', lastName: 'Traveller', email: 'test.traveller@example.com', phone: '+6500000000' },
    guests: [{ occupancyNumber: 1, firstName: 'Test', lastName: 'Traveller', email: 'test.traveller@example.com' }],
  });
  const q = await ex.quote({ executionRef: first.executionRef, intent }, fulfillment);
  out(`quote: ${formatMinor(q.merchantTotal)} (expires ${q.expiresAt})`);
  for (const t of q.terms) out(`  term: ${t}`);

  if (wantBook) {
    const checkpoints: ExecutionContext['checkpoints'] = {};
    const ctx: ExecutionContext = {
      purchaseId: 'pur_check',
      attemptId: 'att_check',
      idempotencyKey: `att_check_${Date.now()}`,
      quote: { quoteId: 'quo_check', merchantTotal: q.merchantTotal, executionRef: q.executionRef, expiresAt: q.expiresAt },
      fulfillment,
      checkpoints,
      checkpoint: async (step, data) => {
        checkpoints[step] = data;
        out(`  checkpoint: ${step}`);
      },
    };
    const show = (label: string, r: ExecutionResult) => {
      const ref = 'providerReference' in r ? r.providerReference : null;
      const extra = r.kind === 'succeeded' ? ` ${r.commerceStatus}/${r.merchantPaymentStatus} charged=${formatMinor(r.chargedAmount)}` : 'reason' in r ? ` ${r.reason}` : '';
      out(`${label}: ${r.kind} ref=${ref ?? '-'}${extra}`);
    };
    const exec = await ex.execute(ctx);
    show('execute', exec);
    const back = await ex.retrieve(ctx);
    show('retrieve', back);
    if (exec.kind !== 'succeeded' || back.kind !== 'succeeded') failed = true;
  }
}
process.exit(failed ? 1 : 0);
