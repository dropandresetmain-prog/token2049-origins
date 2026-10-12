import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { SolanaLedger } from '../../clients/solana/ledger.js';
import { XLayerLedger } from '../../clients/xlayer/ledger.js';
import { loadSigner } from '../../clients/xlayer/signer.js';
import { NETWORK, RPC_URLS, TOKEN } from '../../src/funding/xlayer/config.js';
import { XLayerRpc } from '../../src/funding/xlayer/rpc.js';

// Explicit and exclusive: partial setup is never overwritten. Keys never leave the protected directory or reach stdout.
const directory = process.argv[2];
if (!directory || !isAbsolute(directory)) throw new Error('absolute protected setup directory required');
SolanaLedger.protectDirectory(directory);
const publicFile = join(directory, 'public.json');
let identity: { payer: string; treasury: string };
if (existsSync(publicFile)) {
  identity = JSON.parse(readFileSync(publicFile, 'utf8'));
  loadSigner(join(directory, 'payer.key'), identity.payer); loadSigner(join(directory, 'treasury.key'), identity.treasury);
  new XLayerLedger(join(directory, 'xlayer-ledger.json'), identity.payer).read();
} else {
  const payerKey = generatePrivateKey(), treasuryKey = generatePrivateKey();
  writeFileSync(join(directory, 'payer.key'), payerKey, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'treasury.key'), treasuryKey, { flag: 'wx', mode: 0o600 });
  identity = { payer: privateKeyToAccount(payerKey).address.toLowerCase(), treasury: privateKeyToAccount(treasuryKey).address.toLowerCase() };
  new XLayerLedger(join(directory, 'xlayer-ledger.json'), identity.payer).initialize();
  writeFileSync(join(directory, 'bridge-token.txt'), randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  writeFileSync(publicFile, JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
  const settings = {
    XLAYER_NETWORK: NETWORK, XLAYER_CHAIN_ID: '1952', XLAYER_RPC_URL: RPC_URLS[0], XLAYER_TOKEN_ADDRESS: TOKEN, XLAYER_ASSET_DECIMALS: '6',
    XLAYER_TREASURY_ADDRESS: identity.treasury, XLAYER_MAX_PAYMENT_BASE_UNITS: '100000', XLAYER_MAX_GAS_BUDGET_WEI: '1000000000000000',
    XLAYER_CONFIRMATIONS: '2', XLAYER_PAYER_ADDRESS: identity.payer, XLAYER_PAYER_KEY_FILE: join(directory, 'payer.key'),
    XLAYER_LEDGER_DIRECTORY: directory, XLAYER_GATEWAY_URL: 'http://127.0.0.1:18995', XLAYER_GATEWAY_TOKEN_FILE: join(directory, 'gateway-token.txt'),
    XLAYER_PAYER_MAX_PAYMENT_BASE_UNITS: '100000', XLAYER_PAYER_MAX_DAILY_BASE_UNITS: '500000', XLAYER_PAYER_MAX_TOTAL_BASE_UNITS: '1000000',
    XLAYER_PAYER_MAX_TOTAL_GAS_WEI: '10000000000000000', XLAYER_PAYER_MAX_COMMERCIAL_USD_MINOR: '10000',
    XLAYER_PAYER_BRIDGE_TOKEN_FILE: join(directory, 'bridge-token.txt'), XLAYER_PAYER_BRIDGE_PORT: '8791',
  };
  writeFileSync(join(directory, '.env.xlayer'), Object.entries(settings).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
}
console.log(JSON.stringify({ event: 'xlayer_wallets_ready', directory, ...identity }));
const rpc = new XLayerRpc();
await rpc.assertNetwork(); await rpc.assertAsset();
console.log(JSON.stringify({ event: 'xlayer_balances', payer: identity.payer, okbWei: String(await rpc.nativeBalance(identity.payer)), usdt0BaseUnits: String(await rpc.tokenBalance(identity.payer)) }));
