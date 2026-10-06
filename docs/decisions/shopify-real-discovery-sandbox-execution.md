# Shopify real discovery and controlled sandbox execution

Status: implemented and locally verified; external lane PARTIAL on 2026-10-06. This decision applies to `build/shopify-global-sandbox` only. See [external evidence](../evidence/shopify-global-sandbox-e2e.md).

## Settled

Discovery and execution are separate. A live Shopify Global Catalog offer identifies the source merchant, product, variant, item price, availability and observation time. The source merchant receives no order or payment. The equivalent transaction executes through Capsule's owned Shopify development store. Sandbox shipping and tax are its own charges, never assertions about source checkout charges.

`find_offers`, `create_quote`, `buy` and `get_purchase` remain the public operations. Retail intent may opt into `discovery: live`; omission or `controlled_catalog` preserves ordinary controlled-store discovery. No new MCP server, purchase model, payment rail, journal or checkout implementation exists.

Search has no store mutation. Selection through `create_quote` prepares one immutable shadow per Capsule offer and controlled store. Native unique custom ID `capsule_sandbox.offer_id`, PostgreSQL session locking and durable mapping recover an uncertain product-create result without title search or blind re-creation. One live offer has one immutable quote; repeated matching requests return it, changed fulfillment or expired quotes require fresh selection. The existing one-purchase-per-quote and pay-click checkpoint/reconciliation rules remain authoritative.

No source images or raw Catalog payloads are copied, downloaded, displayed or retained. Catalog searches always fetch fresh data; first preparation performs a live lookup and rejects source drift. Reduced Capsule offer records and selected transaction evidence are persisted. Shopify's no-caching guidance does not explicitly settle this transaction-retention interpretation; confirmation is Investigate Now before deployment or expanded use.

## Implemented

- Official UCP Global Catalog search/lookup, strict schema and source normalization. Typed USD, scale 2, quantity one; item cap USD100; intent ceiling also applies. Unsupported currencies fail; no FX engine.
- Exact owned store guard: `token2049-test-store.myshopify.com`, live `partnerDevelopment` plan, USD shop currency, explicit development/Bogus flags and configured publication GID.
- A physical, taxable, untracked-inventory, single-variant shadow at the exact source item price, with escaped source metadata, immutable digest, creation time and retained-demo lifecycle. No subscription or image.
- ACTIVE product publication, separate Admin publication readback, and independent Storefront sale-ready/price readback before ready. Existing General shipping profile is used.
- Ordinary Storefront search excludes the `capsule-sandbox` tag and reserved shadow title prefix. Direct product/variant lookup also excludes the prefix. Only internal preparation may include shadows for visibility readback.
- Existing Storefront cart, browser exact quote, Bogus gateway, hostname controls, execution, Admin readback and recovery are reused. Standalone settled `Shipping / Free` can mean zero only when it matches the selected rate and all existing subtotal/currency/tax/total/duplicate-row checks pass.
- Optional public source and sandbox provenance on offers, quotes, receipts and proof; source evidence cannot replace execution evidence. Fixture funding is explicitly simulated, independently of real discovery or real Shopify evidence.
- Migration `0003_shopify_shadows.sql`: durable mapping plus unique live-source quote per offer. No dependencies, real-chain calls or deployed funding bypass added.
- Test-only manual harness with loopback PostgreSQL, forbidden chain environment variables, one cart per invocation, explicit stop-before-pay boundary, and a read-only retained-purchase ambiguity guard before paid mode. `--resume-before-pay` recovers preparation only; it cannot retry payment or bypass quote expiry.

## External proof and remaining blockers

Real Catalog discovery, selected-source refresh, exactly one shadow creation, native-ID recovery, publication and independent Storefront readback passed. The real checkout quote guard stopped; no immutable real quote, approval, funding, Pay, order or receipt was produced in this lane. Full checkout/order/proof is covered only by labelled local fixtures.

A preceding E2E lane has an unresolved post-Pay outcome. Its purchase remains held unresolved. This lane did not retry payment or inherit the later diagnostic-only E2E commit. Read-only reconciliation of that original attempt must precede any new paid test.

Cross-currency handling, cleanup scheduling and delegated judge budgets are Park for Later. Shadows remain retained for the demo/audit window; cleanup must preserve source mapping and order evidence. Explicit approval of the exact sandbox total remains required.

## Runtime configuration and scopes

New variable: `SHOPIFY_SANDBOX_PUBLICATION_ID` (publication GID, not a secret). Global Catalog uses the public Shopify example UCP agent profile by default; its profile can be injected only through internal client construction. No new production fixture switch.

Shadow runtime Admin scopes: `read_products`, `write_products`, `write_publications`. `read_publications` is useful for setup discovery, not required when the publication ID is supplied. Existing independent order verification still needs `read_orders`; Storefront catalog/cart permissions and browser configuration remain required. Untracked shadow inventory avoids adding inventory/location scopes. Current credentials already have broader scopes; tighten them separately after validating the existing lane's needs. No scope expansion was performed.
