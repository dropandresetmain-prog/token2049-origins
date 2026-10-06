/**
 * Schema v1. Single SQLite file, one writer/worker process.
 * Money/base-unit amounts are TEXT integer strings handled with BigInt in code.
 */
export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = /* sql */ `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_clients (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  channel TEXT NOT NULL,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  category TEXT NOT NULL,
  route TEXT NOT NULL,
  provider_environment TEXT NOT NULL,
  intent_json TEXT NOT NULL,
  public_json TEXT NOT NULL,
  execution_ref_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS offers_customer ON offers(customer_id);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  supersedes_quote_id TEXT REFERENCES quotes(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  offer_id TEXT NOT NULL REFERENCES offers(id),
  category TEXT NOT NULL,
  route TEXT NOT NULL,
  provider_environment TEXT NOT NULL,
  public_json TEXT NOT NULL,
  fulfillment_json TEXT NOT NULL,
  execution_ref_json TEXT NOT NULL,
  digest TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quotes_customer ON quotes(customer_id);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  channel TEXT NOT NULL,
  state TEXT NOT NULL,
  payment_state TEXT NOT NULL,
  commerce_status TEXT NOT NULL,
  merchant_payment_status TEXT NOT NULL,
  funding_rail TEXT NOT NULL,
  funding_requirement_json TEXT NOT NULL,
  approval_json TEXT NOT NULL,
  provider_reference TEXT,
  receipt_json TEXT,
  status_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS purchases_customer ON purchases(customer_id);
-- One live purchase per quote: a quote cannot be bought twice through competing channels.
CREATE UNIQUE INDEX IF NOT EXISTS purchases_one_per_quote ON purchases(quote_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  customer_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (customer_id, operation, idem_key)
);

CREATE TABLE IF NOT EXISTS funding_evidence (
  id TEXT PRIMARY KEY,
  purchase_id TEXT REFERENCES purchases(id),
  rail TEXT NOT NULL,
  network TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  amount_base_units TEXT NOT NULL,
  payer TEXT NOT NULL,
  payee TEXT NOT NULL,
  transfer_reference TEXT NOT NULL,
  payment_state TEXT NOT NULL,
  confirmations INTEGER,
  purpose TEXT NOT NULL,
  -- applied: funds this purchase. unapplied: received but not applied (overpay/duplicate) => refundable obligation.
  application TEXT NOT NULL,
  evidence_mode TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  details_json TEXT NOT NULL
);
-- A transfer proof can be consumed exactly once, across all purchases and channels.
CREATE UNIQUE INDEX IF NOT EXISTS funding_proof_once ON funding_evidence(rail, network, transfer_reference);

CREATE TABLE IF NOT EXISTS capacity_pools (
  currency TEXT PRIMARY KEY,
  scale INTEGER NOT NULL,
  limit_minor TEXT NOT NULL,
  ledger_mode TEXT NOT NULL CHECK (ledger_mode = 'simulated'),
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL UNIQUE REFERENCES purchases(id),
  currency TEXT NOT NULL REFERENCES capacity_pools(currency),
  scale INTEGER NOT NULL,
  amount_minor TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','consumed','released','held_unresolved')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','claimed','done','dead')),
  run_after TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_by TEXT,
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status, run_after);

-- Candidate hashes are durable before settlement; signed payloads and keys are never stored here.
CREATE TABLE IF NOT EXISTS funding_attempts (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL UNIQUE REFERENCES purchases(id),
  rail TEXT NOT NULL,
  network TEXT NOT NULL,
  transfer_reference TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','recorded')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (rail, network, transfer_reference)
);

CREATE TABLE IF NOT EXISTS execution_attempts (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  attempt_no INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('started','succeeded','failed_definite','terms_changed','unknown')),
  provider_reference TEXT,
  checkpoints_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (purchase_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  purchase_id TEXT REFERENCES purchases(id),
  kind TEXT NOT NULL,
  ledger_mode TEXT NOT NULL CHECK (ledger_mode IN ('observed','simulated')),
  description TEXT NOT NULL,
  external_reference TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL REFERENCES journal_entries(id),
  account TEXT NOT NULL,
  asset TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('debit','credit')),
  amount TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS journal_lines_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS journal_lines_account ON journal_lines(account, asset);

-- Immutability: journal rows can never be updated or deleted.
CREATE TRIGGER IF NOT EXISTS journal_entries_no_update BEFORE UPDATE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'journal entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS journal_entries_no_delete BEFORE DELETE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'journal entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS journal_lines_no_update BEFORE UPDATE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'journal lines are immutable'); END;
CREATE TRIGGER IF NOT EXISTS journal_lines_no_delete BEFORE DELETE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'journal lines are immutable'); END;

CREATE TABLE IF NOT EXISTS purchase_events (
  id TEXT PRIMARY KEY,
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (purchase_id, sequence)
);

CREATE TABLE IF NOT EXISTS bank_observations (
  id TEXT PRIMARY KEY,
  bank TEXT NOT NULL,
  kind TEXT NOT NULL,
  masked_reference TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_json TEXT,
  available_json TEXT,
  description TEXT,
  environment TEXT NOT NULL,
  source TEXT NOT NULL,
  provider_timestamp TEXT,
  observed_at TEXT NOT NULL,
  caveats_json TEXT NOT NULL
);
`;
