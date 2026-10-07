import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEMO_DISCLOSURE, describeQuote } from '../../src/channels/mcp/tools.js';
import type { QuoteView } from '../../src/contracts/commerce.js';

// Sanitized live quote views reproduce the title, terms and FX wording missed by the fixture-only profile tests.
const { quotes } = JSON.parse(readFileSync(new URL('../fixtures/fresh-hosted-quote-views.json', import.meta.url), 'utf8')) as { quotes: QuoteView[] };

describe('customer wording for observed hosted quotes', () => {
  it.each(quotes)('$category: emits the disclosure once and keeps other environment details in evidence', (quote) => {
    const before = JSON.stringify(quote);
    const text = describeQuote(quote, [], new Map(), quote.category === 'retail' ? 'Delivering to Marina Bay Sands, Singapore' : null);
    expect(text.split(DEMO_DISCLOSURE)).toHaveLength(2);
    expect(text.replace(DEMO_DISCLOSURE, '')).not.toMatch(/sandbox|testnet|synthetic|fake|bogus|simulated|development store/i);
    expect(text).toContain('Terms: ' + quote.terms[0]);
    expect(text).toContain(quote.fundingOptions[0]!.fundingOptionId!);
    expect(text).toContain(quote.expiresAt);
    expect(JSON.stringify(quote)).toBe(before);
    expect(quote.providerEnvironment).toBeTruthy();
    expect(quote.terms.some(t => /sandbox|development store/i.test(t))).toBe(true);
    expect(quote.fundingOptions[0]!.settlement?.policy.mode).toBe('scaled_testnet');
  });

  it('shows the source product and USD commercial amount separately from the frozen SGD budget', () => {
    const quote = quotes.find(q => q.category === 'retail')!;
    const text = describeQuote(quote, [], new Map(), 'Delivering to Marina Bay Sands, Singapore');
    expect(text).toContain('Exact quote for "Travel Adapter"');
    expect(text).toContain('Merchant total 24.00 USD');
    expect(text).toContain('30.69 SGD (user budget 35.00 SGD)');
    expect(text).toContain('Frankfurter, 2026-10-07');
    expect(text).toContain('Delivering to Marina Bay Sands, Singapore');
    expect(quote.title).toBe('[CAPSULE SANDBOX] Travel Adapter');
    expect(quote.sandboxRepresentation?.boundary).toContain('Source merchant receives no order or payment');
  });
});
