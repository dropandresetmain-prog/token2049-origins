import { describe, expect, it } from 'vitest';
import { XLAYER_EXPLORER_TX_URL, explorerTxUrl } from './explorer.js';

const HASH = '0x' + 'ab12'.repeat(16);

describe('explorerTxUrl', () => {
  it('builds the X Layer test explorer URL for a valid transaction hash', () => {
    expect(XLAYER_EXPLORER_TX_URL).toBe('https://www.okx.com/web3/explorer/xlayer-test/tx/');
    expect(explorerTxUrl('xlayer', HASH)).toBe(`https://www.okx.com/web3/explorer/xlayer-test/tx/${HASH}`);
  });

  it.each([
    ['uppercase hex', '0x' + 'AB12'.repeat(16)],
    ['too short', '0x' + 'a'.repeat(63)],
    ['too long', '0x' + 'a'.repeat(65)],
    ['no prefix', 'a'.repeat(64)],
    ['non-hex', '0x' + 'z'.repeat(64)],
    ['trailing path', HASH + '/../x'],
    ['query injection', HASH + '?next=https://evil.example'],
    ['whitespace', ' ' + HASH],
    ['a fixture reference', 'fixture:matrix-abc'],
    ['empty', ''],
  ])('refuses a reference that is not a transaction hash: %s', (_name, reference) => {
    expect(explorerTxUrl('xlayer', reference)).toBeNull();
  });

  it('has no link for missing references or for other rails', () => {
    expect(explorerTxUrl('xlayer', null)).toBeNull();
    expect(explorerTxUrl('xlayer', undefined)).toBeNull();
    for (const rail of ['cardano', 'solana', 'sui', 'masumi', '', 'toString', '__proto__']) expect(explorerTxUrl(rail, HASH)).toBeNull();
  });
});
