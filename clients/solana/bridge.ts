/**
 * Local Solana payer bridge: the Solana twin of clients/payer/bridge.ts, so a keyless MCP process can ask
 * for ONE bounded Devnet payment without holding keys. It reuses the same hardened server (loopback only,
 * bearer token, purchaseId-only body, one payment at a time) and wraps the existing paySolanaPurchase:
 * amount, payee, network, caps and the spend ledger all come from protected payer configuration, never
 * from the caller. It never resets or recreates a ledger. Responses carry only the public transaction
 * signature: no keys, tokens, signed payloads or raw gateway/RPC bodies.
 *
 *   GET  /health   POST /pay { "purchaseId": "pur_..." }   GET /status   (as the Cardano bridge)
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createBridge, listenLoopback } from '../payer/bridge.js';
import { loadBridgeConfig, readSecretFile } from '../payer/config.js';
import { PayerError } from '../payer/payer.js';
import { FundingSource, maskAddress } from '../../src/contracts/presentation.js';
import { NETWORK } from '../../src/funding/solana/wire.js';
import { loadSolanaPayerConfig, type SolanaPayerConfig } from './config.js';
import { SolanaLedger } from './ledger.js';
import { loadSigner } from './signer.js';
import { paySolanaPurchase } from './pay.js';

export const SOLANA_BRIDGE_VARS = { tokenFile: 'SOLANA_PAYER_BRIDGE_TOKEN_FILE', port: 'SOLANA_PAYER_BRIDGE_PORT', defaultPort: 8789 };

export interface SolanaBridgeDeps {
  config: SolanaPayerConfig;
  /** Test seams; production uses the real payment implementation and offline readiness check. */
  pay?: typeof paySolanaPurchase;
  ready?: () => Promise<boolean>;
}

/** Offline only: the protected ledger must already exist and parse, and the key file must match the payer address. */
async function defaultReady(cfg: SolanaPayerConfig): Promise<boolean> {
  try {
    new SolanaLedger(cfg.payerLedger, cfg.payer).read();
    await loadSigner(cfg.keyFile, cfg.payer);
    return true;
  } catch { return false; }
}

export class SolanaBridgePayer {
  constructor(private readonly d: SolanaBridgeDeps) {}

  async source(): Promise<FundingSource> {
    const c = this.d.config;
    const ready = await (this.d.ready ?? (() => defaultReady(c)))();
    return FundingSource.parse({
      sourceId: `src_${createHash('sha256').update(`${NETWORK}:${c.payer}`).digest('hex').slice(0, 32)}`,
      rail: 'solana', network: NETWORK, publicAddress: c.payer, displayAddress: maskAddress(c.payer),
      assetId: c.mint, readiness: ready ? 'configured' : 'unavailable',
    });
  }

  async pay(purchaseId: string): Promise<{ transferReference: string | null; resumed: boolean }> {
    if (!/^pur_[A-Za-z0-9]{10,40}$/.test(purchaseId)) throw new PayerError('invalid_request', 'purchaseId is not a valid purchase id');
    if ((await this.source()).readiness !== 'configured') throw new PayerError('internal', 'Solana payer is not ready');
    let r: { status: number; signature: string };
    try {
      r = await (this.d.pay ?? paySolanaPurchase)(this.d.config, purchaseId);
    } catch {
      // The reason may embed provider/RPC detail. The spend reservation (if any) is in the ledger; callers re-read the gateway.
      throw new PayerError('internal', 'Solana payment attempt did not complete; read the purchase before doing anything else');
    }
    if (r.status === 202) return { transferReference: r.signature, resumed: false };
    // The signed candidate stays reserved in the ledger and is never rebuilt; this is not a retry signal.
    if (r.status === 409) throw new PayerError('conflict', 'gateway did not accept funding for this purchase');
    if (r.status >= 500) throw new PayerError('gateway_unreachable', 'gateway could not confirm the payment; read the purchase');
    throw new PayerError('payment_rejected', 'gateway rejected the Solana payment');
  }
}

export async function startSolanaBridge(env: NodeJS.ProcessEnv) {
  const b = loadBridgeConfig(env, SOLANA_BRIDGE_VARS);
  const token = readSecretFile(b.tokenFile, SOLANA_BRIDGE_VARS.tokenFile);
  if (token.length < 24) throw new Error(`${SOLANA_BRIDGE_VARS.tokenFile} must hold a token of at least 24 characters`);
  const payer = new SolanaBridgePayer({ config: loadSolanaPayerConfig(env) });
  const log = (e: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(e)}\n`);
  const server = createBridge({ payer, token, source: () => payer.source(), log });
  await listenLoopback(server, b.port);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startSolanaBridge(process.env)
    .then((s) => {
      const a = s.address();
      process.stdout.write(`solana payer bridge listening on 127.0.0.1:${typeof a === 'object' && a ? a.port : '?'}\n`);
    })
    .catch((e) => {
      process.stderr.write(`${e instanceof Error ? e.message : 'bridge failed to start'}\n`);
      process.exitCode = 1;
    });
}
