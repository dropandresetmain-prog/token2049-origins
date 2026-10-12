/**
 * User-facing strings for the operator screens (Treasury and Connections).
 *
 * These screens are for the person running the gateway, not for the person whose assistant made a purchase, so
 * they may say "capacity" and "ledger". Environment disclosure belongs at final transfer approval.
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
  subhead: 'Recorded funding and purchasing capacity, kept apart.',
  separationTitle: 'Two ledgers, never added together',
  separationBody:
    'Verified token funding and purchasing allowances are recorded separately. Neither is a bank or card balance.',
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
    title: 'Observed funds',
    badge: 'Observed',
    intro: 'Token funding verified by the gateway, and the corresponding customer obligations.',
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
    title: 'Purchasing capacity',
    badge: 'Capacity',
    intro: 'An allowance that limits purchasing. It is separate from bank and card balances.',
    limit: 'Capacity limit',
    available: 'Available',
    reserved: 'Reserved',
    consumed: 'Consumed',
    providerTest: 'Provider balance used',
    reservedHint: 'Held for purchases still in progress.',
    consumedHint: 'Recorded allowance used by completed purchases.',
    providerTestHint: "Paid from a provider balance, separate from the card allowance.",
    availableHint: 'Limit minus everything above.',
    barLabel: (currency: string) => `${currency} capacity split`,
    overspent: 'Recorded use is above the limit.',
    empty: 'No capacity pool is configured.',
    reservationsTitle: 'Reservations',
    statusColumn: 'Status',
    countColumn: 'Purchases',
    totalColumn: 'Amount',
    reservationsLabel: 'Capacity reservations by status',
    accountsTitle: 'Capacity accounts',
    accountsEmpty: 'No capacity entries yet.',
    accountsLabel: 'Capacity ledger accounts',
  },

  purchases: {
    title: 'Purchases by state',
    total: (n: number) => (n === 1 ? '1 purchase in total' : `${n} purchases in total`),
    empty: 'No purchases yet.',
  },

  technical: {
    summary: 'Technical details',
    note: 'Customer treasury records. Operational environment metadata is omitted.',
  },

  /** Side of the ledger a balance sits on. */
  side: { debit: 'Debit balance', credit: 'Credit balance' },
};

export const accountLabel: Record<string, string> = {
  'assets:crypto_treasury': 'Tokens held in treasury',
  'liabilities:customer_prepayment': 'Owed to customers: held for purchases',
  'liabilities:customer_unapplied': 'Owed to customers: not yet applied',
  'income:purchase_principal_applied': 'Purchase amounts applied',
  'income:service_fee': 'Service fees earned',
  'simulated:merchant_purchases': 'Merchant purchases',
  'simulated:card_payable': 'Card payable',
  'simulated:provider_test_balance_used': 'Provider balance used',
};

export const ledgerLabel: Record<'observed' | 'simulated', string> = { observed: 'Observed', simulated: 'Capacity' };

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
  network: (family: 'cardano' | 'solana', test: boolean) => `${family === 'cardano' ? 'Cardano' : 'Solana'} network`,
  token: (test: boolean) => 'tokens',
  ada: (test: boolean) => 'ADA',
  usdm: (test: boolean) => 'USDM',
  baseUnits: 'base units',
  simulatedFiat: (currency: string) => currency,
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
  technical: { summary: 'Technical details', note: 'Customer connection records. Operational environment metadata is omitted.' },
  groups: {
    funding: { title: 'Payments in', intro: 'Connected customer payment sources.' },
    merchants: { title: 'Merchants', intro: 'Where the gateway places orders and bookings.' },
    bank: { title: 'Bank observation', intro: 'Read-only view of a bank. Observation only.' },
  },
};

export const integration: Record<string, { name: string; role: string }> = {
  cardano: { name: 'Cardano', role: 'Receives token payments on Cardano' },
  solana: { name: 'Solana', role: 'Receives token payments on Solana' },
  masumi: { name: 'Masumi', role: 'Agent payments and service fees through Masumi' },
  shopify: { name: 'Shopify', role: 'Store orders' },
  nuitee: { name: 'Nuitée', role: 'Hotel bookings' },
  atlas: { name: 'Atlas', role: 'Flight bookings' },
  ocbc: { name: 'OCBC', role: 'Read-only account and card observations' },
};

export const readiness: Record<Readiness['status'], { label: string; tone: Tone }> = {
  EXTERNAL_CHECK_PASSED: { label: 'External check passed', tone: 'positive' },
  CONFIGURED_UNVERIFIED: { label: 'Configured, not verified', tone: 'pending' },
  MISSING_CONFIG: { label: 'Not configured', tone: 'neutral' },
  ACCESS_BLOCKED: { label: 'Access blocked', tone: 'attention' },
  LOCAL_TESTS_ONLY: { label: 'Awaiting external verification', tone: 'neutral' },
};

export const environmentLabel = {
  sandbox: 'Configured',
  test: 'Configured',
  production: 'Production',
};

/* ---------------- OCBC observations ---------------- */

export const ocbc = {
  title: 'OCBC observations',
  badge: 'Observation only',
  banner:
    'Read-only OCBC observations, stored with their source. They are not purchase settlement, not treasury truth, and they do not show that any Capsule purchase reached a bank or card account.',
  historical: 'OCBC observations are historical records.',
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
    local_fixture: 'Local record',
    fresh_external: 'Read from OCBC',
  },
  evidenceUnknown: 'Unknown origin',
  referenceLabel: (masked: string) => `Reference ending ${masked.slice(-4)}`,
  tableLabel: (title: string) => `${title}, OCBC observations`,
};
