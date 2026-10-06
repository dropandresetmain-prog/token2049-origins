import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CdpClient } from '@coinbase/cdp-sdk';
import { CDP_CHAIN_ID, CDP_MAX_ACTION_WEI, CDP_NETWORK, CDP_TRANSFER_IDEMPOTENCY_KEY, CDP_TRANSFER_WEI, validateHistory, validateTransfer } from '../../src/integrations/coinbase-cdp/contracts.js';
import type { CdpPublicIdentity, CdpSettings } from '../../src/integrations/coinbase-cdp/contracts.js';
import { makeAccountPolicy } from '../../src/integrations/coinbase-cdp/client.js';
import { createHistoryOnce, initialHistory, readHistory, writeHistoryAtomic } from '../../src/integrations/coinbase-cdp/history.js';
import { executeTestTransfer, transactionExplorerUrl } from '../../src/integrations/coinbase-cdp/transfer.js';
import type { CdpRpc } from '../../src/integrations/coinbase-cdp/transfer.js';

const identity: CdpPublicIdentity = {
  version: 1,
  network: CDP_NETWORK,
  treasuryName: 'capsule-treasury-test',
  treasuryAddress: '0x1111111111111111111111111111111111111111',
  recipientName: 'capsule-treasury-recipient',
  recipientAddress: '0x2222222222222222222222222222222222222222',
  policyId: '00000000-0000-4000-8000-000000000001',
  createdAt: '2026-10-07T00:00:00.000Z',
};

let directory: string;
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

function tempSettings(): CdpSettings {
  directory = mkdtempSync(join(tmpdir(), 'capsule-cdp-'));
  return {
    apiKeyId: 'test-only', apiKeySecret: 'test-only', walletSecret: 'test-only',
    identityFile: join(directory, 'identity.json'), historyFile: join(directory, 'actions.json'), rpcUrl: 'https://example.invalid',
  };
}

describe('Coinbase CDP treasury guards', () => {
  it('allows only the exact demo-sized Base Sepolia native transfer between separate accounts', () => {
    expect(() => validateTransfer(CDP_TRANSFER_WEI, CDP_NETWORK, identity.treasuryAddress, identity.recipientAddress)).not.toThrow();
    expect(() => validateTransfer(CDP_TRANSFER_WEI + 1n, CDP_NETWORK, identity.treasuryAddress, identity.recipientAddress)).toThrow(/per-action limit/);
    expect(() => validateTransfer(CDP_TRANSFER_WEI, 'base', identity.treasuryAddress, identity.recipientAddress)).toThrow(/Base Sepolia/);
    expect(() => validateTransfer(CDP_TRANSFER_WEI, CDP_NETWORK, identity.treasuryAddress, identity.treasuryAddress)).toThrow(/separate/);
  });

  it('builds the account policy around the dedicated recipient, action cap, and test network', () => {
    const policy = makeAccountPolicy(identity.recipientAddress);
    expect(policy.scope).toBe('account');
    expect(policy.rules[0]?.operation).toBe('sendEvmTransaction');
    expect(policy.rules[0]?.criteria).toContainEqual({ type: 'evmAddress', addresses: [identity.recipientAddress], operator: 'in' });
    expect(policy.rules[0]?.criteria).toContainEqual({ type: 'ethValue', ethValue: CDP_MAX_ACTION_WEI.toString(), operator: '<=' });
    expect(policy.rules[0]?.criteria).toContainEqual({ type: 'evmNetwork', networks: [CDP_NETWORK], operator: 'in' });
  });

  it('creates action history exclusively and refuses changed identities or limits', () => {
    const settings = tempSettings();
    const history = createHistoryOnce(settings.historyFile, identity);
    expect(readHistory(settings.historyFile, identity)).toEqual(history);
    expect(() => validateHistory({ ...history, maxTotalWei: '999' }, identity)).toThrow(/limits changed/);
    expect(() => createHistoryOnce(settings.historyFile, { ...identity, treasuryAddress: '0x3333333333333333333333333333333333333333' })).toThrow(/identity changed/);
  });

  it('retains unknown reservations and retries only the same CDP idempotency key and exact payload', async () => {
    const settings = tempSettings();
    createHistoryOnce(settings.historyFile, identity);
    const keys: string[] = [];
    const payloads: unknown[] = [];
    let fail = true;
    const account = {
      useNetwork: vi.fn(async (network: string) => ({
        network,
        sendTransaction: vi.fn(async (request: { idempotencyKey: string; transaction: unknown }) => {
          keys.push(request.idempotencyKey);
          payloads.push(request.transaction);
          if (fail) { fail = false; throw new Error('sensitive CDP response must not escape'); }
          return { transactionHash: '0x' + 'a'.repeat(64) };
        }),
      })),
    };
    const client = { evm: { getAccount: vi.fn(async () => account) } } as unknown as CdpClient;
    const rpc: CdpRpc = {
      transaction: vi.fn(async () => ({ from: identity.treasuryAddress, to: identity.recipientAddress, value: `0x${CDP_TRANSFER_WEI.toString(16)}`, chainId: `0x${CDP_CHAIN_ID.toString(16)}` })),
      receipt: vi.fn(async () => ({ status: '0x1', transactionHash: '0x' + 'a'.repeat(64) })),
    };

    await expect(executeTestTransfer(client, settings, identity, rpc)).rejects.toThrow(/result is unknown/);
    const unknown = readHistory(settings.historyFile, identity);
    expect(unknown.status).toBe('unknown');
    expect(unknown.attempted).toBe(true);
    expect(JSON.stringify(unknown)).not.toContain('sensitive CDP response');

    const recovered = await executeTestTransfer(client, settings, identity, rpc);
    expect(recovered.status).toBe('confirmed');
    expect(keys).toEqual([CDP_TRANSFER_IDEMPOTENCY_KEY, CDP_TRANSFER_IDEMPOTENCY_KEY]);
    expect(payloads[0]).toEqual(payloads[1]);
    expect(JSON.parse(readFileSync(settings.historyFile, 'utf8')).txHash).toBe('0x' + 'a'.repeat(64));
    expect(transactionExplorerUrl(recovered.txHash!)).toBe(`https://sepolia.basescan.org/tx/${recovered.txHash}`);
    await expect(executeTestTransfer(client, settings, identity, rpc)).rejects.toThrow(/already completed/);
  });

  it('does not send again while a transaction hash is awaiting independent chain readback', async () => {
    const settings = tempSettings();
    const submitted = { ...initialHistory(identity), attempted: true, status: 'submitted' as const, txHash: (`0x${'b'.repeat(64)}`) as `0x${string}` };
    writeHistoryAtomic(settings.historyFile, submitted);
    const sendTransaction = vi.fn();
    const client = { evm: { getAccount: vi.fn(async () => ({ useNetwork: async () => ({ sendTransaction }) })) } } as unknown as CdpClient;
    const rpc: CdpRpc = { transaction: vi.fn(async () => null), receipt: vi.fn(async () => null) };
    const result = await executeTestTransfer(client, settings, identity, rpc);
    expect(result.status).toBe('submitted');
    expect(sendTransaction).not.toHaveBeenCalled();
  });
});
