/**
 * User-facing strings for the operator screens (Treasury and Connections).
 *
 * These screens are for the person running the gateway, not for the person whose assistant made a purchase, so
 * they may say "capacity", "ledger" and "simulated". Everything else in docs/design/VOCABULARY.md still applies:
 * plain sentences, no em or en dashes, at most one middle dot per line, and never claim more than the data proves.
 *
 * Three claims these screens must never make, whatever the data says:
 * - test crypto is bank cash;
 * - simulated purchasing capacity is a bank or card balance;
 * - an OCBC observation shows that a Capsule purchase reached a bank or card account.
 */
import type { Readiness } from '../contracts/backend.js';
import type { Tone } from './en.js';

export const nav = {
  group: 'Operator',
  treasury: 'Treasury',
  connections: 'Connections',
  crumb: 'Operator',
  treasuryTitle: 'Treasury',
  connectionsTitle: 'Connections',
};

export const gate = {
  loadingTreasury: 'Loading treasury',
  loadingConnections: 'Loading connections',
  deniedTitle: 'Operator access required',
  deniedBody: "This access key can't open operator pages. Your purchases and proof are not affected.",
  reload: 'Reload',
  reloading: 'Reloading',
  back: 'Back to purchases',
};

/* ---------------- Treasury ---------------- */

export const treasury = {
  heading: 'Treasury',
  subhead: 'What the gateway has recorded: observed test funds and simulated purchasing capacity, kept apart.',
  separationTitle: 'Two ledgers, never added together',
  separationBody:
    'Observed amounts are test crypto the gateway verified on a test network. Simulated amounts are a synthetic purchasing allowance. Test crypto is not bank cash, and the allowance is not a bank or card balance.',
  readonlyNote: 'This page reads stored records. It does not move money or contact any bank or provider.',

  health: {
    title: 'Ledger health',
    balanced: 'Balanced',
    unbalanced: 'Out of balance',
    balancedDetail: 'Every asset nets to zero across the journal.',
    unbalancedDetail: 'At least one asset does not net to zero. Treat these figures with caution and check the journal.',
    ledgerColumn: 'Ledger',
    assetColumn: 'Asset',
    debitColumn: 'Debits',
    creditColumn: 'Credits',
    netColumn: 'Net',
    statusColumn: 'Status',
    rowBalanced: 'Balanced',
    rowUnbalanced: 'Out of balance',
    empty: 'No journal entries yet.',
    tableLabel: 'Trial balance by ledger and asset',
  },

  observed: {
    title: 'Observed test funds',
    badge: 'Observed',
    intro: 'Test crypto the gateway verified on a test network, and what it owes customers for it. No cash value.',
    accountsTitle: 'Observed accounts',
    accountColumn: 'Account',
    assetColumn: 'Asset',
    balanceColumn: 'Balance',
    sideColumn: 'Side',
    accountsEmpty: 'No observed funds recorded yet.',
    accountsLabel: 'Observed ledger accounts',
  },

  obligations: {
    title: 'Owed to customers',
    intro:
      'Funds customers sent for purchases, in the asset they sent. A liability record, not a payment instruction. Nothing in this system refunds them.',
    assetColumn: 'Asset',
    prepaymentColumn: 'Held for purchases',
    unappliedColumn: 'Not yet applied',
    refundColumn: 'Refund due',
    refundHint: 'Refund due is the part held for purchases that failed, expired or need a new approval.',
    none: 'None',
    empty: 'No customer obligations recorded.',
    tableLabel: 'Customer obligations by asset',
  },

  simulated: {
    title: 'Simulated purchasing capacity',
    badge: 'Simulated',
    intro: 'A synthetic allowance that limits how much the gateway will spend on test purchases. It is not a bank or card balance.',
    limit: 'Capacity limit',
    available: 'Available',
    reserved: 'Reserved',
    consumed: 'Consumed',
    providerTest: 'Provider test balance used',
    reservedHint: 'Held for purchases still in progress.',
    consumedHint: 'Simulated card spend for purchases that went through.',
    providerTestHint: "Paid from a provider's test balance, not from the card allowance.",
    availableHint: 'Limit minus everything above.',
    barLabel: (currency: string) => `${currency} capacity split`,
    overspent: 'Recorded use is above the limit.',
    empty: 'No capacity pool is configured.',
    reservationsTitle: 'Reservations',
    statusColumn: 'Status',
    countColumn: 'Purchases',
    totalColumn: 'Amount',
    reservationsLabel: 'Capacity reservations by status',
    accountsTitle: 'Simulated accounts',
    accountsEmpty: 'No simulated entries yet.',
    accountsLabel: 'Simulated ledger accounts',
  },

  purchases: {
    title: 'Purchases by state',
    total: (n: number) => (n === 1 ? '1 purchase in total' : `${n} purchases in total`),
    empty: 'No purchases yet.',
  },

  technical: {
    summary: 'Technical details',
    note: 'The treasury response as the console read it. For support and audit.',
  },

  /** Side of the ledger a balance sits on. */
  side: { debit: 'Debit balance', credit: 'Credit balance' },
};

export const accountLabel: Record<string, string> = {
  'assets:crypto_treasury': 'Test crypto held in treasury',
  'liabilities:customer_prepayment': 'Owed to customers: held for purchases',
  'liabilities:customer_unapplied': 'Owed to customers: not yet applied',
  'income:purchase_principal_applied': 'Purchase amounts applied',
  'income:service_fee': 'Service fees earned',
  'simulated:merchant_purchases': 'Simulated merchant purchases',
  'simulated:card_payable': 'Simulated card payable',
  'simulated:provider_test_balance_used': 'Provider test balance used',
};

export const ledgerLabel: Record<'observed' | 'simulated', string> = { observed: 'Observed', simulated: 'Simulated' };

export const reservationStatus: Record<string, string> = {
  active: 'Held for purchases in progress',
  consumed: 'Used by completed purchases',
  released: 'Released back to capacity',
  held_unresolved: 'Held, outcome unresolved',
};

export const purchaseState: Record<string, { label: string; tone: Tone }> = {
  awaiting_funding: { label: 'Awaiting payment', tone: 'pending' },
  funded_queued: { label: 'Paid, queued', tone: 'progress' },
  executing: { label: 'Ordering', tone: 'progress' },
  succeeded: { label: 'Completed', tone: 'positive' },
  failed: { label: 'Failed', tone: 'attention' },
  unresolved: { label: 'Unresolved', tone: 'attention' },
  requires_reauthorization: { label: 'Needs a new approval', tone: 'attention' },
  expired: { label: 'Expired', tone: 'neutral' },
};

export const asset = {
  /** "Cardano test network" / "Solana test network"; the word "test" only when the network id says so. */
  network: (family: 'cardano' | 'solana', test: boolean) => `${family === 'cardano' ? 'Cardano' : 'Solana'}${test ? ' test' : ''} network`,
  token: (test: boolean) => (test ? 'test tokens' : 'tokens'),
  ada: (test: boolean) => (test ? 'test ADA' : 'ADA'),
  usdm: (test: boolean) => (test ? 'test USDM' : 'USDM'),
  baseUnits: 'base units',
  simulatedFiat: (currency: string) => `${currency} (simulated)`,
};

/* ---------------- Connections ---------------- */

export const connections = {
  heading: 'Connections',
  subhead: 'What each integration reports about itself right now.',
  caveat:
    'Readiness is what the gateway last checked. It is not a guarantee that a purchase will succeed, and it is not proof of any past purchase.',
  reloadHint: 'Reload re-reads stored data. It does not contact the bank or any provider.',
  notReported: 'Not reported by this gateway',
  notReportedDetail: 'This gateway did not list this integration.',
  environment: 'Environment',
  checked: 'Checked',
  missingTitle: 'Missing settings',
  noteTitle: 'Detail',
  technical: { summary: 'Technical details', note: 'The readiness and bank responses as the console read them. For support and audit.' },
  groups: {
    funding: { title: 'Payments in', intro: 'Where customers pay from. Test networks only unless the environment says otherwise.' },
    merchants: { title: 'Merchants', intro: 'Where the gateway places orders and bookings.' },
    bank: { title: 'Bank observation', intro: 'Read-only view of a bank. Observation only.' },
  },
};

export const integration: Record<string, { name: string; role: string }> = {
  cardano: { name: 'Cardano', role: 'Receives test-token payments on Cardano' },
  solana: { name: 'Solana', role: 'Receives test-token payments on Solana' },
  masumi: { name: 'Masumi', role: 'Agent payments and service fees through Masumi' },
  shopify: { name: 'Shopify', role: 'Test store orders' },
  nuitee: { name: 'Nuitée', role: 'Hotel bookings' },
  atlas: { name: 'Atlas', role: 'Flight bookings' },
  ocbc: { name: 'OCBC', role: 'Read-only view of sandbox accounts and cards' },
};

export const readiness: Record<Readiness['status'], { label: string; tone: Tone }> = {
  EXTERNAL_CHECK_PASSED: { label: 'External check passed', tone: 'positive' },
  CONFIGURED_UNVERIFIED: { label: 'Configured, not verified', tone: 'pending' },
  MISSING_CONFIG: { label: 'Not configured', tone: 'neutral' },
  ACCESS_BLOCKED: { label: 'Access blocked', tone: 'attention' },
  LOCAL_TESTS_ONLY: { label: 'Local tests only', tone: 'neutral' },
};

export const environmentLabel = {
  sandbox: 'Sandbox',
  test: 'Test network',
  production: 'Production',
};

/* ---------------- OCBC observations ---------------- */

export const ocbc = {
  title: 'OCBC sandbox observations',
  badge: 'Observation only',
  banner:
    'Read-only observations of OCBC sandbox data, stored with where they came from. They are not purchase settlement, not treasury truth, and they do not show that any Capsule purchase reached a bank or card account.',
  historical: 'OCBC sandbox data is historical test data.',
  balancesTitle: 'Accounts and cards',
  transactionsTitle: 'Transactions',
  empty: 'No bank observations are stored yet. They are loaded outside this console, which only shows what is already stored.',
  emptyTransactions: 'No transactions are stored.',
  kind: {
    account_balance: 'Account balance',
    card_summary: 'Card summary',
    account_transaction: 'Account transaction',
    card_transaction: 'Card transaction',
  },
  reference: 'Account or card',
  amount: 'Amount',
  available: 'Available',
  observed: 'Observed',
  providerTime: 'Bank timestamp',
  source: 'Source',
  provenance: 'Provenance',
  amountUnavailable: 'Not available',
  evidence: {
    local_fixture: 'Local test fixture',
    fresh_external: 'Read from the OCBC sandbox',
  },
  evidenceUnknown: 'Unknown origin',
  referenceLabel: (masked: string) => `Reference ending ${masked.slice(-4)}`,
  tableLabel: (title: string) => `${title}, OCBC sandbox observations`,
};
