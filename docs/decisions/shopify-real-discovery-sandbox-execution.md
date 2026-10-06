# Shopify real discovery and controlled sandbox execution

Status: integrated into main @ 8a76225364bf3b56fe2bf192297ee17b86d8f540. Product decision is settled; external acceptance is PARTIAL.

## Decision

Discovery and execution are intentionally separate.

Live discovery:
official Shopify Global Catalog/UCP -> real source merchant/product/variant/item price/availability.

Execution:
selected source offer -> one durable shadow product in Capsule's owned Shopify development store -> Capsule's existing exact quote/browser/Bogus sandbox execution.

The source merchant receives no order or payment.

Correct framing:
Capsule discovered the live offer from the real merchant and executed the equivalent merchant transaction through Capsule's controlled Shopify sandbox.

Never claim Capsule purchased from the source merchant.

## Public interface

No Shopify-specific MCP/purchase API was introduced.

Existing generic operations remain:
- find_offers
- create_quote
- buy
- get_purchase

Retail intent may opt into live discovery. Omission preserves the deterministic controlled-store flow.

## Proven externally

PASS:
- official Global Catalog access;
- real live discovery;
- selected-source refresh;
- exactly one durable shadow creation;
- recovery by Capsule-owned native identity;
- publication;
- independent Storefront readback.

Observed real source in lane evidence:
Mercury K1 Lite – Transparent Black from GravaStar, USD 89.95 at observation time.

This is historical evidence, not a permanently seeded product.

## Not externally proven

- exact shadow sandbox checkout quote: PARTIAL / unresolved;
- paid shadow order: NOT RUN;
- real receipt from this flow: NOT PRODUCED.

Do not upgrade these based on local fixtures.

## Shadow rules

- create only after one source offer is selected;
- one source offer -> one durable mapping;
- no catalogue synchronization;
- do not copy/rehost source images;
- clearly label Capsule sandbox representation;
- preserve source provenance separately from sandbox charges/order;
- retain shadows during the hackathon audit/demo window;
- cleanup later must not destroy proof.

## Commercial truth

Source observed item price is not the source merchant's all-in checkout price.

Capsule sandbox shipping, tax and total are separate facts. Exact human approval is for the Capsule sandbox total.

Current lane is USD/US, quantity-one, bounded item amount; FX and SG support are later work.

## Idempotency/recovery

Durable PostgreSQL shadow mapping and locking prevent duplicate shadow creation. The existing Capsule quote/purchase/pay-click/reconciliation model remains authoritative for execution.

Unknown Pay/order outcomes never justify another Pay.

## Provider guidance risk

Global Catalog no-caching guidance does not clearly settle reduced durable transaction-provenance retention. Clarify before broader deployed operation; do not retain raw search payloads or images.

## Evidence

See:
- docs/evidence/shopify-global-sandbox-e2e.md
- docs/evidence/e2e-acceptance-log.md
- docs/KNOWN_ISSUES.md
