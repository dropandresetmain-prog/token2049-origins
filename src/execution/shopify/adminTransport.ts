import { z } from 'zod';
import type { Clock } from '../../infrastructure/clock.js';
import { ProviderError } from '../../core/errors.js';
import type { ShopifyConfig } from './config.js';
import { postGraphQL, ShopifyHttpError, type GraphQLEndpoint } from './http.js';

const TokenResponse = z.object({ access_token: z.string().min(1), expires_in: z.number().positive().optional() });

/** Refresh when less than this much validity remains (Shopify recommends 60s). */
const TOKEN_SKEW_MS = 60_000;

export class AdminTransport {
  private token: { value: string; expiresAtMs: number } | null = null;
  constructor(
    private readonly cfg: ShopifyConfig,
    private readonly fetchImpl: typeof fetch,
    private readonly clock: Clock,
  ) {
    if (!cfg.clientId || !cfg.clientSecret) throw new ProviderError('unknown', 'shopify_admin_not_configured', 'admin client credentials missing');
  }

  private endpoint(token: string): GraphQLEndpoint {
    return {
      url: `https://${this.cfg.storeDomain}/admin/api/${this.cfg.apiVersion}/graphql.json`,
      headers: { 'X-Shopify-Access-Token': token },
    };
  }

  /** client_credentials grant; ~24h token cached in memory only (never persisted or logged). */
  private async mintToken(): Promise<string> {
    const now = this.clock.now().getTime();
    if (this.token && this.token.expiresAtMs - TOKEN_SKEW_MS > now) return this.token.value;
    let res: Response;
    try {
      res = await this.fetchImpl(`https://${this.cfg.storeDomain}/admin/oauth/access_token`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.cfg.clientId!,
          client_secret: this.cfg.clientSecret!,
        }).toString(),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new ShopifyHttpError('network', 'token request failed');
    }
    // Token endpoint rejections (bad client, shop_not_permitted) are credential problems.
    if (!res.ok) throw new ShopifyHttpError('http', `token endpoint HTTP ${res.status}`, res.status === 400 ? 401 : res.status);
    const parsed = TokenResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new ShopifyHttpError('parse', 'token response malformed');
    this.token = { value: parsed.data.access_token, expiresAtMs: now + (parsed.data.expires_in ?? 86_399) * 1000 };
    return this.token.value;
  }

  protected async gql<S extends z.ZodType>(query: string, variables: Record<string, unknown>, schema: S): Promise<z.infer<S>> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.mintToken();
      try {
        return await postGraphQL(this.fetchImpl, this.endpoint(token), query, variables, schema);
      } catch (e) {
        // A 401 on a cached token means it was revoked/expired early: mint once more.
        if (attempt === 0 && e instanceof ShopifyHttpError && e.status === 401) {
          this.token = null;
          continue;
        }
        throw e;
      }
    }
  }

}
