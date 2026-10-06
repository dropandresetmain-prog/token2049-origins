import { readFileSync } from 'node:fs';

export type PayerRail = 'cardano' | 'solana';
export const PAYER_RAILS: readonly PayerRail[] = ['cardano', 'solana'];
export interface BridgeEndpoint { url: string; token: string }

/**
 * Resolved runtime configuration for the MCP channel. Secrets are held as plain strings in memory
 * only; they are read from files (never from argv or env values) and are scrubbed from every output.
 */
export interface McpConfig {
  /** Base URL of the canonical HTTP gateway, e.g. `http://127.0.0.1:8080`. */
  gatewayUrl: string;
  /** Bearer token for ONE gateway API client (one customer, scope-limited). */
  gatewayToken: string;
  /** Optional separate bounded payer processes, at most one per rail. Absent => `buy` returns action_required. */
  bridges?: Partial<Record<PayerRail, BridgeEndpoint>>;
  /** Optional streamable-HTTP listener port on 127.0.0.1. Absent => stdio. */
  httpPort?: number;
  /** Test seam: replaces global fetch for gateway and bridge calls. */
  fetch?: typeof fetch;
  /** Per-request timeouts in ms. */
  gatewayTimeoutMs?: number;
  bridgeTimeoutMs?: number;
}

export class ConfigError extends Error {}

function readTokenFile(path: string, label: string): string {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    // Deliberately do not echo file contents; the path itself is not secret.
    throw new ConfigError(`${label}: cannot read token file at ${path}`);
  }
  const token = raw.trim();
  if (token.length < 8) throw new ConfigError(`${label}: token file is empty or too short`);
  return token;
}

function requireHttpUrl(value: string | undefined, label: string, loopbackOnly = false): string {
  if (!value) throw new ConfigError(`${label} is required`);
  const raw = value.trim();
  const authority = /^https?:\/\/([^/?#\\]+)(?:[/?#]|$)/i.exec(raw);
  if (!authority || /[\u0000-\u0020\u007f\\]/.test(raw))
    throw new ConfigError(`${label} must be an absolute http(s) URL without whitespace or backslashes`);
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ConfigError(`${label} is not a valid URL`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ConfigError(`${label} must be http(s)`);
  // Base URLs receive bearer credentials and fixed paths. Reject ambiguous URL suffixes and userinfo,
  // including empty delimiters that URL normalisation would otherwise silently discard.
  if (u.username || u.password || authority[1]!.includes('@')) throw new ConfigError(`${label} must not embed credentials`);
  if (value.includes('?') || value.includes('#')) throw new ConfigError(`${label} must not include a query or fragment`);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (loopbackOnly && !loopback) throw new ConfigError(`${label} must use a loopback host`);
  if (u.protocol === 'http:' && !loopback) throw new ConfigError(`${label} must use https except on loopback`);
  // Strip trailing slashes so paths can be appended safely.
  return u.toString().replace(/\/+$/, '');
}

/**
 * Per-rail bridge variables. PAYER_BRIDGE_* is the legacy spelling of the CARDANO bridge only; it is never
 * reinterpreted as another rail and may not be combined with CARDANO_PAYER_BRIDGE_*.
 */
const BRIDGE_VARS: Record<PayerRail, { url: string; token: string }[]> = {
  cardano: [{ url: 'CARDANO_PAYER_BRIDGE_URL', token: 'CARDANO_PAYER_BRIDGE_TOKEN_FILE' }, { url: 'PAYER_BRIDGE_URL', token: 'PAYER_BRIDGE_TOKEN_FILE' }],
  solana: [{ url: 'SOLANA_PAYER_BRIDGE_URL', token: 'SOLANA_PAYER_BRIDGE_TOKEN_FILE' }],
};

function loadBridges(env: NodeJS.ProcessEnv): Partial<Record<PayerRail, BridgeEndpoint>> {
  const bridges: Partial<Record<PayerRail, BridgeEndpoint>> = {};
  for (const rail of PAYER_RAILS) {
    // Each pair is all-or-nothing: a URL without a token (or vice versa) is a misconfiguration, not "no bridge".
    const present = BRIDGE_VARS[rail].filter((v) => env[v.url] || env[v.token]);
    if (present.length > 1) throw new ConfigError(`${present.map((v) => v.url).join(' and ')} configure the same ${rail} bridge; set only one`);
    const v = present[0];
    if (!v) continue;
    if (!env[v.url] || !env[v.token]) throw new ConfigError(`${v.url} and ${v.token} must be set together`);
    bridges[rail] = { url: requireHttpUrl(env[v.url], v.url, true), token: readTokenFile(env[v.token]!, v.token) };
  }
  // One bridge process per rail: the same endpoint under two rails would make the payer identity ambiguous.
  if (bridges.cardano && bridges.solana && bridges.cardano.url === bridges.solana.url) throw new ConfigError('Cardano and Solana payer bridges must use different URLs');
  return bridges;
}

/** Build config from environment variables: GATEWAY_URL, GATEWAY_TOKEN_FILE, *_PAYER_BRIDGE_*, PAYER_BRIDGE_*, MCP_HTTP_PORT. */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const gatewayUrl = requireHttpUrl(env.GATEWAY_URL, 'GATEWAY_URL');
  if (!env.GATEWAY_TOKEN_FILE) throw new ConfigError('GATEWAY_TOKEN_FILE is required');
  const gatewayToken = readTokenFile(env.GATEWAY_TOKEN_FILE, 'GATEWAY_TOKEN_FILE');

  const cfg: McpConfig = { gatewayUrl, gatewayToken };

  const bridges = loadBridges(env);
  if (Object.keys(bridges).length) cfg.bridges = bridges;

  if (env.MCP_HTTP_PORT) {
    const port = Number(env.MCP_HTTP_PORT);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError('MCP_HTTP_PORT must be 0-65535');
    cfg.httpPort = port;
  }
  return cfg;
}

/** All secret strings in a config, for output scrubbing. */
export function secretsOf(cfg: McpConfig): string[] {
  return [cfg.gatewayToken, ...Object.values(cfg.bridges ?? {}).map((b) => b.token)];
}
