import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Browser, Page, BrowserContext, Route } from 'playwright-core';
import { PlaywrightCheckoutDriver } from '../../src/execution/shopify/browserCheckout.js';
import { ManualClock } from '../../src/infrastructure/clock.js';
import { money } from '../../src/contracts/money.js';
import type { CheckoutDriverInput } from '../../src/execution/shopify/checkout.js';

const mocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('playwright-core', () => ({ chromium: { launch: mocks.launch } }));

function fixture() {
  const clock = new ManualClock();
  const events: string[] = [];
  let url = 'https://test-shop.myshopify.com/checkouts/fixture';
  let text = 'Standard\nBogus Gateway\nTotal USD $32.00';
  const pay = vi.fn(async () => { events.push('click'); url = 'https://test-shop.myshopify.com/checkouts/fixture/thank_you'; text = 'Order #1001'; });
  const fill = vi.fn(async () => undefined);
  const generic = { first() { return this; }, fill, selectOption: vi.fn(async () => undefined), count: vi.fn(async () => 0), isVisible: vi.fn(async () => false), click: vi.fn(async () => undefined) };
  const button = { ...generic, click: vi.fn(async ({trial}: {trial?:boolean}) => { expect(trial).toBe(true); }), elementHandle: vi.fn(async () => ({ click: pay })) };
  let routeHandler: ((route: Route) => Promise<void>) | undefined;
  const context = { setDefaultTimeout: vi.fn(), newPage: vi.fn(async () => page), route: vi.fn(async (_pattern,handler) => { routeHandler = handler; }) } as unknown as BrowserContext;
  const page = {
    goto: vi.fn(async () => undefined), url: () => url, waitForLoadState: vi.fn(async () => undefined), waitForTimeout: vi.fn(async (ms: number) => clock.advance(ms)),
    locator: vi.fn((selector: string) => selector === 'body' ? {innerText: async () => text} : generic),
    getByRole: vi.fn((role: string) => role === 'button' ? button : { ...generic, count:async (): Promise<number> => 1, check:async () => undefined }),
    getByText: vi.fn(() => ({...generic,count:async (): Promise<number> => 1})),
    frameLocator: vi.fn(() => ({ locator: () => generic })),
  } as unknown as Page;
  const browser = { newContext: vi.fn(async () => context), close: vi.fn(async () => undefined) } as unknown as Browser;
  mocks.launch.mockResolvedValue(browser);
  const driver = new PlaywrightCheckoutDriver({storeDomain:'test-shop.myshopify.com',executablePath:'fixture-browser',clock});
  const input: CheckoutDriverInput = {
    checkoutUrl:url,expectedTotal:money('USD',3200),shippingTitle:'Standard',storePassword:null,
    fulfillment:{category:'retail',email:'test@example.com',shippingAddress:{firstName:'Test',lastName:'Buyer',address1:'1 Test Street',city:'Singapore',zip:'018956',countryCode:'SG'}},
    checkpoint:vi.fn(async step => { events.push(step); }), log:vi.fn(),
  };
  return {driver,input,pay,fill,events,browser,context,page,setText:(value:string) => {text=value;},routeHandler:()=>routeHandler!};
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
