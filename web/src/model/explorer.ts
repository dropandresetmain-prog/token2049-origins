/**
 * Block-explorer links for funding transaction proof. Only X Layer has one today; other rails keep showing the
 * copyable reference alone. The hash is validated before a URL is built, so nothing untrusted reaches an href.
 */

/** Mirrors EXPLORER_TX_URL in src/funding/xlayer/config.ts. Duplicated on purpose: the web bundle imports no backend funding modules. */
export const XLAYER_EXPLORER_TX_URL = 'https://www.okx.com/web3/explorer/xlayer-test/tx/';

const EVM_TX_HASH = /^0x[0-9a-f]{64}$/;

const BUILDERS = new Map<string, (reference: string) => string | null>([
  ['xlayer', (reference) => (EVM_TX_HASH.test(reference) ? `${XLAYER_EXPLORER_TX_URL}${reference}` : null)],
]);

/** Explorer URL for a funding transaction, or null when the rail has no explorer or the reference is not a transaction hash. */
export function explorerTxUrl(rail: string, reference: string | null | undefined): string | null {
  if (!reference) return null;
  return BUILDERS.get(rail)?.(reference) ?? null;
}
