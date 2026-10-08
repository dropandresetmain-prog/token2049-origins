-- Retain a Sui signed public transaction authorization (never a private key) before broadcast.
-- This closes process loss between durable candidate preparation and RPC submission.
ALTER TABLE funding_attempts ADD COLUMN recovery_payload_json TEXT;
ALTER TABLE funding_attempts DROP CONSTRAINT funding_attempts_status_check;
ALTER TABLE funding_attempts ADD CONSTRAINT funding_attempts_status_check
  CHECK (status IN ('pending', 'recorded', 'failed'));
