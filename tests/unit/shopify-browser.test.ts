import { demoData } from '../../src/demo/config.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Browser, Page, BrowserContext, Route } from 'playwright-core';
import { BOGUS_CARD, PlaywrightCheckoutDriver, futureExpiry, readCheckoutTotals, type CheckoutObserver } from '../../src/execution/shopify/browserCheckout.js';
import { ManualClock } from '../../src/infrastructure/clock.js';
import { money } from '../../src/contracts/money.js';
import type { CheckoutDriverInput, CheckoutQuoteInput } from '../../src/execution/shopify/checkout.js';

const mocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('playwright-core', () => ({ chromium: { launch: mocks.launch } }));

function fixture(observer?: CheckoutObserver, options: { billing?: boolean; failBillingField?: string; singapore?: boolean } = {}) {
  const clock = new ManualClock();
  const events: string[] = [];
  let url = 'https://test-shop.myshopify.com/checkouts/fixture';
  let text = 'Standard\nBogus Gateway\nTotal USD $32.00';
  const pay = vi.fn(async () => { events.push('click'); url = 'https://test-shop.myshopify.com/checkouts/fixture/thank_you'; text = 'Order #1001'; });
  const fill = vi.fn(async (_value: string) => undefined);
  type CardFieldState = { value: string; invalid: boolean; valid: boolean; acceptsInput: boolean };
  const fields = new Map<string, Map<string, CardFieldState>>();
  const billingFields = new Map<string, string>();
  const billingSelects = new Map<string, string>();
  const billingRoles: string[] = [];
  const makeFieldLocator = (frameName: string, inputName: string) => {
    const frameFields = fields.get(frameName) ?? new Map<string, CardFieldState>();
    fields.set(frameName, frameFields);
    const state = frameFields.get(inputName) ?? { value: '', invalid: false, valid: true, acceptsInput: true };
    frameFields.set(inputName, state);
    return {
      first() { return this; },
      count: vi.fn(async () => 1),
      fill: vi.fn(async (value: string) => { if (state.acceptsInput) state.value = value; fill(value); }),
      inputValue: vi.fn(async () => state.value),
      getAttribute: vi.fn(async (name: string) => name === 'aria-invalid' && state.invalid ? 'true' : null),
      evaluate: vi.fn(async (fn: (el: { checkValidity: () => boolean }) => unknown) => fn({ checkValidity: () => state.valid })),
      selectOption: vi.fn(async () => undefined),
      isVisible: vi.fn(async () => true),
      isEnabled: vi.fn(async () => true),
      click: vi.fn(async () => undefined),
    };
  };
  const generic = { first() { return this; }, fill, selectOption: vi.fn(async () => undefined), count: vi.fn(async () => 0), isVisible: vi.fn(async () => false), click: vi.fn(async () => undefined) };
  const button = { ...generic, click: vi.fn(async ({trial}: {trial?:boolean}) => { expect(trial).toBe(true); }), elementHandle: vi.fn(async () => ({ click: pay })) };
  let routeHandler: ((route: Route) => Promise<void>) | undefined;
  const context = { setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => page), route: vi.fn(async (_pattern,handler) => { routeHandler = handler; }) } as unknown as BrowserContext;
  const page = {
    goto: vi.fn(async () => undefined), url: () => url, waitForLoadState: vi.fn(async () => undefined), waitForTimeout: vi.fn(async (ms: number) => clock.advance(ms)),
    locator: vi.fn((selector: string) => {
      if (selector === 'body') return {innerText: async () => text};
      if (options.singapore && selector === 'input[name="city"], input[autocomplete~="address-level2"]') return {
        ...generic, first: () => ({ fill: async () => { throw new Error('Singapore city is only an autofill clone'); } }),
      };
      const billingSelect = /select\[autocomplete="billing ([^"]+)"\]:visible/.exec(selector)?.[1];
      if (billingSelect) return {
        count: vi.fn(async () => options.billing ? 1 : 0),
        selectOption: vi.fn(async (value: string) => { billingSelects.set(billingSelect, value); }),
      };
      const billingField = /input\[autocomplete="billing ([^"]+)"\]/.exec(selector)?.[1];
      if (billingField) return {
        // Raw CSS sees the ordinary field plus an aria-hidden autofill clone. Only the
        // accessible role intersection below may fill this ambiguous selector.
        count: vi.fn(async () => options.billing ? 2 : 0),
        fill: vi.fn(async () => { throw new Error('ambiguous billing controls'); }),
        accessibleFill: vi.fn(async (value: string) => {
          if (options.failBillingField === billingField) throw new Error('billing fill failed');
          billingFields.set(billingField, value);
        }),
      };
      return generic;
    }),
    getByRole: vi.fn((role: string) => {
      if (role === 'button') return button;
      billingRoles.push(role);
      return {
        ...generic,
        count: async (): Promise<number> => 1,
        check: async () => undefined,
        or: vi.fn(() => ({
          and: vi.fn((fieldLocator: { accessibleFill?: (value: string) => Promise<void> }) => ({
            fill: fieldLocator.accessibleFill ?? generic.fill,
          })),
        })),
      };
    }),
    getByText: vi.fn(() => ({...generic,count:async (): Promise<number> => 1})),
    // Shopify's hosted card iframes expose eight inputs. The first is always the card number;
    // select by the intended input name so the regression catches positional selection.
    frameLocator: vi.fn((selector: string) => {
      const frameName = /card-fields-([^"]+)/.exec(selector)?.[1] ?? 'unknown';
      return { locator: (inputSelector: string) => {
        const requested = /input\[name="([^"]+)"\]/.exec(inputSelector)?.[1];
        return makeFieldLocator(frameName, requested ?? 'number');
      } };
    }),
  } as unknown as Page;
  const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined) } as unknown as Browser;
  mocks.launch.mockResolvedValue(browser);
  const driver = new PlaywrightCheckoutDriver({storeDomain:'test-shop.myshopify.com',executablePath:'fixture-browser',clock,observer});
  const input: CheckoutDriverInput = {
    checkoutUrl:url,expectedTotal:money('USD',3200),shippingTitle:'Standard',storePassword:null,
    fulfillment:{category:'retail',...demoData.buyer},
    checkpoint:vi.fn(async step => { events.push(step); }), log:vi.fn(),
  };
  const quoteInput: CheckoutQuoteInput = {
    checkoutUrl:url, expectedSubtotal:money('USD',2500), expectedShipping:money('USD',500), shippingTitle:'Standard',
    storePassword:null, fulfillment:{category:'retail',...demoData.buyer}, log:vi.fn(),
  };
  return {driver,input,quoteInput,pay,fill,events,browser,context,page,button,clock,fields,billingFields,billingSelects,billingRoles,setFieldState:(frameName:string, field:string, patch:Partial<CardFieldState>) => {
    const frameFields = fields.get(frameName) ?? new Map<string, CardFieldState>();
    const state = frameFields.get(field) ?? { value: '', invalid: false, valid: true, acceptsInput: true };
    frameFields.set(field, { ...state, ...patch }); fields.set(frameName, frameFields);
  },setText:(value:string) => {text=value;},routeHandler:()=>routeHandler!};
}

beforeEach(() => mocks.launch.mockReset());
describe('controlled Shopify browser payment boundary', () => {
  it('awaits the durable checkpoint before exactly one test-gateway click', async () => {
    const s = fixture();
    expect(await s.driver.complete(s.input)).toEqual({orderName:'#1001'});
    expect(s.events).toEqual(['pay_click','click','order']);
    expect(s.pay).toHaveBeenCalledTimes(1);
    expect(s.browser.newContext).toHaveBeenCalledWith({acceptDownloads:false,serviceWorkers:'block'});
    expect(s.browser.close).toHaveBeenCalledOnce();
  });
  it('fills the named card inputs in their matching hosted frames before the single Pay click', async () => {
    const s = fixture();
    expect(await s.driver.complete(s.input)).toEqual({orderName:'#1001'});
    expect(s.fields.get('number')?.get('number')?.value).toBe(BOGUS_CARD.number);
    expect(s.fields.get('name')?.get('name')?.value).toBe(BOGUS_CARD.name);
    expect(s.fields.get('expiry')?.get('expiry')?.value).toBe(futureExpiry(s.clock.now()));
    expect(s.fields.get('verification_value')?.get('verification_value')?.value).toBe(BOGUS_CARD.cvv);
    expect(s.pay).toHaveBeenCalledOnce();
  });
  it.each([
    ['empty', { value: '', acceptsInput: false }],
    ['aria-invalid', { invalid: true }],
    ['wrong populated value', { value: '12/34', acceptsInput: false }],
  ])('stops before checkpoint and Pay when a named card field is %s', async (_label, state) => {
    const s = fixture();
    s.setFieldState('expiry', 'expiry', state);
    await expect(s.driver.complete(s.input)).rejects.toMatchObject({ code: 'payment_fields_invalid' });
    expect(s.input.checkpoint).not.toHaveBeenCalled();
    expect(s.events).toEqual([]);
    expect(s.pay).not.toHaveBeenCalled();
  });
  it('accepts the correct test name value even when native checkValidity reports the empty-pattern quirk', async () => {
    const s = fixture();
    s.setFieldState('name', 'name', { valid: false });
    expect(await s.driver.complete(s.input)).toEqual({orderName:'#1001'});
    expect(s.fields.get('name')?.get('name')?.value).toBe(BOGUS_CARD.name);
    expect(s.pay).toHaveBeenCalledOnce();
  });
  it('fills only the explicit billing controls with the synthetic test buyer address', async () => {
    const s = fixture(undefined, { billing: true });
    expect(await s.driver.complete(s.input)).toEqual({orderName:'#1001'});
    expect(s.billingSelects.get('country-name')).toBe(demoData.buyer.shippingAddress.countryCode);
    expect(s.billingSelects.get('address-level1')).toBe(demoData.buyer.shippingAddress.province);
    expect(s.billingFields).toEqual(new Map([
      ['given-name', demoData.buyer.shippingAddress.firstName],
      ['family-name', demoData.buyer.shippingAddress.lastName],
      ['address-line1', demoData.buyer.shippingAddress.address1],
      ['address-line2', ''],
      ['address-level2', demoData.buyer.shippingAddress.city],
      ['postal-code', demoData.buyer.shippingAddress.zip],
    ]));
    expect(s.billingRoles).toContain('textbox');
    expect(s.billingRoles).toContain('combobox');
    expect(s.pay).toHaveBeenCalledOnce();
  });
  it('preserves checkout behavior when no separate billing form is present', async () => {
    const s = fixture();
    expect(await s.driver.complete(s.input)).toEqual({orderName:'#1001'});
    expect(s.billingFields.size).toBe(0);
    expect(s.billingSelects.size).toBe(0);
    expect(s.pay).toHaveBeenCalledOnce();
  });
  it('stops before Pay when a visible billing input cannot be filled', async () => {
    const s = fixture(undefined, { billing: true, failBillingField: 'address-level2' });
    await expect(s.driver.complete(s.input)).rejects.toMatchObject({ code: 'step_failed' });
    expect(s.input.checkpoint).not.toHaveBeenCalled();
    expect(s.events).toEqual([]);
    expect(s.pay).not.toHaveBeenCalled();
  });
  it('captures confirmation timeout before page cleanup without a second Pay click', async () => {
    const failure = vi.fn(async (step: string) => { expect(step).toBe('await_confirmation'); expect(s.browser.close).not.toHaveBeenCalled(); });
    const s = fixture({ stepFailed: failure });
    s.pay.mockImplementationOnce(async () => { s.events.push('click'); s.setText('Processing your order'); });
    await expect(s.driver.complete(s.input)).rejects.toMatchObject({code:'order_not_confirmed'});
    expect(failure).toHaveBeenCalledOnce();
    expect(s.pay).toHaveBeenCalledOnce();
    expect(s.events).toEqual(['pay_click','click']);
    expect(s.browser.close).toHaveBeenCalledOnce();
    expect(s.input.log).toHaveBeenCalledWith('await_confirmation');
  });
  it.each([
    'Enter a valid card number',
    'Enter a valid expiration date',
    'Enter a valid expiry date',
    'Enter a valid security code',
    'Your card was declined',
    'Your card has been declined',
  ])('stops confirmation polling promptly on post-Pay validation text: %s', async (message) => {
    const failure = vi.fn(async (step: string) => { expect(step).toBe('await_confirmation'); });
    const s = fixture({ stepFailed: failure });
    const startedAt = s.clock.now().getTime();
    s.pay.mockImplementationOnce(async () => { s.events.push('click'); s.setText(message); });
    await expect(s.driver.complete(s.input)).rejects.toMatchObject({code:'payment_validation_failed'});
    expect(s.clock.now().getTime() - startedAt).toBeLessThan(90_000);
    expect(failure).toHaveBeenCalledOnce();
    expect(failure).toHaveBeenCalledWith('await_confirmation');
    expect(s.pay).toHaveBeenCalledOnce();
    expect(s.events).toEqual(['pay_click','click']);
  });
  it('keeps the original unknown-outcome timeout if diagnostics throw', async () => {
    const s = fixture({stepFailed:async () => { throw new Error('diagnostics unavailable'); }});
    s.pay.mockImplementationOnce(async () => { s.events.push('click'); });
    await expect(s.driver.complete(s.input)).rejects.toMatchObject({code:'order_not_confirmed'});
    expect(s.pay).toHaveBeenCalledOnce();
    expect(s.events).toEqual(['pay_click','click']);
    expect(s.browser.close).toHaveBeenCalledOnce();
  });
  it('captures a post-Pay challenge while preserving the single submission', async () => {
    const failure = vi.fn(async () => undefined);
    const s = fixture({stepFailed:failure});
    s.pay.mockImplementationOnce(async () => { s.events.push('click'); s.setText('Verify you are human'); });
    await expect(s.driver.complete(s.input)).rejects.toMatchObject({code:'captcha_challenge'});
    expect(failure).toHaveBeenCalledWith('await_confirmation');
    expect(s.events).toEqual(['pay_click','click']);
    expect(s.pay).toHaveBeenCalledOnce();
  });
  it('captures a failed Pay action after its checkpoint without retrying it', async () => {
    const failure = vi.fn(async () => undefined);
    const s = fixture({stepFailed:failure});
    s.pay.mockRejectedValueOnce(new Error('page detached'));
    await expect(s.driver.complete(s.input)).rejects.toMatchObject({code:'step_failed'});
    expect(failure).toHaveBeenCalledWith('pay_click');
    expect(s.events).toEqual(['pay_click']);
    expect(s.pay).toHaveBeenCalledOnce();
    expect(s.browser.close).toHaveBeenCalledOnce();
  });
  it('does not click on checkpoint failure', async () => {
    const s = fixture(); s.input.checkpoint = async () => { throw new Error('disk failure'); };
    await expect(s.driver.complete(s.input)).rejects.toThrow('disk failure');
    expect(s.pay).not.toHaveBeenCalled();
    expect(s.browser.close).toHaveBeenCalledOnce();
  });
  it('stops before filling card or paying on a challenge', async () => {
    const s = fixture(); s.setText('Verify you are human');
    await expect(s.driver.complete(s.input)).rejects.toMatchObject({code:'captcha_challenge'});
    expect(s.fill).not.toHaveBeenCalled(); expect(s.pay).not.toHaveBeenCalled();
  });
  it('stops before payment when currency or final total differs', async () => {
    const s = fixture(); s.setText('Standard\nBogus Gateway\nSubtotal USD $25.00\nTotal SGD $32.00');
    await expect(s.driver.complete(s.input)).rejects.toMatchObject({code:'total_mismatch'});
    expect(s.pay).not.toHaveBeenCalled();
  });
  it('stops before card entry if Bogus gateway is absent', async () => {
    const s = fixture(); s.setText('Standard\nTotal USD $32.00');
    await expect(s.driver.complete(s.input)).rejects.toMatchObject({code:'test_gateway_not_active'});
    expect(s.pay).not.toHaveBeenCalled(); expect(s.page.frameLocator).not.toHaveBeenCalled();
  });
  it('blocks navigation to other stores and non-Shopify subresources', async () => {
    const s = fixture(); await s.driver.complete(s.input);
    for (const [url,navigation] of [['https://other.myshopify.com/checkouts/x',true],['http://127.0.0.1/admin',false],['https://evil.example/pixel',false]] as const) {
      const abort = vi.fn(async () => undefined); const proceed = vi.fn(async () => undefined);
      const route = { request: () => ({url:()=>url,isNavigationRequest:()=>navigation,frame:()=>({parentFrame:()=>null})}),abort,continue:proceed } as unknown as Route;
      await s.routeHandler()(route); expect(abort).toHaveBeenCalledOnce(); expect(proceed).not.toHaveBeenCalled();
    }
  });
});
describe('hosted checkout quote-only boundary', () => {
  it('quotes Singapore with no city or province controls and never fills hidden city clones or enters payment', async () => {
    const s = fixture(undefined, { billing: true, failBillingField: 'address-level2', singapore: true });
    s.quoteInput.fulfillment = { category: 'retail', email: 'buyer@example.com', shippingAddress: {
      firstName: 'Test', lastName: 'Buyer', address1: '1 Test Street', city: 'Singapore', zip: '018956', countryCode: 'SG',
    } };
    s.setText('Standard\nBogus Gateway\nSubtotal USD $25.00\nShipping USD $5.00\nTotal tax USD $2.00\nTotal USD $32.00');
    await expect(s.driver.quote(s.quoteInput)).resolves.toMatchObject({ total: money('USD', 3200) });
    expect(s.billingSelects.get('country-name')).toBe('SG');
    expect(s.billingSelects.has('address-level1')).toBe(false);
    expect(s.billingFields).toEqual(new Map([
      ['given-name', 'Test'], ['family-name', 'Buyer'], ['address-line1', '1 Test Street'], ['address-line2', ''], ['postal-code', '018956'],
    ]));
    expect(s.page.frameLocator).not.toHaveBeenCalled();
    expect(s.button.click).not.toHaveBeenCalled();
    expect(s.pay).not.toHaveBeenCalled();
  });
  it('reads a settled quote without card entry, checkpoint, or pay action', async () => {
    const s = fixture();
    s.setText('Standard\nBogus Gateway\nSubtotal USD $25.00\nShipping USD $5.00\nTotal tax USD $2.00\nTotal USD $32.00');
    await expect(s.driver.quote(s.quoteInput)).resolves.toEqual({
      subtotal:money('USD',2500), shipping:money('USD',500), tax:money('USD',200), total:money('USD',3200), shippingTitle:'Standard',
    });
    expect(s.page.frameLocator).not.toHaveBeenCalled();
    expect(s.button.click).not.toHaveBeenCalled();
    expect(s.pay).not.toHaveBeenCalled();
    expect(s.browser.close).toHaveBeenCalledOnce();
  });

  it('accepts a missing tax row only when the settled checkout total balances to zero tax', () => {
    expect(readCheckoutTotals('Standard\nSubtotal USD $25.00\nShipping USD $5.00\nTotal USD $30.00', money('USD',2500), money('USD',500), 'Standard'))
      .toEqual({ subtotal:money('USD',2500), shipping:money('USD',500), tax:money('USD',0), total:money('USD',3000), shippingTitle:'Standard' });
  });

  it.each([
    ['missing nonzero tax', 'Subtotal USD $25.00\nShipping USD $5.00\nTotal USD $32.00'],
    ['subtotal only', 'Subtotal USD $25.00\nTotal USD $25.00'],
    ['changed shipping', 'Subtotal USD $25.00\nShipping USD $6.00\nTax USD $2.00\nTotal USD $33.00'],
    ['wrong currency', 'Subtotal USD $25.00\nShipping SGD $5.00\nTax USD $2.00\nTotal USD $32.00'],
    ['unbalanced explicit tax', 'Subtotal USD $25.00\nShipping USD $5.00\nTax USD $1.00\nTotal USD $32.00'],
    ['differing duplicate totals', 'Subtotal USD $25.00\nShipping USD $5.00\nTax USD $2.00\nTotal USD $32.00\nTotal USD $31.00'],
    ['calculating tax', 'Subtotal USD $25.00\nShipping USD $5.00\nCalculating tax\nTotal USD $32.00'],
  ])('rejects %s checkout evidence', (_label, body) => {
    expect(readCheckoutTotals(body, money('USD',2500), money('USD',500), 'Standard')).toBeNull();
  });

  it.each(['FREE', 'Free', 'free'])('reads standalone Shipping / %s as zero only with a settled, balanced zero-shipping quote', free => {
    expect(readCheckoutTotals(`Standard\nSubtotal USD $25.00\nShipping\n${free}\nTotal USD $25.00`, money('USD',2500), money('USD',0), 'Standard'))
      .toEqual({ subtotal:money('USD',2500), shipping:money('USD',0), tax:money('USD',0), total:money('USD',2500), shippingTitle:'Standard' });
    expect(readCheckoutTotals(`Standard\nSubtotal USD $25.00\nShipping\n${free}\nTotal tax USD $2.00\nTotal USD $27.00`, money('USD',2500), money('USD',0), 'Standard'))
      .toEqual({ subtotal:money('USD',2500), shipping:money('USD',0), tax:money('USD',200), total:money('USD',2700), shippingTitle:'Standard' });
  });

  it('reads the live uppercase FREE shipping-token layout without loosening the summary checks', () => {
    expect(readCheckoutTotals('Standard\nFREE\n$15.00\n$89.95\nSubtotal\n$89.95\nShipping\nFREE\nTotal\nUSD\n$89.95', money('USD',8995), money('USD',0), 'Standard'))
      .toEqual({ subtotal:money('USD',8995), shipping:money('USD',0), tax:money('USD',0), total:money('USD',8995), shippingTitle:'Standard' });
  });

  it('accepts repeated free tokens with mixed casing only when duplicate shipping rows agree', () => {
    expect(readCheckoutTotals('Subtotal USD $25.00\nShipping\nFREE\nShipping\nFree\nShipping\nfree\nTotal USD $25.00', money('USD',2500), money('USD',0), 'Standard'))
      .toEqual({ subtotal:money('USD',2500), shipping:money('USD',0), tax:money('USD',0), total:money('USD',2500), shippingTitle:'Standard' });
  });

  it('does not use a free-shipping row to override the expected nonzero shipping charge', () => {
    expect(readCheckoutTotals('Subtotal USD $25.00\nShipping\nFree\nTotal USD $25.00', money('USD',2500), money('USD',500), 'Standard')).toBeNull();
  });

  it.each([
    ['conflicting numeric shipping rows', 'Subtotal USD $25.00\nShipping USD $0.00\nShipping USD $5.00\nTotal USD $25.00'],
    ['free and nonzero numeric shipping', 'Subtotal USD $25.00\nShipping\nFree\nShipping USD $5.00\nTotal USD $25.00'],
    ['uppercase free and nonzero numeric shipping', 'Subtotal USD $25.00\nShipping\nFREE\nShipping USD $5.00\nTotal USD $25.00'],
    ['free plus conflicting numeric duplicates', 'Subtotal USD $25.00\nShipping\nFree\nShipping USD $0.00\nShipping USD $5.00\nTotal USD $25.00'],
    ['free plus wrong-currency numeric shipping', 'Subtotal USD $25.00\nShipping\nFree\nShipping SGD $0.00\nTotal USD $25.00'],
    ['mixed-case free plus wrong-currency numeric shipping', 'Subtotal USD $25.00\nShipping\nFREE\nShipping\nFree\nShipping SGD $0.00\nTotal USD $25.00'],
  ])('rejects %s instead of falling back to a free row', (_label, body) => {
    expect(readCheckoutTotals(body, money('USD',2500), money('USD',0), 'Standard')).toBeNull();
  });

  it('rejects free and numeric shipping disagreement even when the numeric row matches the expected nonzero charge', () => {
    expect(readCheckoutTotals('Subtotal USD $25.00\nShipping\nFree\nShipping USD $5.00\nTotal USD $30.00', money('USD',2500), money('USD',500), 'Standard')).toBeNull();
  });

  it.each([
    ['missing subtotal', 'Shipping\nFree\nTotal USD $25.00'],
    ['missing final total', 'Subtotal USD $25.00\nShipping\nFree'],
    ['incomplete tax row', 'Subtotal USD $25.00\nShipping\nFree\nTax\nTotal USD $25.00'],
    ['nonzero tax without a tax row', 'Subtotal USD $25.00\nShipping\nFree\nTotal USD $27.00'],
    ['unbalanced explicit tax', 'Subtotal USD $25.00\nShipping\nFree\nTax USD $1.00\nTotal USD $27.00'],
    ['conflicting final totals', 'Subtotal USD $25.00\nShipping\nFree\nTotal USD $25.00\nTotal USD $24.00'],
    ['calculating charges', 'Subtotal USD $25.00\nShipping\nFree\nCalculating taxes\nTotal USD $25.00'],
    ['estimated taxes', 'Subtotal USD $25.00\nShipping\nFree\nEstimated taxes USD $0.00\nTotal USD $25.00'],
    ['charges deferred to next step', 'Subtotal USD $25.00\nShipping\nFree\nTaxes calculated at next step\nTotal USD $25.00'],
    ['promotional free-shipping text without a summary shipping row', 'Free shipping\nSubtotal USD $25.00\nTotal USD $25.00'],
  ])('rejects %s with free shipping evidence', (_label, body) => {
    expect(readCheckoutTotals(body, money('USD',2500), money('USD',0), 'Standard')).toBeNull();
  });

  it('reads a settled hosted quote with free shipping without entering a card or paying', async () => {
    const s = fixture();
    s.quoteInput.expectedShipping = money('USD',0);
    s.setText('Standard\nBogus Gateway\nSubtotal USD $25.00\nShipping\nFree\nTax USD $2.00\nTotal USD $27.00');
    await expect(s.driver.quote(s.quoteInput)).resolves.toEqual({
      subtotal:money('USD',2500), shipping:money('USD',0), tax:money('USD',200), total:money('USD',2700), shippingTitle:'Standard',
    });
    expect(s.page.frameLocator).not.toHaveBeenCalled();
    expect(s.button.click).not.toHaveBeenCalled();
    expect(s.pay).not.toHaveBeenCalled();
    expect(s.browser.close).toHaveBeenCalledOnce();
  });

  it('stops quote discovery on a challenge and still closes the browser', async () => {
    const s = fixture(); s.setText('Verify you are human');
    await expect(s.driver.quote(s.quoteInput)).rejects.toMatchObject({code:'captcha_challenge'});
    expect(s.page.frameLocator).not.toHaveBeenCalled();
    expect(s.button.click).not.toHaveBeenCalled();
    expect(s.pay).not.toHaveBeenCalled();
    expect(s.browser.close).toHaveBeenCalledOnce();
  });

  it('blocks payment when a frozen quote breakdown changes even if total is unchanged', async () => {
    const s = fixture();
    s.input.expectedCheckoutTotals = {
      subtotal:money('USD',2500), shipping:money('USD',500), tax:money('USD',200), total:money('USD',3200), shippingTitle:'Standard',
    };
    s.setText('Standard\nBogus Gateway\nSubtotal USD $26.00\nShipping USD $4.00\nTax USD $2.00\nTotal USD $32.00');
    await expect(s.driver.complete(s.input)).rejects.toMatchObject({code:'total_mismatch'});
    expect(s.page.frameLocator).not.toHaveBeenCalled();
    expect(s.input.checkpoint).not.toHaveBeenCalled();
    expect(s.button.click).not.toHaveBeenCalled();
    expect(s.pay).not.toHaveBeenCalled();
    expect(s.browser.close).toHaveBeenCalledOnce();
  });
});
