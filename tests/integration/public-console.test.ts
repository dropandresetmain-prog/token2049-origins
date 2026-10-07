import { afterEach, describe, expect, it } from 'vitest';
import { startHarness, createFundablePurchase, type Harness } from '../support/harness.js';
let h: Harness | undefined;
afterEach(async () => { await h?.close(); h = undefined; });
describe('explicit public demo console', () => {
  it('publishes only owned demo reads and redacted evidence while preserving credential boundaries', async () => {
    h = await startHarness({ publicConsoleCustomerId: 'cus_PUBLICDEMO' });
    const own = await createFundablePurchase(h);
    const other = await createFundablePurchase(h, h.bob.token);
    const id = own.purchase.purchaseId;
    for (const path of ['/v1/evidence/purchases', '/v1/purchases/'+id, '/v1/evidence/purchases/'+id, '/v1/evidence/purchases/'+id+'/proof', '/v1/evidence/treasury', '/v1/evidence/bank']) {
      const read = await h.call('GET', path);
      expect(read.status, path).toBe(200);
      expect(JSON.stringify(read.body)).not.toContain('alice@example.com');
    }
    const list = await h.call('GET', '/v1/evidence/purchases?customerId='+h.bob.customerId);
    expect(list.body.purchases.map((p: any) => p.id)).toEqual([id]);
    for (const path of ['/v1/purchases/'+other.purchase.purchaseId, '/v1/evidence/purchases/'+other.purchase.purchaseId, '/v1/evidence/purchases/'+other.purchase.purchaseId+'/proof']) {
      expect((await h.call('GET', path)).status).toBe(404);
    }
    expect((await h.call('GET','/v1/purchases/'+other.purchase.purchaseId,{token:h.bob.token})).status).toBe(200);
    expect((await h.call('GET','/v1/evidence/purchases',{headers:{Authorization:'Bearer invalid'}})).status).toBe(401);
    for (const path of ['/v1/quotes/'+own.quote.quoteId, '/v1/quotes/'+own.quote.quoteId+'/purchase', '/v1/purchases/'+id+'/events']) expect((await h.call('GET',path)).status).toBe(401);
    const observations = await h.gw.db.all('SELECT * FROM bank_observations');
    const purchases = await h.gw.db.all('SELECT * FROM purchases');
    for (const path of ['/v1/offers/search','/v1/quotes','/v1/purchases','/v1/purchases/'+id+'/fund','/v1/purchases/'+id+'/payment-attempt','/v1/purchases/'+id+'/payment-attempt/complete','/v1/evidence/bank/refresh']) {
      expect((await h.call('POST',path,{body:{}})).status,path).toBe(401);
    }
    for (const method of ['PUT','PATCH','DELETE','HEAD']) expect((await h.call(method,'/v1/evidence/bank')).status).toBe(401);
    expect(await h.gw.db.all('SELECT * FROM bank_observations')).toEqual(observations);
    expect(await h.gw.db.all('SELECT * FROM purchases')).toEqual(purchases);
  });
  it('keeps all console data authenticated when the public demo option is absent', async () => {
    h = await startHarness();
    for (const path of ['/v1/evidence/purchases','/v1/evidence/treasury','/v1/evidence/bank']) expect((await h.call('GET',path)).status).toBe(401);
  });
});
