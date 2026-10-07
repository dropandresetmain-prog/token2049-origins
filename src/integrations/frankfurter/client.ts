import { z } from 'zod';
import { FxSnapshot, type FxReferenceSource } from '../../contracts/fx.js';
import { CurrencyCode } from '../../contracts/money.js';
import { CoreError } from '../../core/errors.js';

const RateResponse = z.object({ date: z.iso.date(), base: CurrencyCode, quote: CurrencyCode, rate: FxSnapshot.shape.rate }).strict();
export const FX_UNAVAILABLE = 'Currency conversion is temporarily unavailable. Try again with a USD budget.';

/** Daily/latest reference only. No customer data, API key, redirect or settlement conversion. */
export class FrankfurterClient implements FxReferenceSource {
  constructor(private readonly options: { fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => Date } = {}) {
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 10_000))
      throw new RangeError('FX timeout must be between 1 and 10000 ms');
  }

  async latest(from: string, to: string): Promise<FxSnapshot> {
    CurrencyCode.parse(from); CurrencyCode.parse(to);
    if (from === to) throw new RangeError('reference conversion requires different currencies');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('FX timeout')); }, this.options.timeoutMs ?? 3_000);
      });
      const request = async () => {
        const response = await (this.options.fetchImpl ?? fetch)(`https://api.frankfurter.dev/v2/rate/${from}/${to}`, {
          redirect: 'error', signal: controller.signal, headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error('FX unavailable');
        const text = await response.text();
        if (text.length > 8_192) throw new Error('FX response too large');
        // Node 24 exposes the original numeric lexeme. Never round the API rate through a JS number.
        const raw: unknown = JSON.parse(text, function (key, value, context?: { source: string }) {
          if (key === 'rate') {
            if (typeof value !== 'number' || !context?.source) throw new Error('exact JSON numeric rate required');
            return context.source;
          }
          return value;
        });
        const parsed = RateResponse.parse(raw);
        if (parsed.base !== from || parsed.quote !== to) throw new Error('FX pair mismatch');
        const now = (this.options.now ?? (() => new Date()))();
        if (parsed.date > now.toISOString().slice(0, 10)) throw new Error('future FX reference date');
        return FxSnapshot.parse({ source: 'frankfurter', from, to, rate: parsed.rate, referenceDate: parsed.date, fetchedAt: now.toISOString() });
      };
      return await Promise.race([request(), timeout]);
    } catch {
      throw new CoreError('route_unavailable', FX_UNAVAILABLE, { source: 'frankfurter', from, to });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
