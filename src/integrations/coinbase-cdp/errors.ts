export function sanitizeCliError(error: unknown): string {
  if (error instanceof Error && error.message === 'usage: npm run cdp:treasury -- --provision | --read | --test-transfer') return error.message;
  if (error instanceof Error && error.message === 'CDP credentials are unavailable; set CDP_API_KEY_ID, CDP_API_KEY_SECRET and CDP_WALLET_SECRET in the private environment') return error.message;
  return 'CDP operation failed; provider details were suppressed. Inspect protected local state and reconcile before retrying.';
}
