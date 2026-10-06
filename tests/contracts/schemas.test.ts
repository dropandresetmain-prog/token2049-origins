import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PurchaseIntent, Fulfillment } from '../../src/contracts/intent.js';
import { QuoteView, PurchaseView, ReceiptView, OfferView, PurchaseEventView } from '../../src/contracts/commerce.js';
import { CapabilitiesResponse, OPERATIONS } from '../../src/contracts/api.js';
import { ErrorBody } from '../../src/contracts/common.js';
import { startHarness, createFundablePurchase, type Harness } from '../support/harness.js';

describe('v1 contract schemas', () => {
  it('intents are category-specific and strict', () => {
    expect(PurchaseIntent.safeParse({ category: 'hotel', spendCeiling: { currency: 'USD', amountMinor: '1', scale: 2 }, destination: { cityName: 'Singapore', countryCode: 'SG' }, checkin: '2026-11-01', checkout: '2026-11-02', occupancies: [{ adults: 1 }], guestNationality: 'SG' }).success).toBe(true);
    expect(PurchaseIntent.safeParse({ category: 'hotel', spendCeiling: { currency: 'USD', amountMinor: '1', scale: 2 }, destination: { cityName: 'Singapore', countryCode: 'SG' }, checkin: '2026-11-02', checkout: '2026-11-01', occupancies: [{ adults: 1 }], guestNationality: 'SG' }).success).toBe(false);
    expect(PurchaseIntent.safeParse({ category: 'flight', spendCeiling: { currency: 'USD', amountMinor: '1', scale: 2 }, from: 'SIN', to: 'SIN', departDate: '2026-11-01', adults: 1 }).success).toBe(false);
    expect(PurchaseIntent.safeParse({ category: 'retail', spendCeiling: { currency: 'USD', amountMinor: '1', scale: 2 }, quantity: 1, shipToCountry: 'SG', query: 'x', arbitrary: 'nope' }).success).toBe(false);
    expect(Fulfillment.safeParse({ category: 'flight', contact: { familyName: 'Test', givenName: 'Pax', email: 'p@example.com', mobile: '0065-12345678' }, passengers: [{ familyName: 'Test', givenName: 'Pax', gender: 'F', birthday: '1990-01-01', nationality: 'SG', passengerType: 'adult' }] }).success).toBe(true);
  });

  it('operation table is the single source for HTTP paths and MCP tool names', () => {
    expect(Object.values(OPERATIONS).map((o) => o.mcpTool).filter(Boolean).sort()).toEqual(['buy', 'buy', 'create_quote', 'find_offers', 'get_purchase']);
  });
});

describe('HTTP responses conform to v1 schemas', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => h.close());

  it('offers, quotes, purchases, receipts, events, capabilities and errors', async () => {
    const caps = await h.call('GET', '/v1/capabilities');
    expect(CapabilitiesResponse.parse(caps.body).routes).toHaveLength(3);
    const { quote, purchase, required } = await createFundablePurchase(h);
    QuoteView.parse(quote);
    PurchaseView.parse(purchase);
    const offers = await h.call('POST', '/v1/offers/search', { token: h.alice.token, body: { intent: { category: 'retail', query: 'x', quantity: 1, shipToCountry: 'SG', spendCeiling: { currency: 'USD', amountMinor: '10000', scale: 2 } } } });
    offers.body.offers.forEach((o: unknown) => OfferView.parse(o));
    // Offers never expose the server-held execution reference.
    expect(JSON.stringify(offers.body)).not.toContain('executionRef');
    expect(JSON.stringify(quote)).not.toContain('executionRef');
    // Quotes/purchases never echo fulfillment PII.
    expect(JSON.stringify(quote)).not.toContain('buyer@example.com');
    await h.call('POST', `/v1/purchases/${purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:sc1:${required}` } });
    await h.gw.worker.tick();
    const got = await h.call('GET', `/v1/purchases/${purchase.purchaseId}`, { token: h.alice.token });
    const pv = PurchaseView.parse(got.body.purchase);
    ReceiptView.parse(pv.receipt);
    expect(JSON.stringify(got.body)).not.toMatch(/buyer@example\.com|1 Test Street/);
    const ev = await h.call('GET', `/v1/purchases/${purchase.purchaseId}/events`, { token: h.alice.token });
    ev.body.events.forEach((e: unknown) => PurchaseEventView.parse(e));
    const err = await h.call('GET', `/v1/purchases/${purchase.purchaseId}`, { token: h.bob.token });
    ErrorBody.parse(err.body);
  });
});
