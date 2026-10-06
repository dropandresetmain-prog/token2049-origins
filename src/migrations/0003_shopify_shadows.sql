-- One immutable source snapshot and provider representation per selected Capsule offer/store.
CREATE TABLE shopify_shadow_mappings (
  offer_id TEXT NOT NULL REFERENCES offers(id),
  store_domain TEXT NOT NULL,
  source_digest TEXT NOT NULL,
  source_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('preparing','ready')),
  representation_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (offer_id, store_domain),
  CHECK ((state = 'ready') = (representation_json IS NOT NULL))
);

-- Defense in depth if a provisioning session disconnects before persisting its frozen quote.
CREATE UNIQUE INDEX quotes_one_live_source_offer ON quotes(offer_id)
WHERE execution_ref_json::jsonb ? 'sourceOffer';
