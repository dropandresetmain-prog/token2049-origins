-- Preserve operator-accepted historical ambiguity without granting replay authority.
CREATE TABLE hosted_solana_source_archive (
  role TEXT PRIMARY KEY REFERENCES hosted_solana_import(role),
  source_text TEXT NOT NULL,
  policy_text TEXT NOT NULL
);
CREATE TRIGGER hosted_solana_archive_guard BEFORE UPDATE OR DELETE ON hosted_solana_source_archive
  FOR EACH ROW EXECUTE FUNCTION hosted_solana_permanent_guard();

CREATE TABLE hosted_solana_blocked_history (
  role TEXT NOT NULL DEFAULT 'payer' CHECK (role = 'payer'),
  purchase_id TEXT PRIMARY KEY,
  message_sha256 TEXT UNIQUE NOT NULL CHECK (message_sha256 ~ '^[0-9a-f]{64}$'),
  candidate_sha256 TEXT UNIQUE NOT NULL CHECK (candidate_sha256 ~ '^[0-9a-f]{64}$'),
  payer_signature TEXT UNIQUE NOT NULL,
  classification TEXT NOT NULL CHECK (classification = 'historical_unresolved'),
  replay_policy TEXT NOT NULL CHECK (replay_policy = 'permanently_blocked'),
  evidence TEXT NOT NULL,
  FOREIGN KEY (role, purchase_id) REFERENCES hosted_solana_ledger(role, id)
);
CREATE TRIGGER hosted_solana_blocked_guard BEFORE UPDATE OR DELETE ON hosted_solana_blocked_history
  FOR EACH ROW EXECUTE FUNCTION hosted_solana_permanent_guard();

CREATE FUNCTION hosted_solana_blocked_ledger_guard() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM hosted_solana_blocked_history WHERE role = OLD.role AND purchase_id = OLD.id) THEN
    RAISE EXCEPTION 'Historical unresolved Solana attempt is permanently blocked';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER hosted_solana_blocked_ledger_guard BEFORE UPDATE OR DELETE ON hosted_solana_ledger
  FOR EACH ROW EXECUTE FUNCTION hosted_solana_blocked_ledger_guard();

CREATE TRIGGER hosted_solana_archive_no_truncate BEFORE TRUNCATE ON hosted_solana_source_archive
  FOR EACH STATEMENT EXECUTE FUNCTION hosted_solana_permanent_guard();
CREATE TRIGGER hosted_solana_blocked_no_truncate BEFORE TRUNCATE ON hosted_solana_blocked_history
  FOR EACH STATEMENT EXECUTE FUNCTION hosted_solana_permanent_guard();
CREATE TRIGGER hosted_solana_ledger_no_truncate BEFORE TRUNCATE ON hosted_solana_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION hosted_solana_permanent_guard();
