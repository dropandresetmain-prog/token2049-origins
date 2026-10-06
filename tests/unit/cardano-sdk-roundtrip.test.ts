/**
 * Round trip with the REAL x402 SDK client types: our 402 body -> x402Client + ExactCardanoScheme (with a
 * mock signer in place of key material) -> PAYMENT-SIGNATURE -> our adapter. Proves the SDK echoes
 * `accepted` byte-for-byte (including our extra keys) and that the header codecs agree both ways.
 * Also pins the SDK facts the adapter depends on so a dependency bump that changes them fails loudly.
 */
import { describe, expect, it } from 'vitest';
import { LOVELACE_ASSET, USDM_PREPROD_ASSET, decodeCardanoPayload, findDefaultAsset } from '@x402/cardano';
import { ExactCardanoScheme as ExactCardanoClientScheme } from '@x402/cardano/exact/client';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from '@x402/core/http';
import type { PaymentRequired } from '@x402/core/types';
import { createCardanoFundingAdapter, type DecodedTxView } from '../../src/funding/cardano/index.js';
import type { FundingRequirementInput } from '../../src/contracts/ports.js';
import { fundingCommitment } from '../../src/funding/cardano/binding.js';
import { ManualClock } from '../../src/infrastructure/clock.js';

const TREASURY = 'addr_test1qztreasury0000000000000000000000000000000000000000000000';
const TX = 'a'.repeat(64);
const NONCE = `${'b'.repeat(64)}#0`;
const clock = new ManualClock();

const env = {
  CARDANO_NETWORK: 'cardano:preprod',
  CARDANO_FACILITATOR_URL: 'https://facilitator.example.test',
  CARDANO_TREASURY_ADDRESS: TREASURY,
  CARDANO_ASSET_UNIT: USDM_PREPROD_ASSET,
  CARDANO_ASSET_DECIMALS: '6',
  BLOCKFROST_PROJECT_ID: 'preprodTESTONLY',
  BLOCKFROST_BASE_URL: 'https://cardano-preprod.blockfrost.io/api/v0',
};

const input: FundingRequirementInput = {
  purchaseId: 'pur_ABCDEFGHIJKLMNOP',
  quoteId: 'quo_ABCDEFGHIJKLMNOP',
  quoteDigest: 'd'.repeat(64),
  amount: { network: 'cardano:preprod', assetId: USDM_PREPROD_ASSET, decimals: 6, amountBaseUnits: '2500000' },
  payTo: TREASURY,
  resourceUrl: 'http://127.0.0.1:8787/v1/purchases/pur_ABCDEFGHIJKLMNOP/fund',
  description: 'Purchase funding',
  expiresAt: new Date(clock.now().getTime() + 10 * 60_000).toISOString(),
};

describe('real SDK client <-> our adapter', () => {
  it('SDK-signed payload echoes our accepted entry exactly and is accepted by verify()', async () => {
    const signed: unknown[] = [];
    const client = new x402Client();
    client.register(
      'cardano:preprod',
      new ExactCardanoClientScheme({
        getAddress: () => 'addr_test1qzpayer',
        buildAndSignPaymentTransaction: async (i) => {
          signed.push(i);
          return { transaction: 'tx-ok', nonce: NONCE };
        },
      }),
    );
    client.setSpendControls({ maxAmountPerPayment: false, allowedAssets: [{ network: 'cardano:preprod', asset: USDM_PREPROD_ASSET, maxAmountPerPayment: '5000000' }] });

    const decodeCalls: string[] = [];
    const decodeTransaction = (t: string): DecodedTxView => {
      decodeCalls.push(t);
      return { txHash: TX, commitment: fundingCommitment(input.resourceUrl, (adapter.paymentRequirements(input) as unknown as PaymentRequired).accepts[0]!), outputs: [{ address: TREASURY, coin: 2_000_000n, assets: { [USDM_PREPROD_ASSET]: 2_500_000n } }] };
    };
    let seenPayload: unknown;
    const adapter = createCardanoFundingAdapter(env, {
      clock,
      decodeTransaction,
      facilitator: {
        verify: async (p) => {
          seenPayload = p;
          return { isValid: true, payer: 'addr_test1qzpayer' };
        },
        settle: async () => ({ success: true, payer: 'addr_test1qzpayer', transaction: TX, network: 'cardano:preprod', extra: { status: 'confirmed', confirmations: 1 } }),
        getSupported: async () => ({ kinds: [], extensions: [], signers: {} }),
      },
      fetchImpl: async (url) => {
        const path = new URL(String(url)).pathname.replace('/api/v0', '');
        const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s });
        if (path === '/genesis') return j({ network_magic: 1 });
        if (path === `/txs/${TX}/metadata`) return j([{ label: '2049', json_metadata: fundingCommitment(input.resourceUrl, (adapter.paymentRequirements(input) as unknown as PaymentRequired).accepts[0]!) }]);
        if (path === '/blocks/latest') return j({ height: 1010 });
        if (path === `/txs/${TX}/utxos`) return j({ hash: TX, inputs: [{ address: 'addr_test1qzpayer' }], outputs: [{ address: TREASURY, amount: [{ unit: USDM_PREPROD_ASSET.replace('.', ''), quantity: '2500000' }], output_index: 0 }] });
        if (path === `/txs/${TX}`) return j({ hash: TX, block_height: 1005, block_time: 1_790_000_000, valid_contract: true });
        return j({}, 404);
      },
    });

    // 1. The 402 body the core would emit; client decodes it from the PAYMENT-REQUIRED header like a real one.
    const challenge = adapter.paymentRequirements(input) as unknown as PaymentRequired;
    const http = new x402HTTPClient(client);
    const decoded = http.getPaymentRequiredResponse((n) => (n.toLowerCase() === 'payment-required' ? encodePaymentRequiredHeader(challenge) : null));
    expect(decoded).toEqual(challenge);

    // 2. SDK builds the payload; the header is exactly what the payer sends.
    const payload = await http.createPaymentPayload(decoded);
    const headers = http.encodePaymentSignatureHeader(payload);
    const headerValue = Object.entries(headers).find(([k]) => k.toLowerCase() === adapter.paymentHeaderName)?.[1];
    expect(headerValue).toBeTruthy();
    expect(payload.accepted).toEqual(challenge.accepts[0]);
    expect(decodePaymentSignatureHeader(headerValue!)).toEqual(payload);
    expect(decodeCardanoPayload(payload.payload)).toEqual({ transaction: 'tx-ok', nonce: NONCE });

    // The signer was asked for exactly the quoted amount/asset/payee, never anything else.
    expect(signed).toHaveLength(1);
    expect(signed[0]).toMatchObject({ network: 'cardano:preprod', payTo: TREASURY, asset: USDM_PREPROD_ASSET, amount: '2500000' });

    // 3. Our adapter accepts it and hands the facilitator the client's payload untouched.
    const v = await adapter.verify(headerValue!, input);
    expect(v.ok).toBe(true);
    expect(decodeCalls).toEqual(['tx-ok']);
    expect(seenPayload).toEqual(payload);
    if (v.ok) expect(v.funding).toMatchObject({ paymentState: 'confirmed', transferReference: TX, amountBaseUnits: '2500000' });
  });

  it('pins the SDK facts the adapter relies on', () => {
    expect(USDM_PREPROD_ASSET).toBe('e675b46e4d2242c991a8932a99db3044e80515ae14b4c4ccf6b3f4c9.0014df10745553444d');
    expect(LOVELACE_ASSET).toBe('lovelace');
    // tUSDM is a recognized default asset on preprod; lovelace is not (it needs explicit client allowance).
    expect(findDefaultAsset(USDM_PREPROD_ASSET, 'cardano:preprod')).toBeTruthy();
    expect(findDefaultAsset('lovelace', 'cardano:preprod')).toBeFalsy();
  });
});
