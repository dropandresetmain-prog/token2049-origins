import { readFileSync } from 'node:fs';

/**
 * Resolved runtime configuration for the MCP channel. Secrets are held as plain strings in memory
 * only; they are read from files (never from argv or env values) and are scrubbed from every output.
 */
export interface McpConfig {
  /** Base URL of the canonical HTTP gateway, e.g. `http://127.0.0.1:8080`. */
  gatewayUrl: string;
  /** Bearer token for ONE gateway API client (one customer, scope-limited). */
  gatewayToken: string;
  /** Optional separate bounded payer process. Absent => `buy` returns action_required. */
  bridge?: { url: string; token: string };
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

function requireHttpUrl(value: string | undefined, label: string): string {
  if (!value) throw new ConfigError(`${label} is required`);
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new ConfigError(`${label} is not a valid URL`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ConfigError(`${label} must be http(s)`);
  // Strip trailing slashes so paths can be appended safely.
  return u.toString().replace(/\/+$/, '');
}

/** Build config from environment variables: GATEWAY_URL, GATEWAY_TOKEN_FILE, PAYER_BRIDGE_*, MCP_HTTP_PORT. */
export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const gatewayUrl = requireHttpUrl(env.GATEWAY_URL, 'GATEWAY_URL');
  if (!env.GATEWAY_TOKEN_FILE) throw new ConfigError('GATEWAY_TOKEN_FILE is required');
  const gatewayToken = readTokenFile(env.GATEWAY_TOKEN_FILE, 'GATEWAY_TOKEN_FILE');

  const cfg: McpConfig = { gatewayUrl, gatewayToken };

  // Bridge is all-or-nothing: a URL without a token (or vice versa) is a misconfiguration, not "no bridge".
  const bu = env.PAYER_BRIDGE_URL;
  const bt = env.PAYER_BRIDGE_TOKEN_FILE;
  if (bu || bt) {
    if (!bu || !bt) throw new ConfigError('PAYER_BRIDGE_URL and PAYER_BRIDGE_TOKEN_FILE must be set together');
    cfg.bridge = { url: requireHttpUrl(bu, 'PAYER_BRIDGE_URL'), token: readTokenFile(bt, 'PAYER_BRIDGE_TOKEN_FILE') };
  }

  if (env.MCP_HTTP_PORT) {
    const port = Number(env.MCP_HTTP_PORT);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError('MCP_HTTP_PORT must be 0-65535');
    cfg.httpPort = port;
  }
  return cfg;
}

/** All secret strings in a config, for output scrubbing. */
export function secretsOf(cfg: McpConfig): string[] {
  return [cfg.gatewayToken, cfg.bridge?.token].filter((s): s is string => !!s);
}
