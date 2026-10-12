-- Additive: allow X Layer (OKX) wallets and give each X Layer payer its own durable, append-only spend history.
-- Existing Cardano, Solana and Sui rows, histories and guards are untouched. A new rail has no legacy history to import.
ALTER TABLE registered_wallets DROP CONSTRAINT registered_wallets_rail_check;
ALTER TABLE registered_wallets ADD CONSTRAINT registered_wallets_rail_check CHECK(rail IN ('cardano','solana','sui','xlayer'));
CREATE TABLE hosted_xlayer_identity (
 owner TEXT PRIMARY KEY CHECK(owner ~ '^0x[0-9a-f]{40}$'), network TEXT NOT NULL, asset TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE hosted_xlayer_ledger (
 owner TEXT NOT NULL REFERENCES hosted_xlayer_identity(owner), id TEXT NOT NULL, amount TEXT NOT NULL CHECK(amount ~ '^[1-9][0-9]*$'),
 gas_budget TEXT NOT NULL CHECK(gas_budget ~ '^[1-9][0-9]*$'), nonce BIGINT CHECK(nonce IS NULL OR nonce >= 0),
 header TEXT, hash TEXT CHECK(hash IS NULL OR hash ~ '^0x[0-9a-f]{64}$'), created_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('reserved','signed','accepted')),
 PRIMARY KEY(owner,id), UNIQUE(hash), UNIQUE(owner,nonce),
 CHECK((status='reserved') = (header IS NULL)), CHECK((header IS NULL) = (hash IS NULL)), CHECK((header IS NULL) = (nonce IS NULL))
);
CREATE TRIGGER hosted_xlayer_identity_guard BEFORE UPDATE OR DELETE ON hosted_xlayer_identity
 FOR EACH ROW EXECUTE FUNCTION hosted_payer_identity_guard();
CREATE FUNCTION hosted_xlayer_ledger_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'X Layer reservations and candidates cannot be deleted'; END IF;
 IF NEW.owner<>OLD.owner OR NEW.id<>OLD.id OR NEW.amount<>OLD.amount OR NEW.gas_budget<>OLD.gas_budget OR NEW.created_at<>OLD.created_at THEN
  RAISE EXCEPTION 'X Layer reservation is immutable'; END IF;
 IF OLD.header IS NOT NULL AND (NEW.header IS DISTINCT FROM OLD.header OR NEW.hash IS DISTINCT FROM OLD.hash OR NEW.nonce IS DISTINCT FROM OLD.nonce) THEN
  RAISE EXCEPTION 'X Layer signed candidate is immutable'; END IF;
 IF (OLD.status='accepted' AND NEW.status<>'accepted') OR (OLD.status='signed' AND NEW.status='reserved') THEN
  RAISE EXCEPTION 'X Layer status cannot move backwards'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER hosted_xlayer_ledger_guard BEFORE UPDATE OR DELETE ON hosted_xlayer_ledger
 FOR EACH ROW EXECUTE FUNCTION hosted_xlayer_ledger_guard();
CREATE FUNCTION hosted_xlayer_permanent_guard() RETURNS trigger AS $$
BEGIN
 RAISE EXCEPTION 'X Layer spend history is permanent';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER hosted_xlayer_ledger_no_truncate BEFORE TRUNCATE ON hosted_xlayer_ledger
 FOR EACH STATEMENT EXECUTE FUNCTION hosted_xlayer_permanent_guard();
CREATE TRIGGER hosted_xlayer_identity_no_truncate BEFORE TRUNCATE ON hosted_xlayer_identity
 FOR EACH STATEMENT EXECUTE FUNCTION hosted_xlayer_permanent_guard();
