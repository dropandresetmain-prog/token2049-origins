import type { Page, Browser } from 'playwright-core';
import { parseDecimalToMinor, type Money } from '../../contracts/money.js';
import { systemClock, type Clock } from '../../infrastructure/clock.js';
import { CheckoutAbort, createStepLogger, stderrSink, type CheckoutDriver, type CheckoutDriverInput, type CheckoutDriverResult } from './checkout.js';

/**
 * Controlled buyer checkout of OUR OWN Shopify development store, completed with Shopify's
 * published test gateway (Bogus: card number `1`). This is the only place a payment is
 * submitted, and it runs only after (1) the on-page total equals the quoted total and (2) the page
 * shows the test gateway.
 *
 * Hard rules enforced here:
 * - never screenshot, trace, record video or log page text/field values (step names only);
 * - never solve or bypass a CAPTCHA/challenge/OTP: stop (before pay = not sent, after = unknown);
 * - `pay_click` is checkpointed durably BEFORE the single pay click, and the click is never retried.
 *
 * Selectors target Shopify's hosted one-page checkout and are UNVERIFIED against a live store
 * (no provisioned store at build time); see docs/evidence/shopify-protocol.md.
 */

/* ---------------- pure helpers (unit-tested) ---------------- */

/** Published Shopify test-gateway values. These are not real card data. */
export const BOGUS_CARD = { number: '1', name: 'Bogus Gateway', cvv: '123' } as const;

const TEST_GATEWAY_TEXT = /bogus gateway|test payment gateway/i;
const CAPTCHA_TEXT = /verify (that )?you are (a )?human|i['’]m not a robot|complete the (captcha|security challenge)/i;
const OTP_TEXT = /one-time (code|passcode|password)|we (sent|texted|emailed) (you )?a (verification )?code|enter the (verification )?code (we|sent)/i;

export function hasTestGateway(pageText: string): boolean {
  return TEST_GATEWAY_TEXT.test(pageText);
}

export function challengeFromText(pageText: string): 'captcha_challenge' | 'otp_challenge' | null {
  if (CAPTCHA_TEXT.test(pageText)) return 'captcha_challenge';
  if (OTP_TEXT.test(pageText)) return 'otp_challenge';
  return null;
}

const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;

/**
 * Amounts appearing after a standalone "Total" label (not "Subtotal"), in page order. Handles
 * US-style grouping only (comma thousands, dot decimal); anything else yields no match and
 * therefore a total mismatch, which fails closed.
 */
export function parseDisplayedTotals(pageText: string, scale: number): bigint[] {
  const out: bigint[] = [];
  const re = new RegExp(String.raw`(?<![A-Za-z])Total\b[^\d\n]{0,40}${AMOUNT}`, 'g');
  for (const m of pageText.matchAll(re)) {
    try {
      out.push(parseDecimalToMinor(m[1]!.replace(/,/g, ''), scale));
    } catch {
      /* more precision than the currency allows: not a match */
    }
  }
  return out;
}

/** The final order total on the page is the LAST "Total" amount (the summary, after shipping/tax). */
export function displayedTotalMatches(pageText: string, expected: Money): boolean {
  const re = new RegExp(String.raw`(?<![A-Za-z])Total\b([^\d\n]{0,40})${AMOUNT}([^\n]{0,12})`, 'g');
  const matches = [...pageText.matchAll(re)];
  const last = matches.at(-1);
  if (!last || !new RegExp(`\\b${expected.currency}\\b`).test(`${last[1]} ${last[3]}`)) return false;
  try { return parseDecimalToMinor(last[2]!.replace(/,/g,''), expected.scale) === BigInt(expected.amountMinor); }
  catch { return false; }
}

/** Price of a shipping-method label: "Free" => 0, else first decimal amount; null if unparseable. */
export function parseShippingPrice(label: string, scale: number): bigint | null {
  if (/\bfree\b/i.test(label)) return 0n;
  const m = new RegExp(AMOUNT).exec(label);
  if (!m) return null;
  try {
    return parseDecimalToMinor(m[1]!.replace(/,/g, ''), scale);
  } catch {
    return null;
  }
}

export function extractOrderIdentifiers(pageText: string): { orderName?: string; confirmationNumber?: string } {
  const out: { orderName?: string; confirmationNumber?: string } = {};
  const conf = /Confirmation\s*(?:number\s*)?#?\s*([A-Z0-9]{6,12})\b/.exec(pageText);
  if (conf) out.confirmationNumber = conf[1]!;
  const name = /\bOrder\s*#\s*(\d{3,})\b/.exec(pageText);
  if (name) out.orderName = `#${name[1]}`;
  return out;
}

/** `MM / YY` two years ahead of `now`. */
export function futureExpiry(now: Date): string {
  const d = new Date(now.getTime());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = String((d.getUTCFullYear() + 2) % 100).padStart(2, '0');
  return `${mm} / ${yy}`;
}

/** Only our own store's https checkout may be opened. */
export function isTrustedCheckoutUrl(url: string, storeDomain: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && u.hostname.toLowerCase() === storeDomain.toLowerCase() && /^\/(checkouts\/|cart\/c\/)/.test(u.pathname);
  } catch {
    return false;
  }
}

/* ---------------- Playwright driver ---------------- */

export interface PlaywrightCheckoutOptions {
  storeDomain: string;
  headless?: boolean;
  executablePath?: string | null;
  clock?: Clock;
  /** Sink for step-name log lines. Default: stderr. */
  sink?: (line: string) => void;
}

const NAV_TIMEOUT_MS = 45_000;
const STEP_TIMEOUT_MS = 20_000;
const CONFIRM_TIMEOUT_MS = 90_000;
const CHALLENGE_FRAMES = 'iframe[src*="hcaptcha.com"], iframe[src*="recaptcha"], iframe[src*="challenges.cloudflare.com"]';

export class PlaywrightCheckoutDriver implements CheckoutDriver {
  private readonly clock: Clock;
  constructor(private readonly opts: PlaywrightCheckoutOptions) {
    this.clock = opts.clock ?? systemClock;
  }

  async complete(input: CheckoutDriverInput): Promise<CheckoutDriverResult> {
    if (!isTrustedCheckoutUrl(input.checkoutUrl, this.opts.storeDomain)) throw new CheckoutAbort('untrusted_checkout_url');
    const log = input.log;
    let browser: Browser;
    try {
      const { chromium } = await import('playwright-core');
      // Default resolution uses the local Playwright cache; SHOPIFY_BROWSER_EXECUTABLE overrides.
      browser = await chromium.launch({
        headless: this.opts.headless ?? true,
        ...(this.opts.executablePath ? { executablePath: this.opts.executablePath } : {}),
      });
    } catch {
      throw new CheckoutAbort('browser_unavailable');
    }
    try {
      // No video, no trace, no HAR: nothing that could capture PII is ever enabled.
      const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
      context.setDefaultTimeout(STEP_TIMEOUT_MS);
      await context.route('**/*', async route => {
        const request = route.request();
        try {
          const u = new URL(request.url());
          const store = u.hostname === this.opts.storeDomain;
          const staticShopify = ['cdn.shopify.com', 'checkout.shopify.com'].includes(u.hostname) || u.hostname.endsWith('.shopifycdn.com');
          const mainNavigation = request.isNavigationRequest() && request.frame().parentFrame() === null;
          if (u.protocol !== 'https:' || u.username || u.password || u.port || (mainNavigation ? !store : !(store || staticShopify))) return await route.abort();
          await route.continue();
        } catch { await route.abort(); }
      });
      const page = await context.newPage();
      return await this.run(page, input, log);
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  /** Run one named step; any non-abort failure becomes a content-free `step_failed`. */
  private async step<T>(log: (s: string) => void, name: string, fn: () => Promise<T>): Promise<T> {
    log(name);
    try {
      return await fn();
    } catch (e) {
      if (e instanceof CheckoutAbort) throw e;
      // Playwright messages can embed locators/page text: keep only the step name and error class.
      throw new CheckoutAbort('step_failed', `step ${name} failed`);
    }
  }

  private async bodyText(page: Page): Promise<string> {
    return page.locator('body').innerText();
  }

  private async assertNoChallenge(page: Page): Promise<void> {
    const frames = page.locator(CHALLENGE_FRAMES);
    const n = await frames.count();
    for (let i = 0; i < n; i++) if (await frames.nth(i).isVisible()) throw new CheckoutAbort('captcha_challenge');
    const c = challengeFromText(await this.bodyText(page));
    if (c) throw new CheckoutAbort(c);
  }

  private async run(page: Page, input: CheckoutDriverInput, log: (s: string) => void): Promise<CheckoutDriverResult> {
    const { fulfillment: f, expectedTotal } = input;
    const a = f.shippingAddress;

    await this.step(log, 'open_checkout', () => page.goto(input.checkoutUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }));

    // Storefront password gate on development stores.
    if (await this.onPasswordGate(page)) {
      if (!input.storePassword) throw new CheckoutAbort('password_gate_failed');
      await this.step(log, 'password_gate', async () => {
        await page.locator('input[type="password"]').first().fill(input.storePassword!);
        await page.getByRole('button', { name: /enter/i }).first().click();
        await page.waitForLoadState('domcontentloaded');
        await page.goto(input.checkoutUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      });
      if (await this.onPasswordGate(page)) throw new CheckoutAbort('password_gate_failed');
    }
    await this.assertNoChallenge(page);

    await this.step(log, 'fill_email', () =>
      page.locator('input[name="email"], input[autocomplete~="email"], input[type="email"]').first().fill(f.email),
    );
    // Country first: it changes which address fields exist.
    await this.step(log, 'select_country', () => page.locator('select[name="countryCode"]').first().selectOption(a.countryCode));
    await this.step(log, 'fill_name', async () => {
      await page.locator('input[name="firstName"], input[autocomplete~="given-name"]').first().fill(a.firstName);
      await page.locator('input[name="lastName"], input[autocomplete~="family-name"]').first().fill(a.lastName);
    });
    await this.step(log, 'fill_address', async () => {
      await page.locator('input[name="address1"], input[autocomplete~="address-line1"]').first().fill(a.address1);
      if (a.address2) await page.locator('input[name="address2"], input[autocomplete~="address-line2"]').first().fill(a.address2);
      await page.locator('input[name="city"], input[autocomplete~="address-level2"]').first().fill(a.city);
      await page.locator('input[name="postalCode"], input[autocomplete~="postal-code"]').first().fill(a.zip);
    });
    if (a.province) {
      await this.step(log, 'select_province', async () => {
        const sel = page.locator('select[name="zone"]').first();
        if ((await sel.count()) > 0) await sel.selectOption(a.province!).catch(() => sel.selectOption({ label: a.province! }));
      });
    }
    if (a.phone) {
      await this.step(log, 'fill_phone', async () => {
        const p = page.locator('input[name="phone"], input[type="tel"]').first();
        if ((await p.count()) > 0) await p.fill(a.phone!);
      });
    }
    await this.assertNoChallenge(page);

    await this.step(log, 'choose_shipping', () => this.chooseQuotedShipping(page, input.shippingTitle));
    await this.step(log, 'verify_total', () => this.waitForTotal(page, expectedTotal));

    // Test gateway must be visible BEFORE any card value is entered.
    await this.step(log, 'verify_test_gateway', async () => {
      const gw = page.getByText(TEST_GATEWAY_TEXT).first();
      const seen = (await gw.count()) > 0 && hasTestGateway(await this.bodyText(page));
      if (!seen) throw new CheckoutAbort('test_gateway_not_active');
      await gw.click().catch(() => undefined); // select the payment method if it is a radio row
    });
    await this.step(log, 'fill_test_card', async () => {
      const inFrame = (prefix: string) => page.frameLocator(`iframe[name^="${prefix}"]`).locator('input').first();
      await inFrame('card-fields-number').fill(BOGUS_CARD.number);
      await inFrame('card-fields-name').fill(BOGUS_CARD.name);
      await inFrame('card-fields-expiry').fill(futureExpiry(this.clock.now()));
      await inFrame('card-fields-verification_value').fill(BOGUS_CARD.cvv);
    });

    await this.assertNoChallenge(page);
    // Re-verify immediately before paying: totals can move when fields settle.
    await this.step(log, 'reverify_total', () => this.waitForTotal(page, expectedTotal));

    // Durable BEFORE the click. If this throws, nothing was clicked.
    const payButton = page.getByRole('button', { name: /pay now|complete order|place order/i }).first();
    // Trial resolves actionability before the durable boundary.
    await payButton.click({ trial: true });
    await this.chooseQuotedShipping(page, input.shippingTitle);
    await this.waitForTotal(page, expectedTotal);
    if (!hasTestGateway(await this.bodyText(page))) throw new CheckoutAbort('test_gateway_not_active');
    if (new URL(page.url()).hostname !== this.opts.storeDomain) throw new CheckoutAbort('untrusted_checkout_url');
    const payElement = await payButton.elementHandle();
    if (!payElement) throw new CheckoutAbort('step_failed');
    await input.checkpoint('pay_click', { at: this.clock.now().toISOString() });
    log('pay_click');
    // Everything below is post-click: the executor treats any failure as an unknown outcome.
    try {
      await payElement.click({ force: true, timeout: 5000, noWaitAfter: true });
    } catch {
      throw new CheckoutAbort('step_failed', 'step pay_click failed');
    }

    log('await_confirmation');
    const deadline = this.clock.now().getTime() + CONFIRM_TIMEOUT_MS;
    for (;;) {
      if (/thank[-_]?you|\/orders\/[a-f0-9]{8,}/i.test(page.url())) break;
      await this.assertNoChallenge(page);
      if (this.clock.now().getTime() > deadline) throw new CheckoutAbort('order_not_confirmed');
      await page.waitForTimeout(1000);
    }
    log('read_confirmation');
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    const ids = extractOrderIdentifiers(await this.bodyText(page));
    const providerReference = ids.orderName ?? ids.confirmationNumber;
    if (providerReference) {
      await input.checkpoint('order', { providerReference, kind: ids.orderName ? 'name' : 'confirmation' });
    }
    return ids;
  }

  private async onPasswordGate(page: Page): Promise<boolean> {
    return /\/password\b/.test(new URL(page.url()).pathname) || (await page.locator('form[action*="password"] input[type="password"]').count()) > 0;
  }

  private async chooseQuotedShipping(page: Page, title: string): Promise<void> {
    const radios = page.getByRole('radio', { name: title, exact: false });
    if (await radios.count() === 1) await radios.check();
    else {
      // A single automatic method still has to expose the quoted title on the checkout page.
      const label = page.getByText(title, { exact: true });
      if (await label.count() !== 1) throw new CheckoutAbort('total_mismatch');
    }
  }
  /** Totals settle asynchronously after shipping/tax: poll until equal, else abort before paying. */
  private async waitForTotal(page: Page, expected: Money): Promise<void> {
    const end = this.clock.now().getTime() + STEP_TIMEOUT_MS;
    for (;;) {
      if (displayedTotalMatches(await this.bodyText(page), expected)) return;
      if (this.clock.now().getTime() > end) throw new CheckoutAbort('total_mismatch');
      await page.waitForTimeout(500);
    }
  }
}

export function createPlaywrightDriver(opts: PlaywrightCheckoutOptions): PlaywrightCheckoutDriver {
  return new PlaywrightCheckoutDriver({ sink: stderrSink, ...opts });
}

export { createStepLogger };
