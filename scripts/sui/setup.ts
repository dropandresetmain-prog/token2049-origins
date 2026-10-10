import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { getFaucetHost, requestSuiFromFaucetV3 } from '@mysten/sui/faucet';
import { SolanaLedger } from '../../clients/solana/ledger.js';
import { SuiLedger } from '../../clients/sui/ledger.js';
import { loadSigner } from '../../clients/sui/signer.js';
import { RPC_URL, USDC_TYPE, SUI_TYPE } from '../../src/funding/sui/config.js';
import { SuiRpc, suiClient } from '../../src/funding/sui/rpc.js';

const directory = process.argv[2];
if (!directory || !isAbsolute(directory)) throw new Error('absolute protected setup directory required');
SolanaLedger.protectDirectory(directory);
const publicFile = join(directory, 'public.json');
let identity: { payer: string; treasury: string };
if (existsSync(publicFile)) {
  identity = JSON.parse(readFileSync(publicFile, 'utf8'));
  loadSigner(join(directory, 'payer.key'), identity.payer); loadSigner(join(directory, 'treasury.key'), identity.treasury);
  new SuiLedger(join(directory, 'sui-ledger.json'), identity.payer).read();
} else {
  // Setup is explicit and exclusive. Partial setup is never overwritten, even after a crash.
  const payer = Ed25519Keypair.generate(), treasury = Ed25519Keypair.generate();
  writeFileSync(join(directory, 'payer.key'), payer.getSecretKey(), { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'treasury.key'), treasury.getSecretKey(), { flag: 'wx', mode: 0o600 });
  identity = { payer: payer.toSuiAddress(), treasury: treasury.toSuiAddress() };
  new SuiLedger(join(directory, 'sui-ledger.json'), identity.payer).initialize();
  writeFileSync(join(directory, 'bridge-token.txt'), randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  writeFileSync(publicFile, JSON.stringify(identity), { flag: 'wx', mode: 0o600 });
  const settings = {
    SUI_NETWORK: 'testnet', SUI_RPC_URL: RPC_URL, SUI_USDC_TYPE: USDC_TYPE, SUI_ASSET_DECIMALS: '6', SUI_TREASURY_ADDRESS: identity.treasury,
    SUI_MAX_PAYMENT_BASE_UNITS: '100000', SUI_MAX_GAS_BUDGET_MIST: '10000000', SUI_PAYER_ADDRESS: identity.payer,
    SUI_PAYER_KEY_FILE: join(directory, 'payer.key'), SUI_LEDGER_DIRECTORY: directory, SUI_GATEWAY_URL: 'http://127.0.0.1:18994',
    SUI_GATEWAY_TOKEN_FILE: join(directory, 'gateway-token.txt'), SUI_PAYER_MAX_PAYMENT_BASE_UNITS: '100000',
    SUI_PAYER_MAX_DAILY_BASE_UNITS: '500000', SUI_PAYER_MAX_TOTAL_BASE_UNITS: '1000000', SUI_PAYER_MAX_TOTAL_GAS_MIST: '500000000',
    SUI_PAYER_MAX_COMMERCIAL_USD_MINOR: '10000', SUI_PAYER_BRIDGE_TOKEN_FILE: join(directory, 'bridge-token.txt'), SUI_PAYER_BRIDGE_PORT: '8790',
  };
  writeFileSync(join(directory, '.env.sui'), Object.entries(settings).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
}
console.log(JSON.stringify({ event: 'sui_wallets_ready', directory, ...identity }));
const client = suiClient(), rpc = new SuiRpc(client);
await rpc.assertNetwork(); await rpc.assertAsset();
let gas = await client.getBalance({ owner: identity.payer, coinType: SUI_TYPE, signal: AbortSignal.timeout(15000) });
if (BigInt(gas.balance.balance) < 50000000n) {
  try {
    const result = await requestSuiFromFaucetV3({ host: getFaucetHost('testnet'), recipient: identity.payer, timeout: 55000 });
    console.log(JSON.stringify({ event: 'sui_faucet', digest: result.digest, amountMist: result.amountMist }));
  } catch { console.log(JSON.stringify({ event: 'sui_faucet', status: 'manual_funding_may_be_required' })); }
}
gas = await client.getBalance({ owner: identity.payer, coinType: SUI_TYPE, signal: AbortSignal.timeout(15000) });
const usdc = await client.getBalance({ owner: identity.payer, coinType: USDC_TYPE, signal: AbortSignal.timeout(15000) });
console.log(JSON.stringify({ event: 'sui_balances', payer: identity.payer, gasMist: gas.balance.balance, usdcBaseUnits: usdc.balance.balance }));
