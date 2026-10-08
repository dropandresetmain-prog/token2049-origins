import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createBridge, listenLoopback } from '../payer/bridge.js';
import { loadBridgeConfig, readSecretFile } from '../payer/config.js';
import { PayerError } from '../payer/payer.js';
import { FundingSource, maskAddress } from '../../src/contracts/presentation.js';
import { NETWORK, USDC_TYPE } from '../../src/funding/sui/config.js';
import { SuiLedger } from './ledger.js';
import { loadSigner } from './signer.js';
import { loadSuiPayerConfig, type SuiPayerConfig } from './config.js';
import { paySuiPurchase } from './pay.js';

export class SuiBridgePayer {
  constructor(readonly cfg: SuiPayerConfig) {}
  async source() {
    let ready = true;
    try { new SuiLedger(this.cfg.ledger, this.cfg.payer).read(); loadSigner(this.cfg.keyFile, this.cfg.payer); } catch { ready = false; }
    return FundingSource.parse({ sourceId: 'src_' + createHash('sha256').update(`${NETWORK}:${this.cfg.payer}`).digest('hex').slice(0, 32),
      rail: 'sui', network: NETWORK, publicAddress: this.cfg.payer, displayAddress: maskAddress(this.cfg.payer), assetId: USDC_TYPE,
      readiness: ready ? 'configured' : 'unavailable' });
  }
  async pay(purchaseId: string) {
    try {
      const result = await paySuiPurchase(this.cfg, purchaseId);
      if (result.status !== 202) throw new Error('gateway did not confirm funding');
      return { transferReference: result.digest, resumed: result.resumed };
    } catch { throw new PayerError('internal', 'Sui payment outcome requires purchase readback; signed candidates and spend reservations are retained'); }
  }
}
export async function startSuiBridge(env: NodeJS.ProcessEnv) {
  const vars = { tokenFile: 'SUI_PAYER_BRIDGE_TOKEN_FILE', port: 'SUI_PAYER_BRIDGE_PORT', defaultPort: 8790 };
  const b = loadBridgeConfig(env, vars), token = readSecretFile(b.tokenFile, vars.tokenFile);
  if (token.length < 24) throw new Error('SUI_PAYER_BRIDGE_TOKEN_FILE must contain at least 24 characters');
  const payer = new SuiBridgePayer(loadSuiPayerConfig(env));
  const server = createBridge({ payer, token, source: () => payer.source() });
  await listenLoopback(server, b.port);
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const server = await startSuiBridge(process.env); console.log(JSON.stringify({ component: 'sui-payer-bridge', address: server.address() })); }
  catch { console.error('Sui payer bridge startup failed; check protected configuration'); process.exitCode = 1; }
}
