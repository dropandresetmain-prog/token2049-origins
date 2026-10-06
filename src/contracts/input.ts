import { z } from 'zod';
import { PurchaseIntent, Fulfillment, RetailIntent, HotelIntent, FlightIntent, RetailFulfillment, HotelFulfillment, FlightFulfillment } from './intent.js';

const draftMoney = RetailIntent.shape.spendCeiling.partial();
const draftCommon = { spendCeiling: draftMoney.optional() };
export const PurchaseIntentDraft = z.discriminatedUnion('category', [
  z.object(RetailIntent.shape).partial().required({ category: true }).extend(draftCommon).strict(),
  z.object(HotelIntent.shape).partial().required({ category: true }).extend({ ...draftCommon,
    destination: z.union([
      HotelIntent.shape.destination.options[0].partial(),
      HotelIntent.shape.destination.options[1].partial(),
      HotelIntent.shape.destination.options[2].partial(),
    ]).optional(),
    occupancies: z.array(HotelIntent.shape.occupancies.element.partial()).min(1).max(4).optional(),
  }).strict(),
  z.object(FlightIntent.shape).partial().required({ category: true }).extend(draftCommon).strict(),
]);
export type PurchaseIntentDraft = z.infer<typeof PurchaseIntentDraft>;
export const FulfillmentDraft = z.discriminatedUnion('category', [
  RetailFulfillment.partial().required({ category: true }).extend({ shippingAddress: RetailFulfillment.shape.shippingAddress.partial().optional() }),
  HotelFulfillment.partial().required({ category: true }).extend({
    holder: HotelFulfillment.shape.holder.partial().optional(),
    guests: z.array(HotelFulfillment.shape.guests.element.partial()).min(1).max(8).optional(),
  }),
  FlightFulfillment.partial().required({ category: true }).extend({
    contact: FlightFulfillment.shape.contact.partial().optional(),
    passengers: z.array(FlightFulfillment.shape.passengers.element.partial().extend({
      document: FlightFulfillment.shape.passengers.element.shape.document.unwrap().partial().optional(),
    })).min(1).max(4).optional(),
  }),
]);
export type FulfillmentDraft = z.infer<typeof FulfillmentDraft>;

export const InputField = z.object({
  path: z.string().regex(/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*$/),
  humanLabel: z.string(), expectedType: z.enum(['string', 'number', 'integer', 'date', 'email', 'object', 'array']),
  reason: z.string(), issue: z.enum(['missing', 'required_by_provider']),
  format: z.string().optional(), allowedValues: z.array(z.string()).optional(),
}).strict();
export const NeedsInput = z.object({ status: z.literal('needs_input'),
  phase: z.enum(['search', 'fulfillment', 'provider', 'approval', 'funding_selection']),
  collectionPhase: z.enum(['search', 'fulfillment']).optional(),
  fields: z.array(InputField).min(1),
}).strict();
export type NeedsInput = z.infer<typeof NeedsInput>;
export type InputField = z.infer<typeof InputField>;
export type Assessment<T> = { status: 'ready'; value: T } | NeedsInput;

// Requirement descriptions come from the canonical schemas, never from provider messages or user values.
type Node = { type?: string; format?: string; pattern?: string; enum?: string[]; const?: unknown;
  properties?: Record<string, Node>; required?: string[]; items?: Node; maxItems?: number; anyOf?: Node[]; oneOf?: Node[] };
const trees = {
  search: Object.fromEntries([RetailIntent, HotelIntent, FlightIntent].map(s => [s.shape.category.value, z.toJSONSchema(s, { io: 'input' }) as Node])),
  fulfillment: Object.fromEntries([RetailFulfillment, HotelFulfillment, FlightFulfillment].map(s => [s.shape.category.value, z.toJSONSchema(s, { io: 'input' }) as Node])),
};
const at = (value: unknown, path: string[]) => path.reduce<unknown>((v, k) => v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined, value);
function field(path: string[], node: Node, phase: 'search' | 'fulfillment'): InputField {
  const name = path.join('.');
  const date = node.pattern === '^\\d{4}-\\d{2}-\\d{2}$';
  const labels: Record<string, string> = { from: 'Departure airport', to: 'Destination airport', departDate: 'Departure date', checkin: 'Check-in date', checkout: 'Check-out date', spendCeiling: 'Spending limit', shipToCountry: 'Delivery country', guestNationality: 'Guest nationality' };
  const humanLabel = labels[name] ?? path.map(p => /^\d+$/.test(p) ? String(Number(p) + 1) : p.replace(/([a-z])([A-Z])/g, '$1 $2')).join(' · ');
  return { path: name, humanLabel: humanLabel[0]!.toUpperCase() + humanLabel.slice(1),
    expectedType: date ? 'date' : node.format === 'email' ? 'email' : (node.type ?? 'object') as InputField['expectedType'],
    reason: phase === 'search' ? 'Required to search inventory' : 'Required to fulfill this purchase', issue: 'missing',
    ...(date ? { format: 'YYYY-MM-DD' } : node.format ? { format: node.format } : {}),
    ...(node.enum ? { allowedValues: node.enum } : typeof node.const === 'string' ? { allowedValues: [node.const] } : {}),
  };
}
function requirements(node: Node, value: unknown, phase: 'search' | 'fulfillment', path: string[] = []): InputField[] {
  if (node.anyOf || node.oneOf) {
    const options = node.anyOf ?? node.oneOf!;
    // An absent location needs a location choice; a supplied shape selects a controlled location variant.
    if (value === undefined) return [field(path, { type: 'object' }, phase)];
    const keys = Object.keys(value as object);
    const chosen = options.find(n => keys.every(k => k in (n.properties ?? {})));
    return chosen ? requirements(chosen, value, phase, path) : [];
  }
  if (node.properties) return Object.keys(node.properties).filter(k => node.required?.includes(k) || at(value, [k]) !== undefined)
    .flatMap(k => requirements(node.properties![k]!, at(value, [k]), phase, [...path, k]));
  if (value === undefined) return [field(path, node, phase)];
  if (node.items && Array.isArray(value)) return value.flatMap((v, i) => requirements(node.items!, v, phase, [...path, String(i)]));
  return [];
}
function assess<T>(draft: z.ZodType, canonical: z.ZodType<T>, raw: unknown, phase: 'search' | 'fulfillment'): Assessment<T> {
  const value = draft.parse(raw) as { category: string; query?: string; productRef?: string };
  const fields = requirements(trees[phase][value.category]!, value, phase);
  if (phase === 'search' && value.category === 'retail' && !value.query && !value.productRef) {
    fields.push({ path: 'query', humanLabel: 'Product query or product reference', expectedType: 'string', reason: 'Supply query or productRef to search the catalog', issue: 'missing' });
  }
  if (fields.length) return NeedsInput.parse({ status: 'needs_input', phase, fields });
  return { status: 'ready', value: canonical.parse(value) };
}
export const assessPurchaseIntent = (raw: unknown) => assess(PurchaseIntentDraft, PurchaseIntent, raw, 'search');
export const assessFulfillment = (raw: unknown) => assess(FulfillmentDraft, Fulfillment, raw, 'fulfillment');

/** Stable provider requirements are promoted into canonical schemas deliberately. */
export function providerRequirements(category: string, phase: 'search' | 'fulfillment', paths: string[]): NeedsInput {
  const root = trees[phase][category];
  const fields = paths.map(path => {
    let nodes: Node[] = root ? [root] : [];
    for (const part of path.split('.')) {
      nodes = nodes.flatMap(n => (n.anyOf ?? n.oneOf ?? [n]).flatMap(v => /^(0|[1-9]\d*)$/.test(part)
        ? v.items && Number(part) < (v.maxItems ?? 0) ? [v.items] : []
        : v.properties?.[part] ? [v.properties[part]!] : []));
    }
    if (nodes.length !== 1 || nodes[0]!.properties || nodes[0]!.items || path === 'category' || path === 'route' || path.startsWith('spendCeiling')) {
      throw new Error('unmodelled provider requirement');
    }
    return { ...field(path.split('.'), nodes[0]!, phase), issue: 'required_by_provider' as const };
  });
  return NeedsInput.parse({ status: 'needs_input', phase: 'provider', collectionPhase: phase, fields });
}
