import { z } from 'zod';
import data from '../../demo/demo-data.json' with { type: 'json' };
import { SettlementPolicy } from '../contracts/settlement.js';
import { IntegerString } from '../contracts/money.js';
import { RetailFulfillment, HotelFulfillment } from '../contracts/intent.js';

const text = z.string().min(1);
const country = z.string().regex(/^[A-Z]{2}$/);
const days = z.number().int().min(1).max(365);
const scenario = { id: text, label: text, maxCommercialMinor: IntegerString };
export const DemoConfig = z.object({
  version: z.literal(1), settlementPolicy: SettlementPolicy, settlementLabel: text,
  buyer: RetailFulfillment.omit({ category: true }),
  traveller: HotelFulfillment.shape.holder,
  retail: z.object({ ...scenario, query: text, productHandle: text.nullable(), productRef: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/).nullable(), quantity: z.number().int().min(1).max(10), shipToCountry: country, scalingExampleMinor: IntegerString }).strict(),
  retailJudgeSandbox: z.object({ query: text, maxCommercialMinor: IntegerString, maxItemMinor: z.literal('10000'), currency: z.literal('USD'), quantity: z.literal(1), shipToCountry: country }).strict(),
  hotel: z.object({ ...scenario, cityName: text, countryCode: country, checkInDaysFromNow: days, checkOutDaysFromNow: days, adults: z.number().int().min(1).max(6), guestNationality: country }).strict().refine(h => h.checkOutDaysFromNow > h.checkInDaysFromNow),
  flight: z.object({ ...scenario, from: z.string().regex(/^[A-Z]{3}$/), to: z.string().regex(/^[A-Z]{3}$/), departDaysFromNow: days, adults: z.number().int().min(1).max(4) }).strict().refine(f => f.from !== f.to),
}).strict();
export type DemoConfig = z.infer<typeof DemoConfig>;
export function loadDemoConfig(raw: unknown = data): DemoConfig { return DemoConfig.parse(raw); }
export const demoData = loadDemoConfig();
export function demoDate(offsetDays: number, now = new Date()): string {
  return new Date(now.getTime() + days.parse(offsetDays) * 86_400_000).toISOString().slice(0, 10);
}
