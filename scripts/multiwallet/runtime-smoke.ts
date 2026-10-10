import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  PrivateKey, Transaction as CardanoTransaction,
  TransactionBody as CardanoTransactionBody, VKey as CardanoVKey,
} from '@evolution-sdk/evolution';
import { decodeCardanoTransaction, toClientCardanoSigner } from '@x402/cardano';
import { USDM_PREPROD_ASSET } from '@x402/cardano';
import { generateKeyPairSigner, address, blockhash, createTransactionMessage, pipe,
  setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions, signTransactionMessageWithSigners,
  getBase64EncodedWireTransaction } from '@solana/kit';
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import { getTransferCheckedInstruction } from '@solana-program/token';
import { MEMO_PROGRAM_ADDRESS } from '@x402/svm';
import { buildPayment } from '../../clients/sui/pay.js';
import { loadSuiPayerConfig } from '../../clients/sui/config.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction as SuiTransaction } from '@mysten/sui/transactions';
import { readCandidate as readSuiCandidate } from '../../src/funding/sui/wire.js';
import { NETWORK as SUI_NETWORK, TESTNET_GENESIS, USDC_TYPE as SUI_USDC_TYPE, SUI_TYPE } from '../../src/funding/sui/config.js';
import { createBoundSigner } from '../../clients/payer/signer.js';
import { loadPayerConfig } from '../../clients/payer/config.js';
import { FUNDING_METADATA_LABEL, readFundingCommitment } from '../../src/funding/cardano/binding.js';
import { NETWORK as SOL_NETWORK, TEST_MINT, commitment, decodeTransaction } from '../../src/funding/solana/wire.js';

const require = createRequire(import.meta.url);
const packageVersion = (name: string): string => {
  let directory = dirname(require.resolve(name === '@mysten/sui' ? '@mysten/sui/transactions' : name));
  while (directory !== dirname(directory)) {
    const manifestPath = join(directory, 'package.json');
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string; version?: string };
      if (manifest.name === name && manifest.version) return manifest.version;
    }
    directory = dirname(directory);
  }
  return 'unknown';
};
const tempRoot = mkdtempSync(join(tmpdir(), 'multiwallet-runtime-smoke-'));
chmodSync(tempRoot, 0o700);
const fetchOriginal = globalThis.fetch;
const cardanoRequests: string[] = [];
const denyExternalFetch: typeof fetch = async (resource, init) => {
  const url = new URL(typeof resource === 'string' || resource instanceof URL ? String(resource) : resource.url);
  if (url.origin !== 'http://127.0.0.1:9199') throw new Error('runtime smoke blocked non-fixture network request');
  cardanoRequests.push(url.pathname);
  if (url.pathname.endsWith('/epochs/latest/parameters')) return new Response(JSON.stringify({
    min_fee_a: 44, min_fee_b: 155381, pool_deposit: '500000000', key_deposit: '2000000',
    max_tx_size: 16384, max_block_size: 65536, coins_per_utxo_size: '4310',
  }), { status: 200 });
  if (url.pathname.includes('/addresses/') && url.pathname.endsWith('/utxos')) return new Response(JSON.stringify([{
    address: cardanoPayerAddress, tx_hash: 'a'.repeat(64), tx_index: 0, output_index: 0,
    amount: [{ unit: 'lovelace', quantity: '100000000' }, { unit: USDM_PREPROD_ASSET.replace('.', ''), quantity: '5000000' }],
    block: 'offline-fixture', data_hash: null, inline_datum: null, reference_script_hash: null,
  }]), { status: 200 });
  return new Response(JSON.stringify({ message: 'fixture endpoint not implemented' }), { status: 404 });
};

type CheckRecord = { check: string; status: 'PASS' };
const checks: CheckRecord[] = [];
const mark = (check: string, condition: boolean): void => {
  if (!condition) throw new Error(`${check} failed`);
  checks.push({ check, status: 'PASS' });
};
let cardanoPayerAddress = '';

async function cardanoRoundTrip(): Promise<void> {
  const payerMnemonic = PrivateKey.generateMnemonic(256);
  const recipientMnemonic = PrivateKey.generateMnemonic(256);
  const cardanoProvider = { blockfrost: { baseUrl: 'http://127.0.0.1:9199/api/v0', projectId: 'offline-fixture' } };
  cardanoPayerAddress = toClientCardanoSigner({ mnemonic: payerMnemonic, network: 'cardano:preprod', provider: cardanoProvider }).getAddress();
  const recipient = toClientCardanoSigner({ mnemonic: recipientMnemonic, network: 'cardano:preprod', provider: cardanoProvider }).getAddress();
  const expiry = new Date(Date.now() + 10 * 60_000).toISOString();
  const commitment = createHash('sha256').update('multiwallet-offline-runtime-fixture').digest('hex');
  const config = loadPayerConfig({
    PAYER_GATEWAY_URL: 'http://127.0.0.1:8787', PAYER_GATEWAY_TOKEN_FILE: join(tempRoot, 'unused-token'),
    PAYER_CARDANO_NETWORK: 'cardano:preprod', PAYER_CARDANO_MNEMONIC_FILE: join(tempRoot, 'unused-mnemonic'),
    BLOCKFROST_PROJECT_ID: 'offline-fixture', BLOCKFROST_BASE_URL: 'http://127.0.0.1:9199/api/v0',
    PAYER_MAX_PER_PAYMENT_BASE_UNITS: '5000000', PAYER_MAX_CUMULATIVE_BASE_UNITS: '10000000',
    PAYER_MAX_DAILY_BASE_UNITS: '10000000', PAYER_MAX_FEE_LOVELACE: '5000000', PAYER_MAX_ADA_OUTPUT_LOVELACE: '5000000',
    PAYER_ALLOWED_ASSET_UNIT: USDM_PREPROD_ASSET, PAYER_EXPECTED_PAY_TO: recipient, PAYER_LEDGER_FILE: join(tempRoot, 'unused-ledger'),
  });
  const signer = createBoundSigner(config, payerMnemonic, commitment);
  const signed = await signer.buildAndSignPaymentTransaction({
    network: 'cardano:preprod', payTo: recipient, asset: USDM_PREPROD_ASSET, amount: '2500000', maxTimeoutSeconds: 600,
    extra: { assetTransferMethod: 'default', expiresAt: expiry },
  } as Parameters<typeof signer.buildAndSignPaymentTransaction>[0]);
  const decoded = decodeCardanoTransaction(signed.transaction);
  const tx = CardanoTransaction.fromCBORBytes(Buffer.from(signed.transaction, 'base64'));
  const witness = tx.witnessSet.vkeyWitnesses?.[0];
  const bodyHash = CardanoTransactionBody.toHash(tx.body);
  const commitmentFromTx = readFundingCommitment(signed.transaction);
  const metadata = tx.auxiliaryData?.metadata?.get(FUNDING_METADATA_LABEL);
  mark('cardano_evolution_sign_serialize_decode_verify', !!witness && CardanoVKey.verify(witness.vkey, bodyHash.hash, witness.signature.bytes));
  mark('cardano_signed_metadata_commitment', commitmentFromTx === commitment && metadata === commitment);
  mark('cardano_exact_fixture_payment', decoded.outputs.some(output => output.address === recipient && output.assets[USDM_PREPROD_ASSET] === 2500000n));
  mark('cardano_offline_provider_fixture_used', cardanoRequests.length >= 2 && cardanoRequests.every(path => path.startsWith('/')));
}

async function solanaRoundTrip(): Promise<void> {
  const [payer, sponsor, source, destination, payee] = await Promise.all([
    generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner(),
  ]);
  const input = {
    purchaseId: 'pur_RUNTIME12345', quoteId: 'quo_RUNTIME12345', quoteDigest: 'sha256:' + 'a'.repeat(64),
    amount: { network: SOL_NETWORK, assetId: TEST_MINT, decimals: 6, amountBaseUnits: '1234' },
    payTo: payee.address, resourceUrl: 'http://127.0.0.1:8787/v1/purchases/pur_RUNTIME12345/fund',
    description: 'Offline runtime fixture', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
  const memo = commitment(input, destination.address);
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    m => setTransactionMessageFeePayerSigner(sponsor, m),
    m => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n }, m),
    m => appendTransactionMessageInstructions([
      getSetComputeUnitLimitInstruction({ units: 20_000 }),
      getSetComputeUnitPriceInstruction({ microLamports: 1 }),
      getTransferCheckedInstruction({ source: source.address, mint: address(TEST_MINT), destination: destination.address,
        authority: payer, amount: 1234n, decimals: 6 }),
      { programAddress: address(MEMO_PROGRAM_ADDRESS), accounts: [], data: Buffer.from(memo) },
    ], m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const serialized = getBase64EncodedWireTransaction(signed);
  const transfer = decodeTransaction(serialized);
  mark('solana_sdk_transfer_memo_serialize_verify', transfer.signature !== null && transfer.payer === payer.address && transfer.sponsor === sponsor.address);
  mark('solana_exact_amount_mint_destination_memo', transfer.amount === '1234' && transfer.mint === TEST_MINT && transfer.destination === destination.address && transfer.memo === memo);
}

async function suiRoundTrip(): Promise<void> {
  const keypair = Ed25519Keypair.generate();
  const payer = keypair.getPublicKey().toSuiAddress();
  const keyFile = join(tempRoot, 'sui-test-only.key');
  writeFileSync(keyFile, keypair.getSecretKey(), { mode: 0o600 });
  chmodSync(keyFile, 0o600);
  const payee = '0x' + 'b'.repeat(64);
  const config = loadSuiPayerConfig({
    SUI_NETWORK: 'testnet', SUI_RPC_URL: 'https://fullnode.testnet.sui.io:443', SUI_USDC_TYPE: SUI_USDC_TYPE,
    SUI_ASSET_DECIMALS: '6', SUI_TREASURY_ADDRESS: payee, SUI_MAX_PAYMENT_BASE_UNITS: '10000', SUI_MAX_GAS_BUDGET_MIST: '10000000',
    SUI_PAYER_ADDRESS: payer, SUI_PAYER_KEY_FILE: keyFile, SUI_GATEWAY_URL: 'http://127.0.0.1:8787',
    SUI_GATEWAY_TOKEN_FILE: join(tempRoot, 'unused-sui-token'), SUI_PAYER_MAX_PAYMENT_BASE_UNITS: '5000',
    SUI_PAYER_MAX_DAILY_BASE_UNITS: '10000', SUI_PAYER_MAX_TOTAL_BASE_UNITS: '20000',
    SUI_PAYER_MAX_TOTAL_GAS_MIST: '20000000', SUI_PAYER_MAX_COMMERCIAL_USD_MINOR: '50000',
  }, { ledger: 'external' });
  const input = {
    purchaseId: 'pur_RUNTIME12345', quoteId: 'quo_RUNTIME12345', quoteDigest: 'sha256:' + 'b'.repeat(64),
    amount: { network: SUI_NETWORK, assetId: SUI_USDC_TYPE, decimals: 6, amountBaseUnits: '1234' },
    payTo: payee, resourceUrl: 'http://127.0.0.1:8787/v1/purchases/pur_RUNTIME12345/fund',
    description: 'Offline runtime fixture', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
  const objectDigest = '11111111111111111111111111111111';
  const coin = (objectId: string, type: string, balance: string) => ({
    objectId, version: '1', digest: objectDigest, owner: { $kind: 'AddressOwner', AddressOwner: payer },
    type: `0x2::coin::Coin<${type}>`, balance,
  });
  const client = {
    async getChainIdentifier() { return { chainIdentifier: TESTNET_GENESIS }; },
    async getCoinMetadata() { return { coinMetadata: { decimals: 6, symbol: 'USDC' } }; },
    async getBalance({ coinType }: { coinType: string }) { return { balance: { coinType, balance: '0', coinBalance: coinType === SUI_TYPE ? '20000000' : '2000', addressBalance: '0' } }; },
    async listCoins({ coinType }: { coinType: string }) { return { objects: [coin(coinType === SUI_TYPE ? '0x' + '2'.repeat(64) : '0x' + '1'.repeat(64), coinType, coinType === SUI_TYPE ? '20000000' : '2000')], hasNextPage: false, cursor: null }; },
    async getReferenceGasPrice() { return { referenceGasPrice: '1000' }; },
    async getCurrentSystemState() { return { systemState: { epoch: '42' } }; },
  };
  const header = await buildPayment(config, input, client as never, 29);
  const candidate = await readSuiCandidate(header, input, config);
  const roundTrip = SuiTransaction.from(candidate.bytes);
  mark('sui_sdk_build_serialize_candidate_verify', candidate.transfer.payer === payer && candidate.candidate.digest === candidate.transfer.digest);
  mark('sui_exact_transfer_and_replay_bound_nonce', roundTrip.getData().expiration?.ValidDuring?.chain === TESTNET_GENESIS && roundTrip.getData().expiration?.ValidDuring?.nonce === 29 && candidate.transfer.payer === payer);
}

async function main(): Promise<void> {
  globalThis.fetch = denyExternalFetch;
  try {
    await cardanoRoundTrip();
    await solanaRoundTrip();
    await suiRoundTrip();
    const maxRss = process.resourceUsage().maxRSS;
    const output = {
      status: 'PASS',
      checks,
      runtime: {
        node: process.version,
        packages: {
          evolution: packageVersion('@evolution-sdk/evolution'),
          x402Cardano: packageVersion('@x402/cardano'),
          solanaKit: packageVersion('@solana/kit'),
          mystenSui: packageVersion('@mysten/sui'),
        },
        peakRssMiB: Math.round((maxRss / 1024) * 10) / 10,
        network: 'external fetch blocked; Cardano uses in-process Blockfrost fixture; Sui RPC is in-memory fixture',
      },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
  } finally {
    globalThis.fetch = fetchOriginal;
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch(error => {
  process.stderr.write(`runtime smoke failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exit(1);
});