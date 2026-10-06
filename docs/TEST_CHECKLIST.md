# Capsule test checklist — final-candidate gates

Baseline: main @ 8a76225364bf3b56fe2bf192297ee17b86d8f540

This is the current gate for remaining work. Historical lane checklists/evidence remain retained separately.

## A. Local candidate gate

- clean npm ci
- local PostgreSQL healthy
- fresh migrations 0001–0003
- migration rerun/checksum enforcement
- npm run typecheck
- npm run build
- full unit/contract/integration suite
- Cardano and Solana funding/recovery regressions
- Shopify deterministic regressions
- Shopify Global/shadow/idempotency regressions
- Atlas and Nuitée regressions
- OCBC normalization/read-only checks
- MCP needs_input / approval / duplicate behavior
- evidence/proof provenance
- PostgreSQL concurrency/idempotency/recovery
- UI/runtime tests after V3 wiring
- compiled gateway smoke
- compiled MCP smoke
- git diff --check
- bounded secret scan
- clean exact candidate SHA

## B. Seed/preflight gate

For the chosen final demo:
- selected provider inventory/rate/product exists now
- exact demo market/currency supported
- buyer/traveller fixtures valid
- provider credentials/readiness pass
- chosen funding wallet/asset/balances pass
- protected payer/sponsor histories/caps valid
- PostgreSQL demo customer/client state valid
- public origin final before funded quote
- UI is reading live candidate state, not fixture IDs

Use docs/demo/SEED_DATA.md.

## C. Deployment gate

- exact candidate deployed
- origin/main/deployed SHA recorded
- APP_ENV=sandbox
- final PUBLIC_BASE_URL
- Render internal DATABASE_URL
- migrations applied
- Chromium runtime verified
- required Shopify/provider tokens valid
- Cardano/Solana receive/verifier config valid
- payer keys not on Render
- /health and readiness checked
- customer/payer/operator clients provisioned as needed
- proof UI accessible
- backup/fallback captured before consequential run

## D. External E2E gate

Run one canonical flow on exact frozen SHA:

intent
-> needs_input if required
-> offer
-> exact quote
-> explicit funding selection
-> explicit approval
-> one testnet funding action
-> confirmed funding evidence
-> exactly one provider execution attempt
-> independent provider readback
-> receipt/proof

PASS requires chain and provider evidence to agree.

If any irreversible result becomes unknown:
- stop writes;
- do not retry;
- preserve DB/evidence;
- reconcile read-only;
- verdict UNRESOLVED.

## E. Current recorded evidence (not the final gate)

| Lane | Recorded external status |
| --- | --- |
| Cardano | PASS real Preprod funding/recovery; merchant fixture |
| Solana | PASS finalized Devnet funding/recovery; merchant fixture |
| Nuitée | PASS sandbox booking/readback; USD 96.24 final |
| Atlas | Ticketing PASS; ambiguous-create recovery unverified |
| OCBC | Read-only observations/history PASS |
| Shopify deterministic | Paid attempt UNRESOLVED |
| Shopify Global | Discovery/shadow PASS; exact quote partial; paid not run |
| MCP | Protocol/local PASS; ChatGPT host unverified |
| UI | Design V3 approved; runtime not wired |
| Masumi | Not integrated |

## F. Final review and submission gate

After all chosen lanes are integrated:
- Astra final review+fix on exact candidate
- rerun directly affected + final full gate
- final external E2E
- no secrets committed
- README/setup/architecture current
- sponsor technology claims match evidence
- required video/deck/forms/screenshots/links complete
- canonical demo fallback recording available

Do not use a combined local test count as proof of external commerce success.
