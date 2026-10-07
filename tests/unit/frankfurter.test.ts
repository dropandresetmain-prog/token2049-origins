import { describe, expect, it, vi } from 'vitest';
import { FrankfurterClient, FX_UNAVAILABLE } from '../../src/integrations/frankfurter/client.js';
import { convertReference, FxSnapshot } from '../../src/contracts/fx.js';
import { money } from '../../src/contracts/money.js';

const now = () => new Date('2026-10-07T03:00:00.000Z');
const snapshot = FxSnapshot.parse({ source: 'frankfurter', from: 'USD', to: 'SGD', rate: '1.3', referenceDate: '2026-10-06', fetchedAt: now().toISOString() });
const response = (rate: string) => `{"date":"2026-10-06","base":"USD","quote":"SGD","rate":${rate}}`;

describe('Frankfurter exact reference conversion', () => {
  it('uses the current v2 pair API with no redirects, bounded signal, attribution and exact numeric text', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(response('1.300000000000000000001')));
    const rate = await new FrankfurterClient({ fetchImpl, now }).latest('USD', 'SGD');
    expect(rate).toEqual({ ...snapshot, rate: '1.300000000000000000001' });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.frankfurter.dev/v2/rate/USD/SGD', expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
    // This fraction would disappear through Number; rounding up must still see it.
    expect(convertReference(money('USD', '100'), rate, 'SGD', 2, 'ceil')).toEqual(money('SGD', '131'));
  });

  it('converts SGD to USD exactly, inverting the same reference rational', () => {
    expect(convertReference(money('SGD', '6500'), snapshot, 'USD', 2, 'floor')).toEqual(money('USD', '5000'));
    expect(convertReference(money('SGD', '6000'), snapshot, 'USD', 2, 'floor')).toEqual(money('USD', '4615'));
  });

  it('converts USD to SGD and rounds payable up, never inventory up', () => {
    expect(convertReference(money('USD', '4319'), snapshot, 'SGD', 2, 'ceil')).toEqual(money('SGD', '5615'));
    expect(convertReference(money('USD', '4319'), snapshot, 'SGD', 2, 'floor')).toEqual(money('SGD', '5614'));
    const bound = convertReference(money('SGD', '6000'), snapshot, 'USD', 2, 'floor');
    expect(BigInt(convertReference(bound, snapshot, 'SGD', 2, 'ceil').amountMinor)).toBeLessThanOrEqual(6000n);
    expect(BigInt(convertReference(money('USD', BigInt(bound.amountMinor) + 1n), snapshot, 'SGD', 2, 'ceil').amountMinor)).toBeGreaterThan(6000n);
  });

  it.each([
    response('0'), response('-1.3'), response('"1.3"'), response('null'), response('1e-8'), '{}', 'not-json',
    response('1.3').replace('USD', 'EUR'), response('1.3').replace('2026-10-06', '2026-02-30'),
    response('1.3').replace('2026-10-06', '2026-10-08'), response('1.3').replace('SGD', 'sgd'),
  ])('rejects malformed reference responses: %s', async body => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    await expect(new FrankfurterClient({ fetchImpl, now }).latest('USD', 'SGD')).rejects.toMatchObject({ code: 'route_unavailable', message: FX_UNAVAILABLE });
  });

  it('fails closed on unavailability and redirects', async () => {
    for (const fetchImpl of [vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 })), vi.fn<typeof fetch>().mockRejectedValue(new TypeError('redirect'))]) {
      await expect(new FrankfurterClient({ fetchImpl, now }).latest('USD', 'SGD')).rejects.toMatchObject({ message: FX_UNAVAILABLE });
    }
  });

  it('bounds both stalled fetch and stalled response body even when a mock ignores abort', async () => {
    for (const bodyStalled of [false, true]) {
      let signal: AbortSignal | undefined;
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        signal = init?.signal ?? undefined;
        if (!bodyStalled) return new Promise<Response>(() => {});
        return { ok: true, text: () => new Promise<string>(() => {}) } as Response;
      });
      await expect(new FrankfurterClient({ fetchImpl, now, timeoutMs: 10 }).latest('USD', 'SGD')).rejects.toMatchObject({ message: FX_UNAVAILABLE });
      expect(signal?.aborted).toBe(true);
    }
  });

  it('rejects noncanonical currency codes and unsupported conversion pairs', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(new FrankfurterClient({ fetchImpl }).latest('S$', 'USD')).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(() => convertReference(money('EUR', '100'), snapshot, 'SGD', 2, 'ceil')).toThrow('reference pair');
  });
});
