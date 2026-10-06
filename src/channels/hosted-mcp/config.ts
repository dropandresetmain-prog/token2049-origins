import { readFileSync } from 'node:fs';

/**
 * Configuration for the hosted MCP endpoint (POST /mcp on the gateway's own public origin). Hosting is opt-in:
 * nothing here is read unless MCP_HOSTED_ENABLED=true. Error messages name variables, never values.
 */
export class HostedConfigError extends Error {}

export interface HostedMcpConfig {
  /** The one public origin this endpoint answers for, e.g. https://token2049-origins.onrender.com */
  publicUrl: URL;
  /** Exact Origin header values accepted besides the public origin (browser-style callers only). */
  allowedOrigins: string[];
  ownerPasscode: string;
  customerId: string;
  apiClientId: string;
  /** api_clients id of the hosted payer's gateway client (only used when payerTokenSha256 is set). */
  payerClientId: string;
  extraRedirectUris: string[];
  /** The single hosted Cardano payer (exact https origin of its free web service), if configured. */
  cardanoBridge?: { url: string; token: string };
  /** SHA-256 (hex) of the hosted payer's gateway token. Only the hash is configured; it registers the payer's gateway client. */
  payerTokenSha256?: string;
  /** SHA-256 (hex) of a read-only console access key (purchases:read + evidence:read) for the hosted customer. Hash only. */
  consoleKeySha256?: string;
  /** Test seams for slow payers (production values are set in the router). */
  bridgeTimeoutMs?: number;
  bridgeStatusTimeoutMs?: number;
  gatewayTimeoutMs?: number;
  /** How long a tool call waits for a long operation before answering "still running" (ChatGPT gives up after ~60 s). */
  backgroundWaitMs?: number;
  /** Loopback URL of this same process, used by the MCP tools to call the gateway contract. */
  gatewayUrl: string;
}

/** ChatGPT's backend calls without an Origin; these are accepted only if a caller does send one. */
const DEFAULT_ALLOWED_ORIGINS = ['https://chatgpt.com', 'https://chat.openai.com'];

function readSecret(path: string | undefined, label: string, minLength: number): string {
  if (!path) throw new HostedConfigError(`${label} is required`);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new HostedConfigError(`${label}: cannot read secret file`);
  }
  const v = raw.trim();
  if (v.length < minLength) throw new HostedConfigError(`${label}: secret is shorter than ${minLength} characters`);
  return v;
}

/** A bare https origin: no path, query, fragment, credentials; localhost may use http for local development only. */
export function parsePublicOrigin(value: string | undefined, label: string): URL {
  if (!value) throw new HostedConfigError(`${label} is required`);
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    throw new HostedConfigError(`${label} is not a valid URL`);
  }
  const loopback = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw new HostedConfigError(`${label} must be an https origin`);
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '') || /[\s\\]/.test(value.trim())) {
    throw new HostedConfigError(`${label} must be a bare origin (no path, query, fragment or credentials)`);
  }
  return u;
}

/**
 * The one hosted payer origin the gateway may call: https (loopback http only for local development), a bare origin, no
 * credentials, and never the gateway's own origin. It is configured, never discovered, and there is no fallback.
 */
export function parsePayerBridgeUrl(value: string, label: string, gatewayOrigin?: string): string {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    throw new HostedConfigError(`${label} is not a valid URL`);
  }
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '') || /[\s\\]/.test(value.trim())) {
    throw new HostedConfigError(`${label} must be a bare origin without credentials`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw new HostedConfigError(`${label} must be an https origin`);
  if (gatewayOrigin && u.origin === gatewayOrigin) throw new HostedConfigError(`${label} must be a different service than the gateway`);
  return u.origin;
}

export function loadHostedMcpConfig(env: NodeJS.ProcessEnv): HostedMcpConfig | null {
  if (env.MCP_HOSTED_ENABLED !== 'true') return null;
  const publicUrl = parsePublicOrigin(env.MCP_PUBLIC_URL, 'MCP_PUBLIC_URL');
  // The payer verifies the 402 challenge's resource URL against its gateway URL, which the core derives from PUBLIC_BASE_URL.
  // Both must therefore be the same origin or the hosted payer would (rightly) refuse every payment.
  if (!env.PUBLIC_BASE_URL || new URL(env.PUBLIC_BASE_URL).origin !== publicUrl.origin) throw new HostedConfigError('PUBLIC_BASE_URL must equal MCP_PUBLIC_URL');
  const ownerPasscode = readSecret(env.MCP_OAUTH_OWNER_PASSCODE_FILE, 'MCP_OAUTH_OWNER_PASSCODE_FILE', 16);

  const allowedOrigins = [...DEFAULT_ALLOWED_ORIGINS, ...(env.MCP_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)];
  for (const o of allowedOrigins) if (new URL(o).origin !== o) throw new HostedConfigError('MCP_ALLOWED_ORIGINS must list bare origins');
  const extraRedirectUris = (env.MCP_OAUTH_EXTRA_REDIRECT_URIS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const uri of extraRedirectUris) if (!/^https:\/\//.test(uri) || /[\s#]/.test(uri)) throw new HostedConfigError('MCP_OAUTH_EXTRA_REDIRECT_URIS must be exact https URLs');

  // Hosted payments are Cardano-only for this milestone: a Solana bridge here would be a silent misconfiguration.
  if (env.SOLANA_PAYER_BRIDGE_URL || env.SOLANA_PAYER_BRIDGE_TOKEN_FILE) throw new HostedConfigError('hosted MCP supports the Cardano payer only');
  let cardanoBridge: HostedMcpConfig['cardanoBridge'];
  if (env.CARDANO_PAYER_BRIDGE_URL || env.CARDANO_PAYER_BRIDGE_TOKEN_FILE) {
    if (!env.CARDANO_PAYER_BRIDGE_URL || !env.CARDANO_PAYER_BRIDGE_TOKEN_FILE) throw new HostedConfigError('CARDANO_PAYER_BRIDGE_URL and CARDANO_PAYER_BRIDGE_TOKEN_FILE must be set together');
    cardanoBridge = { url: parsePayerBridgeUrl(env.CARDANO_PAYER_BRIDGE_URL, 'CARDANO_PAYER_BRIDGE_URL', publicUrl.origin), token: readSecret(env.CARDANO_PAYER_BRIDGE_TOKEN_FILE, 'CARDANO_PAYER_BRIDGE_TOKEN_FILE', 24) };
  }

  const consoleKeySha256 = env.MCP_CONSOLE_KEY_SHA256?.trim().toLowerCase();
  if (consoleKeySha256 !== undefined && !/^[0-9a-f]{64}$/.test(consoleKeySha256)) throw new HostedConfigError('MCP_CONSOLE_KEY_SHA256 must be a 64-character hex SHA-256');
  const payerTokenSha256 = env.MCP_PAYER_GATEWAY_TOKEN_SHA256?.trim().toLowerCase();
  if (payerTokenSha256 !== undefined && !/^[0-9a-f]{64}$/.test(payerTokenSha256)) throw new HostedConfigError('MCP_PAYER_GATEWAY_TOKEN_SHA256 must be a 64-character hex SHA-256');

  const port = Number(env.PORT ?? '8787');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HostedConfigError('PORT must be 1-65535');
  return {
    publicUrl,
    allowedOrigins,
    ownerPasscode,
    customerId: 'cus_HOSTEDMCPDEMO',
    apiClientId: 'cli_HOSTEDMCPDEMO',
    payerClientId: 'cli_HOSTEDPAYER',
    extraRedirectUris,
    ...(cardanoBridge ? { cardanoBridge } : {}),
    ...(payerTokenSha256 ? { payerTokenSha256 } : {}),
    ...(consoleKeySha256 ? { consoleKeySha256 } : {}),
    gatewayUrl: `http://127.0.0.1:${port}`,
  };
}
