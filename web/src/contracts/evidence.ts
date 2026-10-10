/**
 * Schemas for gateway responses that have no browser-importable schema of their own.
 *
 * - PurchaseProof mirrors src/evidence/proof.ts, which cannot be bundled because it imports the database
 *   layer. `evidence.drift.test.ts` parses the same fixtures with both schemas so the mirror cannot drift.
 * - EvidenceListItem and EvidenceDetail describe what src/evidence/read-model.ts returns today. The backend
 *   has no zod schema for them; `evidence.types-check.ts` asserts at compile time that the backend's return
 *   types satisfy these schemas.
 *
 * Client-side schemas are not `.strict()` on purpose: additive backend fields must not break the console.
 * The mirror of PurchaseProof IS strict, because it must match the backend exactly.
 */
import { z } from 'zod';
import { FundingSource } from '../../../src/contracts/presentation.js';
import { FundingOption, HumanProgress, Money, SandboxExecution, SourceOffer } from './backend.js';

/* ---------- GET /v1/evidence/purchases/:id/proof (scope evidence:read) ---------- */

export const ProofTimelineStep = z.enum(['requested', 'quote_confirmed', 'approved', 'funded', 'merchant_execution', 'result_verified']);
export type ProofTimelineStep = z.infer<typeof ProofTimelineStep>;
export const ProofStepStatus = z.enum(['complete', 'current', 'pending', 'attention']);
export type ProofStepStatus = z.infer<typeof ProofStepStatus>;

export const PurchaseProof = z.object({
  selectedSource: FundingSource.optional(),
  sourceOffer: SourceOffer.optional(), sandboxExecution: SandboxExecution.optional(),
  purchaseId: z.string(), quoteId: z.string(), summary: z.string(), commercialAmount: Money,
  progress: HumanProgress,
  timeline: z.array(z.object({ step: ProofTimelineStep,
    label: z.string(), status: ProofStepStatus, timestamp: z.string().nullable(),
    text: z.string(), evidenceRef: z.string().nullable(),
  }).strict()),
  funding: z.object({ requirement: FundingOption, confirmationStatus: z.string(), applied: z.boolean(),
    sources: z.array(z.object({ displayAddress: z.string(), evidenceRef: z.string() }).strict()),
    transfers: z.array(z.object({ reference: z.string(), confirmationStatus: z.string(), application: z.string(), evidenceMode: z.string(), verifiedAt: z.string() }).strict()),
  }).strict(),
  merchant: z.object({ provider: z.string(), environment: z.string(), result: z.string(), paymentStatus: z.string(), providerReference: z.string().nullable(), evidenceMode: z.string().nullable() }).strict(),
  receipt: z.object({ receiptId: z.string(), finalResult: z.string(), issuedAt: z.string(), limitations: z.array(z.string()), evidenceRefs: z.array(z.string()) }).strict().nullable(),
  technicalEvidencePath: z.string(),
}).strict();
export type PurchaseProof = z.infer<typeof PurchaseProof>;

export const PurchaseProofResponse = z.object({ proof: PurchaseProof });

/* ---------- GET /v1/evidence/purchases (scope evidence:read) ---------- */

const Provenance = z.object({ environment: z.string(), evidenceMode: z.string() });

export const ExecutionEvidenceStatus = z.enum(['not_started', 'pending', 'result_recorded', 'receipt_issued', 'unavailable']);

export const EvidenceListItem = z.object({
  id: z.string(),
  state: z.string(),
  route: z.string(),
  category: z.string(),
  paymentState: z.string(),
  commerceStatus: z.string(),
  merchantPaymentStatus: z.string(),
  payable: Money.nullable(),
  fundingRequirement: FundingOption,
  createdAt: z.string(),
  provenance: Provenance,
  executionEvidenceStatus: ExecutionEvidenceStatus,
});
export type EvidenceListItem = z.infer<typeof EvidenceListItem>;

export const EvidenceListResponse = z.object({ purchases: z.array(EvidenceListItem), limit: z.number().int() });
export type EvidenceListResponse = z.infer<typeof EvidenceListResponse>;

/* ---------- GET /v1/evidence/purchases/:id (scope evidence:read) ---------- */

/** Only the parts the console reads. The full redacted record is shown verbatim under "Technical details". */
export const EvidenceDetail = z.object({
  purchase: z.object({
    id: z.string(),
    state: z.string(),
    channel: z.string(),
    fundingRail: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  reservation: z
    .object({ status: z.enum(['active', 'consumed', 'released', 'held_unresolved']), amount: Money, ledgerMode: z.literal('simulated') })
    .nullable(),
  events: z.array(z.object({ sequence: z.number().int(), type: z.string(), at: z.string() })),
});
export type EvidenceDetail = z.infer<typeof EvidenceDetail>;
