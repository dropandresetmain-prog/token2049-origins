/**
 * Minimal, defensive Blockfrost client for Cardano Preprod chain confirmation.
 *
 * Why this exists: the x402 facilitator's receipt is a claim from another service. Before the core is
 * told a payment is `confirmed`, the adapter re-reads the transaction from an independent chain index
 * and checks that an output really pays the treasury the exact asset quantity. Only the handful of
 * endpoints we need are wrapped, every response is parsed with zod (unknown fields ignored), and
 * errors never carry the project id or raw response bodies.
 */
import { z } from 'zod';
import { FUNDING_METADATA_LABEL } from './binding.js';

/** Preprod network magic as reported by Blockfrost `/genesis`. */
export const PREPROD_NETWORK_MAGIC = 1;
/** Production credentials go only to official Preprod; loopback explicitly supports a trusted local proxy. */
export function isTrustedBlockfrostUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash) return false;
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    return loopback ? ['https:', 'http:'].includes(url.protocol) :
      url.protocol === 'https:' && url.hostname === 'cardano-preprod.blockfrost.io' &&
      (url.port === '' || url.port === '443') && url.pathname.replace(/\/+$/, '') === '/api/v0';
  } catch { return false; }
}
export const DEFAULT_BLOCKFROST_PREPROD_URL = 'https://cardano-preprod.blockfrost.io/api/v0';

/** Typed failure that exposes only the HTTP status (or a transport marker), never a body or header. */
export class BlockfrostError extends Error {
  constructor(
    readonly kind: 'http' | 'transport' | 'shape',
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'BlockfrostError';
  }
  /** 401/403 = bad or wrong-network project id; 402 = quota exhausted. */
  get isAuthFailure(): boolean {
    return this.kind === 'http' && (this.status === 401 || this.status === 402 || this.status === 403);
  }
}

const Amount = z.object({ unit: z.string(), quantity: z.string().regex(/^[0-9]+$/) });
const UtxoOutput = z.object({
  address: z.string(),
  amount: z.array(Amount),
  output_index: z.number().int().nonnegative(),
  /** Collateral-return outputs of a failed script tx are not payments. */
  collateral: z.boolean().optional(),
});
const UtxoInput = z.object({ address: z.string(), tx_hash: z.string().optional(), output_index: z.number().int().optional() });
const TxUtxos = z.object({ hash: z.string(), inputs: z.array(UtxoInput), outputs: z.array(UtxoOutput) });
const TxInfo = z.object({
  hash: z.string(),
  block_height: z.number().int().nonnegative().nullable().optional(),
  block_time: z.number().int().nonnegative().nullable().optional(),
  valid_contract: z.boolean().optional(),
});
const LatestBlock = z.object({ height: z.number().int().nonnegative().nullable() });
const Genesis = z.object({ network_magic: z.number().int() });

export type BlockfrostUtxoOutput = z.infer<typeof UtxoOutput>;

export interface OnChainTx {
  txHash: string;
  commitment: string | null;
  blockHeight: number | null;
  blockTime: number | null;
  /** Newer blocks above the inclusion block (0 = in the tip block). Same definition the SDK facilitator uses. */
  confirmations: number | null;
  validContract: boolean;
  outputs: BlockfrostUtxoOutput[];
  firstInputAddress: string | null;
}

export interface BlockfrostOptions {
  baseUrl: string;
  projectId: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class BlockfrostClient {
  private readonly baseUrl: string;
  private readonly f: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly o: BlockfrostOptions) {
    this.baseUrl = o.baseUrl.replace(/\/+$/, '');
    this.f = o.fetchImpl ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 10_000;
  }

  /** GET and JSON-parse; 404 resolves to null so callers can treat "not indexed yet" as a normal state. */
  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    let res: Response;
    try {
      res = await this.f(`${this.baseUrl}${path}`, {
        headers: { project_id: this.o.projectId },
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch {
      throw new BlockfrostError('transport', null, 'blockfrost request failed');
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new BlockfrostError('http', res.status, `blockfrost returned HTTP ${res.status}`);
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new BlockfrostError('shape', res.status, 'blockfrost returned a non-JSON body');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new BlockfrostError('shape', res.status, 'blockfrost response had an unexpected shape');
    return parsed.data;
  }

  /** Capability probe for readiness: the tip block must be readable with this project id. */
  async latestBlockHeight(): Promise<number | null> {
    const b = await this.get('/blocks/latest', LatestBlock);
    return b?.height ?? null;
  }

  /** Independent network identity check (preprod magic = 1). */
  async networkMagic(): Promise<number | null> {
    const g = await this.get('/genesis', Genesis);
    return g?.network_magic ?? null;
  }

  /**
   * Read a transaction as the chain index sees it. Returns null while the transaction is not in a block
   * (Blockfrost indexes blocks, not the mempool), which callers map to "still submitted".
   */
  async getTransaction(txHash: string): Promise<OnChainTx | null> {
    if (!/^[0-9a-f]{64}$/.test(txHash)) throw new BlockfrostError('shape', null, 'invalid transaction hash');
    if (await this.networkMagic() !== PREPROD_NETWORK_MAGIC) throw new BlockfrostError('shape', null, 'blockfrost is not preprod');
    const tx = await this.get(`/txs/${txHash}`, TxInfo);
    if (!tx || tx.block_height === null || tx.block_height === undefined) return null;
    const utxos = await this.get(`/txs/${txHash}/utxos`, TxUtxos);
    if (!utxos) return null;
    if (tx.hash !== txHash || utxos.hash !== txHash) throw new BlockfrostError('shape', null, 'blockfrost transaction hash mismatch');
    const metadata = await this.get(`/txs/${txHash}/metadata`, z.array(z.object({ label: z.string(), json_metadata: z.unknown() })));
    const values = metadata?.filter(m => m.label === FUNDING_METADATA_LABEL.toString()) ?? [];
    const commitment = values.length === 1 && typeof values[0]!.json_metadata === 'string' ? values[0]!.json_metadata : null;
    const tip = await this.latestBlockHeight();
    return {
      txHash,
      commitment,
      blockHeight: tx.block_height,
      blockTime: tx.block_time ?? null,
      confirmations: tip === null ? null : Math.max(0, tip - tx.block_height),
      validContract: tx.valid_contract !== false,
      outputs: utxos.outputs.filter((o) => o.collateral !== true),
      firstInputAddress: utxos.inputs[0]?.address ?? null,
    };
  }
}

/** Blockfrost reports native assets as `policyId + assetNameHex` (no dot); ADA is `lovelace`. */
export function blockfrostUnit(assetId: string): string {
  return assetId === 'lovelace' ? 'lovelace' : assetId.replace('.', '');
}

/** Exact sum (bigint) of everything paid to `address` in `assetId` across the given outputs. */
export function sumPaidTo(outputs: BlockfrostUtxoOutput[], address: string, assetId: string): bigint {
  const unit = blockfrostUnit(assetId);
  const want = address.toLowerCase();
  let total = 0n;
  for (const o of outputs) {
    if (o.address.toLowerCase() !== want) continue;
    for (const a of o.amount) if (a.unit === unit) total += BigInt(a.quantity);
  }
  return total;
}
