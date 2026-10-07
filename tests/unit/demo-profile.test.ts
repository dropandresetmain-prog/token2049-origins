import { describe, it, expect } from 'vitest';
import { demoData } from '../../src/demo/config.js';
import { applyDemoProfile, deliveryLabel } from '../../src/demo/profile.js';
import { assessFulfillment } from '../../src/contracts/input.js';
import { Fulfillment } from '../../src/contracts/intent.js';
import { INSTRUCTIONS } from '../../src/channels/mcp/server.js';

const profile = demoData.customerProfile;
const ready = (draft: unknown) => {
  const a = assessFulfillment(applyDemoProfile(draft, profile));
  if (a.status !== 'ready') throw new Error('needs_input: ' + a.fields.map(f => f.path).join(','));
  return a.value;
};
const missing = (draft: unknown) => {
  const a = assessFulfillment(applyDemoProfile(draft, profile));
  return a.status === 'needs_input' ? a.fields.map(f => f.path) : [];
};

describe('saved demo customer profile', () => {
  it('is DEMO data in the canonical shapes', () => {
    expect(profile.note).toMatch(/^DEMO configuration/);
    for (const f of [profile.retail, profile.hotel, profile.flight]) expect(Fulfillment.safeParse(f).success).toBe(true);
    expect(profile.retail.shippingAddress).toMatchObject({ firstName: 'Min Htet', lastName: 'Hset', address1: '10 Bayfront Avenue', address2: 'Marina Bay Sands', city: 'Singapore', zip: '018956', countryCode: 'SG', phone: '+6591234567' });
    expect(profile.flight.passengers[0]).toMatchObject({ givenName: 'Min Htet', familyName: 'Hset', gender: 'M', birthday: '1993-01-01', nationality: 'SG', passengerType: 'adult', document: { type: 'passport', number: 'K1234567D', expiry: '2031-12-31', issuingCountry: 'SG' } });
    expect(profile.flight.contact.mobile).toBe('0065-91234567');
    expect(profile.hotel.guests[0]).toMatchObject({ occupancyNumber: 1, email: 'min.htet.hset@example.com' });
  });

  it('{ category } alone fills retail, hotel and flight completely', () => {
    expect(ready({ category: 'retail' })).toEqual(profile.retail);
    expect(ready({ category: 'hotel' })).toEqual(profile.hotel);
    expect(ready({ category: 'flight' })).toEqual(profile.flight);
  });

  it('treats null, blank strings and a repeated seeded value as not supplied', () => {
    expect(ready({ category: 'retail', email: '', shippingAddress: { firstName: null, countryCode: 'SG', city: ' ' } })).toEqual(profile.retail);
  });

  it('never overwrites an explicit user value', () => {
    const r = ready({ category: 'retail', email: 'ada@example.com', shippingAddress: { phone: '+6598765432' } }) as typeof profile.retail;
    expect(r.email).toBe('ada@example.com');
    expect(r.shippingAddress.phone).toBe('+6598765432');
    expect(r.shippingAddress.address1).toBe('10 Bayfront Avenue');
    const h = ready({ category: 'hotel', holder: { phone: '+6598765432' } }) as typeof profile.hotel;
    expect(h.holder).toMatchObject({ phone: '+6598765432', firstName: 'Min Htet' });
    const f = ready({ category: 'flight', passengers: [{ birthday: '1990-05-05' }] }) as typeof profile.flight;
    expect(f.passengers[0]).toMatchObject({ birthday: '1990-05-05', givenName: 'Min Htet', document: profile.flight.passengers[0]!.document });
  });

  it('does not build a mixed address or identity: overrides ask for the rest instead', () => {
    expect(missing({ category: 'retail', shippingAddress: { address1: '5 Orchard Road' } }).sort()).toEqual(['shippingAddress.city', 'shippingAddress.countryCode', 'shippingAddress.zip']);
    expect(missing({ category: 'retail', shippingAddress: { firstName: 'Ada' } })).toEqual(['shippingAddress.lastName']);
    // A different traveller does not inherit the saved customer's DOB, gender, nationality or passport.
    expect(missing({ category: 'flight', passengers: [{ givenName: 'Ada', familyName: 'Lee' }] }).sort()).toEqual(['passengers.0.birthday', 'passengers.0.gender', 'passengers.0.nationality']);
    expect(missing({ category: 'hotel', holder: { firstName: 'Ada', lastName: 'Lee' } })).toEqual(['guests']);
  });

  it('adds no PII question when the profile satisfies the provider', () => {
    for (const category of ['retail', 'hotel', 'flight']) expect(missing({ category })).toEqual([]);
  });

  it('describes delivery without street, postcode, phone or email', () => {
    const label = deliveryLabel(profile.retail)!;
    expect(label).toBe('Delivering to Marina Bay Sands, Singapore');
    expect(label).not.toMatch(/Bayfront|018956|6591234567|example\.com/);
    expect(deliveryLabel(profile.hotel)).toBeNull();
  });

  it('MCP instructions use no fake/synthetic/test-customer language and disclose the demo exactly once', () => {
    expect(INSTRUCTIONS).not.toMatch(/fake|synthetic|test traveller|sandbox customer/i);
    expect(INSTRUCTIONS).not.toContain('Sandbox/testnet only');
    expect(INSTRUCTIONS.split('Demo transaction: payment uses testnet funds and the merchant checkout runs in a sandbox. No real money will be charged.')).toHaveLength(2);
    expect(INSTRUCTIONS).toMatch(/Do not ask the user for fields the profile already provides/);
  });
});
