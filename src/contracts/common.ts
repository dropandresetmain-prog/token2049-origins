import { z } from 'zod';

export const CONTRACT_VERSION = 'v1' as const;

/** Prefixed opaque IDs: `<prefix>_<26 char ulid-like>` */
export const idSchema = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[0-9A-Za-z]{10,40}$`), `${prefix} id`);

export const CustomerId = idSchema('cus');
export const OfferId = idSchema('off');
export const QuoteId = idSchema('quo');
export const PurchaseId = idSchema('pur');
export const FundingEvidenceId = idSchema('fev');
export const ReceiptId = idSchema('rcp');
export const EventId = idSchema('evt');

export const IsoTimestamp = z.iso.datetime({ offset: true });

export const Category = z.enum(['retail', 'hotel', 'flight']);
export type Category = z.infer<typeof Category>;

export const ProviderRoute = z.enum(['shopify', 'atlas', 'nuitee']);
export type ProviderRoute = z.infer<typeof ProviderRoute>;

export const FundingRail = z.enum(['cardano', 'solana', 'sui', 'masumi']);
export type FundingRail = z.infer<typeof FundingRail>;

export const Channel = z.enum(['http', 'mcp', 'chatgpt', 'sokosumi', 'console', 'test']);
export type Channel = z.infer<typeof Channel>;

/** Separate dimensions, never collapsed into one "mode" flag. */
export const ChainEnvironment = z.enum(['cardano-preprod', 'solana-devnet', 'sui-testnet', 'none']);
export const ProviderEnvironment = z.enum(['sandbox', 'test', 'production', 'fixture']);
export const EvidenceMode = z.enum(['fresh_external', 'replay', 'local_fixture']);
export const LedgerMode = z.enum(['observed', 'simulated']);
export type ProviderEnvironment = z.infer<typeof ProviderEnvironment>;
export type EvidenceMode = z.infer<typeof EvidenceMode>;
export type LedgerMode = z.infer<typeof LedgerMode>;

export const VerificationStatus = z.enum(['verified', 'unverified', 'failed']);

/** Every external fact carries provenance. */
export const ExternalFact = z
  .object({
    source: z.string().min(1),
    environment: z.string().min(1),
    reference: z.string().min(1),
    observedAt: IsoTimestamp,
    verificationStatus: VerificationStatus,
    evidenceMode: EvidenceMode,
  })
  .strict();
export type ExternalFact = z.infer<typeof ExternalFact>;

export const Scope = z.enum([
  'offers:read',
  'quotes:write',
  'purchases:write',
  'purchases:fund',
  'purchases:read',
  'evidence:read',
  /** Operator-only: aggregate treasury, capacity and bank observations. Never granted to customer channels by default. */
  'operator:read',
]);
export type Scope = z.infer<typeof Scope>;

/** Readiness vocabulary from IMPLEMENTATION_PLAN §5. Configuration presence is not passing. */
export const ReadinessStatus = z.enum([
  'MISSING_CONFIG',
  'CONFIGURED_UNVERIFIED',
  'EXTERNAL_CHECK_PASSED',
  'ACCESS_BLOCKED',
  'LOCAL_TESTS_ONLY',
]);
export type ReadinessStatus = z.infer<typeof ReadinessStatus>;

export const Readiness = z
  .object({
    component: z.string(),
    status: ReadinessStatus,
    environment: z.string(),
    missing: z.array(z.string()).default([]),
    detail: z.string().optional(),
    checkedAt: IsoTimestamp,
  })
  .strict();
export type Readiness = z.infer<typeof Readiness>;

export const ErrorCode = z.enum([
  'unauthenticated',
  'forbidden',
  'not_found',
  'invalid_request',
  'needs_input',
  'idempotency_conflict',
  'conflict',
  'quote_expired',
  'quote_changed',
  'spend_limit_exceeded',
  'insufficient_capacity',
  'route_unavailable',
  'payment_required',
  'payment_invalid',
  'payment_replayed',
  'provider_error',
  'internal',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** The single error shape for every HTTP/MCP failure. */
export const ErrorBody = z
  .object({
    error: z
      .object({
        code: ErrorCode,
        message: z.string(),
        requestId: z.string(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();
export type ErrorBody = z.infer<typeof ErrorBody>;
