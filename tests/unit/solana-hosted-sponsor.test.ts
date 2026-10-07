import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { address, generateKeyPairSigner, createTransactionMessage, pipe, setTransactionMessageFeePayerSigner, appendTransactionMessageInstructions, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners, getBase64EncodedWireTransaction, blockhash } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS, getTransferCheckedInstruction } from '@solana-program/token';
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import { MEMO_PROGRAM_ADDRESS } from '@x402/svm';
import type { FacilitatorSvmSigner } from '@x402/svm';
import { decodePaymentSignatureHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostedSponsor } from '../../clients/solana/hosted-sponsor.js';
import { loadSolanaPayerConfig } from '../../clients/solana/config.js';
import { SolanaLedger } from '../../clients/solana/ledger.js';
import { NETWORK, TEST_MINT, commitment, decodeTransaction } from '../../src/funding/solana/wire.js';
import type { SolanaRpc } from '../../src/funding/solana/rpc.js';
import { scenario } from '../support/solana.js';

const NOW = new Date('2026-10-06T14:00:00.000Z');
const dirs: string[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => {
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Fixture = Awaited<ReturnType<typeof makeFixture>>;
async function makeFixture(opts: { maxFees?: string } = {}) {
  const scenarioFixture = await scenario();
  const input = scenarioFixture.input;
  const [payer, sponsorSigner, source, payee] = await Promise.all(Array.from({ length: 4 }, () => generateKeyPairSigner()));
  const [destination] = await findAssociatedTokenPda({ owner: payee!.address, tokenProgram: TOKEN_PROGRAM_ADDRESS, mint: address(TEST_MINT) });
  const sponsoredInput = { ...input, payTo: payee!.address };
  const directory = mkdtempSync(join(tmpdir(), 'solana-hosted-sponsor-'));
  dirs.push(directory);
  SolanaLedger.protectDirectory(directory);
  const ledger = new SolanaLedger(join(directory, 'sponsor.json'), sponsorSigner!.address);
  ledger.initialize([]);
  const env = {
    ...scenarioFixture.env,
    SOLANA_TREASURY_ADDRESS: payee!.address,
    SOLANA_TREASURY_TOKEN_ACCOUNT: destination,
    SOLANA_FEE_PAYER_ADDRESS: sponsorSigner!.address,
    SOLANA_PAYER_RPC_URL: 'https://api.devnet.solana.com',
    SOLANA_PAYER_ADDRESS: payer!.address,
    SOLANA_PAYER_TOKEN_ACCOUNT: source!.address,
    SOLANA_PAYER_KEY_FILE: 'unused-test-payer-key',
    SOLANA_LEDGER_DIRECTORY: directory,
    SOLANA_PAYER_MAX_PURCHASE_BASE_UNITS: '10000',
    SOLANA_PAYER_MAX_TOTAL_BASE_UNITS: '10000',
    SOLANA_PAYER_MAX_COMMERCIAL_USD_MINOR: '1000',
    SOLANA_SPONSOR_MAX_TOTAL_FEE_LAMPORTS: opts.maxFees ?? '100000',
    SOLANA_SPONSOR_KEY_FILE: 'unused-test-sponsor-key',
    SOLANA_GATEWAY_URL: 'http://127.0.0.1:8787',
    SOLANA_GATEWAY_TOKEN_FILE: 'unused-test-gateway-token',
  };
  const parsed = loadSolanaPayerConfig(env, { ledger: 'external' });
  const accepted: PaymentRequirements = {
    scheme: 'exact', network: NETWORK, asset: TEST_MINT, amount: sponsoredInput.amount.amountBaseUnits, payTo: sponsoredInput.payTo,
    maxTimeoutSeconds: 60,
    extra: {
      feePayer: sponsorSigner!.address, tokenAccount: destination, memo: commitment(sponsoredInput, destination),
      preparation: { url: parsed.facilitatorUrl + '/prepare', method: 'POST', authentication: 'Bearer', requiresFullySignedTransaction: true },
      funding: { purchaseId: sponsoredInput.purchaseId, quoteId: sponsoredInput.quoteId, quoteDigest: sponsoredInput.quoteDigest,
        resourceUrl: sponsoredInput.resourceUrl, expiresAt: sponsoredInput.expiresAt, ...(sponsoredInput.settlement ? { settlement: sponsoredInput.settlement } : {}) },
    },
  };
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(sponsorSigner!, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 100n }, m),
    (m) => appendTransactionMessageInstructions([
      getSetComputeUnitLimitInstruction({ units: 20000 }), getSetComputeUnitPriceInstruction({ microLamports: 1 }),
      getTransferCheckedInstruction({ source: source!.address, mint: address(TEST_MINT), destination, authority: payer!, amount: BigInt(accepted.amount), decimals: 6 }),
      { programAddress: address(MEMO_PROGRAM_ADDRESS), accounts: [], data: Buffer.from(String(accepted.extra.memo)) },
    ], m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const transaction = getBase64EncodedWireTransaction(signed);
  const transfer = decodeTransaction(transaction);
  const payload: PaymentPayload = { x402Version: 2, resource: { url: sponsoredInput.resourceUrl }, accepted, payload: { transaction } };

  const rpcCalls: Array<{ method: string; params: unknown[] }> = [];
  let statuses: Array<{ err: unknown; confirmationStatus: string } | null> = [];
  let defaultStatus: { err: unknown; confirmationStatus: string } | null = null;
  let loseNextSend = false;
  const sentTransactions: string[] = [];
  const rpc = {
    assertNetwork: vi.fn(async () => {}),
    assertMint: vi.fn(async () => {}),
    assertToken: vi.fn(async () => {}),
    call: vi.fn(async (method: string, params: unknown[] = []) => {
      rpcCalls.push({ method, params });
      if (method === 'getSignaturesForAddress') return [];
      if (method === 'getFeeForMessage') return { value: 10001 };
      if (method === 'getSignatureStatuses') return { value: [statuses.length ? statuses.shift()! : defaultStatus] };
      if (method === 'sendTransaction') {
        const raw = String(params[0]);
        sentTransactions.push(raw);
        if (loseNextSend) { loseNextSend = false; throw new Error('simulated RPC response loss'); }
        return transfer.signature;
      }
      throw new Error(`unexpected fake RPC method: ${method}`);
    }),
  } as unknown as SolanaRpc;
  const transactionId = createHash('sha256').update(transfer.message).digest('hex');
  const signTransaction = vi.fn(async (raw: string) => {
    const reservation = ledger.read().find((row) => row.id === transactionId);
    expect(reservation).toMatchObject({ id: transactionId, signature: null, amount: '0', fee: '10001', header: null });
    return raw;
  });
  const signer: FacilitatorSvmSigner = {
    getAddresses: () => [address(sponsorSigner!.address)],
    signTransaction,
    simulateTransaction: vi.fn(async () => {}),
    sendTransaction: vi.fn(async () => transfer.signature!),
    confirmTransaction: vi.fn(async () => {}),
  };
  const sponsor = await createHostedSponsor(parsed, ledger, { rpc, signer, wait: async () => {} });
  const header = encodePaymentSignatureHeader(payload);
  const s = { ...scenarioFixture, input: sponsoredInput, transfer, transaction };
  return {
    s, parsed, ledger, rpc, rpcCalls, signer, signTransaction, sponsor, payload, header,
    status: (sequence: Array<{ err: unknown; confirmationStatus: string } | null>) => { statuses = [...sequence]; },
    defaultStatus: (value: { err: unknown; confirmationStatus: string } | null) => { defaultStatus = value; },
    loseSendOnce: () => { loseNextSend = true; },
    sentTransactions,
  };
}function preparedPayload(header: string): PaymentPayload { return decodePaymentSignatureHeader(header); }

describe('hosted internal Solana sponsor', () => {
  it('reserves before signing and returns the exact persisted header and signature on duplicate prepare', async () => {
    const f = await makeFixture();
    const first = await f.sponsor.prepare(f.payload);
    expect(f.signTransaction).toHaveBeenCalledTimes(1);
    expect(first.signature).toBe(f.s.transfer.signature);
    expect(f.ledger.read()).toContainEqual(expect.objectContaining({
      id: createHash('sha256').update(f.s.transfer.message).digest('hex'), signature: first.signature, fee: '10001', header: first.header,
    }));

    const repeated = await f.sponsor.prepare(f.payload);
    expect(repeated).toEqual(first);
    expect(f.signTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not sign an incomplete prior reservation', async () => {
    const f = await makeFixture();
    const id = createHash('sha256').update(f.s.transfer.message).digest('hex');
    f.ledger.upsert({ id, signature: null, amount: '0', fee: '10001', header: null, createdAt: NOW.toISOString() });

    await expect(f.sponsor.prepare(f.payload)).rejects.toThrow(/incomplete sponsor reservation/);
    expect(f.signTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['fee cap', { maxFees: '10000' }, (_payload: PaymentPayload) => {}, /cap exceeded/],
    ['wrong payee binding', {}, (payload: PaymentPayload) => {
      payload.accepted = { ...payload.accepted, payTo: 'wrong-payee' };
    }, /outside approved policy/],
    ['expired quote', {}, (payload: PaymentPayload) => {
      const extra = payload.accepted.extra as Record<string, unknown>;
      const funding = extra.funding as Record<string, unknown>;
      payload.accepted = { ...payload.accepted, extra: { ...extra, funding: { ...funding, expiresAt: '2026-10-06T13:59:59.000Z' } } };
    }, /resource or expiry mismatch/],
  ])('refuses %s before signing', async (_name, config, mutate, error) => {
    const f = await makeFixture(config);
    const payload = structuredClone(f.payload);
    mutate(payload);

    await expect(f.sponsor.prepare(payload)).rejects.toThrow(error);
    expect(f.signTransaction).not.toHaveBeenCalled();
    expect(f.ledger.read()).toEqual([]);
  });

  it('broadcasts only the exact persisted header', async () => {
    const f = await makeFixture();
    const prepared = await f.sponsor.prepare(f.payload);
    const altered = preparedPayload(prepared.header);
    altered.resource = { url: 'https://attacker.invalid/fund' };

    await expect(f.sponsor.broadcast(altered)).rejects.toThrow(/not durably bound/);
    expect(f.sentTransactions).toEqual([]);
  });

  it('does not sign or send when the immutable candidate is already finalized', async () => {
    const f = await makeFixture();
    const prepared = await f.sponsor.prepare(f.payload);
    f.defaultStatus({ err: null, confirmationStatus: 'finalized' });

    await expect(f.sponsor.broadcast(preparedPayload(prepared.header))).resolves.toBeUndefined();
    expect(f.signTransaction).toHaveBeenCalledTimes(1);
    expect(f.sentTransactions).toEqual([]);
  });

  it('recovers a lost send response by retrying the same persisted candidate without signing again', async () => {
    const f = await makeFixture();
    const prepared = await f.sponsor.prepare(f.payload);
    f.loseSendOnce();
    f.defaultStatus(null);

    await expect(f.sponsor.broadcast(preparedPayload(prepared.header))).rejects.toThrow(/response loss/);
    expect(await f.ledger.read()).toContainEqual(expect.objectContaining({ signature: prepared.signature, header: prepared.header }));
    f.status([null, { err: null, confirmationStatus: 'finalized' }]);
    await f.sponsor.broadcast(preparedPayload(prepared.header));

    expect(f.signTransaction).toHaveBeenCalledTimes(1);
    expect(f.sentTransactions).toEqual([f.s.transaction, f.s.transaction]);
  });

  it('stops after the bounded finality poll budget and retains the candidate', async () => {
    const f = await makeFixture();
    const prepared = await f.sponsor.prepare(f.payload);
    f.defaultStatus(null);

    await expect(f.sponsor.broadcast(preparedPayload(prepared.header))).rejects.toThrow(/finality pending/);
    expect(f.rpcCalls.filter((call) => call.method === 'getSignatureStatuses')).toHaveLength(13);
    expect(f.sentTransactions).toEqual([f.s.transaction]);
    expect(f.signTransaction).toHaveBeenCalledTimes(1);
    expect(await f.ledger.read()).toContainEqual(expect.objectContaining({ signature: prepared.signature, header: prepared.header }));
  });
});



