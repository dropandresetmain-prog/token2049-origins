import { z } from 'zod';
import { ProviderError } from '../../core/errors.js';

/**
 * Transport failure from Shopify. Messages never include response bodies, headers or request
 * variables (those can carry PII or tokens); only status codes and GraphQL error codes.
 */
export class ShopifyHttpError extends Error {
  constructor(
    readonly kind: 'network' | 'http' | 'graphql' | 'parse',
    message: string,
    readonly status?: number,
    readonly accessDenied = false,
    readonly throttled = false,
  ) {
    super(message);
  }
  /** 401/403 or an ACCESS_DENIED GraphQL error: credentials/scopes problem, not an outage. */
  get blocked(): boolean {
    return this.status === 401 || this.status === 403 || this.accessDenied;
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

const Envelope = z.object({
  data: z.unknown().optional(),
  errors: z
    .array(z.object({ message: z.string().optional(), extensions: z.object({ code: z.string().optional() }).passthrough().optional() }).passthrough())
    .optional(),
});

export interface GraphQLEndpoint {
  url: string;
  headers: Record<string, string>;
}

export async function postGraphQL<S extends z.ZodType>(
  fetchImpl: typeof fetch,
  ep: GraphQLEndpoint,
  query: string,
  variables: Record<string, unknown>,
  schema: S,
): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetchImpl(ep.url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...ep.headers },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new ShopifyHttpError('network', 'request failed');
  }
  if (!res.ok) throw new ShopifyHttpError('http', `HTTP ${res.status}`, res.status);
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new ShopifyHttpError('parse', 'response was not JSON');
  }
  const env = Envelope.safeParse(raw);
  if (!env.success) throw new ShopifyHttpError('parse', 'unexpected response envelope');
  if (env.data.errors && env.data.errors.length > 0) {
    const codes = env.data.errors.map((x) => ['ACCESS_DENIED','THROTTLED'].includes(x.extensions?.code ?? '') ? x.extensions!.code! : 'UNKNOWN');
    throw new ShopifyHttpError('graphql', `GraphQL errors: ${[...new Set(codes)].join(',')}`, undefined, codes.includes('ACCESS_DENIED'), codes.includes('THROTTLED'));
  }
  const parsed = schema.safeParse(env.data.data);
  if (!parsed.success) throw new ShopifyHttpError('parse', 'response shape did not match expectation');
  return parsed.data;
}

/**
 * Map a transport failure to the core's outcome semantics. All Shopify calls made before the pay
 * click are reads or harmless cart edits, so a failure is a definite "nothing was charged".
 */
export function toProviderError(e: unknown, code: string): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof ShopifyHttpError) {
    const retryable = e.kind === 'network' || e.status === 429 || (e.status !== undefined && e.status >= 500);
    return new ProviderError(e.kind === 'http' && e.status !== undefined && e.status < 500 && e.status !== 429 ? 'rejected' : 'not_sent', code, e.message, retryable);
  }
  // Class name (and zod issue paths/codes, never values) only: enough to diagnose without leaking content.
  const detail = e instanceof z.ZodError ? `zod ${e.issues.slice(0, 5).map((i) => `${i.path.join('.')}:${i.code}`).join(',')}` : e instanceof Error ? e.name : 'unknown';
  return new ProviderError('not_sent', code, `operation failed (${detail})`);
}
