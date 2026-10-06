import { z } from 'zod';

export class MasumiError extends Error {
  constructor(readonly code: 'unavailable' | 'unauthorized' | 'rejected' | 'invalid_response', readonly status?: number) {
    super('Masumi service ' + code + (status ? ' (HTTP ' + status + ')' : ''));
  }
}
export interface MasumiConfig {
  baseUrl: string; token: string; agentIdentifier: string; sellerVkey: string;
  contractAddress: string; sellerAddress: string; assetUnit: string; feeBaseUnits: string;
  blockfrostKey: string; blockfrostBaseUrl: string;
}
export const TUSDM = '16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d';
const integer = z.string().regex(/^(0|[1-9][0-9]*)$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const funds = z.array(z.object({ amount: integer, unit: z.string() }));
const tx = z.object({ txHash: hash.nullable(), status: z.string(), confirmations: z.number().int().nullable(), blockTime: z.number().nullable(), layer: z.enum(['L1', 'L2']).optional(), newOnChainState: z.string().nullable(), previousOnChainState: z.string().nullable() });
export const FeePayment = z.object({
  id: z.string().min(1), blockchainIdentifier: z.string().min(1), agentIdentifier: z.string(),
  inputHash: hash, payByTime: integer, submitResultTime: integer, unlockTime: integer,
  externalDisputeUnlockTime: integer, forceLayer: z.literal('L1'), onChainState: z.string().nullable(),
  RequestedFunds: funds, WithdrawnForSeller: funds, WithdrawnForBuyer: funds,
  sellerReturnAddress: z.string().nullable(), resultHash: z.preprocess(v => v === '' ? null : v, hash.nullable()),
  SmartContractWallet: z.object({ walletVkey: z.string(), walletAddress: z.string() }).nullable(),
  PaymentSource: z.object({ network: z.literal('Preprod'), smartContractAddress: z.string(), paymentSourceType: z.literal('Web3CardanoV2') }),
  BuyerWallet: z.object({ walletVkey: z.string() }).nullable(),
  CurrentTransaction: tx.nullable(), TransactionHistory: z.array(tx).nullable().optional(),
  NextAction: z.object({ requestedAction: z.string(), resultHash: z.preprocess(v => v === '' ? null : v, hash.nullable()) }),
});
export type FeePayment = z.infer<typeof FeePayment>;

export function validateServiceUrl(raw: string): string {
  const u = new URL(raw);
  const local = ['127.0.0.1', 'localhost', '::1'].includes(u.hostname);
  if ((u.protocol !== 'https:' && !(local && u.protocol === 'http:')) || u.username || u.password || u.search || u.hash) throw new Error('Invalid MASUMI_PAYMENT_SERVICE_URL');
  return u.href.replace(/\/$/, '');
}
export class MasumiClient {
  constructor(readonly config: MasumiConfig, private readonly fetchImpl = fetch) {
    this.config = Object.freeze({...config});
    validateServiceUrl(config.baseUrl);
    const u = new URL(config.blockfrostBaseUrl);
    if (u.origin !== 'https://cardano-preprod.blockfrost.io' || u.username || u.password || u.search || u.hash) throw new Error('Only Preprod Blockfrost is supported');
    if (config.assetUnit !== TUSDM || !/^[1-9][0-9]*$/.test(config.feeBaseUnits) || BigInt(config.feeBaseUnits) > 1000000n) throw new Error('Invalid bounded Preprod fee configuration');
  }
  async request(path: string, body?: Record<string, unknown>): Promise<unknown> {
    let res: Response;
    try { res = await this.fetchImpl(this.config.baseUrl + '/api/v1/' + path, {
      method: body ? 'POST' : 'GET', headers: { token: this.config.token, accept: 'application/json', 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000), redirect: 'error',
    }); } catch { throw new MasumiError('unavailable'); }
    if (!res.ok) throw new MasumiError(res.status === 401 || res.status === 403 ? 'unauthorized' : 'rejected', res.status);
    const envelope = z.object({ status: z.literal('success'), data: z.unknown() }).safeParse(await res.json().catch(() => null));
    if (!envelope.success) throw new MasumiError('invalid_response');
    return envelope.data.data;
  }
  async payment(identifier: string): Promise<FeePayment> {
    const parsed = FeePayment.safeParse(await this.request('payment/resolve-blockchain-identifier', { blockchainIdentifier: identifier, network: 'Preprod', filterSmartContractAddress: this.config.contractAddress, includeHistory: 'true' }));
    if (!parsed.success) throw new MasumiError('invalid_response');
    return parsed.data;
  }
  async findPayment(inputHash: string): Promise<FeePayment | null> {
    const data = await this.request('payment?network=Preprod&filterPaymentSourceType=Web3CardanoV2&filterAgentIdentifier=' + encodeURIComponent(this.config.agentIdentifier) + '&limit=100&includeHistory=true');
    const result = z.object({ Payments: z.array(FeePayment) }).safeParse(data);
    if (!result.success) throw new MasumiError('invalid_response');
    const matches = result.data.Payments.filter(p => p.inputHash === inputHash);
    if (matches.length > 1) throw new MasumiError('invalid_response');
    // An empty first page is never proof that an ambiguous write failed.
    return matches[0] ?? null;
  }
  async createPayment(inputHash: string, nonce: string, times: { payBy: number; submitBy: number; unlockAt: number; disputeUntil: number }): Promise<FeePayment> {
    const value = await this.request('payment', {
      inputHash, network: 'Preprod', agentIdentifier: this.config.agentIdentifier, paymentSourceType: 'Web3CardanoV2', supportedPaymentSourceIndex: 0,
      identifierFromPurchaser: nonce, // Fixed pricing is read from registered metadata; native API forbids RequestedFunds here.
      payByTime: new Date(times.payBy).toISOString(), submitResultTime: new Date(times.submitBy).toISOString(),
      unlockTime: new Date(times.unlockAt).toISOString(), externalDisputeUnlockTime: new Date(times.disputeUntil).toISOString(), forceLayer: 'L1',
    });
    const parsed = FeePayment.safeParse(value);
    if (!parsed.success) throw new MasumiError('invalid_response');
    return parsed.data;
  }
  async submitResult(identifier: string, resultHash: string): Promise<void> {
    await this.request('payment/submit-result', { network: 'Preprod', blockchainIdentifier: identifier, submitResultHash: resultHash });
  }
  async chain(path: string): Promise<unknown> {
    let res: Response;
    try { res = await this.fetchImpl(this.config.blockfrostBaseUrl + path, { headers: { project_id: this.config.blockfrostKey, accept: 'application/json' }, signal: AbortSignal.timeout(15000), redirect: 'error' }); }
    catch { throw new MasumiError('unavailable'); }
    if (!res.ok) throw new MasumiError('rejected', res.status);
    return res.json().catch(() => { throw new MasumiError('invalid_response'); });
  }
}
