import { describe, it, expect, vi, afterEach } from 'vitest';
import { decodePaymentSignatureHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentRequired } from '@x402/core/types';
import { createSolanaFundingAdapter } from '../../src/funding/solana/adapter.js';
import { parseSolanaConfig } from '../../src/funding/solana/config.js';
import { scenario, clock } from '../support/solana.js';

afterEach(() => vi.restoreAllMocks());
describe('keyless gateway with internal hosted Solana sponsor', () => {
  it('requires no public facilitator endpoint or bearer secret in payer-broadcast mode', async () => {
    const s = await scenario();
    const { SOLANA_FACILITATOR_TOKEN_FILE: _token, SOLANA_FACILITATOR_URL: _url, ...env } = s.env;
    expect(parseSolanaConfig({ ...env, SOLANA_SETTLEMENT_MODE: 'payer_broadcast' }).ok).toBe(true);
    expect(parseSolanaConfig(env).ok).toBe(false);
    expect(parseSolanaConfig({ ...env, SOLANA_FACILITATOR_TOKEN_FILE: _token })).toEqual({ ok: false, missing: ['SOLANA_FACILITATOR_URL'] });
  });
  it.each([true, false])('independently requires finality=%s and never calls a facilitator or signs', async finalized => {
    clock.set('2026-10-06T14:00:00Z');
    const s = await scenario();
    s.setFinalized(finalized);
    const facilitator = { verify: vi.fn(), settle: vi.fn(), getSupported: vi.fn() };
    const adapter = createSolanaFundingAdapter({ ...s.env, SOLANA_SETTLEMENT_MODE: 'payer_broadcast' }, { clock, fetchImpl: s.fetchImpl, facilitator });
    const requirement = (adapter.paymentRequirements(s.input) as PaymentRequired).accepts[0]!;
    expect(requirement.extra?.preparation).toEqual({ mode: 'payer_broadcast', requiresFullySignedTransaction: true });
    const payload = decodePaymentSignatureHeader(s.header);
    const header = encodePaymentSignatureHeader({ ...payload, accepted: requirement });
    expect((await adapter.readiness()).status).toBe('EXTERNAL_CHECK_PASSED');
    const result = await adapter.verify(header, s.input);
    expect(result.ok).toBe(finalized);
    if (!result.ok) expect(result).toMatchObject({ code: 'payment_required', settlementAttempted: true });
    expect(facilitator.verify).not.toHaveBeenCalled();
    expect(facilitator.settle).not.toHaveBeenCalled();
    expect(facilitator.getSupported).not.toHaveBeenCalled();
  });
  it('retains exact binding and rejects an altered amount before any settlement', async () => {
    clock.set('2026-10-06T14:00:00Z');
    const s = await scenario();
    const adapter = createSolanaFundingAdapter({ ...s.env, SOLANA_SETTLEMENT_MODE: 'payer_broadcast' }, { clock, fetchImpl: s.fetchImpl });
    const payload = decodePaymentSignatureHeader(s.header);
    const req = (adapter.paymentRequirements(s.input) as PaymentRequired).accepts[0]!;
    const header = encodePaymentSignatureHeader({ ...payload, accepted: { ...req, amount: '1001' } });
    expect(await adapter.verify(header, s.input)).toMatchObject({ ok: false, settlementAttempted: false });
  });
});
