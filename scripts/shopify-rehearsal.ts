/**
 * UNFUNDED Shopify checkout rehearsal (development/diagnostic tool; never used by the gateway).
 *
 * Drives the REAL Playwright checkout driver against the configured development store with the
 * synthetic demo buyer and Bogus Gateway test-card fields, then STOPS at the `pay_click` checkpoint.
 * The driver invokes that checkpoint strictly BEFORE the pay click, and the checkpoint callback here
 * throws a dedicated RehearsalStop, so the click can never happen. No gateway purchase, funding or
 * Shopify order is created. Output is sanitized: hostnames, step names, booleans and amounts only.
 *
 *   node --env-file=.env --import tsx scripts/shopify-rehearsal.ts [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { demoData } from '../src/demo/config.js';
import { loadShopifyConfig } from '../src/execution/shopify/config.js';
import { ShopifyExecutor } from '../src/execution/shopify/index.js';
import { AdminClient } from '../src/execution/shopify/admin.js';
import { createPlaywrightDriver, parseDisplayedTotals, type CheckoutObserver } from '../src/execution/shopify/browserCheckout.js';
import { createStepLogger } from '../src/execution/shopify/checkout.js';
import { systemClock } from '../src/infrastructure/clock.js';
import { RetailIntent } from '../src/contracts/intent.js';
import type { Money } from '../src/contracts/money.js';

export class RehearsalStop extends Error {
  constructor() {
    super('rehearsal_stop_before_pay_click');
  }
}

const PAY_NAME = /pay now|complete order|place order/i;
const SELECTORS: Record<string, string> = {
  email: 'input[name="email"], input[autocomplete~="email"], input[type="email"]',
  country: 'select[name="countryCode"]',
  firstName: 'input[name="firstName"], input[autocomplete~="given-name"]',
  lastName: 'input[name="lastName"], input[autocomplete~="family-name"]',
  address1: 'input[name="address1"], input[autocomplete~="address-line1"]',
  city: 'input[name="city"], input[autocomplete~="address-level2"]',
  postalCode: 'input[name="postalCode"], input[autocomplete~="postal-code"]',
  cardNumberFrame: 'iframe[name^="card-fields-number"]',
  cardNameFrame: 'iframe[name^="card-fields-name"]',
  cardExpiryFrame: 'iframe[name^="card-fields-expiry"]',
  cardCvvFrame: 'iframe[name^="card-fields-verification_value"]',
};

const outDir = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? path.join('artifacts', 'e2e', fs.readFileSync(path.join('artifacts', 'e2e', '.current'), 'utf8').trim());
fs.mkdirSync(outDir, { recursive: true });
const jsonl = path.join(outDir, '02-shopify-rehearsal.jsonl');
const emit = (kind: string, data: Record<string, unknown> = {}): void => {
  fs.appendFileSync(jsonl, `${JSON.stringify({ at: new Date().toISOString(), kind, ...data })}\n`);
};
const host = (u: string): string => {
  try {
    return new URL(u).hostname || 'about';
  } catch {
    return 'invalid';
  }
};

// Preconditions: sandbox only, no funding rail configured in this process.
const env = process.env;
const forbidden = Object.keys(env).filter((k) => /^(CARDANO_|PAYER_|BLOCKFROST_|SOLANA_)/.test(k) && env[k]);
if (env.APP_ENV !== 'sandbox' || forbidden.length) {
  emit('precondition_failed', { appEnv: env.APP_ENV ?? null, fundingEnvPresent: forbidden.length > 0 });
  process.exit(2);
}
const report = loadShopifyConfig(env);
const cfg = report.config;
if (!report.buyerReady || !report.adminReady || !cfg.devStoreConfirmed || !cfg.bogusGatewayEnabled || report.invalid.length) {
  emit('precondition_failed', { reason: 'shopify_not_ready' });
  process.exit(2);
}
if (!demoData.retail.productRef) {
  emit('precondition_failed', { reason: 'demo_product_ref_missing' });
  process.exit(2);
}

const startedAt = new Date().toISOString();
emit('start', { storeHost: cfg.storeDomain, apiVersion: cfg.apiVersion, headless: cfg.headless, productRef: demoData.retail.productRef });

// ---- diagnostics observer (read-only) ----
const blocked = new Map<string, { hostname: string; resourceType: string; frame: string; count: number }>();
let page: Page | null = null;
const stepsSeen: string[] = [];
const snapshot = async (label: string): Promise<Record<string, unknown>> => {
  const out: Record<string, unknown> = { label };
  const p = page;
  if (!p) return out;
  try {
    out.mainFrameHost = host(p.url());
    out.mainPath = new URL(p.url()).pathname.split('/').map((seg) => (/^[0-9a-zA-Z_-]{16,}$/.test(seg) ? ':token' : seg)).join('/');
    out.pageTitle = (await p.title().catch(() => '')).slice(0, 80);
    out.frames = p.frames().filter((f) => f !== p.mainFrame()).map((f) => ({ name: f.name().slice(0, 60), host: host(f.url()) }));
    const sel: Record<string, number> = {};
    for (const [k, v] of Object.entries(SELECTORS)) sel[k] = await p.locator(v).count().catch(() => -1);
    out.selectorCounts = sel;
    const body = await p.locator('body').innerText().catch(() => '');
    out.displayedAmountsMinor = [...new Set(parseDisplayedTotals(body, 2).map((n) => n.toString()))];
    out.currencyFormat = { dollarSign: body.includes('$'), usdCode: /\bUSD\b/.test(body), usPrefix: body.includes('US$') };
    out.bogusGatewayTextSeen = /bogus gateway|test payment gateway/i.test(body);
    const radios = p.getByRole('radio');
    const n = await radios.count();
    const labels: string[] = [];
    for (let i = 0; i < Math.min(n, 12); i++) {
      const l = await radios.nth(i).evaluate((el) => (el as unknown as { labels?: ArrayLike<{ innerText: string }> }).labels?.[0]?.innerText ?? el.getAttribute('aria-label') ?? '').catch(() => '');
      if (l) labels.push(l.replace(/\s+/g, ' ').slice(0, 80));
    }
    out.radioLabels = labels;
    out.moneyLines = body.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 0 && l.length <= 50 && (/[$]|USD|total|subtotal|tax/i.test(l))).slice(0, 14);
    {
      // Test-mode instructions contain only published Bogus test values, no buyer data.
      const lines = body.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const i = lines.findIndex((l) => /testing instruction/i.test(l));
      out.testingBlock = i >= 0 ? lines.slice(i, i + 10).map((l) => l.slice(0, 70)) : [];
      out.paymentHeadings = lines.filter((l) => l.length <= 40 && /payment|credit|card|gateway|bogus|test mode/i.test(l)).slice(0, 10);
    }
    out.inputRadioCount = await p.locator('input[type="radio"]').count().catch(() => -1);
    out.shippingTextLines = body.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 0 && l.length <= 60 && /standard|express|shipping|delivery|calculated|enter .*address|stock|unavailable|not available|bogus|test/i.test(l)).slice(0, 14);
    const pay = p.getByRole('button', { name: PAY_NAME });
    out.payButtonCount = await pay.count();
    if (out.payButtonCount) {
      const b = pay.first();
      out.payButtonName = ((await b.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').slice(0, 40);
      out.payButtonEnabled = await b.isEnabled().catch(() => null);
      out.payButtonVisible = await b.isVisible().catch(() => null);
    }
  } catch {
    out.snapshotError = true;
  }
  return out;
};
const observer: CheckoutObserver = {
  attach: async (p) => {
    page = p;
    if (permalinkCookies.length) {
      await p.context().addCookies(permalinkCookies.map(([name, value]) => ({ name, value, domain: cfg.storeDomain, path: '/', secure: true })));
    }
  },
  blocked: (e) => {
    const k = `${e.hostname}|${e.resourceType}|${e.frame}`;
    const cur = blocked.get(k);
    if (cur) cur.count++;
    else blocked.set(k, { ...e, count: 1 });
  },
  stepFailed: async (step) => {
    emit('step_failed', { step, ...(await snapshot('at_failure')) });
    if (step === 'choose_shipping' && page) {
      // Race check: do the shipping options appear if we simply wait?
      await page.waitForTimeout(10_000).catch(() => undefined);
      emit('after_wait_10s', await snapshot('after_wait_10s'));
    }
  },
  beforePay: async () => {
    const snap = await snapshot('before_pay_click');
    // Independent actionability probe: a TRIAL click performs every actionability check and never clicks.
    let trial = false;
    try {
      await page!.getByRole('button', { name: PAY_NAME }).first().click({ trial: true, timeout: 5000 });
      trial = true;
    } catch {
      trial = false;
    }
    emit('before_pay', { ...snap, harnessTrialClickPassed: trial });
  },
};

const permalinkMode = process.argv.includes('--permalink');
/** Session cookies from the HTTP permalink resolution; seeded into the browser context (never logged). */
let permalinkCookies: Array<[string, string]> = [];
/** Follow /cart/<variant>:<qty> redirects (same host only, cookies kept in memory, nothing printed) to the /checkouts/ URL. */
async function resolvePermalink(): Promise<string> {
  const variantId = /\/(\d+)$/.exec(demoData.retail.productRef!)?.[1];
  if (!variantId) throw new Error('bad_product_ref');
  const start = `https://${cfg.storeDomain}/cart/${variantId}:${demoData.retail.quantity}?return_to=/checkout&country=${demoData.retail.shipToCountry}`;
  let url = start;
  let authed = false;
  // Force the destination market context (otherwise the market is inferred from the caller's IP).
  const jar = new Map<string, string>([['localization', demoData.retail.shipToCountry]]);
  for (let hop = 0; hop < 8; hop++) {
    const u = new URL(url);
    if (u.hostname !== cfg.storeDomain || u.protocol !== 'https:') throw new Error('permalink_left_store_host');
    if (/^\/checkouts\//.test(u.pathname)) {
      permalinkCookies = [...jar];
      return u.toString();
    }
    if (/\/password(\/|$)/.test(u.pathname)) {
      // Authenticate once over HTTP (password and cookies stay in memory, never logged), then restart the permalink.
      if (authed || !cfg.storePassword) throw new Error('permalink_password_gate');
      const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const keep = (r: Response) => { for (const c of r.headers.getSetCookie()) { const m = /^([^=;]+)=([^;]*)/.exec(c); if (m) jar.set(m[1]!, m[2]!); } };
      const page = await fetch(url, { redirect: 'manual', headers: { cookie: cookie() } });
      keep(page);
      const token = /name="authenticity_token"[^>]*value="([^"]+)"/.exec(await page.text())?.[1];
      const body = new URLSearchParams({ form_type: 'storefront_password', utf8: '✓', password: cfg.storePassword });
      if (token) body.set('authenticity_token', token);
      keep(await fetch(`https://${cfg.storeDomain}/password`, { method: 'POST', redirect: 'manual', headers: { cookie: cookie(), 'content-type': 'application/x-www-form-urlencoded' }, body }));
      authed = true;
      url = start;
      continue;
    }
    const res = await fetch(url, { redirect: 'manual', headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const c of res.headers.getSetCookie()) { const m = /^([^=;]+)=([^;]*)/.exec(c); if (m) jar.set(m[1]!, m[2]!); }
    const loc = res.headers.get('location');
    if (!loc) throw new Error(`permalink_no_redirect_status_${res.status}`);
    url = new URL(loc, url).toString();
  }
  throw new Error('permalink_too_many_redirects');
}

// ---- real quote through the real executor, then the real driver ----
const executor = new ShopifyExecutor(env);
const intent = RetailIntent.parse({
  category: 'retail',
  productRef: demoData.retail.productRef,
  quantity: demoData.retail.quantity,
  shipToCountry: demoData.retail.shipToCountry,
  spendCeiling: { currency: 'USD', amountMinor: demoData.retail.maxCommercialMinor, scale: 2 },
});
const fulfillment = { category: 'retail' as const, ...demoData.buyer };
let outcome = 'UNKNOWN';
let failure: { code: string; message: string } | null = null;
try {
  let ref: { checkoutUrl: string; shippingTitle: string };
  let expectedTotal: Money;
  if (permalinkMode) {
    // DIAGNOSTIC ONLY: official cart permalink resolved over plain HTTP (no Storefront API / cartCreate).
    // Expected total is subtotal + the seeded flat shipping rate; a tax difference is itself a finding.
    ref = { checkoutUrl: await resolvePermalink(), shippingTitle: env.REHEARSAL_SHIPPING_TITLE ?? 'Standard' };
    expectedTotal = { currency: 'USD', amountMinor: env.REHEARSAL_EXPECTED_TOTAL_MINOR ?? '1795', scale: 2 };
    emit('permalink', { mode: 'cart_permalink', checkoutHost: host(ref.checkoutUrl), expectedTotalMinor: expectedTotal.amountMinor, shippingTitle: ref.shippingTitle });
  } else {
    const offers = await executor.search(intent);
    if (offers.length !== 1) throw new Error(`expected exactly one offer, got ${offers.length}`);
    const quote = await executor.quote({ executionRef: offers[0]!.executionRef, intent }, fulfillment);
    ref = quote.executionRef as { checkoutUrl: string; shippingTitle: string };
    expectedTotal = quote.merchantTotal;
    emit('quote', {
      merchantTotalMinor: quote.merchantTotal.amountMinor,
      currency: quote.merchantTotal.currency,
      breakdown: quote.breakdown.map((b) => ({ kind: b.kind, amountMinor: b.amount.amountMinor })),
      shippingTitle: ref.shippingTitle,
      checkoutHost: host(ref.checkoutUrl),
    });
  }
  const log = createStepLogger((line) => {
    const m = /step=([a-z0-9_.-]+)/.exec(line);
    if (m) {
      stepsSeen.push(m[1]!);
      emit('step', { step: m[1] });
    }
  });
  const driver = createPlaywrightDriver({ storeDomain: cfg.storeDomain, headless: cfg.headless, executablePath: cfg.browserExecutable, observer, diagnosticAllowedHosts: process.argv.filter((a) => a.startsWith('--allow-host=')).map((a) => a.slice('--allow-host='.length)).filter((h) => /^[a-z0-9.-]+$/.test(h)), sink: () => undefined });
  await driver.complete({
    checkoutUrl: ref.checkoutUrl,
    fulfillment,
    expectedTotal,
    shippingTitle: ref.shippingTitle,
    storePassword: cfg.storePassword,
    log,
    checkpoint: async (step) => {
      // The production driver checkpoints BEFORE the click: throwing here guarantees no click.
      if (step === 'pay_click') throw new RehearsalStop();
      throw new Error(`unexpected_checkpoint_${step}`);
    },
  });
  outcome = 'SAFETY_VIOLATION_DRIVER_RETURNED_WITHOUT_STOPPING';
} catch (e) {
  if (e instanceof RehearsalStop) outcome = 'REHEARSAL_STOPPED_BEFORE_PAY_CLICK';
  else {
    outcome = 'REHEARSAL_FAILED_BEFORE_PAY_CLICK';
    failure = { code: String((e as { code?: unknown }).code ?? (e as Error).name), message: String((e as Error).message).slice(0, 120) };
  }
}
if (stepsSeen.includes('await_confirmation')) outcome = 'SAFETY_VIOLATION_POST_CLICK_STEP_REACHED';

// Independent proof that no order exists.
let ordersCreated: number | string = 'unchecked';
try {
  ordersCreated = (await new AdminClient(cfg, fetch, systemClock).searchOrders({ createdAfter: startedAt })).length;
} catch {
  ordersCreated = 'readback_failed';
}
const blockedList = [...blocked.values()];
emit('end', { outcome, failure, ordersCreatedSinceStart: ordersCreated, blockedRequests: blockedList });
fs.writeFileSync(
  path.join(outDir, '03-rehearsal-summary.md'),
  [
    '# Shopify rehearsal summary',
    '',
    `- outcome: **${outcome}**`,
    failure ? `- failure: ${failure.code} — ${failure.message}` : '- failure: none',
    `- steps: ${stepsSeen.join(' → ')}`,
    `- orders created since start (Admin readback): ${ordersCreated}`,
    `- blocked (hostname | type | frame | count): ${blockedList.map((b) => `${b.hostname}|${b.resourceType}|${b.frame}|${b.count}`).join('; ') || 'none'}`,
    '',
    'See 02-shopify-rehearsal.jsonl for per-step snapshots.',
    '',
  ].join('\n'),
);
console.log(JSON.stringify({ outcome, failure, steps: stepsSeen, ordersCreated, blockedCount: blockedList.length }, null, 1));
process.exit(outcome === 'REHEARSAL_STOPPED_BEFORE_PAY_CLICK' ? 0 : 1);
