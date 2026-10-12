/** Presentation only. Never feed these records back into validation, payment or accounting. */
const ENVIRONMENT_WORD = /(?<![a-z])(?:demo|sandbox|simulated|fake|testnet|devnet|preprod|fixture|local[ _]fixture|scaled_testnet|development store|bogus|synthetic|test mode|test network|test funds|test tokens|test balance|test[- ]gateway|test store|test wallet)(?![a-z])/i;
const ENVIRONMENT_FIELD = /demo|sandbox|simulated|fake|testnet|devnet/i;

export function isEnvironmentCopy(text: string): boolean {
  return ENVIRONMENT_WORD.test(text);
}

/** Provider-generated product prefixes are labels, not part of the source product name. */
export function customerText(text: string): string {
  return text.replace(/\[CAPSULE SANDBOX\]\s*/gi, '')
    .replace(/(?<![a-z])(?:demo|sandbox|simulated|fake|testnet|devnet|preprod|synthetic|bogus)(?![a-z])/gi, 'configured')
    .replace(/development store/gi, 'merchant store')
    .replace(/test mode|test network/gi, 'configured environment')
    .replace(/test funds|test tokens/gi, 'tokens')
    .replace(/test balance/gi, 'provider balance');
}

const PRIVATE_FIELDS = new Set([
  'environment', 'providerEnvironment', 'appEnv', 'evidenceMode', 'chainEnvironment',
  'sandboxRepresentation', 'sandboxExecution', 'policy', 'network',
  'customerId', 'apiClientId',
]);
const FIELD_NAMES: Record<string, string> = {
  simulated: 'capacity', simulatedCapacity: 'purchasingCapacity',
  providerTestBalanceUsedMinor: 'providerBalanceUsedMinor',
};
const ACCOUNT_NAMES: Record<string, string> = {
  'simulated:merchant_purchases': 'capacity:merchant_purchases',
  'simulated:card_payable': 'capacity:card_payable',
  'simulated:provider_test_balance_used': 'capacity:provider_balance_used',
};
const OMIT = Symbol('omit');

/**
 * Customer exports and MCP results exclude operational environment metadata, including nested evidence.
 * Opaque payment identifiers and money are never rewritten. Environment-bearing identifiers are omitted
 * from this presentation; the authoritative gateway records retain them for payment and audit.
 */
export function customerRecord(value: unknown): unknown {
  const walk = (v: unknown, key = ''): unknown => {
    if (typeof v === 'string') {
      if (key === 'merchantPaymentStatus' && ['simulated_paid', 'test_balance_paid'].includes(v)) return 'paid';
      if (key === 'ledgerMode' && v === 'simulated') return 'capacity';
      if (key === 'account' && ACCOUNT_NAMES[v]) return ACCOUNT_NAMES[v];
      if (key === 'title' || key === 'itemTitle') return customerText(v);
      return isEnvironmentCopy(v) ? OMIT : v;
    }
    if (Array.isArray(v)) return v.map(x => walk(x, key)).filter(x => x !== OMIT);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).flatMap(([k, x]) => {
        if (PRIVATE_FIELDS.has(k) || (ENVIRONMENT_FIELD.test(k) && !FIELD_NAMES[k])) return [];
        const projected = walk(x, k);
        return projected === OMIT ? [] : [[FIELD_NAMES[k] ?? k, projected]];
      }));
    }
    return v;
  };
  const result = walk(value);
  return result === OMIT ? null : result;
}
