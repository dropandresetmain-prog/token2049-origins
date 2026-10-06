# Setup, verification and reference ledger

> Historical planning snapshot: persistence alternatives in this source are superseded by the PostgreSQL-only decision in docs/RUNBOOK.md. The original planning text below is retained as history.

Release: `launch-2026-10-06-v1`. Configuration names below are project-facing proposals, not claims about vendor environment-variable names. The implementation lead maps them once to the chosen SDK, then keeps examples and readiness checks synchronized.

## Who does what

Min Htet supplies account access, approvals, keys, funding and publication decisions. Opus handles code, local tooling, safe wallet-generation scripts, schema/contract work, tests and sanitized readiness checks. Do not ask for secrets in chat or copy previous `.env` files into a new project.

No provider, wallet, faucet or current credential was exercised in this planning update. User-reported prior access is useful context, not fresh end-to-end evidence.

## Readiness matrix

| Dependency | Current basis | Provision / verify | Work possible without it |
|---|---|---|---|
| Implementation GitHub repo | `token2049-origins` found empty via connector | Clone/init safely; authenticate push | Local docs/code in verified target |
| Runtime / persistence | Not inspected on user's machine | Compatible Node/TS and one durable DB | Schemas/tests/setup scripts |
| Atlas | Prior integration located | Sandbox client ID/secret, allowed payment mechanism, quote->pay->retrieve | Source inspection, adapter/tests |
| Nuitée/LiteAPI | Prior adapter located | Sandbox key, request headers/base URL, actual booking/payment mode | Adapter/tests |
| Shopify | Core; access not exercised | Dev store, permitted buyer checkout, products/variants, test gateway, order readback/webhook | Worker/adapter and fixtures |
| OCBC | Existing access user-reported | Sandbox endpoints/scopes and masked account/card read evidence | Observation adapter and schema tests |
| Direct Cardano | Official starter documented | Preprod project/RPC, real payer/treasury, fee ADA, exact test-token unit/decimals | SDK integration, signer/verification tests |
| Solana | Official x402 guide documented | Devnet RPC, payer/treasury and token accounts, SOL, exact test-USDC mint | Shared contract; separate lane tests |
| Masumi/Sokosumi | Workshop + organizer preference | Current API/standard, payment service, wallets/token policy, registration/listing, fee/principal timing | Parallel service/wrapper against contract fixtures |
| ChatGPT/MCP | Desired demo client | HTTPS endpoint, current client tool configuration/auth, approval/signing path | Thin server/client tests |
| Console/deployment | Not provisioned | Existing deploy target with persistent storage and secret injection | Redacted read model and local UI |
| CRE | Secondary | Current CLI/auth, permitted workflow simulation/deploy access | Defer until core |
| Coinbase CDP/exchange, NOWNodes | Stretch | Only investigate when intentionally scheduled | No mandatory setup |

## Safe configuration groups

**Core:** `APP_ENV`, `DATABASE_URL` or `DATABASE_PATH`, `PUBLIC_BASE_URL`, per-channel auth configuration, approved demo spend limits. Missing provider secrets must not prevent the core/test suite from starting. A provider route must clearly report not configured.

**Cardano gateway:** `CARDANO_NETWORK`, `CARDANO_PROVIDER_URL`, `CARDANO_PROVIDER_PROJECT_ID` (secret if required), `CARDANO_TREASURY_ADDRESS`, `CARDANO_ASSET_UNIT`, `CARDANO_ASSET_DECIMALS`, facilitator configuration derived from the selected SDK. Never load payer keys into gateway config.

**Cardano payer process:** local key/seed file reference, network/provider access and per-purchase/cumulative caps. Generate keys without printing mnemonic/secret bytes into terminal/tool transcripts. Provide only public address and funding instructions to the user.

**Solana:** `SOLANA_RPC_URL`, exact network ID, `SOLANA_TREASURY_ADDRESS`, `SOLANA_USDC_MINT`, token decimals and readiness of associated token accounts. Payer key reference lives in its separate process. Do not assume gas sponsorship; fund the actual chosen fee payer and account-creation costs.

**Commerce:** `ATLAS_BASE_URL`, `ATLAS_CLIENT_ID`, `ATLAS_CLIENT_SECRET`; `NUITEE_BASE_URL`, `NUITEE_API_KEY`; `SHOPIFY_STORE_DOMAIN`, chosen API version, buyer API/UCP credentials where granted, restricted order-read/admin verification token where needed, webhook secret, fixed permitted test gateway. Only include credentials used by the actual execution route; do not make a broad catalog credential a prerequisite for buying a known dev-store product.

**OCBC:** verified sandbox base URL, subscribed API auth credentials and masked account/card references. Derive exact field names from the source integration/catalog rather than guessing. Account/card reads are not an issuance/charge capability.

**Masumi:** lane-owned configuration follows its actual current standard/service. It includes Preprod network, payment asset unit, service endpoint/auth, registration and gateway channel auth. Do not alias its tUSDM ticker to the direct SDK token without checking policy ID + asset name + decimals.

No live card PAN/CVV, mainnet payer keys, traveller passport data or real payment credentials are needed for first-lane acceptance. Keep local key files, `.env`, raw receipts/traces and runtime DB out of Git. External receipts must be redacted before publication.

## Funding amounts

Full quoted merchant principal must be covered by the payment or an explicitly approved funding design. A faucet grant that covers a 0.01-token test resource may not fund a full hotel/flight example. Count expected fresh runs and gas/UTxO/token-account overhead before choosing scenarios.

Do not mint a lookalike USDC/tUSDM token and call it the official asset. Do not secretly map a 1-token payment to a 150-USD booking. Prefer sufficient faucet/dispenser funding or a legitimately small quote. Any explicit sandbox denomination scheme would be a separate decision and clearly labeled.

## Critical evidence gaps and dispositions

- **Atlas payment mechanism — Investigate Now.** Existing transaction adapter explicitly supports sandbox balance/deposit only. Verify other supported methods; do not reintroduce supplier credit silently. Any sandbox-only exception needs a visible decision.
- **Masumi pre-execution funding — Investigate Now.** Workshop page 10 places result/payment request before escrow funding. Do not assume funds are committed early enough to cover purchase principal.
- **Shopify programmatic completion — Investigate Now.** Current docs include escalation. Prove completion on the actual store; browser checkout remains allowed. Admin paid-state mutations do not count.
- **OCBC capability — Investigate Now.** Existing bank/card access must be freshly checked. Never label local balance mutation an OCBC transaction.
- **Testnet/SDK compatibility — Investigate Now.** Verify network IDs, assets, supported facilitator pairs, headers and settlement timing. A common 402 shape alone proves nothing.
- **Credential leakage / financial double count — Act Now.** Tests and execution boundaries must prevent both before demo.
- **Production custody, redemption and universal merchant acceptance — Park for Later.** Document limitations; no production readiness claim.

## References checked for this planning update

These establish documentation/source behavior, not runtime access. Vendor docs govern API facts; founder scope remains in `ARCHITECTURE_DECISIONS.md`.

### User-provided authoritative material

- `Pasted text.txt`: previous product evolution, constraints and track summaries. Final founder corrections override abandoned recommendations such as FollowThrough and supplier-credit core.
- BuilderBase track screenshots for Cardano, Solana, Chainlink and NOWNodes; main-event screenshot is incomplete. Preserve original rule text rather than invent a main rubric.
- `Masumi Workshop TOKEN2049 Origins.pdf`: page 10 task/result -> escrow -> payout; pages 12–15 distinguish seller/buyer/Coworker routes; page 16 lists API access at noon and the 7 October 23:59 deadline.
- Organizer message quoted by founder: strongly recommends a useful Masumi-standard agent live on Preprod and registered on Sokosumi. Treat as judging/distribution guidance, not a rewritten formal rule.

### Existing project references — read only

- `dropandresetmain-prog/qoder-atlas` at `e79c387ebacc5a9e4a9350666e0dd8a501921d01`:
  - `src/providers/hotel/nuiteeAdapter.ts` (located through live code search).
  - `src/providers/atlas/transactionAdapter.ts` (read header/options and payment guard; sandbox test-balance limitation verified).
  - `src/providers/atlas/client.ts`, `types.ts`, `adapter.ts` are dependencies referenced by the transaction file; inspect as needed, not assumed independently audited here.
- OCBC source location was not established by the current scoped code search. Inspect the user-designated banking project/local clone at launch, without running or modifying it.
- Prior provider implementations may be references, not permission to import Northstar/Somebody runtime logic. Check hackathon reuse rules, disclose SDK/scaffolding/reused code and pin provenance. When permission is unclear, write fresh bounded integration code from public APIs rather than importing old project modules.

### Public technical references

- Cardano Express starter: https://developers.cardano.org/templates/x402-express/
  Confirms generated Preprod wallet, Blockfrost prerequisite and receipt-producing reference flow. Inspect its source for transaction timing and exact SDK versions.
- Solana x402: https://solana.com/docs/payments/agentic-payments/x402
  Describes V2 protocol, Devnet identifiers and verification requirements. Use SDK-generated fields and verified facilitator support.
- Shopify Checkout MCP: https://shopify.dev/docs/agents/carts-and-checkout/checkout-mcp
  Includes authenticated checkout and escalation to merchant UI. It does not establish that our credentials can complete every store's checkout.
- Shopify test payments: https://help.shopify.com/en/manual/checkout-settings/test-orders/payments-test-mode
  Merchant-side test behavior; no connected OCBC sandbox issuer is implied.
- Masumi listing: https://www.masumi.network/dev/masumi/documentation/how-to-guides/list-agent-on-sokosumi
  Requires registered agent and MIP-003-compatible API; specifies exact USDM/tUSDM units and a submission process. Workshop-specific launch workflow may differ; check it rather than assuming instant listing.
- Workshop quickstart provided in slides: https://www.masumi.network/token2049
  Not retrievable through the web tool in this planning pass; parallel lane should use current mentor-provided access.
- OpenAI MCP server guide: https://developers.openai.com/plugins/build/mcp-server
  Current guide for the channel implementation; using MCP alone does not provide payment signing/authority.
- CRE overview: https://docs.chain.link/cre/getting-started/overview
  Workflow simulation is different from a deployed/verified decentralized service.
- PCI SSC FAQ 1280: https://www.pcisecuritystandards.org/faqs/1280/
  Do not retain card verification codes after authorization, including for concierge/card-on-file use. This is why storing a reusable real CVV in environment secrets is not the design.

## Capture format

For each external acceptance run, store a redacted evidence manifest with: commit, command, time, purchase/quote ID, principal/fee, public network/asset, tx reference, provider environment and order/payment status, verification method, journal IDs and result. Keep raw logs/PII local and ignored. Never overwrite prior successful evidence; add a new run.
