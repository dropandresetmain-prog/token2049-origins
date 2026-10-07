/**
 * Every user-facing string in the console.
 *
 * Rules (docs/design/VOCABULARY.md):
 * - Write for the person whose assistant made the purchase, not for the people who built Capsule.
 * - No internal terms on screen: no "principal", "rail", "fixture", "provider", "execution", "capacity",
 *   "reservation", "digest", "x402", "preprod", "devnet", "sandbox", "evidence mode", raw enum values or
 *   event type names. Map them here instead.
 * - Plain sentences. No em or en dashes. At most one middle dot per line.
 * - Never claim more than the data proves: a payment is not an order, an order is not paid, a test is not real.
 */
import type {
  Category,
  Channel,
  CommerceStatus,
  FundingRail,
  MerchantPaymentStatus,
  PaymentState,
  ProviderRoute,
} from '../contracts/backend.js';

type Cat = Category | 'unknown';

export const brand = {
  name: 'Capsule',
};

export const nav = {
  live: 'Current purchase',
  liveShort: 'Current',
  purchases: 'Purchases',
  attention: 'Needs attention',
  navLabel: 'Workspace',
  workspaceName: 'Your workspace',
  workspaceDetail: 'Assistant purchases',
  presentation: 'Presentation view',
  presentationOn: 'Presentation view. Same purchase, fewer controls.',
  presentationOff: 'Workspace view restored.',
  about: 'About Capsule',
  skipToContent: 'Skip to content',
  brandLabel: 'Capsule, current purchase',
  sidebarLabel: 'Workspace navigation',
  appLabel: 'Capsule application',
  breadcrumbLabel: 'Breadcrumb',
  crumbSeparator: '/',
  pageTitle: (page: string) => `${page} | ${brand.name}`,
};

export const environment = {
  sample: { strong: 'Sample data.', text: 'Nothing here is a real purchase. Names, amounts and outcomes are examples.' },
  test: { strong: 'Test mode.', text: 'Payments use test funds with no cash value, and orders go to test merchants.' },
};

/* ---------------- Status ---------------- */

export type StatusKey =
  | 'awaiting_payment'
  | 'confirming_payment'
  | 'in_progress'
  | 'checking'
  | 'completed'
  | 'price_changed'
  | 'expired'
  | 'not_completed';

export type Tone = 'pending' | 'progress' | 'positive' | 'attention' | 'neutral';

export const status: Record<StatusKey, { label: string; tone: Tone }> = {
  awaiting_payment: { label: 'Awaiting payment', tone: 'pending' },
  confirming_payment: { label: 'Confirming payment', tone: 'progress' },
  in_progress: { label: 'In progress', tone: 'progress' },
  checking: { label: 'Checking with merchant', tone: 'progress' },
  completed: { label: 'Completed', tone: 'positive' },
  price_changed: { label: 'Price changed', tone: 'attention' },
  expired: { label: 'Expired', tone: 'neutral' },
  not_completed: { label: "Couldn't complete", tone: 'attention' },
};

/* ---------------- Things ---------------- */

export const category: Record<Cat, { noun: string; title: string; verbing: string; doing: string; stepLabel: string }> = {
  hotel: { noun: 'booking', title: 'Hotel booking', verbing: 'Booking your stay', doing: 'booking the stay', stepLabel: 'Booking the stay' },
  flight: { noun: 'booking', title: 'Flight booking', verbing: 'Booking your flight', doing: 'booking the flight', stepLabel: 'Booking the flight' },
  retail: { noun: 'order', title: 'Online order', verbing: 'Placing your order', doing: 'placing the order', stepLabel: 'Placing the order' },
  unknown: { noun: 'order', title: 'Purchase', verbing: 'Placing your order', doing: 'placing the order', stepLabel: 'Placing the order' },
};

export const merchant: Record<ProviderRoute, { name: string; kind: string }> = {
  shopify: { name: 'Shopify', kind: 'Online store' },
  nuitee: { name: 'Nuitée', kind: 'Hotel booking partner' },
  atlas: { name: 'Atlas', kind: 'Flight booking partner' },
};
export const unknownMerchant = { name: 'Merchant', kind: 'Merchant' };

export function merchantDetail(kind: string, isTest: boolean): string {
  return isTest ? `${kind}, test mode` : kind;
}

/** How the assistant reached Capsule. Used when the assistant's own name is not available. */
export const channel: Record<Channel, { name: string; kind: string }> = {
  mcp: { name: 'Your assistant', kind: 'AI assistant' },
  chatgpt: { name: 'ChatGPT', kind: 'AI assistant' },
  sokosumi: { name: 'Sokosumi agent', kind: 'Agent marketplace' },
  http: { name: 'Connected app', kind: 'Connected app' },
  console: { name: 'Capsule', kind: 'Capsule' },
  test: { name: 'Test client', kind: 'Test client' },
};
export const unknownRequester = { name: 'Your assistant', kind: 'AI assistant' };
/** The generic name reads lower-case mid-sentence ("Ask your assistant"); real names stay as they are. */
export function inSentence(name: string): string {
  return name === unknownRequester.name ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

export const paymentMethod: Record<FundingRail, string> = {
  cardano: 'Cardano',
  solana: 'Solana',
  masumi: 'Masumi',
};
export const testNetwork = 'Test network';
export const testFunds = 'test tokens';

export const paymentState: Record<PaymentState, string> = {
  not_received: 'Not paid yet',
  submitted: 'Payment sent, waiting for confirmation',
  confirmed: 'Payment received',
  escrow_locked: 'Payment held in escrow',
  released: 'Payment released',
  refunded: 'Payment refunded',
  invalid: "Payment couldn't be accepted",
  unknown: 'Checking the payment',
};

export function commerceOutcome(s: CommerceStatus, cat: Cat): string {
  switch (s) {
    case 'not_started': return 'Not started yet';
    case 'order_created_unpaid': return 'Order created, not paid yet';
    case 'held': return cat === 'retail' ? 'On hold, not paid yet' : 'Reserved, not confirmed yet';
    case 'payment_pending': return 'Waiting for the merchant to take payment';
    case 'paid': return 'Order paid';
    case 'confirmed': return cat === 'retail' || cat === 'unknown' ? 'Order confirmed' : 'Booking confirmed';
    case 'ticketing': return 'Issuing the ticket';
    case 'ticketed': return 'Ticket issued';
    case 'failed': return 'Not completed';
    case 'cancelled': return 'Cancelled';
    case 'unknown': return 'Not known yet';
  }
}

export const merchantPayment: Record<MerchantPaymentStatus, string> = {
  none: 'Not paid',
  pending: 'Pending',
  authorized: 'Authorized, not yet charged',
  paid: 'Paid',
  simulated_paid: 'Paid (simulated in test mode)',
  test_balance_paid: 'Paid from a test balance',
  failed: 'Failed',
  refunded: 'Refunded',
  unknown: 'Not known yet',
};

export const paymentCovers: Record<'purchase_principal' | 'service_fee' | 'principal_and_fee', string> = {
  purchase_principal: 'The purchase price',
  service_fee: "Capsule's fee only",
  principal_and_fee: "The purchase price and Capsule's fee",
};

export const allowance: Record<'active' | 'consumed' | 'released' | 'held_unresolved', string> = {
  active: 'Set aside for this purchase',
  consumed: 'Used for this purchase',
  released: 'Released',
  held_unresolved: 'Held until the outcome is known',
};

/**
 * Products found at another store are bought as an equivalent test order in Capsule's own test store.
 * The source store never receives an order or a payment, and the copy must never suggest it did.
 */
export const sourceStore = {
  sourceStoreKind: 'Source store',
  checkoutName: 'Capsule checkout',
  checkoutVia: 'Checkout via Capsule',
  testStoreName: 'Capsule test store',
  testStoreKind: 'Shopify test store',
  foundAt: (store: string) => `Found at ${store}`,
  rowFoundAt: 'Found at',
  rowListedPrice: 'Listed price there',
  listed: (price: string, when: string) => `${price}, seen ${when}`,
  boundary: (store: string) => `This is a test order placed with Capsule's test store. ${store} receives no order and no payment.`,
  viewListing: (store: string) => `View the listing at ${store}`,
};

/* ---------------- Purchase page ---------------- */

export const detail = {
  totalLabel: 'Total',
  copyId: 'Copy purchase number',
  copied: 'Copied.',
  copyUnavailableTitle: 'Copy this text',
  copyUnavailableIntro: "Your browser didn't allow copying. Select the text below and copy it.",
  approvedUpTo: (limit: string) => `Approved up to ${limit}`,
  routeHeading: 'How this purchase moves',
  requestedBy: 'Requested by',
  capsule: 'Capsule',
  merchantLabel: 'Merchant',
  progressHeading: 'Progress',
  completeHeading: 'Purchase activity',
  stepsDone: (done: number, total: number) => `${done} of ${total} done`,
  openActivity: 'View activity',
  openReceipt: 'View receipt',
  proofButton: 'Proof',
  proofCount: (n: number, total: number) => `${n} of ${total}`,
  summaryHeading: 'Summary',
  price: 'Price',
  capsuleFee: 'Capsule fee',
  total: 'Total',
  payAtProperty: (amount: string) => `Pay at the property: ${amount}. Not included in the total.`,
  priceDetails: 'Price details',
  paymentHeading: 'Payment',
  paymentLocked: 'Payment received. The payment method can no longer change.',
  paymentNotYet: 'No payment received yet.',
  scaledTestPayment: 'Test payments are 1/1000 of the price and have no cash value.',
  testPaymentNote: 'Test funds with no cash value.',
  paidAmount: (amount: string) => `${amount} paid`,
  dueAmount: (amount: string) => `${amount} due`,
  requestQuote: (text: string) => `“${text}”`,
};

export const routeAction: Record<StatusKey, (cat: Cat) => string> = {
  awaiting_payment: () => 'Waiting for payment',
  confirming_payment: () => 'Confirming payment',
  in_progress: (cat) => category[cat].verbing,
  checking: () => 'Checking with the merchant',
  completed: () => 'Done',
  price_changed: () => 'Stopped before ordering',
  expired: () => 'Quote expired',
  not_completed: () => 'Stopped',
};

export const steps = {
  approved: {
    label: 'Approved',
    done: (agent: string) => `${agent} approved this exact price and payment method.`,
    noRecord: "Approval details aren't available for this purchase.",
    pending: 'Waiting for approval.',
  },
  paid: {
    label: 'Payment received',
    done: (method: string, isTest: boolean) => `Paid with ${method}${isTest ? ' on the test network' : ''}.`,
    current: 'Waiting for payment.',
    pending: 'Waiting for payment.',
  },
  ordering: {
    done: (merchantName: string) => `Sent to ${merchantName}.`,
    current: (merchantName: string, cat: Cat) => `Capsule is ${category[cat].doing} with ${merchantName}.`,
    pending: 'Starts once the payment is received.',
    priceChanged: (merchantName: string) => `${merchantName} changed the price, so Capsule stopped before ordering.`,
    expired: 'The quote expired before ordering could start.',
  },
  confirmed: {
    label: 'Merchant confirmation',
    done: (merchantName: string, outcome: string) => `${merchantName} confirmed. ${outcome}.`,
    current: (merchantName: string) => `Waiting for ${merchantName} to confirm. No action needed.`,
    pending: 'Not confirmed yet.',
    failed: (merchantName: string) => `${merchantName} didn't complete the order.`,
    nothingBought: 'Nothing was bought.',
  },
};

export const stepState = {
  done: 'Done',
  inProgress: 'In progress',
  pending: 'Pending',
  needsAttention: 'Needs attention',
};

export const attention = {
  priceChanged: {
    title: 'The price changed, so nothing was bought.',
    body: (merchantName: string, agent: string) =>
      `${merchantName} changed the terms after they were approved. Ask ${agent} for a new quote and approve it to continue.`,
    paidNote: 'Your payment stays linked to the original quote.',
    action: 'Copy request for a new quote',
    copyText: (title: string, ref: string) =>
      `The price for "${title}" changed after I approved it, so Capsule stopped before buying anything (purchase ${ref}). Please get a new quote and ask me to approve it.`,
  },
  expired: {
    title: 'This quote expired, so nothing was bought.',
    body: (agent: string) => `Ask ${agent} for a new quote to try again.`,
    paidNote: 'A payment was received for this purchase. See Proof for details.',
    action: 'Copy request for a new quote',
    copyText: (title: string, ref: string) =>
      `The quote for "${title}" expired before Capsule could buy it (purchase ${ref}). Please get a new quote and ask me to approve it.`,
  },
  notCompleted: {
    title: "This purchase couldn't be completed.",
    body: (merchantName: string, ref: string) =>
      `${merchantName} didn't complete the order. Contact Capsule support with purchase ${ref} so they can check the payment and the outcome.`,
    action: 'Copy purchase number',
  },
};

/* ---------------- Proof panel ---------------- */

export const proof = {
  title: 'Proof',
  close: 'Close proof',
  tabSummary: 'Summary',
  tabActivity: 'Activity',
  tabsLabel: 'Proof sections',
  sampleNote: "These are sample records. They don't point to real payments or bookings.",
  testNote: 'Test mode. Payments use test funds, and orders go to test merchants.',
  paymentHeading: 'Payment',
  received: 'Received',
  notReceived: 'Not received',
  rowMethod: 'Paid with',
  rowAmount: 'Amount',
  rowCovers: 'Covers',
  rowReceivedAt: 'Received',
  paymentReference: 'Payment reference',
  copyPaymentReference: 'Copy payment reference',
  noPayment: 'No payment has been received yet.',
  feeOnlyNote: "This payment covers Capsule's fee only. It doesn't pay for the purchase.",
  orderHeading: (cat: Cat) => (cat === 'retail' || cat === 'unknown' ? 'Order' : 'Booking'),
  confirmed: 'Confirmed',
  notConfirmed: 'Not confirmed',
  rowMerchant: 'Merchant',
  rowMode: 'Mode',
  testMode: 'Test mode',
  liveMode: 'Live',
  rowOutcome: 'Outcome',
  rowMerchantPayment: 'Merchant payment',
  merchantReference: 'Merchant reference',
  copyMerchantReference: 'Copy merchant reference',
  notConfirmedNote: (merchantName: string) =>
    `A payment alone doesn't confirm the order. The receipt appears once ${merchantName} confirms.`,
  allowanceHeading: 'Spending allowance',
  simulated: 'Simulated',
  rowStatus: 'Status',
  allowanceNote: 'Capsule sets this amount aside from your simulated spending allowance while the purchase runs. No bank account or card is charged.',
  activityEmpty: 'No activity recorded yet.',
  technicalDetails: 'Technical details for support',
  download: 'Download proof',
  downloaded: 'Proof downloaded.',
  unavailable: "Proof isn't available with this access key.",
};

/** Purchase activity, keyed by gateway event type. Unknown types fall back to `fallback`. */
export const activity: Record<string, string> & { fallback: string } = {
  fallback: 'Status updated',
  'purchase.created': 'Purchase created',
  'approval.recorded': 'Price and payment method approved',
  'capacity.reserved': 'Amount set aside',
  'capacity.consumed': 'Set-aside amount used',
  'capacity.released': 'Set-aside amount released',
  'funding.attempt_prepared': 'Payment requested',
  'funding.submitted': 'Payment sent',
  'funding.confirmed': 'Payment received',
  'funding.invalid': "Payment couldn't be accepted",
  'funding.rejected': 'Payment declined',
  'funding.unapplied': 'Payment arrived after the purchase closed',
  'funding.manual_required': 'Payment needs a manual check',
  'blockfrost.error': 'Payment check delayed',
  'chain.mismatch': 'Payment check delayed',
  'chain.confirm_mismatch': 'Payment check delayed',
  'chain.recovered': 'Payment check resumed',
  'facilitator.verify_unavailable': 'Payment check delayed',
  'facilitator.settle_indeterminate': 'Payment check delayed',
  'execution.queued': 'Queued to send to the merchant',
  'execution.started': 'Sent to the merchant',
  'execution.checkpoint': 'Merchant processing',
  'execution.succeeded': 'Merchant confirmed',
  'execution.unknown': 'Waiting to hear from the merchant',
  'execution.blocked': 'Paused before sending to the merchant',
  'execution.terms_changed': 'Price changed before ordering',
  'execution.failed_definite': 'Merchant did not complete the order',
  'execution.financial_anomaly': 'Needs a manual check',
  'outcome.refreshed': 'Checked with the merchant',
  'outcome.manual_required': 'Outcome needs a manual check',
  'provider.webhook_received': 'Update received from the merchant',
  'receipt.issued': 'Receipt issued',
  'receipt.mismatch': 'Receipt needs a manual check',
  'reconciliation.pending': 'Confirming the outcome',
  'reconciliation.manual_required': 'Outcome needs a manual check',
  'refund.due': 'Refund due',
  'purchase.expired': 'Quote expired',
};

/* ---------------- Dialogs ---------------- */

export const receipt = {
  title: 'Receipt',
  unavailable: 'The receipt is available once the merchant confirms.',
  sampleBadge: 'Sample receipt',
  rowRequestedBy: 'Requested by',
  rowPaidWith: 'Paid with',
  rowMerchant: 'Merchant',
  rowOutcome: 'Outcome',
  rowMerchantReference: 'Merchant reference',
  rowReceiptNumber: 'Receipt number',
  rowIssued: 'Issued',
  notesHeading: 'Notes',
  /** Written by the console from receipt facts; the gateway's own wording stays in the download. */
  noteSimulatedFunds: 'This purchase used simulated test funds. No real payment was made.',
  noteTestFunds: 'Paid with test tokens that have no cash value.',
  noteScaled: 'Test payments are 1/1000 of the price.',
  noteTestMerchant: 'The merchant ran this order in test mode. Nothing will be shipped, booked or charged for real.',
  noteNoBankCharge: 'No bank account or card was charged.',
  close: 'Close',
  download: 'Download receipt',
  downloaded: 'Receipt downloaded.',
};

export const quoteDialog = {
  title: 'Price details',
  intro: 'The exact price and terms that were approved for this purchase.',
  rowItem: 'Item',
  rowDetails: 'Details',
  rowCapsuleFee: 'Capsule fee',
  rowTotal: 'Total',
  rowLimit: 'Spending limit',
  rowValidUntil: 'Price valid until',
  rowQuoteNumber: 'Quote number',
  termsHeading: 'Merchant terms',
  noTerms: 'The merchant listed no extra terms.',
  unavailable: "Price details aren't available with this access key.",
  close: 'Close',
};

export const about = {
  title: 'About Capsule',
  intro: 'Capsule lets your AI assistants buy things for you within the limits you approve. This page shows what they bought, how it was paid for, and what the merchant confirmed.',
  readOnly: 'This view is read-only. Approvals and payments happen through your assistant.',
  sampleNote: 'You are looking at sample data. Nothing here is a real purchase.',
  close: 'Close',
};

/* ---------------- Purchases list ---------------- */

export const list = {
  heading: 'Purchases',
  subhead: 'Everything your assistants have bought or tried to buy.',
  allCrumb: 'All purchases',
  tabsLabel: 'Filter purchases',
  tabs: { all: 'All', in_progress: 'In progress', attention: 'Needs attention', completed: 'Completed' },
  searchLabel: 'Search purchases',
  searchPlaceholder: 'Search by item, merchant, assistant or number',
  columns: { purchase: 'Purchase', requestedBy: 'Requested by', paidWith: 'Paid with', amount: 'Amount', status: 'Status', open: 'Open purchase' },
  openRow: (title: string) => `Open ${title}`,
  showing: (shown: number, total: number) => `Showing ${shown} of ${total} purchases`,
  limitNote: (limit: number) => `Only the ${limit} most recent purchases are shown.`,
  noMatchTitle: 'No matching purchases',
  noMatchBody: 'Try an item, merchant, assistant or purchase number.',
  clearSearch: 'Clear search',
  emptyTitle: 'No purchases yet',
  emptyBody: 'When your assistants buy something through Capsule, it shows up here.',
  noFilterTitle: (tab: string) => `Nothing in ${tab.toLowerCase()}`,
  noFilterBody: 'Purchases appear here when they reach this state.',
};

/* ---------------- Sign in, loading, errors ---------------- */

export const signIn = {
  title: 'Connect to Capsule',
  intro: 'Paste the access key for your workspace to see your purchases.',
  label: 'Access key',
  help: 'The key stays in this browser tab and is cleared when you close it or sign out.',
  submit: 'Connect',
  connecting: 'Connecting',
  signOut: 'Sign out',
  signedOut: 'Signed out. Your access key was cleared.',
};

export const loading = {
  purchases: 'Loading purchases',
  purchase: 'Loading purchase',
};

export const errors = {
  unauthenticated: "That access key wasn't accepted. Check it and try again.",
  forbidden: "This access key can't view purchases. Ask for a key that can view purchases and proof.",
  not_found: "This purchase doesn't exist or isn't in your workspace.",
  network: "Capsule couldn't be reached. Check your connection and try again.",
  invalid_response: 'Capsule sent a response this page doesn\'t understand. Try again, or contact support.',
  generic: 'Something went wrong. Try again.',
  supportCode: (code: string) => `Support code ${code}`,
  retry: 'Try again',
  backToPurchases: 'Back to purchases',
  crumb: 'Purchase unavailable',
};

/* ---------------- Shared chrome ---------------- */

export const common = {
  close: 'Close',
  closeDialog: 'Close dialog',
};

/** Sample scenario shortcuts, shown only when the console runs on sample data. */
export const dock = {
  label: 'Sample scenarios',
  inProgress: 'In progress',
  completed: 'Completed',
  checking: 'Checking with merchant',
  priceChange: 'Price change',
  awaitingPayment: 'Awaiting payment',
  foundElsewhere: 'Found at another store',
  purchases: 'Purchases',
};
