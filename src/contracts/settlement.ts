import { z } from 'zod';
import { IntegerString, Money, minor } from './money.js';

/** Not an FX rate: this rational scales commercial notional into valueless testnet notional. */
export const SettlementPolicy = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('full_notional'), numerator: z.literal(1), denominator: z.literal(1) }).strict(),
  z.object({ mode: z.literal('scaled_testnet'), numerator: z.literal(1), denominator: z.literal(1000) }).strict(),
]);
export type SettlementPolicy = z.infer<typeof SettlementPolicy>;

export function settlementBaseUnits(commercial: Money, decimals: number, rawPolicy: SettlementPolicy): bigint {
  Money.parse(commercial);
  const policy = SettlementPolicy.parse(rawPolicy);
  if (commercial.currency !== 'USD' || commercial.scale !== 2) throw new RangeError('settlement supports USD cents only; no FX conversion');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new RangeError('unsupported settlement decimals');
  const numerator = minor(commercial) * 10n ** BigInt(decimals) * BigInt(policy.numerator);
  const denominator = 10n ** BigInt(commercial.scale) * BigInt(policy.denominator);
  if (numerator % denominator !== 0n) throw new RangeError('settlement cannot be represented exactly');
  return numerator / denominator;
}

export const SettlementBreakdown = z.object({
  policy: SettlementPolicy,
  commercialPrincipal: Money,
  commercialServiceFee: Money,
  commercialTotal: Money,
  principalBaseUnits: IntegerString,
  feeBaseUnits: IntegerString,
  totalBaseUnits: IntegerString,
}).strict();
export type SettlementBreakdown = z.infer<typeof SettlementBreakdown>;

/** Validate both sides independently, including fee allocation, without rounding. */
export function validateSettlement(raw: unknown, decimals: number): SettlementBreakdown {
  const s = SettlementBreakdown.parse(raw);
  const principal = settlementBaseUnits(s.commercialPrincipal, decimals, s.policy);
  const fee = settlementBaseUnits(s.commercialServiceFee, decimals, s.policy);
  const total = settlementBaseUnits(s.commercialTotal, decimals, s.policy);
  if (minor(s.commercialPrincipal) + minor(s.commercialServiceFee) !== minor(s.commercialTotal) ||
      principal.toString() !== s.principalBaseUnits || fee.toString() !== s.feeBaseUnits ||
      total.toString() !== s.totalBaseUnits || principal + fee !== total) throw new RangeError('inconsistent settlement breakdown');
  return s;
}
