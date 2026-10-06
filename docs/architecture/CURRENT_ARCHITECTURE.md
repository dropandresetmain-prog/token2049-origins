# Capsule current architecture

Baseline: main @ 8a76225364bf3b56fe2bf192297ee17b86d8f540

## System shape

External agent / host
        |
        | HTTP or thin MCP
        v
Authenticated Capsule API
        |
        +--> input assessment / needs_input
        +--> offer discovery
        +--> immutable quote + authority
        +--> selected funding adapter
        +--> durable purchase / jobs / journal
        +--> provider executor
        +--> evidence / proof

Separate bounded payer/signer processes hold spending keys. The gateway never loads payer private keys.

## Core boundaries

### Channels
Implemented:
- canonical HTTP
- thin MCP

Planned/unverified:
- actual ChatGPT host connection
- Masumi/Sokosumi channel

Channels translate and authenticate. They do not own provider logic, funding truth or journal writes.

### Commerce contract

Provider-neutral operations:
- find offers
- create exact quote
- buy approved quote
- fund purchase
- get purchase/status
- get proof

Normalized categories:
- retail
- hotel
- flight

Current default routes:
- retail -> Shopify
- hotel -> Nuitée
- flight -> Atlas

Multi-provider aggregation is intentionally not part of this hackathon baseline.

### Funding

Implemented:
- Cardano Preprod
- Solana Devnet

Quote exposes zero or more ready funding options. Human explicitly selects fundingOptionId; approval binds the exact quote and selected option.

Public-testnet settlement uses the disclosed 1:1000 notional policy. Commercial money and chain asset quantities remain distinct assets in the journal/evidence model.

Masumi funding, if integrated later, must be another funding adapter and may not bypass purchase-principal verification.

### Execution/recovery

Execution is asynchronous and durable:
- PostgreSQL purchase/job state;
- irreversible-attempt checkpoint before provider write;
- provider-specific readback;
- unknown outcome -> unresolved;
- no blind duplicate execution.

PostgreSQL job claims use row locks/fencing. One gateway/worker topology remains the supported hackathon launch shape.

## Provider adapters

### Shopify deterministic
Capsule-owned development-store product -> Storefront cart/exact quote -> controlled browser checkout -> Bogus test payment -> Admin readback.

External paid acceptance currently remains unresolved.

### Shopify Global judge sandbox
Official Shopify Global Catalog/UCP discovery -> selected real source offer -> one durable shadow product in Capsule dev store -> publication/readback -> same controlled quote/execution machinery.

Source merchant and sandbox merchant are separate provenance chains. Source merchant receives no order/payment.

Current external state: discovery/shadow PASS; exact sandbox quote partial/unresolved; paid order not run.

### Atlas
Search/quote/create/pay/ticket/readback in Atlas sandbox. Test balance is explicitly sandbox synthetic capacity, not card settlement. Ticketing passed; ambiguous-create recovery remains unverified.

### Nuitée
Search/prebook/book/readback in LiteAPI sandbox. Paid sandbox booking passed for tested path.

### OCBC
Read-only account/card/history observations. OCBC never writes Capsule treasury/journal/capacity truth.

## Persistence

PostgreSQL only.

Key durable concepts:
- customers/API clients;
- offers;
- quotes;
- purchases;
- funding requirements/evidence/attempts;
- reservations;
- execution attempts/checkpoints;
- jobs;
- immutable journal;
- provider/bank observations;
- Shopify shadow mappings.

Migrations are append-only after application.

## Evidence

Truth dimensions stay separate:
- purchase lifecycle;
- customer funding state;
- provider commerce status;
- merchant payment status;
- observed chain evidence;
- simulated sandbox accounting.

Customer proof is a projection over durable truth, not a second state machine.

Historical/fixture evidence carries provenance labels and cannot become fresh external evidence by environment configuration.

## UI

Approved V3 is currently a design reference only. Runtime should consume the same proof/core data and must not infer paid/completed state from visual heuristics.

## Security model

- bearer clients map server-side to customer/channel/scopes;
- no caller-selected arbitrary payee/amount/network;
- payer keys isolated;
- secrets outside Git;
- network/host allow-lists around consequential provider calls;
- synthetic buyer data in sandboxes;
- no production mode;
- no blind retries after unknown irreversible actions.
