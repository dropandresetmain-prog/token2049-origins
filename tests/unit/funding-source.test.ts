import { describe, it, expect } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { FundingSource, SOLANA_DEVNET_NETWORK, SOLANA_DEVNET_USDC_MINT, maskAddress } from '../../src/contracts/presentation.js';
import { NETWORK, TEST_MINT } from '../../src/funding/solana/wire.js';

const CARDANO_ADDRESS = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp';

const cardano = (over: Record<string, unknown> = {}) => ({
  sourceId: 'src_' + 'a'.repeat(32), rail: 'cardano', network: 'cardano:preprod', publicAddress: CARDANO_ADDRESS,
  displayAddress: maskAddress(CARDANO_ADDRESS), assetId: 'lovelace', readiness: 'configured', ...over,
});
async function solana(over: Record<string, unknown> = {}) {
  const payer = (await generateKeyPairSigner()).address;
  return { sourceId: 'src_' + 'b'.repeat(32), rail: 'solana', network: NETWORK, publicAddress: payer, displayAddress: maskAddress(payer), assetId: TEST_MINT, readiness: 'configured', ...over };
}

describe('FundingSource contract', () => {
  it('pins the Solana literals to the funding implementation', () => {
    expect(SOLANA_DEVNET_NETWORK).toBe(NETWORK);
    expect(SOLANA_DEVNET_USDC_MINT).toBe(TEST_MINT);
  });
  it('accepts a valid Cardano Preprod source', () => {
    expect(FundingSource.parse(cardano())).toMatchObject({ rail: 'cardano', network: 'cardano:preprod' });
  });
  it('accepts a valid Solana Devnet source', async () => {
    expect(FundingSource.parse(await solana())).toMatchObject({ rail: 'solana', network: NETWORK, assetId: TEST_MINT });
  });
  it('rejects a Cardano address presented as Solana', async () => {
    expect(FundingSource.safeParse(await solana({ publicAddress: CARDANO_ADDRESS })).success).toBe(false);
  });
  it('rejects a Solana address presented as Cardano', async () => {
    const s = await solana();
    expect(FundingSource.safeParse(cardano({ publicAddress: s.publicAddress })).success).toBe(false);
  });
  it.each([
    ['cardano mainnet', () => cardano({ network: 'cardano:mainnet' })],
    ['cardano on solana network', () => cardano({ network: NETWORK })],
    ['empty network', () => cardano({ network: '' })],
  ])('rejects wrong network: %s', (_n, make) => {
    expect(FundingSource.safeParse(make()).success).toBe(false);
  });
  it('rejects Solana mainnet, a Cardano network and an unsupported mint', async () => {
    expect(FundingSource.safeParse(await solana({ network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' })).success).toBe(false);
    expect(FundingSource.safeParse(await solana({ network: 'cardano:preprod' })).success).toBe(false);
    expect(FundingSource.safeParse(await solana({ assetId: 'lovelace' })).success).toBe(false);
  });
  it('rejects the masumi rail and unknown fields', async () => {
    expect(FundingSource.safeParse(cardano({ rail: 'masumi' })).success).toBe(false);
    expect(FundingSource.safeParse({ ...(await solana()), privateKey: 'x' }).success).toBe(false);
  });
});
