/**
 * Browser-safe re-exports of the gateway's executable contracts.
 *
 * Only modules that depend on nothing but zod and each other may be imported here. Anything that touches
 * the database layer (for example src/evidence/proof.ts) is mirrored in ./evidence.ts instead, and a drift
 * test keeps the mirror honest.
 */
export {
  Money,
  CryptoAmount,
  formatMinor,
} from '../../../src/contracts/money.js';
export { SettlementBreakdown, SettlementPolicy } from '../../../src/contracts/settlement.js';
export {
  CONTRACT_VERSION,
  Category,
  Channel,
  ErrorBody,
  ErrorCode,
  EvidenceMode,
  FundingRail,
  ProviderEnvironment,
  ProviderRoute,
  Readiness,
} from '../../../src/contracts/common.js';
export {
  CommerceStatus,
  FundingOption,
  FundingSummary,
  MerchantPaymentStatus,
  PaymentState,
  PriceLine,
  PurchaseEventView,
  PurchaseState,
  PurchaseView,
  QuoteView,
  ReceiptView,
} from '../../../src/contracts/commerce.js';
export { CapabilitiesResponse, OPERATIONS, PurchaseResponse } from '../../../src/contracts/api.js';
export { HumanProgress, projectProgress, completionReference } from '../../../src/contracts/presentation.js';
export { SandboxExecution, SandboxRepresentation, SourceOffer } from '../../../src/contracts/provenance.js';
