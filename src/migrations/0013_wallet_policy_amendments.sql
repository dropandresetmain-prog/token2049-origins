-- Explicit owner policy amendments preserve immutable registrations and every ledger entry.
CREATE TABLE wallet_policy_amendments (
 source_id TEXT NOT NULL REFERENCES registered_wallets(source_id), revision INTEGER NOT NULL CHECK(revision>0),
 previous_policy_json TEXT NOT NULL, policy_json TEXT NOT NULL,
 authorization_reference TEXT NOT NULL CHECK(length(authorization_reference) BETWEEN 8 AND 200),
 created_at TEXT NOT NULL, PRIMARY KEY(source_id,revision),
 CHECK(jsonb_typeof(previous_policy_json::jsonb)='object'), CHECK(jsonb_typeof(policy_json::jsonb)='object')
);
CREATE FUNCTION wallet_policy_amendment_guard() RETURNS trigger AS $$
DECLARE wallet registered_wallets; prior wallet_policy_amendments; baseline jsonb; allowed TEXT[];
BEGIN
 SELECT * INTO wallet FROM registered_wallets WHERE source_id=NEW.source_id FOR UPDATE;
 IF wallet.enabled OR EXISTS(SELECT 1 FROM wallet_signing_authority WHERE source_id=NEW.source_id AND enabled) THEN
  RAISE EXCEPTION 'disable wallet and signing authority before amending its policy';
 END IF;
 SELECT * INTO prior FROM wallet_policy_amendments WHERE source_id=NEW.source_id ORDER BY revision DESC LIMIT 1;
 baseline:=COALESCE(prior.policy_json,wallet.policy_json)::jsonb;
 IF NEW.revision<>COALESCE(prior.revision,0)+1 OR NEW.previous_policy_json::jsonb<>baseline THEN
  RAISE EXCEPTION 'policy amendment must extend exact canonical policy';
 END IF;
 allowed:=ARRAY['maxAmount','maxPerPayment','maxDaily','maxTotal','maxCommercial'];
 IF (NEW.policy_json::jsonb - allowed) IS DISTINCT FROM (baseline - allowed) THEN
  RAISE EXCEPTION 'policy amendment cannot change identity, recipient, gateway or gas authority';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER wallet_policy_amendment_insert BEFORE INSERT ON wallet_policy_amendments
 FOR EACH ROW EXECUTE FUNCTION wallet_policy_amendment_guard();
CREATE TRIGGER wallet_policy_amendment_immutable BEFORE UPDATE OR DELETE ON wallet_policy_amendments
 FOR EACH ROW EXECUTE FUNCTION hosted_payer_identity_guard();
CREATE TRIGGER wallet_policy_amendment_no_truncate BEFORE TRUNCATE ON wallet_policy_amendments
 FOR EACH STATEMENT EXECUTE FUNCTION hosted_solana_permanent_guard();
