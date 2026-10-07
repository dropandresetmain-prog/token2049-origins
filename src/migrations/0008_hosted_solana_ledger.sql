-- Payer and sponsor histories are separate liabilities, bound permanently to the proven identities.
CREATE TABLE hosted_solana_identity (
  role TEXT PRIMARY KEY CHECK (role IN ('payer', 'sponsor')),
  owner TEXT UNIQUE NOT NULL,
  network TEXT NOT NULL,
  mint TEXT NOT NULL
);
CREATE TABLE hosted_solana_import (
  role TEXT PRIMARY KEY REFERENCES hosted_solana_identity(role),
  source_sha256 TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  entry_count INTEGER NOT NULL CHECK (entry_count >= 0),
  committed_amount TEXT NOT NULL CHECK (committed_amount ~ '^[0-9]+$'),
  committed_fee TEXT NOT NULL CHECK (committed_fee ~ '^[0-9]+$'),
  imported_at TEXT NOT NULL
);
CREATE TABLE hosted_solana_ledger (
  role TEXT NOT NULL REFERENCES hosted_solana_identity(role),
  id TEXT NOT NULL,
  signature TEXT,
  amount TEXT NOT NULL CHECK (amount ~ '^[0-9]+$'),
  fee TEXT NOT NULL CHECK (fee ~ '^[0-9]+$'),
  header TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (role, id),
  UNIQUE (role, signature)
);
CREATE FUNCTION hosted_solana_permanent_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Solana identity and import records are permanent';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER hosted_solana_identity_guard BEFORE UPDATE OR DELETE ON hosted_solana_identity
  FOR EACH ROW EXECUTE FUNCTION hosted_solana_permanent_guard();
CREATE TRIGGER hosted_solana_import_guard BEFORE UPDATE OR DELETE ON hosted_solana_import
  FOR EACH ROW EXECUTE FUNCTION hosted_solana_permanent_guard();
CREATE FUNCTION hosted_solana_ledger_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Solana reservations and history cannot be deleted'; END IF;
  IF NEW.role <> OLD.role OR NEW.id <> OLD.id OR NEW.amount <> OLD.amount OR NEW.fee <> OLD.fee OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Solana payment facts are immutable';
  END IF;
  IF OLD.signature IS NOT NULL AND NEW.signature IS DISTINCT FROM OLD.signature THEN
    RAISE EXCEPTION 'Solana signature is immutable';
  END IF;
  -- Payer-only signature may become a fully sponsored payload once, before a public reference exists.
  IF OLD.signature IS NOT NULL AND NEW.header IS DISTINCT FROM OLD.header THEN
    RAISE EXCEPTION 'Solana sponsored payload is immutable';
  END IF;
  IF OLD.header IS NOT NULL AND NEW.header IS NULL THEN RAISE EXCEPTION 'Solana candidate cannot be erased'; END IF;
  IF OLD.header IS NOT NULL AND NEW.header IS DISTINCT FROM OLD.header AND NEW.signature IS NULL THEN
    RAISE EXCEPTION 'Solana unsigned candidate cannot be replaced';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER hosted_solana_ledger_guard BEFORE UPDATE OR DELETE ON hosted_solana_ledger
  FOR EACH ROW EXECUTE FUNCTION hosted_solana_ledger_guard();
