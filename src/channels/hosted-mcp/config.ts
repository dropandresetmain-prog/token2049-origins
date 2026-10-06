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
  extraRedirectUris: string[];
  /** The single hosted Cardano payer bridge on the private network, if configured. */
  cardanoBridge?: { url: string; token: string };
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

/** Private-network payer bridge: a single-label host (Render service name) or loopback. Never a public name. */
export function parsePrivateBridgeUrl(value: string, label: string): string {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    throw new HostedConfigError(`${label} is not a valid URL`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HostedConfigError(`${label} must be http(s)`);
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '') || /[\s\\]/.test(value.trim())) {
    throw new HostedConfigError(`${label} must be a bare origin without credentials`);
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  const privateName = /^[a-z0-9][a-z0-9-]{0,62}$/.test(u.hostname); // single label: resolvable only inside the private network
  if (!loopback && !privateName) throw new HostedConfigError(`${label} must name a private-network service (single-label host) or loopback`);
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
    cardanoBridge = { url: parsePrivateBridgeUrl(env.CARDANO_PAYER_BRIDGE_URL, 'CARDANO_PAYER_BRIDGE_URL'), token: readSecret(env.CARDANO_PAYER_BRIDGE_TOKEN_FILE, 'CARDANO_PAYER_BRIDGE_TOKEN_FILE', 24) };
  }

  const port = Number(env.PORT ?? '8787');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new HostedConfigError('PORT must be 1-65535');
  return {
    publicUrl,
    allowedOrigins,
    ownerPasscode,
    customerId: 'cus_HOSTEDMCPDEMO',
    apiClientId: 'cli_HOSTEDMCPDEMO',
    extraRedirectUris,
    ...(cardanoBridge ? { cardanoBridge } : {}),
    gatewayUrl: `http://127.0.0.1:${port}`,
  };
}
