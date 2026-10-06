import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CdpClient } from '@coinbase/cdp-sdk';
import { CDP_CHAIN_ID, CDP_MAX_ACTION_WEI, CDP_NETWORK, CDP_TRANSFER_WEI, validateHistory, validateTransfer } from '../../src/integrations/coinbase-cdp/contracts.js';
import type { CdpPublicIdentity, CdpSettings } from '../../src/integrations/coinbase-cdp/contracts.js';
import { makeAccountPolicy } from '../../src/integrations/coinbase-cdp/client.js';
import { provision } from '../../src/integrations/coinbase-cdp/client.js';
import { sanitizeCliError } from '../../src/integrations/coinbase-cdp/errors.js';
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
    expect(policy.rules.slice(1).map((rule) => [rule.action, rule.operation, rule.criteria])).toEqual([
      ['reject', 'sendEvmTransaction', []], ['reject', 'signEvmTransaction', []], ['reject', 'signEvmMessage', []], ['reject', 'signEvmTypedData', []], ['reject', 'signEvmHash', []],
    ]);
  });

  it('creates action history exclusively and refuses changed identities or limits', () => {
    const settings = tempSettings();
    const history = createHistoryOnce(settings.historyFile, identity);
    expect(readHistory(settings.historyFile, identity)).toEqual(history);
    expect(history.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(() => validateHistory({ ...history, maxTotalWei: '999' }, identity)).toThrow(/limits changed/);
    expect(() => validateHistory({ ...history, txHash: 'malformed' as `0x${string}` }, identity)).toThrow(/transaction hash is invalid/);
    expect(() => createHistoryOnce(settings.historyFile, { ...identity, treasuryAddress: '0x3333333333333333333333333333333333333333' })).toThrow(/identity changed/);
    writeFileSync(settings.historyFile, JSON.stringify({ ...history, txHash: 'malformed' }));
    expect(() => readHistory(settings.historyFile, identity)).toThrow(/transaction hash is invalid/);
    writeFileSync(settings.historyFile, '{corrupt');
    expect(() => readHistory(settings.historyFile, identity)).toThrow(/unavailable or corrupt/);
  });

  it('holds unknown reservations without a transaction hash and never submits again', async () => {
    const settings = tempSettings();
    createHistoryOnce(settings.historyFile, identity);
    const keys: string[] = [];
    const payloads: unknown[] = [];
    const sendTransaction = vi.fn(async (request: { idempotencyKey: string; transaction: unknown }) => {
      keys.push(request.idempotencyKey);
      payloads.push(request.transaction);
      throw new Error('sensitive CDP response must not escape');
    });
    const account = {
      useNetwork: vi.fn(async (_rpcUrl: string) => ({
        sendTransaction,
      })),
    };
    const client = { evm: { getAccount: vi.fn(async () => account) } } as unknown as CdpClient;
    const rpc: CdpRpc = {
      assertNetwork: vi.fn(async () => {}),
      transaction: vi.fn(async () => ({ from: identity.treasuryAddress, to: identity.recipientAddress, value: `0x${CDP_TRANSFER_WEI.toString(16)}`, chainId: `0x${CDP_CHAIN_ID.toString(16)}` })),
      receipt: vi.fn(async () => ({ status: '0x1', transactionHash: '0x' + 'a'.repeat(64) })),
    };

    let resultError: unknown;
    try { await executeTestTransfer(client, settings, identity, rpc); } catch (error) { resultError = error; }
    expect(resultError).toBeInstanceOf(Error);
    expect((resultError as Error).message).toMatch(/Do not retry or resend/);
    expect((resultError as Error).message).toMatch(/read-only operator reconciliation/);
    const unknown = readHistory(settings.historyFile, identity);
    expect(unknown.status).toBe('unknown');
    expect(unknown.attempted).toBe(true);
    expect(JSON.stringify(unknown)).not.toContain('sensitive CDP response');

    await expect(executeTestTransfer(client, settings, identity, rpc)).rejects.toThrow(/unknown without a transaction hash/);
    expect(sendTransaction).toHaveBeenCalledTimes(1);
    expect(keys).toHaveLength(1);
    expect(payloads).toHaveLength(1);
    expect(JSON.stringify(readHistory(settings.historyFile, identity))).not.toContain('sensitive CDP response');
  });

  it('does not send again while a transaction hash is awaiting independent chain readback', async () => {
    const settings = tempSettings();
    createHistoryOnce(settings.historyFile, identity);
    const submitted = { ...initialHistory(identity), attempted: true, status: 'submitted' as const, txHash: (`0x${'b'.repeat(64)}`) as `0x${string}` };
    writeHistoryAtomic(settings.historyFile, submitted);
    const sendTransaction = vi.fn();
    const client = { evm: { getAccount: vi.fn(async () => ({ useNetwork: async () => ({ sendTransaction }) })) } } as unknown as CdpClient;
    const rpc: CdpRpc = { assertNetwork: vi.fn(async () => {}), transaction: vi.fn(async () => null), receipt: vi.fn(async () => null) };
    const result = await executeTestTransfer(client, settings, identity, rpc);
    expect(result.status).toBe('submitted');
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it('verifies Base Sepolia through the configured RPC before reserving or sending', async () => {
    const settings = tempSettings();
    const initial = createHistoryOnce(settings.historyFile, identity);
    const sendTransaction = vi.fn();
    const client = { evm: { getAccount: vi.fn(async () => ({ useNetwork: vi.fn(async () => ({ sendTransaction })) })) } } as unknown as CdpClient;
    const rpc: CdpRpc = {
      assertNetwork: vi.fn(async () => { throw new Error('wrong network'); }),
      transaction: vi.fn(async () => null),
      receipt: vi.fn(async () => null),
    };
    await expect(executeTestTransfer(client, settings, identity, rpc)).rejects.toThrow(/wrong network/);
    expect(sendTransaction).not.toHaveBeenCalled();
    expect(readHistory(settings.historyFile, identity)).toEqual(initial);
  });

  it('blocks provisioning when an existing public identity has lost its history before any API call', async () => {
    const settings = tempSettings();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(settings.identityFile, JSON.stringify(identity));
    const createAccount = vi.fn();
    const client = { evm: { createAccount } } as unknown as CdpClient;
    await expect(provision(client, settings)).rejects.toThrow(/history is missing/);
    expect(createAccount).not.toHaveBeenCalled();
  });

  it('refuses to attach a Capsule policy to a treasury with existing policy authority', async () => {
    const settings = tempSettings();
    const createAccount = vi.fn(async ({ name }: { name: string }) => name === identity.treasuryName
      ? { address: identity.treasuryAddress, policies: ['pre-existing-policy'] }
      : { address: identity.recipientAddress, policies: [] });
    const createPolicy = vi.fn();
    const client = { evm: { createAccount }, policies: { createPolicy } } as unknown as CdpClient;
    await expect(provision(client, settings)).rejects.toThrow(/already has an attached policy/);
    expect(createPolicy).not.toHaveBeenCalled();
  });

  it('suppresses provider exception text that may contain credentials', () => {
    expect(sanitizeCliError(new Error('Authorization: bearer-secret-123'))).not.toContain('bearer-secret-123');
    expect(sanitizeCliError(new Error('Authorization: bearer-secret-123'))).toMatch(/provider details were suppressed/);
  });
});
