export type PayerErrorCode = 'invalid_request'|'policy_violation'|'not_found'|'unauthenticated'|'conflict'|'payment_rejected'|'gateway_unreachable'|'rate_limited'|'internal';
/** Fixed messages only; never copy provider responses, private references or signing payloads. */
export class PayerError extends Error {
 retrySafe = false;
 constructor(readonly code: PayerErrorCode, message: string, readonly purchase?: unknown) { super(message); this.name='PayerError'; }
}
