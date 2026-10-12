import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createBridge, listenLoopback } from '../payer/bridge.js';
import { loadBridgeConfig, readSecretFile } from '../payer/config.js';
import { PayerError } from '../payer/payer.js';
import { FundingSource, maskAddress } from '../../src/contracts/presentation.js';
import { NETWORK, TOKEN } from '../../src/funding/xlayer/config.js';
import { XLayerLedger } from './ledger.js';
import { loadSigner } from './signer.js';
import { loadXLayerPayerConfig, type XLayerPayerConfig } from './config.js';
import { payXLayerPurchase } from './pay.js';

export class XLayerBridgePayer {
  constructor(readonly cfg: XLayerPayerConfig) {}
  async source() {
    let ready = true;
    try { new XLayerLedger(this.cfg.ledger, this.cfg.payer).read(); loadSigner(this.cfg.keyFile, this.cfg.payer); } catch { ready = false; }
    return FundingSource.parse({ sourceId: 'src_' + createHash('sha256').update(`${NETWORK}:${this.cfg.payer}`).digest('hex').slice(0, 32),
      rail: 'xlayer', network: NETWORK, publicAddress: this.cfg.payer, displayAddress: maskAddress(this.cfg.payer), assetId: TOKEN,
      readiness: ready ? 'configured' : 'unavailable' });
  }
  async pay(purchaseId: string) {
    try {
      const result = await payXLayerPurchase(this.cfg, purchaseId);
      if (result.status !== 202) throw new Error('gateway did not confirm funding');
      return { transferReference: result.hash, resumed: result.resumed };
    } catch { throw new PayerError('internal', 'X Layer payment outcome requires purchase readback; signed candidates and spend reservations are retained'); }
  }
}
export async function startXLayerBridge(env: NodeJS.ProcessEnv) {
  const vars = { tokenFile: 'XLAYER_PAYER_BRIDGE_TOKEN_FILE', port: 'XLAYER_PAYER_BRIDGE_PORT', defaultPort: 8791 };
  const b = loadBridgeConfig(env, vars), token = readSecretFile(b.tokenFile, vars.tokenFile);
  if (token.length < 24) throw new Error('XLAYER_PAYER_BRIDGE_TOKEN_FILE must contain at least 24 characters');
  const payer = new XLayerBridgePayer(loadXLayerPayerConfig(env));
  const server = createBridge({ payer, token, source: () => payer.source() });
  await listenLoopback(server, b.port);
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const server = await startXLayerBridge(process.env); console.log(JSON.stringify({ component: 'xlayer-payer-bridge', address: server.address() })); }
  catch { console.error('X Layer payer bridge startup failed; check protected configuration'); process.exitCode = 1; }
}
