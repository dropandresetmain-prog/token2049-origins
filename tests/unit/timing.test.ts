import { describe, expect, it, vi } from 'vitest';
import { timedOperation } from '../../src/infrastructure/timing.js';

describe('passive operation timing', () => {
  it('records fixed metadata without results or error content', async () => {
    const sink = vi.fn();
    const result = { private: 'buyer@example.com' };
    expect(await timedOperation('shopify.api', 'readback', async () => result, sink)).toBe(result);
    expect(sink.mock.calls[0]![0]).toEqual({ type: 'operation.timing', component: 'shopify.api', step: 'readback', durationMs: expect.any(Number), outcome: 'ok' });
    const failure = new Error('secret token and page content');
    await expect(timedOperation('shopify.browser', 'open_checkout', async () => { throw failure; }, sink)).rejects.toBe(failure);
    expect(sink.mock.calls[1]![0].outcome).toBe('error');
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(/buyer@|secret token|page content/);
  });

  it('isolates broken telemetry on success and failure', async () => {
    const sink = () => { throw new Error('sink failed'); };
    expect(await timedOperation('payer', 'sign', async () => 42, sink)).toBe(42);
    const failure = new Error('original failure');
    await expect(timedOperation('payer', 'sign', async () => { throw failure; }, sink)).rejects.toBe(failure);
  });
});
