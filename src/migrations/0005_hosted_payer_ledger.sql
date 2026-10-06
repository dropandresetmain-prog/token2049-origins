-- Durable spend history for the hosted Cardano payer (dedicated demo wallet only; no historical ledger is imported).
-- The payer reserves spend BEFORE signing, keeps the exact signed payment header for identical resend, and never loses
-- history across restarts or redeploys. Rows are tied to one wallet identity and are append-only in effect:
-- no deletes of signed/accepted rows, and the facts of a payment can never be rewritten.

CREATE TABLE hosted_payer_identity (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  network TEXT NOT NULL,
  public_address TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE hosted_payer_ledger (
  purchase_id TEXT PRIMARY KEY,
  payer_address TEXT NOT NULL,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount_base_units TEXT NOT NULL CHECK (amount_base_units ~ '^[1-9][0-9]*$'),
  pay_to TEXT NOT NULL,
  -- signing = reserved against the caps, nothing sendable yet; signed = header exists; accepted = gateway took it.
  status TEXT NOT NULL CHECK (status IN ('signing','signed','accepted')),
  header TEXT,
  transfer_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((status = 'signing') = (header IS NULL))
);
CREATE INDEX hosted_payer_ledger_caps ON hosted_payer_ledger(payer_address, network, asset);

CREATE FUNCTION hosted_payer_ledger_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only an unsent reservation (signing failed in-process, nothing was signed) may be released.
    IF OLD.status <> 'signing' THEN RAISE EXCEPTION 'hosted payer ledger rows with a signed payment cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.purchase_id <> OLD.purchase_id OR NEW.payer_address <> OLD.payer_address OR NEW.network <> OLD.network OR NEW.asset <> OLD.asset
     OR NEW.amount_base_units <> OLD.amount_base_units OR NEW.pay_to <> OLD.pay_to OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'hosted payer ledger facts are immutable';
  END IF;
  IF OLD.status = 'accepted' AND NEW.status <> 'accepted' THEN RAISE EXCEPTION 'hosted payer ledger status cannot move backwards'; END IF;
  IF OLD.status = 'signed' AND NEW.status = 'signing' THEN RAISE EXCEPTION 'hosted payer ledger status cannot move backwards'; END IF;
  -- The signed payload is retained exactly: once set it can never change.
  IF OLD.header IS NOT NULL AND NEW.header IS DISTINCT FROM OLD.header THEN RAISE EXCEPTION 'hosted payer signed payload is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER hosted_payer_ledger_guard BEFORE UPDATE OR DELETE ON hosted_payer_ledger
  FOR EACH ROW EXECUTE FUNCTION hosted_payer_ledger_guard();

CREATE FUNCTION hosted_payer_identity_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'hosted payer identity is permanent';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER hosted_payer_identity_guard BEFORE UPDATE OR DELETE ON hosted_payer_identity
  FOR EACH ROW EXECUTE FUNCTION hosted_payer_identity_guard();
