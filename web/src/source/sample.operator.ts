/**
 * Sample operator data: illustrative Treasury and Connections responses in the gateway's own shapes.
 *
 * Validated with the same schemas as the live reads when built, so a sample the gateway could not produce fails
 * fast. Nothing here is a real balance, bank observation or readiness check. The sample deliberately has a
 * refund obligation, partly used capacity and a mix of readiness states so every presentation path is visible.
 */
import { CapabilitiesResponse } from '../contracts/backend.js';
import { BankResponse, TreasuryResponse } from '../contracts/operator.js';
import type { ConnectionsData } from '../contracts/source.js';

const CARDANO_TEST = 'cardano:preprod/lovelace';
const SOLANA_TEST = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1/SampleMint1111111111111111111111111111111111';
const USD = 'fiat:USD/2';

export function sampleTreasury(): TreasuryResponse {
  return TreasuryResponse.parse({
    note: 'Sample data. Not a real ledger.',
    ledger: {
      balanced: true,
      trialBalance: [
        { ledgerMode: 'observed', asset: CARDANO_TEST, debitTotal: '412500000', creditTotal: '412500000', net: '0', balanced: true },
        { ledgerMode: 'observed', asset: SOLANA_TEST, debitTotal: '86000000', creditTotal: '86000000', net: '0', balanced: true },
        { ledgerMode: 'simulated', asset: USD, debitTotal: '98400', creditTotal: '98400', net: '0', balanced: true },
      ],
      accounts: [
        { account: 'assets:crypto_treasury', asset: CARDANO_TEST, ledgerMode: 'observed', balanceDebitPositive: '412500000', normalSide: 'debit' },
        { account: 'assets:crypto_treasury', asset: SOLANA_TEST, ledgerMode: 'observed', balanceDebitPositive: '86000000', normalSide: 'debit' },
        { account: 'liabilities:customer_prepayment', asset: CARDANO_TEST, ledgerMode: 'observed', balanceDebitPositive: '-120000000', normalSide: 'credit' },
        { account: 'liabilities:customer_prepayment', asset: SOLANA_TEST, ledgerMode: 'observed', balanceDebitPositive: '-30000000', normalSide: 'credit' },
        { account: 'income:purchase_principal_applied', asset: CARDANO_TEST, ledgerMode: 'observed', balanceDebitPositive: '-280000000', normalSide: 'credit' },
        { account: 'income:service_fee', asset: CARDANO_TEST, ledgerMode: 'observed', balanceDebitPositive: '-12500000', normalSide: 'credit' },
        { account: 'income:purchase_principal_applied', asset: SOLANA_TEST, ledgerMode: 'observed', balanceDebitPositive: '-56000000', normalSide: 'credit' },
        { account: 'simulated:merchant_purchases', asset: USD, ledgerMode: 'simulated', balanceDebitPositive: '98400', normalSide: 'debit' },
        { account: 'simulated:card_payable', asset: USD, ledgerMode: 'simulated', balanceDebitPositive: '-83400', normalSide: 'credit' },
        { account: 'simulated:provider_test_balance_used', asset: USD, ledgerMode: 'simulated', balanceDebitPositive: '-15000', normalSide: 'credit' },
      ],
    },
    simulatedCapacity: [
      {
        ledgerMode: 'simulated',
        label: 'SIMULATED synthetic purchasing capacity: not a bank balance and not an OCBC observation',
        currency: 'USD',
        scale: 2,
        limitMinor: '500000',
        reservedMinor: '64200',
        cardPayableMinor: '83400',
        providerTestBalanceUsedMinor: '15000',
        availableMinor: '337400',
      },
    ],
    purchasesByState: { awaiting_funding: 1, executing: 1, succeeded: 5, failed: 1, expired: 2 },
    obligations: {
      ledgerMode: 'observed',
      note: 'Amounts owed to customers in funding-asset base units. An obligation is a liability record, not a payment instruction.',
      unappliedByAsset: { [CARDANO_TEST]: '5000000' },
      refundDueByAsset: { [CARDANO_TEST]: '48000000' },
      prepaymentOutstandingByAsset: { [CARDANO_TEST]: '120000000', [SOLANA_TEST]: '30000000' },
    },
    reservations: [
      { status: 'active', currency: 'USD', scale: 2, count: 2, totalMinor: '64200', ledgerMode: 'simulated' },
      { status: 'consumed', currency: 'USD', scale: 2, count: 5, totalMinor: '98400', ledgerMode: 'simulated' },
      { status: 'released', currency: 'USD', scale: 2, count: 3, totalMinor: '41000', ledgerMode: 'simulated' },
    ],
  });
}

export function sampleConnections(now: number): ConnectionsData {
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const ready = (component: string, status: string, environment: string, extra: { missing?: string[]; detail?: string } = {}) => ({
    component,
    status,
    environment,
    missing: extra.missing ?? [],
    ...(extra.detail ? { detail: extra.detail } : {}),
    checkedAt: at(3),
  });
  const ocbc = ready('ocbc', 'EXTERNAL_CHECK_PASSED', 'sandbox', {
    detail: 'Sample readiness. The adapter is read-only and sandbox data is historical.',
  });
  const capabilities = CapabilitiesResponse.parse({
    contractVersion: 'v1',
    appEnv: 'sandbox',
    routes: [
      { route: 'shopify', category: 'retail', readiness: ready('shopify', 'EXTERNAL_CHECK_PASSED', 'sandbox') },
      { route: 'nuitee', category: 'hotel', readiness: ready('nuitee', 'LOCAL_TESTS_ONLY', 'sandbox', { missing: ['NUITEE_API_KEY'] }) },
      { route: 'atlas', category: 'flight', readiness: ready('atlas', 'ACCESS_BLOCKED', 'sandbox', { detail: 'Sample: the sandbox account is not enabled for booking.' }) },
    ],
    fundingRails: [
      { rail: 'cardano', readiness: ready('cardano', 'EXTERNAL_CHECK_PASSED', 'cardano:preprod') },
      { rail: 'solana', readiness: ready('solana', 'CONFIGURED_UNVERIFIED', 'solana-devnet') },
      { rail: 'masumi', readiness: ready('masumi', 'ACCESS_BLOCKED', 'sandbox', { detail: 'Sample: service-fee verification only.' }) },
    ],
    banking: [ocbc],
    operations: ['find_offers', 'create_quote', 'buy', 'get_purchase'],
  });
  const money = (minor: string) => ({ currency: 'SGD', amountMinor: minor, scale: 2 });
  const caveats = ['OCBC developer-sandbox data is historical test data.'];
  const bank = BankResponse.parse({
    note: 'Observations of external bank/card state. They are stored facts with provenance, separate from the gateway journal and from simulated card capacity; they do not show that any gateway purchase reached the bank.',
    adapters: [ocbc],
    observations: [
      {
        id: 'obs_sample_balance', bank: 'ocbc', kind: 'account_balance', maskedReference: '****3456', currency: 'SGD',
        amount: money('1250000'), availableAmount: money('1198000'), environment: 'sandbox', source: 'ocbc:sandbox:corporateAccountListing/1.0',
        providerTimestamp: null, observedAt: at(22), caveats, provenance: { environment: 'sandbox', evidenceMode: 'fresh_external' },
      },
      {
        id: 'obs_sample_card', bank: 'ocbc', kind: 'card_summary', maskedReference: '****7788', currency: 'SGD',
        amount: money('84250'), availableAmount: money('915750'), environment: 'sandbox', source: 'ocbc:sandbox:creditcardlisting/1.0',
        providerTimestamp: null, observedAt: at(22), caveats, provenance: { environment: 'sandbox', evidenceMode: 'fresh_external' },
      },
      {
        id: 'obs_sample_tx', bank: 'ocbc', kind: 'account_transaction', maskedReference: '****3456', currency: 'SGD',
        amount: money('4500'), availableAmount: null, environment: 'sandbox', source: 'ocbc:sandbox:accounttransactionhistory/1.0',
        providerTimestamp: at(60 * 24 * 40), observedAt: at(22), caveats, provenance: { environment: 'sandbox', evidenceMode: 'fresh_external' },
      },
    ],
  });
  return { capabilities, bank };
}
