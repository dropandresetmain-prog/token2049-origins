import { demoData } from '../../src/demo/config.js';
import { describe, it, expect, vi } from 'vitest';
import { createShopifyExecutor, hasPaidTestEvidence, cartSignature } from '../../src/execution/shopify/index.js';
import { readCartTotals, readCartAddress, cheapestSelections, StorefrontClient, type StorefrontCart } from '../../src/execution/shopify/storefront.js';
import { AdminClient, type AdminOrder } from '../../src/execution/shopify/admin.js';
import { CheckoutAbort, createStepLogger, type CheckoutDriver } from '../../src/execution/shopify/checkout.js';
import { isTrustedCheckoutUrl, displayedTotalMatches, challengeFromText, hasTestGateway } from '../../src/execution/shopify/browserCheckout.js';
import { loadShopifyConfig } from '../../src/execution/shopify/config.js';
import { postGraphQL } from '../../src/execution/shopify/http.js';
import { ManualClock } from '../../src/infrastructure/clock.js';
import type { ExecutionContext } from '../../src/contracts/ports.js';
import type { RetailFulfillment, RetailIntent } from '../../src/contracts/intent.js';
import { money } from '../../src/contracts/money.js';
import { z } from 'zod';
import { readdirSync, readFileSync } from 'node:fs';

const env = { SHOPIFY_STORE_DOMAIN: 'test-shop.myshopify.com', SHOPIFY_STOREFRONT_TOKEN: 'fixture-storefront', SHOPIFY_CLIENT_ID: 'fixture-client', SHOPIFY_CLIENT_SECRET: 'fixture-secret', SHOPIFY_DEV_STORE_CONFIRMED: 'true', SHOPIFY_BOGUS_GATEWAY_ENABLED: 'true', SHOPIFY_BROWSER_EXECUTABLE: 'fixture-path' };
const nonce = '596fef08-64d7-4e3a-8dfd-2930d6c5b8e7';
const f: RetailFulfillment = { category: 'retail', ...demoData.buyer };
const intent: RetailIntent = { category: 'retail', query: 'shirt', quantity: 2, shipToCountry: demoData.retail.shipToCountry, spendCeiling: money('USD', 4000) };
const amount = (value: string) => ({ amount: value, currencyCode: 'USD' });
function cart(): StorefrontCart {
  const shipping = { handle: 'standard', title: 'Standard', deliveryMethodType: 'SHIPPING', estimatedCost: amount('5.00') };
  return { id: 'gid://shopify/Cart/fixture?key=secret', checkoutUrl: 'https://test-shop.myshopify.com/checkouts/fixture?key=secret', totalQuantity: 2,
    buyerIdentity: { email: f.email }, attributes: [{ key: 't2o_quote', value: nonce }], discountAllocations: [],
    cost: { totalAmount: amount('32.00'), subtotalAmount: amount('25.00'), totalAmountEstimated: false, subtotalAmountEstimated: false, totalTaxAmount: amount('2.00'), totalTaxAmountEstimated: false, totalDutyAmount: null },
    lines: { nodes: [{ quantity: 2, merchandise: { id: 'gid://shopify/ProductVariant/123', title: 'Default Title', product: { title: 'Test shirt' } } }] },
    deliveryGroups: { nodes: [{ id: 'group', deliveryAddress: { ...f.shippingAddress, address2: null, countryCodeV2: f.shippingAddress.countryCode, provinceCode: f.shippingAddress.province ?? null }, deliveryOptions: [shipping], selectedDeliveryOption: shipping }] } };
}
function order(): AdminOrder { return { id: 'gid://shopify/Order/123', name: '#1001', test: true, displayFinancialStatus: 'PAID', totalPriceSet: { presentmentMoney: amount('32.00') },
  customAttributes: [{ key: 't2o_quote', value: nonce }], transactions: [{ kind: 'SALE', status: 'SUCCESS', test: true, gateway: 'bogus', amountSet: { presentmentMoney: amount('32.00') } }] }; }
async function setup(driver?: Pick<CheckoutDriver, 'complete'> & Partial<Pick<CheckoutDriver, 'quote'>>) {
  let current = cart();
  let orders: AdminOrder[] = [];
  const sf = { findVariants: vi.fn(async () => [{ variantId: 'gid://shopify/ProductVariant/123', title: 'Test shirt', description: 'Fixture', unitPrice: money('USD',1250) }]),
    createCart: vi.fn(async ({ nonce: n }: { nonce: string }) => { current.attributes[0]!.value = n; return current; }),
    selectDelivery: vi.fn(async () => current), getCart: vi.fn(async () => current) };
  const admin = { searchOrders: vi.fn(async () => orders) };
  const complete = driver ?? { complete: vi.fn(async (input) => { await input.checkpoint('pay_click', { at: '2026-10-06T12:00:00.000Z' }); const o = order(); o.customAttributes[0]!.value = current.attributes[0]!.value; orders = [o]; return { orderName: '#1001' }; }) };
  const quoteRead = vi.fn(async () => readCartTotals(cart()));
  const combinedDriver: CheckoutDriver = { ...complete, quote: driver?.quote ?? quoteRead };
  const opts = { storefront: sf, admin, driver: combinedDriver, clock: new ManualClock() };
  const executor = createShopifyExecutor(env, opts);
  const quote = await executor.quote({ executionRef: { variantId: 'gid://shopify/ProductVariant/123', quantity: 2 }, intent }, f);
  const ctx: ExecutionContext = { purchaseId: 'purchase', attemptId: 'attempt', idempotencyKey: 'attempt', quote: { quoteId: 'quote', ...quote }, fulfillment: f, checkpoints: {}, checkpoint: vi.fn(async (step,data) => { ctx.checkpoints[step] = data; }) };
  return { executor, ctx, quote, sf, admin, complete, current, setOrders: (value: AdminOrder[]) => { orders = value; }, quoteRead, opts };
}

describe('Shopify exact quote boundary', () => {
  it('reads required codes from the selected address when the delivery-group projection omits them', () => {
    const c=cart(); const group=c.deliveryGroups.nodes[0]!.deliveryAddress;
    c.delivery={addresses:[{selected:true,address:{...group,countryCode:group.countryCodeV2}}]};
    group.countryCodeV2=null;group.provinceCode=null;
    expect(readCartAddress(c)).toMatchObject({countryCodeV2:f.shippingAddress.countryCode,provinceCode:f.shippingAddress.province});
  });
  it.each(['country','province','street','multiple'])('rejects ambiguous/conflicting selected delivery %s', key => {
    const c=cart();const group=c.deliveryGroups.nodes[0]!.deliveryAddress;
    c.delivery={addresses:[{selected:true,address:{...group,countryCode:group.countryCodeV2}}]};
    const a=c.delivery.addresses[0]!.address;
    if(key==='country')a.countryCode='SG';
    if(key==='province')a.provinceCode='CA';
    if(key==='street')a.address1='Different street';
    if(key==='multiple')c.delivery.addresses.push({...c.delivery.addresses[0]!});
    expect(()=>readCartAddress(c)).toThrow();
  });
  it('new quote hashes bind the selected address without changing legacy hashes', () => {
    const c=cart();const legacy=cartSignature(c);
    const group=c.deliveryGroups.nodes[0]!.deliveryAddress;
    c.delivery={addresses:[{selected:true,address:{...group,countryCode:group.countryCodeV2}}]};
    expect(cartSignature(c)).toBe(legacy);
    const bound=cartSignature(c,true);
    c.delivery.addresses[0]!.address.provinceCode='CA';
    expect(cartSignature(c,true)).not.toBe(bound);
    expect(cartSignature(c)).toBe(legacy);
  });

  it('quotes decimal totals, explicit tax and chosen shipping with private opaque binding', async () => {
    const s = await setup();
    expect(s.quote.merchantTotal).toEqual(money('USD',3200));
    expect(s.quote.breakdown.map(b => b.amount.amountMinor)).toEqual(['2500','500','200']);
    expect(s.sf.createCart.mock.calls[0]![0]).toMatchObject({ fulfillment: f });
    expect(JSON.stringify(s.quote.executionRef)).not.toContain('test@example.com');
    expect(JSON.stringify(s.quote)).not.toContain('1 Test Street');
    expect(s.quote.fulfillmentSummary).toBe(`Synthetic delivery to ${demoData.retail.shipToCountry}`);
  });
  it.each(['estimated','tax','duty','discount','delivery','currency'])('rejects inexact %s carts', key => {
    const c = cart();
    if (key === 'estimated') c.cost.totalAmountEstimated = true;
    if (key === 'tax') c.cost.totalTaxAmount = amount('1.00');
    if (key === 'duty') c.cost.totalDutyAmount = amount('1.00');
    if (key === 'discount') c.discountAllocations = [{}];
    if (key === 'delivery') c.deliveryGroups.nodes[0]!.selectedDeliveryOption = null;
    if (key === 'currency') c.cost.subtotalAmount.currencyCode = 'SGD';
    expect(() => readCartTotals(c)).toThrow();
  });
  it('chooses shipping deterministically and detects same-price changed terms', async () => {
    const s = await setup();
    expect(cheapestSelections(s.current)).toEqual([{ deliveryGroupId: 'group', deliveryOptionHandle: 'standard' }]);
    s.current.deliveryGroups.nodes[0]!.selectedDeliveryOption!.title = 'Slower';
    expect(await s.executor.execute(s.ctx)).toMatchObject({ kind: 'terms_changed' });
    expect(s.complete.complete).not.toHaveBeenCalled();
  });
  it('rejects changed buyer and expired quote before browser work', async () => {
    const s = await setup();
    s.ctx.fulfillment = { ...f, email: 'changed@example.com' };
    expect(await s.executor.execute(s.ctx)).toMatchObject({ kind: 'terms_changed' });
    expect(s.complete.complete).not.toHaveBeenCalled();
  });
  it('gates dev store and non-synthetic identities', async () => {
    expect((await createShopifyExecutor({}).readiness()).status).toBe('MISSING_CONFIG');
    await expect(createShopifyExecutor({ ...env, SHOPIFY_DEV_STORE_CONFIRMED: 'false' }).search(intent)).rejects.toThrow();
    const s = await setup();
    await expect(s.executor.quote({ executionRef: {}, intent }, { ...f, email: 'buyer@real.com' })).rejects.toThrow('Synthetic');
    expect(loadShopifyConfig({ ...env, SHOPIFY_STORE_DOMAIN: '127.0.0.1' }).invalid).toContain('SHOPIFY_STORE_DOMAIN');
  });
});

describe('Shopify hosted-checkout quote and execution binding', () => {
  it('quotes estimated API costs only from independently observed checkout totals, without executing', async () => {
    const s = await setup();
    s.current.cost.totalAmountEstimated = true;
    s.current.cost.subtotalAmountEstimated = true;
    s.current.cost.totalTaxAmountEstimated = true;
    s.current.cost.totalTaxAmount = null;
    const q = await s.executor.quote({ executionRef: { variantId: 'gid://shopify/ProductVariant/123', quantity: 2 }, intent }, f);
    expect(q.merchantTotal).toEqual(money('USD',3200));
    expect(q.executionRef.checkoutTotals).toMatchObject({tax:money('USD',200)});
    expect(s.quoteRead).toHaveBeenCalledTimes(2);
    expect(s.complete.complete).not.toHaveBeenCalled();
    expect(s.admin.searchOrders).not.toHaveBeenCalled();
  });
  it('propagates checkout observation failure without creating an approvable quote', async () => {
    await expect(setup({complete:vi.fn(),quote:async () => {throw new CheckoutAbort('total_mismatch');}})).rejects.toThrow();
  });
  it.each(['tax','currency','scale','subtotal','shipping'])('rejects inconsistent observed checkout %s at the adapter boundary', async key => {
    const observed=readCartTotals(cart());
    if(key==='tax')observed.tax=money('USD',100);
    if(key==='currency')observed.total.currency='SGD';
    if(key==='scale'){observed.total.scale=3;observed.tax.scale=3;}
    if(key==='subtotal')observed.subtotal=money('USD',2600);
    if(key==='shipping')observed.shipping=money('USD',600);
    await expect(setup({complete:vi.fn(),quote:async () => observed})).rejects.toThrow('Checkout breakdown');
  });
  it('execution revalidates estimated API cart binding while preserving the frozen checkout breakdown', async () => {
    const s=await setup();
    s.current.cost.totalAmountEstimated=true;
    s.current.cost.subtotalAmountEstimated=true;
    s.current.cost.totalTaxAmountEstimated=true;
    s.current.cost.totalTaxAmount=null;
    s.ctx.quote.executionRef.cartHash=cartSignature(s.current);
    expect(await s.executor.execute(s.ctx)).toMatchObject({kind:'succeeded'});
    expect(s.complete.complete).toHaveBeenCalledWith(expect.objectContaining({expectedCheckoutTotals:s.ctx.quote.executionRef.checkoutTotals}));
  });
  it('a changed cart before pay checkpoint stops execution without a payment write', async () => {
    let clicks=0;
    const s=await setup({complete:async input => {
      s.current.lines.nodes[0]!.quantity=3;
      await input.checkpoint('pay_click',{}); clicks++; return {};
    }});
    expect(await s.executor.execute(s.ctx)).toMatchObject({kind:'terms_changed'});
    expect(clicks).toBe(0);
    expect(s.ctx.checkpoints.pay_click).toBeUndefined();
  });
  it('legacy quotes still refuse an estimated API cart before any browser execution', async () => {
    const s=await setup();
    delete s.ctx.quote.executionRef.checkoutTotals;
    s.current.cost.totalAmountEstimated=true;
    s.ctx.quote.executionRef.cartHash=cartSignature(s.current);
    expect(await s.executor.execute(s.ctx)).toMatchObject({kind:'terms_changed'});
    expect(s.complete.complete).not.toHaveBeenCalled();
  });

});

describe('Shopify payment checkpoint and independent readback', () => {
  it('successful checkout requires Admin proof and concurrently submits only once', async () => {
    const s = await setup();
    const [a,b] = await Promise.all([s.executor.execute(s.ctx), s.executor.execute(s.ctx)]);
    expect(a).toMatchObject({ kind: 'succeeded', merchantPaymentStatus: 'simulated_paid', providerReference: 'gid://shopify/Order/123' });
    expect(a).toEqual(b);
    expect(s.complete.complete).toHaveBeenCalledTimes(1);
    expect(s.admin.searchOrders).toHaveBeenCalledTimes(1);
    expect(s.ctx.checkpoints.pay_click).toBeDefined();
    expect(JSON.stringify(a)).not.toMatch(/test@example|1 Test Street|secret|fixture-client/);
  });
  it('does not click when durable payment checkpoint rejects', async () => {
    let clicks = 0;
    const s = await setup({ complete: async input => { await input.checkpoint('pay_click', {}); clicks++; return {}; } });
    s.ctx.checkpoint = async step => { if (step === 'pay_click') throw new Error('disk failure'); };
    expect(await s.executor.execute(s.ctx)).toMatchObject({ kind: 'failed_definite' });
    expect(clicks).toBe(0);
  });
  it('post-payment timeout remains unknown and restart can only retrieve', async () => {
    let clicks = 0;
    const s = await setup({ complete: async input => { await input.checkpoint('pay_click', {}); clicks++; throw new CheckoutAbort('order_not_confirmed'); } });
    expect(await s.executor.execute(s.ctx)).toMatchObject({ kind: 'unknown' });
    const restarted = createShopifyExecutor(env, s.opts);
    expect(await restarted.execute(s.ctx)).toMatchObject({ kind: 'unknown' });
    expect(clicks).toBe(1);
    const paid = order(); paid.customAttributes[0]!.value = s.ctx.quote.executionRef.nonce as string; s.setOrders([paid]);
    expect(await restarted.retrieve(s.ctx)).toMatchObject({ kind: 'succeeded' });
    expect(clicks).toBe(1);
  });
  it('browser confirmation or an unpaid order cannot finalize', async () => {
    const s = await setup({ complete: async () => ({ orderName: '#1001' }) });
    expect(await s.executor.execute(s.ctx)).toMatchObject({ kind: 'unknown' });
    const unpaid = order(); unpaid.customAttributes[0]!.value = s.ctx.quote.executionRef.nonce as string; unpaid.displayFinancialStatus = 'PENDING'; s.setOrders([unpaid]);
    expect(await s.executor.retrieve(s.ctx)).toMatchObject({ kind: 'unknown', providerReference: unpaid.id });
  });
  it.each(['production','authorized','pending','manual','wrong_amount','wrong_currency','wrong_gateway'])('rejects %s paid evidence', key => {
    const o = order();
    if (key === 'production') o.test = false;
    if (key === 'authorized') o.transactions[0]!.kind = 'AUTHORIZATION';
    if (key === 'pending') o.transactions[0]!.status = 'PENDING';
    if (key === 'manual') o.transactions = [];
    if (key === 'wrong_amount') o.transactions[0]!.amountSet.presentmentMoney.amount = '30.00';
    if (key === 'wrong_currency') o.transactions[0]!.amountSet.presentmentMoney.currencyCode = 'SGD';
    if (key === 'wrong_gateway') o.transactions[0]!.gateway = 'manual';
    expect(hasPaidTestEvidence(o, money('USD',3200))).toBe(false);
  });
  it('CAPTURE evidence succeeds; wrong/duplicate nonce candidates remain unresolved', async () => {
    const o = order(); o.transactions[0]!.kind = 'CAPTURE'; expect(hasPaidTestEvidence(o,money('USD',3200))).toBe(true);
    const s = await setup(); s.setOrders([o]); expect(await s.executor.retrieve(s.ctx)).toMatchObject({ kind: 'unknown' });
    o.customAttributes[0]!.value = s.ctx.quote.executionRef.nonce as string; s.setOrders([o,o]);
    expect(await s.executor.retrieve(s.ctx)).toMatchObject({ kind: 'unknown', reason: expect.stringContaining('Multiple') });
  });
});

describe('Shopify outbound transport and browser safeguards', () => {
  it.each(['https://evil.example/checkouts/x','http://test-shop.myshopify.com/checkouts/x','https://x:test@test-shop.myshopify.com/checkouts/x','https://test-shop.myshopify.com:444/checkouts/x','https://test-shop.myshopify.com/admin'])('rejects unsafe checkout URL %s', url => expect(isTrustedCheckoutUrl(url,env.SHOPIFY_STORE_DOMAIN)).toBe(false));
  it('requires quoted currency and total, and detects OTP/CAPTCHA', () => {
    expect(displayedTotalMatches('Subtotal $25.00\nTotal USD $32.00',money('USD',3200))).toBe(true);
    // Observed live Shopify layout: label, currency code and amount on separate lines.
    const live = 'Shipping\n$8.00\nSubtotal\n$9.95\nShipping\n$8.00\nTotal\nUSD\n$17.95';
    expect(displayedTotalMatches(live, money('USD',1795))).toBe(true);
    expect(displayedTotalMatches(live, money('USD',1796))).toBe(false);
    expect(displayedTotalMatches(live.replace('USD','SGD'), money('USD',1795))).toBe(false);
    expect(displayedTotalMatches('Subtotal\n$9.95', money('USD',995))).toBe(false);
    expect(displayedTotalMatches('Total SGD $32.00',money('USD',3200))).toBe(false);
    expect(challengeFromText('Verify you are human')).toBe('captcha_challenge');
    expect(challengeFromText('Enter the verification code sent')).toBe('otp_challenge');
    expect(hasTestGateway('Some payment option (for testing)')).toBe(false);
    expect(hasTestGateway('Testing instruction\nUse these values to test your checkout:\n1 to simulate an approved transaction\n2 to simulate a declined transaction')).toBe(true);
    expect(hasTestGateway('Testing instruction\nUse test card 4242 4242 4242 4242')).toBe(false);
  });
  it('has step-only logs and content-free GraphQL failures', async () => {
    const sink = vi.fn(); createStepLogger(sink)('test@example.com'); expect(sink).toHaveBeenCalledWith('shopify.checkout step=invalid_step_name');
    const fakeFetch = vi.fn(async (_url: unknown, _request?: RequestInit) => new Response(JSON.stringify({ errors: [{ message: 'token-secret', extensions: { code: 'test@example.com' } }] }), {status:200}));
    await expect(postGraphQL(fakeFetch as typeof fetch,{url:'https://test-shop.myshopify.com',headers:{}},'query',{},z.object({}))).rejects.toThrow('UNKNOWN');
    expect(fakeFetch.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
  });
  it('retries THROTTLED cart creation with bounded backoff, then succeeds', async () => {
    const c = cart(); let n = 0; const sleeps: number[] = [];
    const fakeFetch = vi.fn(async () => new Response(JSON.stringify(n++ < 2 ? { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] } : { data: { cartCreate: { cart: c, userErrors: [] } } })));
    const sf = new StorefrontClient(loadShopifyConfig(env).config, fakeFetch as typeof fetch, async (ms) => { sleeps.push(ms); });
    await expect(sf.createCart({ variantId: 'gid://shopify/ProductVariant/123', quantity: 2, nonce, fulfillment: f })).resolves.toMatchObject({ id: c.id });
    expect(fakeFetch).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([500, 1500]);
  });
  it('gives up after the backoff budget and never retries non-throttle errors', async () => {
    const sleeps: number[] = [];
    const throttled = vi.fn(async () => new Response(JSON.stringify({ errors: [{ extensions: { code: 'THROTTLED' } }] })));
    const sf = new StorefrontClient(loadShopifyConfig(env).config, throttled as typeof fetch, async (ms) => { sleeps.push(ms); });
    await expect(sf.createCart({ variantId: 'gid://shopify/ProductVariant/123', quantity: 2, nonce, fulfillment: f })).rejects.toThrow('THROTTLED');
    expect(throttled).toHaveBeenCalledTimes(5);
    expect(sleeps).toEqual([500, 1500, 4000, 10000]);
    const denied = vi.fn(async () => new Response(JSON.stringify({ errors: [{ extensions: { code: 'ACCESS_DENIED' } }] })));
    const sf2 = new StorefrontClient(loadShopifyConfig(env).config, denied as typeof fetch, async () => undefined);
    await expect(sf2.createCart({ variantId: 'gid://shopify/ProductVariant/123', quantity: 2, nonce, fulfillment: f })).rejects.toThrow('ACCESS_DENIED');
    expect(denied).toHaveBeenCalledTimes(1);
  });
  it('prefers the private delegate token and forwards a valid buyer IP; rejects a malformed IP', async () => {
    const seen: Array<Record<string, string>> = [];
    const fakeFetch = vi.fn(async (_u: unknown, r?: RequestInit) => { seen.push(r!.headers as Record<string, string>); return new Response(JSON.stringify({ data: { shop: { name: 'x' } } })); });
    const priv = loadShopifyConfig({ ...env, SHOPIFY_STOREFRONT_PRIVATE_TOKEN: 'fixture-private', SHOPIFY_STOREFRONT_BUYER_IP: '203.0.113.9' });
    await new StorefrontClient(priv.config, fakeFetch as typeof fetch).shopName();
    expect(seen[0]).toMatchObject({ 'Shopify-Storefront-Private-Token': 'fixture-private', 'Shopify-Storefront-Buyer-IP': '203.0.113.9' });
    expect(seen[0]).not.toHaveProperty('X-Shopify-Storefront-Access-Token');
    await new StorefrontClient(loadShopifyConfig(env).config, fakeFetch as typeof fetch).shopName();
    expect(seen[1]).toMatchObject({ 'X-Shopify-Storefront-Access-Token': 'fixture-storefront' });
    expect(seen[1]).not.toHaveProperty('Shopify-Storefront-Buyer-IP');
    const bad = loadShopifyConfig({ ...env, SHOPIFY_STOREFRONT_BUYER_IP: '1.2.3.4\r\nX-Evil: 1' });
    expect(bad.invalid).toContain('SHOPIFY_STOREFRONT_BUYER_IP');
    expect(bad.config.storefrontBuyerIp).toBeNull();
  });
  it('Storefront uses delivery input and Admin only reads, with token caching', async () => {
    const c = cart(); const fakeFetch = vi.fn(async (_url: unknown, request: RequestInit | undefined) => {
      const body = JSON.parse(request!.body as string);
      expect(body.query).toContain('deliveryAddress { firstName lastName');
      expect(body.variables.input.delivery.addresses[0]).toMatchObject({ selected: true, oneTimeUse: true, address: { deliveryAddress: { firstName: 'Test' } } });
      return new Response(JSON.stringify({ data: { cartCreate: {cart:c,userErrors:[]} } }));
    });
    await new StorefrontClient(loadShopifyConfig(env).config, fakeFetch as typeof fetch).createCart({ variantId:'gid://shopify/ProductVariant/123',quantity:2,nonce,fulfillment:f });
    const adminFetch = vi.fn(async (url: unknown) => new Response(JSON.stringify(String(url).endsWith('access_token') ? { access_token:'fixture-token',expires_in:86400 } : { data: { orders:{ nodes:[order()] } } })));
    const admin = new AdminClient(loadShopifyConfig(env).config, adminFetch as typeof fetch,new ManualClock());
    await admin.searchOrders({createdAfter:'2026-10-06T12:00:00.000Z'}); await admin.searchOrders({name:'#1001'});
    expect(adminFetch).toHaveBeenCalledTimes(3);
    expect(cartSignature(c)).toHaveLength(64);
    const files = readdirSync('src/execution/shopify').filter(n => n.endsWith('.ts')).map(n => readFileSync(`src/execution/shopify/${n}`,'utf8')).join('\n');
    expect(files).not.toMatch(/orderMarkAsPaid|draftOrderComplete|\borderCreate\b/);
    expect(readFileSync('src/execution/shopify/admin.ts','utf8')).not.toMatch(/mutation\s/);
  });
});
