import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import type { FundingRequirementInput } from '../../src/contracts/ports.js';
import { createSuiFundingAdapter } from '../../src/funding/sui/adapter.js';
import { NETWORK, TESTNET_GENESIS, USDC_TYPE } from '../../src/funding/sui/config.js';
import { bindingMessage, encodeCandidate, type SuiCandidate } from '../../src/funding/sui/wire.js';
import { ManualClock } from '../../src/infrastructure/clock.js';
import type { ChainTransaction, SuiRpcPort } from '../../src/funding/sui/rpc.js';

export const suiClock = new ManualClock(Date.parse('2026-10-08T00:00:00.000Z'));
export const SUI_PAYEE = '0x' + 'b'.repeat(64);
const SUI_PAYER_OBJECT = '0x' + '1'.repeat(64);
const SUI_GAS_OBJECT = '0x' + '2'.repeat(64);
const OBJECT_DIGEST = '11111111111111111111111111111111';

export function suiInput(changes: Partial<FundingRequirementInput> = {}): FundingRequirementInput {
  return {
    purchaseId: 'pur_1234567890',
    quoteId: 'quo_1234567890',
    quoteDigest: 'quote-digest',
    amount: { network: NETWORK, assetId: USDC_TYPE, decimals: 6, amountBaseUnits: '1000' },
    payTo: SUI_PAYEE,
    resourceUrl: 'http://127.0.0.1:8787/v1/purchases/pur_1234567890/fund',
    description: 'Test purchase',
    expiresAt: '2026-10-08T00:10:00.000Z',
    ...changes,
  };
}

export const suiEnv = {
  SUI_NETWORK: 'testnet',
  SUI_RPC_URL: 'https://fullnode.testnet.sui.io:443',
  SUI_USDC_TYPE: USDC_TYPE,
  SUI_ASSET_DECIMALS: '6',
  SUI_TREASURY_ADDRESS: SUI_PAYEE,
  SUI_MAX_PAYMENT_BASE_UNITS: '10000',
  SUI_MAX_GAS_BUDGET_MIST: '10000000',
};

export async function makeSuiCandidate(
  input: FundingRequirementInput,
  options: {
    commands?: 'exact' | 'move' | 'extra-output' | 'balance'; amount?: bigint; recipient?: string;
    gasAddressBalance?: boolean; validity?: { chain?: string; expiryMs?: number; nonce?: number };
    sender?: string; gasOwner?: string;
    balance?: { package?: string; module?: string; function?: string; typeArgument?: string; from?: 'sender' | 'sponsor'; reservation?: bigint; amount?: bigint; recipient?: string };
  } = {},
) {
  const keypair = Ed25519Keypair.generate();
  const payer = keypair.getPublicKey().toSuiAddress();
  const tx = new Transaction();
  tx.setSender(options.sender ?? payer);
  tx.setGasOwner(options.gasOwner ?? payer);
  tx.setGasBudget(10_000_000);
  tx.setGasPrice(1_000);
  if (options.validity) {
    tx.setExpiration({ ValidDuring: {
      minEpoch: '42', maxEpoch: '43', minTimestamp: null,
      maxTimestamp: options.validity.expiryMs === undefined ? null : String(options.validity.expiryMs),
      chain: options.validity.chain ?? '69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD',
      nonce: options.validity.nonce ?? 7,
    } });
  } else {
    tx.setExpiration({ Epoch: 1 });
  }
  tx.setGasPayment(options.gasAddressBalance ? [] : [{ objectId: SUI_GAS_OBJECT, version: '1', digest: OBJECT_DIGEST }]);
  if (options.commands === 'balance') {
    const balance = options.balance ?? {};
    const withdrawal = tx.withdrawal({
      amount: balance.reservation ?? BigInt(input.amount.amountBaseUnits),
      type: balance.typeArgument ?? USDC_TYPE,
      from: balance.from ?? 'sender',
    } as Parameters<Transaction['withdrawal']>[0]);
    const coin = tx.moveCall({
      target: `${balance.package ?? '0x2'}::${balance.module ?? 'coin'}::${balance.function ?? 'redeem_funds'}`,
      typeArguments: [balance.typeArgument ?? USDC_TYPE],
      arguments: [withdrawal],
    });
    tx.transferObjects([coin], balance.recipient ?? options.recipient ?? input.payTo);
  } else {
    const [coin] = tx.splitCoins(tx.objectRef({ objectId: SUI_PAYER_OBJECT, version: '1', digest: OBJECT_DIGEST }), [
      tx.pure.u64(options.amount ?? BigInt(input.amount.amountBaseUnits)),
    ]);
    tx.transferObjects([coin], options.recipient ?? input.payTo);
  }
  if (options.commands === 'move') {
    tx.moveCall({ target: '0x2::clock::timestamp_ms', arguments: [] });
  } else if (options.commands === 'extra-output') {
    const [extra] = tx.splitCoins(tx.objectRef({ objectId: '0x' + '3'.repeat(64), version: '1', digest: OBJECT_DIGEST }), [tx.pure.u64(1n)]);
    tx.transferObjects([extra], '0x' + 'c'.repeat(64));
  }
  const bytes = await tx.build();
  const { signature } = await keypair.signTransaction(bytes);
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  const { signature: bindingSignature } = await keypair.signPersonalMessage(bindingMessage(input, digest));
  const candidate: SuiCandidate = {
    version: 1,
    protocol: 'sui-usdc-transfer',
    transaction: toBase64(bytes),
    signature,
    bindingSignature,
    digest,
  };
  return { payer, bytes, digest, candidate, header: encodeCandidate(candidate), keypair };
}

export interface SuiMockOptions {
  wrongGenesis?: boolean;
  wrongAsset?: boolean;
  missingTransaction?: boolean;
  missingCheckpoint?: boolean;
  failedTransaction?: boolean;
  omitTimestamp?: boolean;
  throwTransaction?: boolean;
  throwExecute?: boolean;
  advanceClockOnReadMs?: number;
  receivedAtMs?: number;
  mutateBalanceChanges?: boolean;
  transactionReads?: number;
}

export async function suiScenario(
  changes: Partial<FundingRequirementInput> = {},
  options: SuiMockOptions = {},
  candidateOptions: Parameters<typeof makeSuiCandidate>[1] = {},
) {
  const input = suiInput(changes);
  const candidate = await makeSuiCandidate(input, candidateOptions);
  let executed = 0;
  let transactionReads = 0;
  let objectChecks = 0;
  let networkChecks = 0;
  let assetChecks = 0;
  let mutable = { missingTransaction: true, ...options };
  let record: ChainTransaction | null = mutable.missingTransaction ? null : buildRecord(candidate, input, mutable);
  const rpc: SuiRpcPort & { assertPaymentObjects(bytes: Uint8Array): Promise<void> } = {
    async assertNetwork() {
      networkChecks++;
      if (mutable.wrongGenesis) throw new Error('wrong testnet genesis');
    },
    async assertAsset() {
      assetChecks++;
      if (mutable.wrongAsset) throw new Error('USDC metadata mismatch');
    },
    async assertPaymentObjects(_bytes) {
      objectChecks++;
    },
    async transaction(digest) {
      transactionReads++;
      if (mutable.advanceClockOnReadMs) suiClock.advance(mutable.advanceClockOnReadMs);
      if (mutable.throwTransaction) throw new Error('read timeout');
      if (mutable.missingTransaction || !record || digest !== candidate.digest) return null;
      return record;
    },
    async execute(bytes, _signature) {
      executed++;
      if (mutable.throwExecute) throw new Error('execution response timed out');
      mutable = { ...mutable, missingTransaction: false };
      record = buildRecord({ ...candidate, bytes: new Uint8Array(bytes) }, input, mutable);
    },
  };
  const adapter = createSuiFundingAdapter(suiEnv, { clock: suiClock, rpc });
  return {
    adapter, input, candidate, rpc,
    counts: () => ({ executed, transactionReads, objectChecks, networkChecks, assetChecks }),
    setOptions(next: SuiMockOptions) {
      mutable = { ...mutable, ...next };
      record = buildRecord(candidate, input, mutable);
    },
    removeRecord() { record = null; },
    setRecord(next: ChainTransaction | null) { record = next; },
    restart() { return createSuiFundingAdapter(suiEnv, { clock: suiClock, rpc }); },
  };
}

function buildRecord(
  candidate: Pick<Awaited<ReturnType<typeof makeSuiCandidate>>, 'bytes' | 'digest' | 'payer'>,
  input: FundingRequirementInput,
  options: SuiMockOptions,
): ChainTransaction {
  const timestampMs = options.receivedAtMs ?? suiClock.now().getTime();
  const balanceChanges = options.failedTransaction
    ? []
    : options.mutateBalanceChanges
    ? [{ address: input.payTo, coinType: USDC_TYPE, amount: '999' }]
    : [
        { address: input.payTo, coinType: USDC_TYPE, amount: input.amount.amountBaseUnits },
        { address: candidate.payer, coinType: USDC_TYPE, amount: '-' + input.amount.amountBaseUnits },
      ];
  return {
    digest: candidate.digest,
    bcs: candidate.bytes,
    checkpoint: options.missingCheckpoint ? null : '1',
    timestampMs: options.omitTimestamp ? null : timestampMs,
    balanceChanges,
    status: { success: !options.failedTransaction },
  } as unknown as ChainTransaction;
}
