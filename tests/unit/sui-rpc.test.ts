import { describe, expect, it, vi } from 'vitest';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { SuiRpc } from '../../src/funding/sui/rpc.js';
import { SUI_TYPE, USDC_TYPE, TESTNET_GENESIS } from '../../src/funding/sui/config.js';
import { makeSuiCandidate, suiInput } from '../support/sui.js';

async function objectsFixture() {
  const candidate = await makeSuiCandidate(suiInput());
  const data = Transaction.from(candidate.bytes).getData();
  const refs = [data.inputs.find(i => i.Object)?.Object!.ImmOrOwnedObject!, data.gasData.payment![0]!];
  const objects = refs.map((ref, index) => ({ ...ref, owner: { $kind: 'AddressOwner', AddressOwner: candidate.payer },
    type: `0x2::coin::Coin<${index === 0 ? USDC_TYPE : SUI_TYPE}>` }));
  const getObjects = vi.fn(async () => ({ objects }));
  return { candidate, objects, getObjects, rpc: new SuiRpc({ getObjects } as unknown as SuiGrpcClient) };
}

describe('Sui independent RPC validation', () => {
  it('checks current token and gas object ownership, types and exact references', async () => {
    const s = await objectsFixture();
    await expect(s.rpc.assertPaymentObjects(s.candidate.bytes)).resolves.toBeUndefined();
    expect(s.getObjects.mock.calls).toHaveLength(1);
  });

  it.each(['owner', 'type', 'version', 'digest', 'objectId', 'gasType', 'missing'] as const)('rejects altered %s from independent object readback', async field => {
    const s = await objectsFixture();
    if (field === 'missing') s.objects.pop();
    else if (field === 'owner') s.objects[0]!.owner.AddressOwner = '0x' + 'c'.repeat(64);
    else if (field === 'type') s.objects[0]!.type = `0x2::coin::Coin<${SUI_TYPE}>`;
    else if (field === 'gasType') s.objects[1]!.type = `0x2::coin::Coin<${USDC_TYPE}>`;
    else s.objects[0]![field] = field === 'version' ? '2' : '0x' + 'd'.repeat(64);
    await expect(s.rpc.assertPaymentObjects(s.candidate.bytes)).rejects.toThrow(/objects unavailable|ownership, type or version mismatch/);
  });

  it.each([
    ['1000', '10000000', true], ['999', '10000000', false], ['1000', '9999999', false],
  ])('independently verifies address USDC %s and gas %s balances', async (token, gas, valid) => {
    const candidate = await makeSuiCandidate(suiInput(), { commands: 'balance', gasAddressBalance: true, validity: {} });
    const getObjects = vi.fn(async () => { throw new Error('empty object request forbidden'); });
    const getBalance = vi.fn(async ({ coinType }: { coinType: string }) => ({ balance: { addressBalance: coinType === USDC_TYPE ? token : gas } }));
    const rpc = new SuiRpc({ getObjects, getBalance } as unknown as SuiGrpcClient);
    if (valid) await expect(rpc.assertPaymentObjects(candidate.bytes)).resolves.toBeUndefined();
    else await expect(rpc.assertPaymentObjects(candidate.bytes)).rejects.toThrow(/address balance insufficient/);
    expect(getObjects).not.toHaveBeenCalled();
  });

  it('rejects a mainnet or other genesis independently of configured network labels', async () => {
    const rpc = new SuiRpc({ getChainIdentifier: async () => ({ chainIdentifier: 'wrong-network' }) } as unknown as SuiGrpcClient);
    await expect(rpc.assertNetwork()).rejects.toThrow(/genesis mismatch/);
  });

  it.each([5, 9])('rejects USDC metadata with %s decimals', async decimals => {
    const rpc = new SuiRpc({ getCoinMetadata: async () => ({ coinMetadata: { decimals, symbol: 'USDC' } }) } as unknown as SuiGrpcClient);
    await expect(rpc.assertAsset()).rejects.toThrow(/mismatched/);
  });

  it('keeps read timeouts distinct from authoritative transaction absence', async () => {
    const getTransaction = vi.fn().mockRejectedValueOnce({ code: 'NOT_FOUND' }).mockRejectedValueOnce(new Error('timeout'));
    const rpc = new SuiRpc({ getTransaction } as unknown as SuiGrpcClient);
    await expect(rpc.transaction('digest')).resolves.toBeNull();
    await expect(rpc.transaction('digest')).rejects.toThrow(/read unavailable/);
  });

  it('accepts independently returned official testnet identity', async () => {
    const rpc = new SuiRpc({ getChainIdentifier: async () => ({ chainIdentifier: TESTNET_GENESIS }) } as unknown as SuiGrpcClient);
    await expect(rpc.assertNetwork()).resolves.toBeUndefined();
  });
});
