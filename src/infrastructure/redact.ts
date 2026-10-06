/**
 * Redaction for anything that can leave the process boundary: logs, events, tool output, receipts,
 * error details and browser traces. Conservative by design: key-based masking plus value patterns.
 */
const SECRET_KEY = /(secret|token|password|passwd|api[-_]?key|authorization|cookie|mnemonic|seed|private|skey|signature|cvv|cvc|pan|card[-_]?number|x-payment|payment[-_]?payload)/i;
const PII_KEY = /(email|phone|mobile|address1|address2|street|zip|postal|birthday|birth|passport|document|first[-_]?name|last[-_]?name|family[-_]?name|given[-_]?name|holder|guests?|passengers?|contact|shipping[-_]?address|nationality)/i;

const VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:\d[ -]?){13,19}\b/g, '[REDACTED_NUMBER]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/\bt2o_[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_TOKEN]'],
  [/\b(?:sk|pk|tok|shpat|shpss|sand|prod)_[A-Za-z0-9_-]{8,}\b/g, '[REDACTED_TOKEN]'],
  [/\b(ed25519_sk|xprv|addr_xsk)[0-9a-z]{20,}\b/gi, '[REDACTED_KEY]'],
];

export function redactString(s: string): string {
  // A Shopify Order GID is an opaque reference needed to reconcile a verified merchant result.
  // Preserve only the complete canonical form; the numeric component remains masked in any
  // surrounding or otherwise untrusted string, and object keys are still handled by redact().
  if (/^gid:\/\/shopify\/Order\/[1-9]\d{0,19}(?![\s\S])/.test(s)) return s;
  let out = s;
  for (const [re, rep] of VALUE_PATTERNS) out = out.replace(re, rep);
  return out;
}

export function redact<T>(value: T, depth = 0): T {
  if (depth > 12) return '[REDACTED_DEPTH]' as T;
  if (typeof value === 'string') return redactString(value) as T;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) out[k] = '[REDACTED]';
      else if (PII_KEY.test(k)) out[k] = '[REDACTED_PII]';
      else out[k] = redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}
