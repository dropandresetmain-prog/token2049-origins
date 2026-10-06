import { describe, expect, it } from 'vitest';
import { redact, redactString } from '../../src/infrastructure/redact.js';

describe('redaction of Shopify order references', () => {
  const orderGid = 'gid://shopify/Order/18933264089145';

  it('preserves only an exact canonical Shopify Order GID', () => {
    expect(redactString(orderGid)).toBe(orderGid);
    expect(redactString(`Order reference ${orderGid}`)).toBe('Order reference gid://shopify/Order/[REDACTED_NUMBER]');
    expect(redactString(`${orderGid}/notes`)).toBe('gid://shopify/Order/[REDACTED_NUMBER]/notes');
    expect(redactString(`${orderGid}\n`)).toBe('gid://shopify/Order/[REDACTED_NUMBER]\n');
    expect(redactString('gid://shopify/ProductVariant/18933264089145')).toBe('gid://shopify/ProductVariant/[REDACTED_NUMBER]');
  });

  it('continues masking card-like digits, email, bearer/API tokens and sensitive keys', () => {
    expect(redactString('4111 1111 1111 1111 buyer@example.com Bearer fixture-token shpat_12345678'))
      .toBe('[REDACTED_NUMBER][REDACTED_EMAIL] Bearer [REDACTED] [REDACTED_TOKEN]');
    expect(redact({ authorization: orderGid, providerReference: orderGid })).toEqual({
      authorization: '[REDACTED]',
      providerReference: orderGid,
    });
    expect(redact({ email: orderGid })).toEqual({ email: '[REDACTED_PII]' });
  });
});
