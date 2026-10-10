-- Registrations are capability records, not cached chain balances. Existing purchases/history stay unchanged.
CREATE TABLE payer_profiles (
 id TEXT PRIMARY KEY, customer_id TEXT UNIQUE NOT NULL REFERENCES customers(id), created_at TEXT NOT NULL
);
CREATE TABLE registered_wallets (
 source_id TEXT PRIMARY KEY CHECK(source_id ~ '^src_[0-9a-f]{32}$'),
 payer_id TEXT NOT NULL REFERENCES payer_profiles(id),
 rail TEXT NOT NULL CHECK(rail IN ('cardano','solana','sui')),
 network TEXT NOT NULL, asset_id TEXT NOT NULL, public_address TEXT NOT NULL,
 signer_ref TEXT NOT NULL, ledger_namespace TEXT NOT NULL, policy_json TEXT NOT NULL CHECK(jsonb_typeof(policy_json::jsonb)='object'),
 public_json TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE,
 UNIQUE(network,public_address), UNIQUE(rail,ledger_namespace)
);
CREATE TABLE purchase_wallets (
 purchase_id TEXT PRIMARY KEY REFERENCES purchases(id),
 source_id TEXT NOT NULL REFERENCES registered_wallets(source_id),
 customer_id TEXT NOT NULL REFERENCES customers(id),
 source_json TEXT NOT NULL
);
CREATE FUNCTION registered_wallet_identity_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'wallet ownership cannot be deleted'; END IF;
 IF (to_jsonb(NEW) - 'enabled') IS DISTINCT FROM (to_jsonb(OLD) - 'enabled') THEN
  RAISE EXCEPTION 'wallet ownership, policy reference and public identity are immutable';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER registered_wallet_identity_guard BEFORE UPDATE OR DELETE ON registered_wallets
 FOR EACH ROW EXECUTE FUNCTION registered_wallet_identity_guard();
CREATE TRIGGER payer_profile_guard BEFORE UPDATE OR DELETE ON payer_profiles
 FOR EACH ROW EXECUTE FUNCTION hosted_payer_identity_guard();
CREATE TRIGGER purchase_wallet_guard BEFORE UPDATE OR DELETE ON purchase_wallets
 FOR EACH ROW EXECUTE FUNCTION hosted_payer_identity_guard();
-- A service credential is reachability, not signing authority. Cutover grants this row only after retiring old signers.
CREATE TABLE wallet_signing_authority (
 source_id TEXT PRIMARY KEY REFERENCES registered_wallets(source_id),
 instance_id TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE FUNCTION purchase_wallet_insert_guard() RETURNS trigger AS $$
DECLARE p purchases; w registered_wallets; customer TEXT;
BEGIN
 SELECT * INTO p FROM purchases WHERE id=NEW.purchase_id;
 SELECT * INTO w FROM registered_wallets WHERE source_id=NEW.source_id;
 SELECT customer_id INTO customer FROM payer_profiles WHERE id=w.payer_id;
 IF customer IS DISTINCT FROM p.customer_id OR NEW.customer_id IS DISTINCT FROM customer OR
  (p.approval_json::jsonb->>'selectedSourceId') IS DISTINCT FROM NEW.source_id OR w.rail IS DISTINCT FROM p.funding_rail OR
  (w.public_json::jsonb) IS DISTINCT FROM (NEW.source_json::jsonb) OR NOT w.enabled THEN
  RAISE EXCEPTION 'purchase source must match canonical customer and approval';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER purchase_wallet_insert_guard BEFORE INSERT ON purchase_wallets
 FOR EACH ROW EXECUTE FUNCTION purchase_wallet_insert_guard();
