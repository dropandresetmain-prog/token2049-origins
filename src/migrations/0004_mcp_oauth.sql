-- OAuth 2.1 authorization server state for the hosted MCP endpoint. Secrets (codes, tokens) are stored only as SHA-256 hashes.
CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Authorization requests awaiting owner approval (one row per authorize call; short lived, single use).
CREATE TABLE oauth_auth_requests (
  id_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  state TEXT,
  resource TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  resource TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  api_client_id TEXT NOT NULL REFERENCES api_clients(id),
  expires_at TEXT NOT NULL,
  used_at TEXT
);

-- Access and refresh tokens. An access token resolves to an existing customer + api_client identity and
-- can never carry more scope than that api_client holds. Refresh tokens rotate on every use.
CREATE TABLE oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('access','refresh')),
  grant_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  api_client_id TEXT NOT NULL REFERENCES api_clients(id),
  scopes_json TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX oauth_tokens_grant ON oauth_tokens(grant_id);
