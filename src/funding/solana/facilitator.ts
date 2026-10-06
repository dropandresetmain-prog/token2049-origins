import { readFileSync } from 'node:fs';
import type { HTTPFacilitatorClient } from '@x402/core/http';
import type { PaymentPayload, PaymentRequirements, VerifyResponse, SettleResponse, SupportedResponse } from '@x402/core/types';
import type { SolanaConfig } from './config.js';
import { z } from 'zod';

const Network = z.custom<`${string}:${string}`>(v => typeof v === 'string' && /^[^:]+:.+$/.test(v));
const Responses = {
  verify: z.object({ isValid: z.boolean(), invalidReason: z.string().optional(), invalidMessage: z.string().optional(), payer: z.string().optional() }),
  settle: z.object({ success: z.boolean(), errorReason: z.string().optional(), errorMessage: z.string().optional(), payer: z.string().optional(), transaction: z.string(), network: Network }),
  supported: z.object({ kinds: z.array(z.object({ x402Version: z.number().int(), scheme: z.string(), network: Network, extra: z.record(z.string(), z.unknown()).optional() })), extensions: z.array(z.string()), signers: z.record(z.string(), z.array(z.string())) }),
};

// The SDK client follows redirects. Keep authentication on the configured origin instead.
export function createSolanaFacilitatorClient(cfg: SolanaConfig, fetchImpl: typeof fetch = fetch): Pick<HTTPFacilitatorClient, 'verify' | 'settle' | 'getSupported'> {
  async function request<T>(route: 'verify' | 'settle' | 'supported', payload?: PaymentPayload, requirements?: PaymentRequirements): Promise<T> {
    const token = readFileSync(cfg.facilitatorTokenFile, 'utf8').trim();
    if (!token) throw new Error('facilitator authentication unavailable');
    const response = await fetchImpl(cfg.facilitatorUrl + '/' + route, {
      method: payload ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify({ x402Version: payload.x402Version, paymentPayload: payload, paymentRequirements: requirements }) } : {}),
      redirect: 'error', signal: AbortSignal.timeout(45000),
    });
    if (!response.ok || response.redirected) throw new Error('facilitator request rejected');
    return Responses[route].parse(await response.json()) as T;
  }
  return {
    verify: (payload, requirements) => request<VerifyResponse>('verify', payload, requirements),
    settle: (payload, requirements) => request<SettleResponse>('settle', payload, requirements),
    getSupported: () => request<SupportedResponse>('supported'),
  };
}
