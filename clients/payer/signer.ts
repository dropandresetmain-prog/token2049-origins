/** Evolution builder keeps the funding commitment in auxiliary data before fee calculation and signing. */
import { Address, Assets, Client, Transaction, preprod } from '@evolution-sdk/evolution';
import { decodeCardanoTransaction, toClientCardanoSigner, withCardanoProviderTimeout, type ClientCardanoSigner } from '@x402/cardano';
import { FUNDING_METADATA_LABEL, readFundingCommitment } from '../../src/funding/cardano/binding.js';
import type { PayerConfig } from './config.js';

/** Bound incidental tADA costs separately from the quoted native-token principal. */
export function assertAdaBudget(config: PayerConfig, tx: { fee: bigint; outputs: Array<{ address: string; coin: bigint }> }, asset: string): void {
  if (tx.fee < 0n || tx.fee > config.maxFeeLovelace) throw new Error('transaction fee exceeds payer cap');
  const treasuryAda = tx.outputs.filter(o => o.address === config.expectedPayTo).reduce((sum, o) => sum + o.coin, 0n);
  if (asset !== 'lovelace' && treasuryAda > config.maxAdaOutputLovelace) throw new Error('treasury ADA output exceeds payer cap');
}

export function createBoundSigner(config: PayerConfig, mnemonic: string, commitment: string): ClientCardanoSigner {
  const normalized = mnemonic.trim().replace(/\s+/g, ' ').toLowerCase();
  const provider = { blockfrost: { baseUrl: config.blockfrostBaseUrl, projectId: config.blockfrostProjectId } };
  const addressSigner = toClientCardanoSigner({ mnemonic: normalized, network: config.network, provider });
  const client = Client.make(preprod).withBlockfrost(provider.blockfrost).withSeed({ mnemonic: normalized });
  return {
    getAddress: () => addressSigner.getAddress(),
    async buildAndSignPaymentTransaction(input) {
      if (input.network !== config.network || input.payTo !== config.expectedPayTo || input.asset !== config.allowedAsset || BigInt(input.amount) > config.maxPerPayment || input.extra?.assetTransferMethod !== 'default') throw new Error('unsupported payment');
      const bounded = <T>(operation: PromiseLike<T>, name: string) => withCardanoProviderTimeout(operation, 30_000, name);
      const changeAddress = await bounded(client.address(), 'address');
      const utxos = await bounded(client.getWalletUtxos(), 'utxos');
      const nonceUtxo = utxos[0];
      if (!nonceUtxo) throw new Error('wallet has no utxos');
      const amount = BigInt(input.amount);
      const [policy, name] = input.asset.split('.');
      const assets = input.asset === 'lovelace' ? Assets.fromLovelace(amount) : Assets.addByHex(Assets.zero, policy!, name!, amount);
      const expires = Date.parse(String(input.extra?.expiresAt));
      if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error('quote expired');
      const builder = await bounded(client.newTx().collectFrom({ inputs: [nonceUtxo] })
        .payToAddress({ address: Address.fromBech32(input.payTo), assets })
        .attachMetadata({ label: FUNDING_METADATA_LABEL, metadata: commitment })
        .setValidity({ to: BigInt(Math.min(expires, Date.now() + input.maxTimeoutSeconds * 1000)) })
        .build({ changeAddress, autoMinUtxo: input.asset !== 'lovelace' }), 'build');
      const unsigned = await builder.toTransaction();
      const encodedUnsigned = Buffer.from(Transaction.toCBORBytes(unsigned)).toString('base64');
      if (readFundingCommitment(encodedUnsigned) !== commitment) throw new Error('transaction metadata commitment missing');
      assertAdaBudget(config, decodeCardanoTransaction(encodedUnsigned), input.asset);
      if (expires <= Date.now()) throw new Error('quote expired before signing');
      const signed = await bounded(builder.sign(), 'sign');
      const tx = new Transaction.Transaction({ body: unsigned.body, witnessSet: signed.witnessSet, isValid: true, auxiliaryData: unsigned.auxiliaryData });
      return { transaction: Buffer.from(Transaction.toCBORBytes(tx)).toString('base64'),
        nonce: `${Buffer.from(nonceUtxo.transactionId.hash).toString('hex')}#${Number(nonceUtxo.index)}` };
    },
  };
}
