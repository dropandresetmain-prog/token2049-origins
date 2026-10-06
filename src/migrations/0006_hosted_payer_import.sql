-- One-time, permanent record that the canonical (legacy file) payer ledger was imported into PostgreSQL. The marker binds the
-- import to the wallet identity and to the SHA-256 of the exact imported entries, so a rerun can verify it is the same history and
-- can never duplicate, reset or replace it.
CREATE TABLE hosted_payer_import (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  payer_address TEXT NOT NULL,
  network TEXT NOT NULL,
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  entry_count INTEGER NOT NULL CHECK (entry_count >= 0),
  committed_base_units TEXT NOT NULL CHECK (committed_base_units ~ '^[0-9]+$'),
  imported_at TEXT NOT NULL
);

CREATE FUNCTION hosted_payer_import_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'hosted payer import marker is permanent';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER hosted_payer_import_guard BEFORE UPDATE OR DELETE ON hosted_payer_import
  FOR EACH ROW EXECUTE FUNCTION hosted_payer_import_guard();
