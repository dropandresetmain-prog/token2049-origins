import { describe, it, expect } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { FundingSource, SOLANA_DEVNET_NETWORK, SOLANA_DEVNET_USDC_MINT, SUI_TESTNET_NETWORK, SUI_TESTNET_USDC_TYPE, XLAYER_TESTNET_NETWORK, XLAYER_TESTNET_USDT0, maskAddress } from '../../src/contracts/presentation.js';
import { NETWORK, TEST_MINT } from '../../src/funding/solana/wire.js';
import { NETWORK as XLAYER_NETWORK, TOKEN as XLAYER_TOKEN } from '../../src/funding/xlayer/config.js';
import { PAYER_FORMAT } from '../../src/evidence/proof.js';
import { fundingEnvironment } from '../../src/evidence/read-model.js';

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

const EVM_ADDRESS = '0x71c7656ec7ab88b098defb751b7401b5f6d8976f';
const SUI_ADDRESS = '0x' + 'a'.repeat(64);
const xlayer = (over: Record<string, unknown> = {}) => ({
  sourceId: 'src_' + 'c'.repeat(32), rail: 'xlayer', network: XLAYER_TESTNET_NETWORK, publicAddress: EVM_ADDRESS,
  displayAddress: maskAddress(EVM_ADDRESS), assetId: XLAYER_TESTNET_USDT0, readiness: 'configured', ...over,
});
const sui = (over: Record<string, unknown> = {}) => ({
  sourceId: 'src_' + 'd'.repeat(32), rail: 'sui', network: SUI_TESTNET_NETWORK, publicAddress: SUI_ADDRESS,
  displayAddress: maskAddress(SUI_ADDRESS), assetId: SUI_TESTNET_USDC_TYPE, readiness: 'configured', ...over,
});

describe('X Layer FundingSource contract', () => {
  it('pins the X Layer literals to the funding implementation', () => {
    expect(XLAYER_TESTNET_NETWORK).toBe(XLAYER_NETWORK);
    expect(XLAYER_TESTNET_USDT0).toBe(XLAYER_TOKEN);
  });
  it('accepts a valid X Layer Testnet source with a lowercase EVM address', () => {
    expect(FundingSource.parse(xlayer())).toMatchObject({ rail: 'xlayer', network: 'eip155:1952', assetId: XLAYER_TESTNET_USDT0 });
  });
  it('rejects uppercase and EIP-55 checksummed addresses (canonical form is lowercase)', () => {
    expect(FundingSource.safeParse(xlayer({ publicAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' })).success).toBe(false);
    expect(FundingSource.safeParse(xlayer({ publicAddress: EVM_ADDRESS.toUpperCase().replace('0X', '0x') })).success).toBe(false);
  });
  it.each([
    ['too short', '0x' + 'a'.repeat(39)],
    ['too long', '0x' + 'a'.repeat(41)],
    ['no prefix', 'a'.repeat(40)],
    ['non-hex', '0x' + 'g'.repeat(40)],
  ])('rejects a malformed EVM address: %s', (_n, publicAddress) => {
    expect(FundingSource.safeParse(xlayer({ publicAddress })).success).toBe(false);
  });
  it('rejects the wrong network or asset', () => {
    expect(FundingSource.safeParse(xlayer({ network: 'eip155:196' })).success).toBe(false);
    expect(FundingSource.safeParse(xlayer({ network: 'eip155:1' })).success).toBe(false);
    expect(FundingSource.safeParse(xlayer({ network: SUI_TESTNET_NETWORK })).success).toBe(false);
    expect(FundingSource.safeParse(xlayer({ assetId: '0x' + '1'.repeat(40) })).success).toBe(false);
    expect(FundingSource.safeParse(xlayer({ assetId: XLAYER_TESTNET_USDT0.toUpperCase().replace('0X', '0x') })).success).toBe(false);
    expect(FundingSource.safeParse(xlayer({ assetId: 'lovelace' })).success).toBe(false);
  });
  it('rejects an EVM address presented as Cardano, Solana or Sui', async () => {
    expect(FundingSource.safeParse(cardano({ publicAddress: EVM_ADDRESS })).success).toBe(false);
    expect(FundingSource.safeParse(await solana({ publicAddress: EVM_ADDRESS })).success).toBe(false);
    expect(FundingSource.safeParse(sui({ publicAddress: EVM_ADDRESS })).success).toBe(false);
  });
  it('rejects Cardano, Solana and Sui addresses presented as X Layer', async () => {
    expect(FundingSource.safeParse(xlayer({ publicAddress: CARDANO_ADDRESS })).success).toBe(false);
    expect(FundingSource.safeParse(xlayer({ publicAddress: (await solana()).publicAddress })).success).toBe(false);
    expect(FundingSource.safeParse(xlayer({ publicAddress: SUI_ADDRESS })).success).toBe(false);
  });
  it('rejects X Layer network or asset on another rail', async () => {
    expect(FundingSource.safeParse(sui({ network: XLAYER_TESTNET_NETWORK })).success).toBe(false);
    expect(FundingSource.safeParse(await solana({ network: XLAYER_TESTNET_NETWORK })).success).toBe(false);
    expect(FundingSource.safeParse(await solana({ assetId: XLAYER_TESTNET_USDT0 })).success).toBe(false);
  });
  it('rejects unknown fields on an X Layer source', () => {
    expect(FundingSource.safeParse({ ...xlayer(), privateKey: 'x' }).success).toBe(false);
  });
});

describe('evidence projection for X Layer', () => {
  it('shows a payer only in lowercase EVM address form', () => {
    expect(PAYER_FORMAT['xlayer']!.test(EVM_ADDRESS)).toBe(true);
    expect(PAYER_FORMAT['xlayer']!.test('0x71C7656EC7ab88b098defB751B7401B5f6d8976F')).toBe(false);
    expect(PAYER_FORMAT['xlayer']!.test('0x' + 'a'.repeat(64))).toBe(false);
    expect(PAYER_FORMAT['xlayer']!.test(CARDANO_ADDRESS)).toBe(false);
  });
  it('does not show an EVM address as the payer of another rail, nor another rail payer for X Layer', () => {
    for (const rail of ['cardano', 'solana', 'sui']) expect(PAYER_FORMAT[rail]!.test(EVM_ADDRESS)).toBe(false);
    expect(PAYER_FORMAT['xlayer']!.test(SUI_ADDRESS)).toBe(false);
  });
  it('labels eip155:1952 as xlayer-testnet for external evidence and keeps fixtures anonymous', () => {
    expect(fundingEnvironment('eip155:1952', 'fresh_external')).toBe('xlayer-testnet');
    expect(fundingEnvironment('eip155:1952', 'local_fixture')).toBe('fixture');
    expect(fundingEnvironment('eip155:196', 'fresh_external')).toBe('eip155:196');
  });
});
