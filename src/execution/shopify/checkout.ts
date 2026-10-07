import type { RetailFulfillment } from '../../contracts/intent.js';
import type { Money } from '../../contracts/money.js';
import { redactString } from '../../infrastructure/redact.js';

/**
 * Separate read-only quote observation from payment execution. Quote inputs have no payment
 * checkpoint and the quote path never enters card details or touches Pay. Execution MUST await
 * the durable pay_click checkpoint before clicking; failures after it remain unknown outcomes.
 */
export interface CheckoutQuoteInput {
  checkoutUrl: string;
  fulfillment: RetailFulfillment;
  expectedSubtotal: Money;
  expectedShipping: Money;
  shippingTitle: string;
  storePassword: string | null;
  log(step: string): void;
}

export interface CheckoutTotals {
  total: Money;
  subtotal: Money;
  shipping: Money;
  tax: Money;
  shippingTitle: string;
}

export interface CheckoutDriverInput {
  checkoutUrl: string;
  fulfillment: RetailFulfillment;
  /** Exact total the on-page total must equal before the test card is entered or pay is clicked. */
  expectedTotal: Money;
  /** Frozen hosted-checkout breakdown for new quotes; absent on legacy cart-exact quotes. */
  expectedCheckoutTotals?: CheckoutTotals;
  shippingTitle: string;
  /** Dev-store storefront password, if the gate appears. */
  storePassword: string | null;
  checkpoint(step: string, data: Record<string, unknown>): Promise<void>;
  /** Step names only (e.g. `fill_email`). Never pass page text, field values or error bodies. */
  log(step: string): void;
}

export interface CheckoutDriverResult {
  /** Order name as shown, e.g. `#1001`, when the page exposes it. */
  orderName?: string;
  /** Customer-facing confirmation number (Admin `confirmationNumber`), when shown. */
  confirmationNumber?: string;
}

export interface CheckoutDriver {
  /** Reads settled checkout totals without card entry, payment checkpoints or a Pay click. */
  quote(input: CheckoutQuoteInput): Promise<CheckoutTotals>;
  complete(input: CheckoutDriverInput): Promise<CheckoutDriverResult>;
}

export type CheckoutAbortCode =
  | 'captcha_challenge'
  | 'otp_challenge'
  | 'password_gate_failed'
  | 'test_gateway_not_active'
  | 'total_mismatch'
  | 'quote_expired'
  | 'untrusted_checkout_url'
  | 'browser_unavailable'
  | 'payment_fields_invalid'
  | 'payment_validation_failed'
  | 'step_failed'
  | 'order_not_confirmed';

/**
 * Deliberate stop. `code` is machine-readable; `message` is a fixed phrase (never page content).
 * Whether it is definite or unknown is decided by the executor from the pay_click checkpoint.
 */
export class CheckoutAbort extends Error {
  constructor(
    readonly code: CheckoutAbortCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

const STEP_NAME = /^[a-z0-9][a-z0-9_.-]{0,47}$/;

/**
 * Step-name-only logger. Anything that is not a plain step identifier is replaced, so a caller
 * cannot leak a field value, address, order text or token through it, and the sink only ever
 * sees redacted text.
 */
export function createStepLogger(sink: (line: string) => void): (step: string) => void {
  return (step: string) => {
    const safe = STEP_NAME.test(step) ? step : 'invalid_step_name';
    sink(redactString(`shopify.checkout step=${safe}`));
  };
}

/** Default sink: stderr, step names only. */
export const stderrSink = (line: string): void => {
  process.stderr.write(`${line}\n`);
};
