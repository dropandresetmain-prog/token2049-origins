import type { DemoConfig } from './config.js';
import type { Fulfillment } from '../contracts/intent.js';

/**
 * DEMO configuration only. Merges the saved demo customer (demo/demo-data.json -> customerProfile) into a
 * fulfillment draft BEFORE canonical validation, so the hosted MCP never has to ask for details the profile
 * already holds. The core and the HTTP API are untouched: they still accept arbitrary customer fulfillment.
 *
 * Rules:
 *  - An explicit user value is never overwritten. Blank strings and nulls count as "not supplied".
 *  - A user value equal to the seeded one is not an override (hosts often repeat country codes and names).
 *  - Mixed identities are never built. Supplying a different name for a person record means the personal
 *    attributes of that record (name pair, gender, birthday, nationality, passport) are NOT seeded, because they
 *    belong to the saved customer; the missing ones are reported as needs_input. Contact details (email, phone)
 *    still fill in, as the account holder's confirmation contact. The same applies to the delivery location:
 *    overriding any location field means the rest of the location is asked for, not taken from the profile.
 */
export type DemoCustomerProfile = DemoConfig['customerProfile'];
type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const present = (v: unknown): boolean => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
const same = (a: unknown, b: unknown) => (typeof a === 'string' && typeof b === 'string' ? a.trim().toLowerCase() === b.trim().toLowerCase() : a === b);
const overrides = (user: Rec, seed: Rec, keys: string[]) => keys.some(k => present(user[k]) && !same(user[k], seed[k]));

/** Drop undefined/null/blank values recursively so they surface as missing fields instead of validation errors. */
function prune(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(prune);
  if (isRec(v)) return Object.fromEntries(Object.entries(v).filter(([, x]) => present(x)).map(([k, x]) => [k, prune(x)]));
  return v;
}

/** user wins; otherwise the seed value (when it has one). */
function fill(out: Rec, user: Rec, seed: Rec, keys: string[]): void {
  for (const k of keys) if (!present(user[k]) && present(seed[k])) out[k] = seed[k];
}

interface PersonShape { name: string[]; personal?: string[]; contact: string[]; always?: string[] }

/** Fill one person record (holder, guest, contact, passenger). Returns whether the user named a different person. */
function person(userRaw: unknown, seed: Rec, shape: PersonShape): { value: Rec; different: boolean } {
  const user = isRec(userRaw) ? userRaw : {};
  const value: Rec = { ...user };
  const different = overrides(user, seed, shape.name);
  fill(value, user, seed, [...shape.contact, ...(shape.always ?? [])]);
  if (!different) {
    fill(value, user, seed, [...shape.name, ...(shape.personal ?? [])]);
    // A document is atomic: any user-supplied document field means the saved document is not used.
    if ('document' in seed && !present(user.document)) value.document = seed.document;
  }
  return { value, different };
}

export function applyDemoProfile(draft: unknown, profile: DemoCustomerProfile): unknown {
  if (!isRec(draft)) return draft;
  const user = prune(draft) as Rec;
  if (user.category === 'retail') {
    const seed = profile.retail as unknown as Rec & { shippingAddress: Rec };
    const addr = isRec(user.shippingAddress) ? user.shippingAddress : {};
    const out: Rec = { ...user };
    fill(out, user, seed, ['email']);
    const shipping: Rec = { ...addr };
    const location = ['address1', 'address2', 'city', 'province', 'zip', 'countryCode'];
    if (!overrides(addr, seed.shippingAddress, location)) fill(shipping, addr, seed.shippingAddress, location);
    if (!overrides(addr, seed.shippingAddress, ['firstName', 'lastName'])) fill(shipping, addr, seed.shippingAddress, ['firstName', 'lastName']);
    fill(shipping, addr, seed.shippingAddress, ['phone']);
    out.shippingAddress = shipping;
    return out;
  }
  if (user.category === 'hotel') {
    const seed = profile.hotel as unknown as { holder: Rec; guests: Rec[] };
    const holder = person(user.holder, seed.holder, { name: ['firstName', 'lastName'], contact: ['email', 'phone'] });
    const out: Rec = { ...user, holder: holder.value };
    if (Array.isArray(user.guests)) {
      out.guests = user.guests.map((g, i) => seed.guests[i]
        ? person(g, seed.guests[i]!, { name: ['firstName', 'lastName'], contact: ['email'], always: ['occupancyNumber'] }).value
        : g);
    } else if (!holder.different) out.guests = seed.guests;
    return out;
  }
  if (user.category === 'flight') {
    const seed = profile.flight as unknown as { contact: Rec; passengers: Rec[] };
    const contact = person(user.contact, seed.contact, { name: ['givenName', 'familyName'], contact: ['email', 'mobile'] });
    const out: Rec = { ...user, contact: contact.value };
    if (Array.isArray(user.passengers)) {
      out.passengers = user.passengers.map((p, i) => seed.passengers[i]
        ? person(p, seed.passengers[i]!, { name: ['givenName', 'familyName'], personal: ['gender', 'birthday', 'nationality'], contact: [], always: ['passengerType'] }).value
        : p);
    } else if (!contact.different) out.passengers = seed.passengers;
    return out;
  }
  return user;
}

/** Short, customer-facing delivery line. Deliberately omits street, postcode, phone and email. */
export function deliveryLabel(f: Fulfillment): string | null {
  if (f.category !== 'retail') return null;
  const a = f.shippingAddress;
  return `Delivering to ${a.address2?.trim() || a.address1}, ${a.city}`;
}
