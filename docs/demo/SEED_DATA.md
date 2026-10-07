# Capsule demo seed and preflight policy

## Why this exists

Earlier E2E work showed that demo/demo-data.json can describe the scenario we want while external sandboxes contain different state. Canonical demo data is a configuration SSOT, not evidence that a product, rate, wallet balance or market actually exists.

Every final run therefore has two layers:

1. desired scenario / controlled seed;
2. external preflight proving reality matches the scenario.

## Canonical scenario SSOT

demo/demo-data.json may contain:
- synthetic buyer/traveller profiles;
- search constraints;
- controlled product references;
- relative date offsets;
- quantity/caps;
- settlement policy;
- human-facing scenario labels.

It must not contain:
- secrets;
- wallet private material;
- API keys;
- dynamic transaction/order IDs;
- assumed provider success;
- stale live Global Catalog selections.

## Planned seed/preflight structure

Preferred eventual commands/modules:

scripts/demo-seed/*
- mutate only systems Capsule owns and is authorized to seed.

scripts/demo-preflight/*
- read actual external state and fail clearly when it differs.

Do not create a giant cross-provider mutation script if read-only verification is enough.

## Required preflight matrix

### Shopify deterministic
Verify:
- exact controlled product/variant exists;
- published to Storefront;
- expected price;
- inventory/sellability;
- supported demo market;
- shipping options;
- test gateway;
- browser/PCI hosts;
- Admin read credentials.

Known current constraint: use the evidenced USD/US synthetic buyer path; Singapore sellability is unresolved.

### Shopify Global
Verify at runtime:
- official Global Catalog reachable;
- live query returns viable USD offers;
- selected source offer is refreshed before preparation;
- source availability/price/currency still valid;
- publication ID configured;
- shadow mapping is unique and recoverable;
- source and sandbox provenance remain distinct.

Do not hardcode a live Global Catalog product ID as the demo.

### Nuitée
Verify:
- sandbox key;
- target search dates/location produce a bookable rate;
- prebook/fee shape compatible with current adapter;
- saved demo customer profile (`customerProfile`; see hosted MCP doc);
- enough sandbox capability for one demo run.

### Atlas
Verify:
- sandbox auth;
- target route/date returns a usable offer;
- latest fees compatible with guard;
- test-balance path only when explicitly authorized;
- do not use an ambiguous prior create as a reason to send another create.

### Cardano
Verify:
- Preprod network;
- exact asset identity;
- treasury;
- Blockfrost/facilitator;
- payer wallet;
- tADA and test-stablecoin balance;
- absolute protected payer ledger;
- remaining caps/history.

Never reset ledger/history to regain budget.

### Solana
Verify:
- Devnet;
- exact USDC mint/token accounts;
- payer/treasury SOL;
- payer USDC;
- sponsor/preparation service;
- protected payer/sponsor histories and caps.

### PostgreSQL / clients
Verify:
- target database/schema;
- migrations;
- demo customer/client records;
- customer/payer identity relationship;
- no stale unresolved state will be mistaken for a new demo purchase.

### Masumi/Sokosumi
For the integrated native fee/task runtime, verify existing state read-only; do not recreate a paid task to refresh evidence. Public marketplace prerequisites remain separate and unverified:
- MPS health;
- Preprod wallet/payment state;
- agent/listing/task IDs;
- public endpoint/auth;
- task delivery;
- exact native fee payout and separate direct principal funding;
- marketplace state.

### UI
Verify:
- displayed scenario corresponds to actual quote/purchase/provider evidence;
- no hardcoded green state;
- no stale tx/order IDs;
- correct environment labels.

## Reset policy

Reset only controlled, non-authoritative demo state.

Never reset:
- payer ledgers/cap histories;
- unresolved purchase/provider attempts;
- immutable journal/history;
- external provider orders;
- evidence needed to reconcile ambiguity.

Prefer new quote/purchase IDs for fresh authorized runs.

## Final rule

A demo run begins only after preflight PASS for the chosen provider + funding rail. A configuration file saying something exists is never sufficient.
