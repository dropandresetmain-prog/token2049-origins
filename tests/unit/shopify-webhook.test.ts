import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, it, expect, vi } from 'vitest';
import { createShopifyWebhookRouter, verifyShopifyHmac } from '../../src/execution/shopify/webhook.js';

const secret = 'fixture-secret';
const shop = 'test-shop.myshopify.com';
const nonce = '596fef08-64d7-4e3a-8dfd-2930d6c5b8e7';
const payload = JSON.stringify({ admin_graphql_api_id: 'gid://shopify/Order/123', email:'private@example.com', financial_status:'paid', shipping_address:{address1:'private address'}, note_attributes: [{name:'t2o_quote',value:nonce}] });
const sign = (body: string) => createHmac('sha256',secret).update(body).digest('base64');
const headers = { 'content-type':'application/json','x-shopify-hmac-sha256':sign(payload),'x-shopify-shop-domain':shop,'x-shopify-topic':'orders/paid','x-shopify-webhook-id':'fixture-id' };
async function withServer(jsonFirst: boolean, onReconcile: Parameters<typeof createShopifyWebhookRouter>[0]['onReconcile'], run: (url: string) => Promise<void>) {
  const app = express();
  if (jsonFirst) app.use(express.json());
  app.use('/webhook', createShopifyWebhookRouter({storeDomain:shop,secret,onReconcile}));
  app.use(express.json());
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook`); }
  finally { await new Promise<void>((resolve,reject) => server.close(e => e ? reject(e) : resolve())); }
}

describe('Shopify raw-body HMAC router', () => {
  it('verifies exact bytes and malformed signature fails without throwing', () => {
    expect(verifyShopifyHmac(Buffer.from(payload),sign(payload),secret)).toBe(true);
    expect(verifyShopifyHmac(Buffer.from(payload + ' '),sign(payload),secret)).toBe(false);
    expect(verifyShopifyHmac(Buffer.from(payload),'x',secret)).toBe(false);
    expect(verifyShopifyHmac(Buffer.from(payload),sign(payload),'wrong')).toBe(false);
  });
  it('queues hints only; duplicate and out-of-order deliveries still require independent readback', async () => {
    const callback = vi.fn(async () => undefined);
    await withServer(false,callback,async url => {
      for (const topic of ['orders/paid','orders/paid','orders/updated']) {
        const response = await fetch(url,{method:'POST',headers:{...headers,'x-shopify-topic':topic},body:payload});
        expect(response.status).toBe(202);
      }
    });
    expect(callback).toHaveBeenCalledTimes(3);
    expect(callback.mock.calls[0]).toEqual([{orderId:'gid://shopify/Order/123',quoteNonce:nonce,deliveryId:'fixture-id',topic:'orders/paid'}]);
    expect(JSON.stringify(callback.mock.calls)).not.toMatch(/private|financial_status|shipping_address/);
  });
  it.each(['signature','store','topic','parsed'])('rejects %s failure before callback', async failure => {
    const callback = vi.fn(async () => undefined);
    await withServer(failure === 'parsed',callback,async url => {
      const altered = {...headers};
      if (failure === 'signature') altered['x-shopify-hmac-sha256'] = sign(payload + ' ');
      if (failure === 'store') altered['x-shopify-shop-domain'] = 'another.myshopify.com';
      if (failure === 'topic') altered['x-shopify-topic'] = 'orders/create';
      const response = await fetch(url,{method:'POST',headers:altered,body:payload});
      expect(response.status).toBe(failure === 'signature' || failure === 'store' ? 401 : 400);
    });
    expect(callback).not.toHaveBeenCalled();
  });
  it('enqueue failures return retryable 503 without PII', async () => {
    await withServer(false,async () => { throw new Error('private address secret'); },async url => {
      const response = await fetch(url,{method:'POST',headers,body:payload});
      expect(response.status).toBe(503); expect(await response.text()).toContain('reconciliation_unavailable');
    });
  });
  it('requires signed JSON shape and refuses conflicting nonce hints', async () => {
    const callback = vi.fn(async () => undefined);
    await withServer(false,callback,async url => {
      const bad = '{"email":"private@example.com"}';
      expect((await fetch(url,{method:'POST',headers:{...headers,'x-shopify-hmac-sha256':sign(bad)},body:bad})).status).toBe(400);
      const ambiguous = JSON.stringify({admin_graphql_api_id:'gid://shopify/Order/123',note_attributes:[{name:'t2o_quote',value:nonce},{name:'t2o_quote',value:nonce}]});
      expect((await fetch(url,{method:'POST',headers:{...headers,'x-shopify-hmac-sha256':sign(ambiguous)},body:ambiguous})).status).toBe(202);
    });
    expect(callback.mock.calls[0]).toEqual([expect.objectContaining({quoteNonce:null})]);
  });
});
