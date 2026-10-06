/**
 * Source selection. Build-time switch: VITE_CONSOLE_SOURCE=sample (default) | gateway.
 * In gateway mode the console asks for an access key and talks to the gateway on the same origin
 * (or VITE_GATEWAY_URL when set, for local development against a separate gateway).
 */
import type { ConsoleSource } from '../contracts/source.js';
import { createSampleSource, type SampleSource } from './sample.js';
import { createGatewaySource } from './gateway.js';

export type SourceConfig = { kind: 'sample' } | { kind: 'gateway'; baseUrl: string };

export function sourceConfig(env: Record<string, string | undefined> = import.meta.env): SourceConfig {
  if (env.VITE_CONSOLE_SOURCE === 'gateway') return { kind: 'gateway', baseUrl: (env.VITE_GATEWAY_URL ?? '').replace(/\/$/, '') };
  return { kind: 'sample' };
}

export function sampleSource(): SampleSource {
  return createSampleSource({ latencyMs: 250 });
}

/** Gateway sources hold the access key in memory only. Nothing is written to storage. */
export function gatewaySource(baseUrl: string, accessKey: string): ConsoleSource {
  return createGatewaySource({ baseUrl, accessKey });
}

export type { SampleSource };
