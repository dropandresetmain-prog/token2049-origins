/**
 * Schemas for the operator-only gateway responses (scope operator:read).
 *
 * - GET /v1/evidence/treasury  -> TreasuryResponse (src/evidence/read-model.ts treasuryView)
 * - GET /v1/evidence/bank      -> BankResponse     (src/evidence/router.ts)
 * - GET /v1/capabilities       -> CapabilitiesResponse (public; see ./backend.ts)
 *
 * The backend has no zod schema for the first two. `console-contract.test.ts` parses the real backend
 * responses with these schemas, and `evidence.types-check.ts`-style compile checks keep the shapes honest.
 *
 * Client-side schemas are not `.strict()` on purpose: additive backend fields must not break the console.
 * Unknown keys are dropped on parse, so nothing the console has not been written to present can reach a screen
 * (for example a bank `description`, which the gateway does not send and the console would not show).
 *
 * The console never calls POST /v1/evidence/bank/refresh. It is read-only.
 */
import { z } from 'zod';
import { Money, Readiness } from './backend.js';

/** Which ledger an amount belongs to. They are never added together. */
export const LedgerMode = z.enum(['observed', 'simulated']);
export type LedgerMode = z.infer<typeof LedgerMode>;

const Minor = z.string().regex(/^-?\d+$/);
const ByAsset = z.record(z.string(), Minor);

export const TrialBalanceRow = z.object({
  ledgerMode: LedgerMode,
  asset: z.string(),
  debitTotal: Minor,
  creditTotal: Minor,
  net: Minor,
  balanced: z.boolean(),
});

export const LedgerAccount = z.object({
  account: z.string(),
  asset: z.string(),
  ledgerMode: LedgerMode,
  /** Debit-positive. `normalSide` says which sign is the natural one for the account. */
  balanceDebitPositive: Minor,
  normalSide: z.enum(['debit', 'credit']),
});

export const CapacityPool = z.object({
  ledgerMode: z.literal('simulated'),
  label: z.string(),
  currency: z.string(),
  scale: z.number().int().min(0),
  limitMinor: Minor,
  reservedMinor: Minor,
  cardPayableMinor: Minor,
  providerTestBalanceUsedMinor: Minor,
  availableMinor: Minor,
});

export const Obligations = z.object({
  ledgerMode: z.literal('observed'),
  note: z.string(),
  unappliedByAsset: ByAsset,
  refundDueByAsset: ByAsset,
  prepaymentOutstandingByAsset: ByAsset,
});

export const ReservationTotal = z.object({
  status: z.string(),
  currency: z.string(),
  scale: z.number().int().min(0),
  count: z.number().int().min(0),
  totalMinor: Minor,
  ledgerMode: z.literal('simulated'),
});

export const TreasuryResponse = z.object({
  note: z.string(),
  ledger: z.object({
    balanced: z.boolean(),
    trialBalance: z.array(TrialBalanceRow),
    accounts: z.array(LedgerAccount),
  }),
  simulatedCapacity: z.array(CapacityPool),
  purchasesByState: z.record(z.string(), z.number().int().min(0)),
  obligations: Obligations,
  reservations: z.array(ReservationTotal),
});
export type TreasuryResponse = z.infer<typeof TreasuryResponse>;

/* ---------- bank observations ---------- */

export const BankObservationKind = z.enum(['account_balance', 'card_summary', 'account_transaction', 'card_transaction']);
export type BankObservationKind = z.infer<typeof BankObservationKind>;

export const BankObservation = z.object({
  id: z.string(),
  bank: z.string(),
  kind: BankObservationKind,
  /** Already masked by the gateway ("****3456"). The console masks again before display. */
  maskedReference: z.string(),
  currency: z.string(),
  amount: Money.nullable(),
  availableAmount: Money.nullable(),
  environment: z.string(),
  source: z.string(),
  providerTimestamp: z.string().nullable(),
  observedAt: z.string(),
  caveats: z.array(z.string()),
  provenance: z.object({ environment: z.string(), evidenceMode: z.string() }),
});
export type BankObservation = z.infer<typeof BankObservation>;

export const BankResponse = z.object({
  note: z.string(),
  adapters: z.array(Readiness),
  observations: z.array(BankObservation),
});
export type BankResponse = z.infer<typeof BankResponse>;
