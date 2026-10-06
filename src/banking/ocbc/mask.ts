/**
 * Defensive masking for bank/card references. Anything that leaves an adapter or the evidence API
 * carries at most the last four characters of an account/card number, never more.
 */

/** "****1234" from any account-like value, or "****" when nothing safe can be shown. */
export function maskReference(value: unknown): string {
  const raw = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof raw !== 'string') return '****';
  // A value that arrives already masked ("XXXX-XXXX-1234", "******1234") keeps its visible last four.
  const alreadyMasked = /[*xX\u2022]{2,}/.test(raw);
  const compact = raw.replace(/[\s\-._/*\u2022]+/g, '');
  // An unmasked value shorter than 8 characters would be revealed almost entirely by "last four".
  if (compact.length < 4 || (!alreadyMasked && compact.length < 8)) return '****';
  const last4 = compact.slice(-4);
  if (!/^[0-9A-Za-z]{4}$/.test(last4) || /[xX]/.test(last4)) return '****';
  return `****${last4}`;
}
