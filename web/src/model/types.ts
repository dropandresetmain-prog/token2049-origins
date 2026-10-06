/**
 * View models: exactly what the screens render. Every string here is already user-facing copy.
 * Screens must not read gateway contract types directly; they render these.
 */
import type { StatusKey, Tone } from '../copy/en.js';
import type { ConsoleMode } from '../contracts/source.js';

export type { StatusKey, Tone, ConsoleMode };

export type IconName = 'hotel' | 'flight' | 'retail' | 'purchases' | 'agent' | 'wallet' | 'layers' | 'receipt' | 'check' | 'pause' | 'alert' | 'lock';

export type ListFilter = 'all' | 'in_progress' | 'attention' | 'completed';

export interface StatusVM {
  key: StatusKey;
  label: string;
  tone: Tone;
}

export interface Field {
  label: string;
  value: string;
  /** Render the value in monospace (identifiers). */
  mono?: boolean;
}

export interface CopyableRef {
  label: string;
  value: string;
  copyLabel: string;
}

/* ---------------- Purchases list ---------------- */

export interface PurchaseRowVM {
  id: string;
  displayId: string;
  title: string;
  icon: IconName;
  merchant: string;
  createdLabel: string;
  createdAt: string;
  requestedBy: string;
  paidWith: string;
  paidWithDetail: string;
  amount: string;
  status: StatusVM;
  group: Exclude<ListFilter, 'all'> | null;
  /** Lower-cased text the search box matches against. */
  searchText: string;
}

export interface PurchaseListVM {
  rows: PurchaseRowVM[];
  counts: Record<ListFilter, number>;
  limitNote: string | null;
}

/* ---------------- Purchase detail ---------------- */

export type FlowState = 'idle' | 'active' | 'done' | 'stopped';

export interface RouteVM {
  from: { label: string; name: string; detail: string; payment: { method: string; network: string | null } };
  capsule: { label: string; action: string; stopped: boolean };
  to: { label: string; name: string; detail: string; icon: IconName; result: string; resultIcon: IconName; done: boolean };
  flowIn: FlowState;
  flowOut: FlowState;
}

export type StepStatus = 'done' | 'current' | 'pending' | 'attention';

export interface StepVM {
  key: 'approved' | 'paid' | 'ordering' | 'confirmed';
  label: string;
  detail: string;
  status: StepStatus;
  /** Time for done/current steps, otherwise a short state word ("Pending"). */
  time: string;
}

export interface AttentionVM {
  tone: 'attention' | 'neutral';
  title: string;
  body: string;
  action: { label: string; copyText: string };
}

export interface SummaryVM {
  item: { title: string; detail: string; icon: IconName };
  costs: Field[];
  total: Field;
  notes: string[];
  payment: { method: string; network: string | null; amount: string | null; note: string; locked: boolean; lockText: string };
}

export interface ProofSectionVM {
  heading: string;
  icon: IconName;
  badge: { label: string; tone: Tone };
  fields: Field[];
  reference: CopyableRef | null;
  note: string | null;
}

export interface ActivityItemVM {
  label: string;
  time: string;
}

export interface ProofVM {
  available: boolean;
  disclaimer: string | null;
  sections: ProofSectionVM[];
  /** "1 of 2": how many of payment and merchant confirmation are in. */
  confirmedCount: number;
  activity: ActivityItemVM[];
  technicalRecord: unknown;
  downloadName: string;
}

export interface ReceiptVM {
  sample: boolean;
  total: string;
  currency: string;
  itemTitle: string;
  fields: Field[];
  notes: string[];
  downloadName: string;
  download: unknown;
}

export interface QuoteVM {
  itemTitle: string;
  details: string;
  lines: Field[];
  fee: Field;
  total: Field;
  notes: string[];
  limit: Field | null;
  validUntil: Field;
  quoteNumber: Field;
  terms: string[];
}

export interface PurchaseDetailVM {
  id: string;
  displayId: string;
  title: string;
  requestedBy: string;
  createdLabel: string;
  status: StatusVM;
  total: { amount: string; currency: string };
  request: { text: string | null; limit: string | null } | null;
  attention: AttentionVM | null;
  route: RouteVM;
  stepsHeading: string;
  stepsCount: string;
  steps: StepVM[];
  summary: SummaryVM;
  proof: ProofVM;
  receipt: ReceiptVM | null;
  quote: QuoteVM | null;
  /** True while the outcome can still change; the screen refreshes on a timer. */
  live: boolean;
}
