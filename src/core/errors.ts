import type { ErrorCode } from '../contracts/common.js';

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_request: 400,
  needs_input: 422,
  idempotency_conflict: 409,
  conflict: 409,
  quote_expired: 409,
  quote_changed: 409,
  spend_limit_exceeded: 422,
  insufficient_capacity: 422,
  route_unavailable: 503,
  payment_required: 402,
  payment_invalid: 402,
  payment_replayed: 409,
  provider_error: 502,
  internal: 500,
};

export class CoreError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

/**
 * Thrown by provider adapters. `outcome` tells the core whether a request may have reached
 * the provider: only `not_sent` and `rejected` are safe to treat as definite no-charge failures.
 */
export class ProviderError extends Error {
  constructor(
    readonly outcome: 'not_sent' | 'rejected' | 'unknown',
    readonly providerCode: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
