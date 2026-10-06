import { describe, expect, it } from 'vitest';
import { PurchaseIntent, Fulfillment } from '../../src/contracts/intent.js';
import { assessPurchaseIntent, assessFulfillment, providerRequirements, NeedsInput } from '../../src/contracts/input.js';
import { CreatePurchaseRequest } from '../../src/contracts/api.js';
import { retailIntent, retailFulfillment } from '../support/harness.js';

describe('progressive input boundary', () => {
  it.each([
    [{ category: 'flight', from: 'SIN', adults: 1, spendCeiling: { currency: 'USD', amountMinor: '20000', scale: 2 } }, ['to', 'departDate']],
    [{ category: 'hotel' }, ['checkin', 'checkout', 'destination', 'occupancies', 'guestNationality']],
    [{ category: 'retail', quantity: 1, shipToCountry: 'SG', spendCeiling: { currency: 'USD', amountMinor: '10000', scale: 2 } }, ['query']],
  ])('collects controlled search fields without guessing values', (draft, paths) => {
    const result = assessPurchaseIntent(draft);
    expect(result.status).toBe('needs_input');
    if (result.status !== 'needs_input') throw new Error('expected needs_input');
    expect(result.fields.map(f => f.path)).toEqual(expect.arrayContaining(paths));
    expect(NeedsInput.parse(result).phase).toBe('search');
    if (draft.category === 'flight') expect(result.fields.map(f => f.path)).toEqual(paths);
  });
  it('does not weaken the complete canonical schemas', () => {
    expect(PurchaseIntent.safeParse({ category: 'flight' }).success).toBe(false);
    expect(Fulfillment.safeParse({ category: 'retail' }).success).toBe(false);
    expect(assessPurchaseIntent(retailIntent())).toEqual({ status: 'ready', value: PurchaseIntent.parse(retailIntent()) });
    expect(assessFulfillment(retailFulfillment)).toEqual({ status: 'ready', value: Fulfillment.parse(retailFulfillment) });
  });
  it('finds nested contact, passenger, address and optional-document requirements', () => {
    const flight = assessFulfillment({ category: 'flight', contact: { email: 'synthetic@example.com' }, passengers: [{ givenName: 'Test', document: { type: 'passport' } }] });
    if (flight.status !== 'needs_input') throw new Error('expected needs_input');
    expect(flight.fields.map(f => f.path)).toEqual(expect.arrayContaining(['contact.familyName', 'contact.mobile', 'passengers.0.familyName', 'passengers.0.document.number', 'passengers.0.document.expiry']));
    expect(JSON.stringify(flight)).not.toContain('synthetic@example.com');
    const retail = assessFulfillment({ category: 'retail', email: 'test@example.com', shippingAddress: { countryCode: 'SG' } });
    if (retail.status !== 'needs_input') throw new Error('expected needs_input');
    expect(retail.fields.map(f => f.path)).toContain('shippingAddress.address1');
    const hotel = assessFulfillment({ category: 'hotel', guests: [{}] });
    if (hotel.status !== 'needs_input') throw new Error('expected needs_input');
    expect(hotel.fields.map(f => f.path)).toContain('holder.phone');
  });
  it.each([
    { category: 'flight', departDate: 'tomorrow' }, { category: 'flight', to: 23 },
    { category: 'retail', arbitraryProviderBag: {} }, { category: 'hotel', destination: { cityName: 'Test', arbitrary: true } },
    { category: 'flight', adults: 0 }, { category: 'retail', spendCeiling: { currency: 'USD', amountMinor: '-1' } },
  ])('rejects malformed supplied values and unknown fields', draft => expect(() => assessPurchaseIntent(draft)).toThrow());
  it('only permits deliberate canonical provider requirements', () => {
    const requirement = providerRequirements('flight', 'fulfillment', ['passengers.0.document.number']);
    expect(requirement).toMatchObject({ status: 'needs_input', phase: 'provider', fields: [{ path: 'passengers.0.document.number', issue: 'required_by_provider' }] });
    expect(() => providerRequirements('flight', 'fulfillment', ['providerExtras.unreviewed'])).toThrow('unmodelled');
    expect(() => providerRequirements('flight', 'fulfillment', ['category'])).toThrow('unmodelled');
    expect(() => providerRequirements('flight', 'fulfillment', ['passengers.4.document.number'])).toThrow('unmodelled');
  });
  it('requires explicit funding selection and rejects independently supplied rails', () => {
    const request = { quoteId: 'quo_ABCDEFGHIJKLMNOP', approval: { quoteDigest: 'sha256:' + 'a'.repeat(64), maxTotal: { currency: 'USD', amountMinor: '10', scale: 2 } } };
    expect(CreatePurchaseRequest.safeParse(request).success).toBe(false);
    expect(CreatePurchaseRequest.safeParse({ ...request, approval: { ...request.approval, selectedFundingOptionId: 'fop_ABCDEFGHIJKLMNOP' } }).success).toBe(true);
    expect(CreatePurchaseRequest.safeParse({ ...request, fundingRail: 'cardano' }).success).toBe(false);
  });
});
