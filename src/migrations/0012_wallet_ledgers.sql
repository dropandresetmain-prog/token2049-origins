-- New-wallet namespaces preserve legacy singleton/role identities and import markers unchanged.
CREATE TABLE wallet_cardano_identity (
 singleton TEXT PRIMARY KEY, network TEXT NOT NULL, public_address TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER wallet_cardano_identity_guard BEFORE UPDATE OR DELETE ON wallet_cardano_identity
 FOR EACH ROW EXECUTE FUNCTION hosted_payer_identity_guard();
CREATE TABLE wallet_cardano_ledger (LIKE hosted_payer_ledger INCLUDING ALL);
CREATE TRIGGER wallet_cardano_ledger_guard BEFORE UPDATE OR DELETE ON wallet_cardano_ledger
 FOR EACH ROW EXECUTE FUNCTION hosted_payer_ledger_guard();
CREATE TABLE wallet_solana_identity (
 role TEXT PRIMARY KEY, owner TEXT UNIQUE NOT NULL, network TEXT NOT NULL, mint TEXT NOT NULL
);
CREATE TABLE wallet_solana_import (
 role TEXT PRIMARY KEY REFERENCES wallet_solana_identity(role), source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'),
 entry_count INTEGER NOT NULL CHECK(entry_count >= 0), committed_amount TEXT NOT NULL CHECK(committed_amount ~ '^[0-9]+$'),
 committed_fee TEXT NOT NULL CHECK(committed_fee ~ '^[0-9]+$'), imported_at TEXT NOT NULL
);
CREATE TABLE wallet_solana_ledger (
 role TEXT NOT NULL REFERENCES wallet_solana_identity(role), id TEXT NOT NULL,
 signature TEXT, amount TEXT NOT NULL CHECK(amount ~ '^[0-9]+$'), fee TEXT NOT NULL CHECK(fee ~ '^[0-9]+$'),
 header TEXT, created_at TEXT NOT NULL, PRIMARY KEY(role,id), UNIQUE(role,signature)
);
CREATE TRIGGER wallet_solana_identity_guard BEFORE UPDATE OR DELETE ON wallet_solana_identity
 FOR EACH ROW EXECUTE FUNCTION hosted_solana_permanent_guard();
CREATE TRIGGER wallet_solana_import_guard BEFORE UPDATE OR DELETE ON wallet_solana_import
 FOR EACH ROW EXECUTE FUNCTION hosted_solana_permanent_guard();
CREATE TRIGGER wallet_solana_ledger_guard BEFORE UPDATE OR DELETE ON wallet_solana_ledger
 FOR EACH ROW EXECUTE FUNCTION hosted_solana_ledger_guard();
-- One sponsor fee cap across every customer wallet using the same protected gas sponsor.
CREATE TABLE wallet_sponsor_policy (owner TEXT PRIMARY KEY, max_fee_lamports TEXT NOT NULL CHECK(max_fee_lamports ~ '^[1-9][0-9]*$'));
CREATE TRIGGER wallet_sponsor_policy_guard BEFORE UPDATE OR DELETE ON wallet_sponsor_policy
 FOR EACH ROW EXECUTE FUNCTION hosted_solana_permanent_guard();
CREATE TABLE hosted_sui_identity (
 owner TEXT PRIMARY KEY, network TEXT NOT NULL, asset TEXT NOT NULL,
 source_sha256 TEXT NOT NULL CHECK(source_sha256 ~ '^[0-9a-f]{64}$'), entry_count INTEGER NOT NULL CHECK(entry_count >= 0),
 committed_amount TEXT NOT NULL CHECK(committed_amount ~ '^[0-9]+$'), committed_gas TEXT NOT NULL CHECK(committed_gas ~ '^[0-9]+$'),
 imported_at TEXT NOT NULL
);
CREATE TABLE hosted_sui_ledger (
 owner TEXT NOT NULL REFERENCES hosted_sui_identity(owner), id TEXT NOT NULL, amount TEXT NOT NULL CHECK(amount ~ '^[1-9][0-9]*$'),
 gas_budget TEXT NOT NULL CHECK(gas_budget ~ '^[1-9][0-9]*$'), header TEXT, digest TEXT, created_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('reserved','signed','accepted')),
 PRIMARY KEY(owner,id), UNIQUE(digest),
 CHECK((status='reserved') = (header IS NULL)), CHECK((header IS NULL) = (digest IS NULL))
);
CREATE TRIGGER hosted_sui_identity_guard BEFORE UPDATE OR DELETE ON hosted_sui_identity
 FOR EACH ROW EXECUTE FUNCTION hosted_payer_identity_guard();
CREATE FUNCTION hosted_sui_ledger_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Sui reservations and candidates cannot be deleted'; END IF;
 IF NEW.owner<>OLD.owner OR NEW.id<>OLD.id OR NEW.amount<>OLD.amount OR NEW.gas_budget<>OLD.gas_budget OR NEW.created_at<>OLD.created_at THEN
  RAISE EXCEPTION 'Sui reservation is immutable'; END IF;
 IF OLD.header IS NOT NULL AND (NEW.header IS DISTINCT FROM OLD.header OR NEW.digest IS DISTINCT FROM OLD.digest) THEN
  RAISE EXCEPTION 'Sui signed candidate is immutable'; END IF;
 IF (OLD.status='accepted' AND NEW.status<>'accepted') OR (OLD.status='signed' AND NEW.status='reserved') THEN
  RAISE EXCEPTION 'Sui status cannot move backwards'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER hosted_sui_ledger_guard BEFORE UPDATE OR DELETE ON hosted_sui_ledger
 FOR EACH ROW EXECUTE FUNCTION hosted_sui_ledger_guard();

-- Identity uniqueness must span legacy and multi-wallet tables, so an empty namespace cannot hide prior exposure.
CREATE FUNCTION wallet_identity_namespace_guard() RETURNS trigger AS $$
DECLARE identity TEXT;
BEGIN
 identity=COALESCE(to_jsonb(NEW)->>'public_address',to_jsonb(NEW)->>'owner');
 PERFORM pg_advisory_xact_lock(hashtextextended('wallet-history-identity:'||identity,0));
 IF TG_TABLE_NAME='wallet_cardano_identity' AND EXISTS(SELECT 1 FROM hosted_payer_identity WHERE public_address=identity) THEN RAISE EXCEPTION 'legacy Cardano wallet must retain canonical history'; END IF;
 IF TG_TABLE_NAME='hosted_payer_identity' AND EXISTS(SELECT 1 FROM wallet_cardano_identity WHERE public_address=identity) THEN RAISE EXCEPTION 'registered Cardano wallet already has canonical history'; END IF;
 IF TG_TABLE_NAME='wallet_solana_identity' AND EXISTS(SELECT 1 FROM hosted_solana_identity WHERE owner=identity) THEN RAISE EXCEPTION 'legacy Solana wallet must retain canonical history'; END IF;
 IF TG_TABLE_NAME='hosted_solana_identity' AND EXISTS(SELECT 1 FROM wallet_solana_identity WHERE owner=identity) THEN RAISE EXCEPTION 'registered Solana wallet already has canonical history'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER wallet_cardano_namespace_guard BEFORE INSERT ON wallet_cardano_identity FOR EACH ROW EXECUTE FUNCTION wallet_identity_namespace_guard();
CREATE TRIGGER legacy_cardano_namespace_guard BEFORE INSERT ON hosted_payer_identity FOR EACH ROW EXECUTE FUNCTION wallet_identity_namespace_guard();
CREATE TRIGGER wallet_solana_namespace_guard BEFORE INSERT ON wallet_solana_identity FOR EACH ROW EXECUTE FUNCTION wallet_identity_namespace_guard();
CREATE TRIGGER legacy_solana_namespace_guard BEFORE INSERT ON hosted_solana_identity FOR EACH ROW EXECUTE FUNCTION wallet_identity_namespace_guard();
