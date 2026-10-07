-- Channel handoffs are diagnostics and retry guards, never funding or settlement evidence.
CREATE TABLE payment_handoffs (
  purchase_id TEXT PRIMARY KEY REFERENCES purchases(id),
  attempt_id TEXT NOT NULL,
  api_client_id TEXT NOT NULL REFERENCES api_clients(id),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  retry_safe BOOLEAN NOT NULL DEFAULT FALSE,
  error_code TEXT,
  updated_at TEXT NOT NULL
);
