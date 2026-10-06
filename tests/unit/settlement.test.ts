import { describe, expect, it } from 'vitest';
import { demoData, DemoConfig, demoDate, loadDemoConfig } from '../../src/demo/config.js';
import { money } from '../../src/contracts/money.js';
import { FundingOption } from '../../src/contracts/commerce.js';
import { settlementBaseUnits, SettlementPolicy, validateSettlement } from '../../src/contracts/settlement.js';

describe('exact testnet notional settlement', () => {
  it.each([['100', '1000'], ['1000', '10000'], ['18340', '183400'], ['12347', '123470'], ['0', '0'], ['50000', '500000']])
  ('USD minor %s produces exactly %s base units', (cents, units) => {
    expect(settlementBaseUnits(money('USD', cents), 6, demoData.settlementPolicy)).toBe(BigInt(units));
  });
  it('rejects unsupported currency and precision instead of rounding obligations', () => {
    expect(() => settlementBaseUnits(money('EUR', '18340'), 6, demoData.settlementPolicy)).toThrow('USD');
    expect(() => settlementBaseUnits(money('USD', '1'), 4, demoData.settlementPolicy)).toThrow('exactly');
    expect(() => settlementBaseUnits(money('USD', '1', 3), 6, demoData.settlementPolicy)).toThrow('USD');
    expect(SettlementPolicy.safeParse({ mode: 'scaled_testnet', numerator: 1, denominator: 999 }).success).toBe(false);
  });
  it('checks the commercial sum, fee allocation and total chain amount', () => {
    const s = { policy: demoData.settlementPolicy, commercialPrincipal: money('USD', '10000'), commercialServiceFee: money('USD', '100'), commercialTotal: money('USD', '10100'), principalBaseUnits: '100000', feeBaseUnits: '1000', totalBaseUnits: '101000' };
    expect(validateSettlement(s, 6)).toEqual(s);
    expect(() => validateSettlement({ ...s, feeBaseUnits: '1000000' }, 6)).toThrow();
    const opt = { rail: 'cardano', payTo: 'test', amount: { network: 'cardano:preprod', assetId: 'test', decimals: 6, amountBaseUnits: '101001' }, settlement: s };
    expect(FundingOption.safeParse(opt).success).toBe(false);
  });
});

describe('canonical demo boundary', () => {
  it('has one strict secret-free data schema and derives relative dates', () => {
    expect(DemoConfig.parse(demoData)).toEqual(demoData);
    expect(() => loadDemoConfig({ ...demoData, apiKey: 'forbidden' })).toThrow();
    expect(() => loadDemoConfig({ ...demoData, retail: { ...demoData.retail, endpoint: 'forbidden' } })).toThrow();
    expect(demoDate(30, new Date('2030-01-01T00:00:00Z'))).toBe('2030-01-31');
  });
});
