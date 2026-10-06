# Hosted Solana MCP lane

Base: 0234d20a11e80285318c88511195c5f2d51c0df8. Branch: feat/hosted-solana-mcp. Status: PARTIAL, implementation and local verification complete; hosted resources unprovisioned.

## Intended behavior

Hosted OAuth MCP may connect independent Cardano and Solana private payer bridges. Quote exposes both connected sources only after their actual readiness checks. An explicit Solana selection invokes only the Solana bridge; failure returns an honest error. Existing core purchase, provider and x402 transaction semantics remain in use.

One Render private service runs the existing Solana payer and facilitator on separate authenticated ports, with two protected histories on a persistent disk. Public gateway holds only bridge/facilitator bearer secrets, public identity/network/recipient configuration, and the dedicated payer gateway token hash. Signer files remain exclusively on the private service. No tunnel or laptop dependency.

## Official path and eligibility

Checked 2026-10-07: [Solana agentic x402 guidance](https://solana.com/docs/payments/agentic-payments/x402), [official facilitator guide](https://solana.com/docs/tools/x402-facilitator), [Render private networking](https://render.com/docs/private-network), [persistent disks](https://render.com/docs/disks), [pricing](https://render.com/pricing). Existing Capsule facilitator already verifies exact Devnet genesis, USDC mint, recipient token account, amount, immutable signed transaction, sponsor and payer budgets. Hosting it privately is the smallest change; Kora is optional and does not remove these boundaries.

Current npm registry versions checked: @x402/svm 2.28.0 and @solana/kit 8.4.0. This lane deliberately retains known-good locked 2.26.0 / 5.1.0 rather than combining hosting with a payment-library migration. Official public Devnet RPC is used; rate limits can cause readiness to fail closed. No paid RPC introduced.

BuilderBase Solana track wording, read in the signed-in event dashboard: a functional Devnet/Mainnet Beta program or meaningful integration of existing Solana programs qualifies; read-only frontend data does not. Judges require an example transaction, public/judge-accessible code, working demo and disclosure of preexisting work. Existing retained finalized SPL USDC transfer/Nuitée evidence supports the commerce rail. This lane adds hosting, but cannot claim its own real hosted transaction yet. Deadline shown: 2026-10-07 23:59 Singapore. Link: https://builderbase.com/track-dashboard/token2049-origins-hackathon/event-site .

## Deployment resources and exact blocker

Blueprint: deploy/render-solana.yaml; Dockerfile.solana. One Singapore Starter private service + 1 GB disk is $7.25/month at checked prices ($7 compute + $0.25 disk). The existing free public gateway can send private-network traffic in the same workspace/region. Use the actual Render Internal hostname, not an assumed display name. Service autodeploy is off. Canonical Render deployment and render.yaml were not changed.

Read-only Render API: live gateway deploy dep-db2luemgekts73ff3g4g uses common base SHA, service srv-db2jgqnavr4c73e9blrg. No Solana private service exists. Render Billing UI explicitly says No card on file. Paid private service/disk requires the human to add billing and provision. No platform mutation was attempted.

## Operator steps after provisioning

1. Add Render billing; create the private service from this lane Blueprint in the existing workspace/region. Keep it private. Add only its dedicated payer/sponsor keys as secret files; do not reuse historical local demo identities or ledgers. Create/fund dedicated Devnet identities and token accounts via supported testnet tools; no mainnet funds. Payer, sponsor and treasury must be distinct.
2. Set exact actual private hostname on facilitator URL/pin and bridge Host allowlist. Use separate random bearer secrets for bridge, facilitator and the payer gateway client. Caps in the template allow at most 0.01 Devnet USDC cumulatively plus bounded sponsor fees; adjust only deliberately before demonstration.
3. In the private service shell, run npm run payer:solana:hosted:init-history once. It scans complete finalized chain history and refuses if either history already exists. Directory is /var/data/solana. Missing, corrupt, stale locked, incomplete or exhausted history fails closed. Never delete histories to recover budget.
4. Configure a rehearsal gateway with deploy/hosted-solana-gateway.env.example and the exact public addresses/caps; hash the dedicated payer gateway token for MCP_SOLANA_PAYER_GATEWAY_TOKEN_SHA256. Do not put signer files on the web service. This task has not changed the protected canonical deployment.
5. Run npm run payer:solana:hosted:preflight in the gateway shell: authenticated GET /supported and GET /status only. Record the exact supported scheme/network/signers and readiness projection. Quote through OAuth MCP must show both Connected. Do not call buy or /pay for this smoke.
6. Run npm run payer:solana:hosted:history before and after a controlled service restart. Retain matching file digests and entry counts; then rerun readiness/preflight. Fingerprints contain no signed payloads or secrets. This proves persistent history only when performed on the deployed disk.
7. One hosted Devnet payment requires explicit authorization after all preceding checks pass. Do not book another hotel. Unknown settlement is reconciled from the retained signed candidate and chain/gateway readback; never construct a new payment blindly.

## Verification and review

Local tests and external proof are separate. Initial affected set: 102/102 tests across seven files. Added OAuth integration checks: 2/2 after fixing an overlong fixture display address. Full repo: 51 files, 978/978 tests passed once. Typecheck and build passed. These exercise real OAuth/HTTP transport with test payer/facilitator seams; no hosted service or external payment is implied. Final CLI additions passed typecheck, production build and no-configuration fail-closed smoke. After the final bridge credential and packaging fixes, the directly affected hosted configuration/OAuth set passed 70/70 tests across three files. The full suite was not repeated.

- Act Now — Read-only preflight must be present in the production gateway image. Added its compiled entry to tsconfig.build.json and invoke it with Node; no dev-only tsx dependency in the gateway. Deferring would make the deployment check unusable.
- Act Now — Rail bridge credentials must be distinct to keep their authority separate. Configuration now rejects identical Cardano/Solana bridge tokens.
- Act Now — Durable atomic rename needed directory fsync on Linux, otherwise an abrupt host failure could lose a spend reservation. Fixed directory fsync after both initialization and update; existing ledger suite passes. Deferring could weaken spend caps.
- Act Now — Hosted signer readiness must include both protected histories, network/mint/accounts, both keys, sponsor funds, and exact authenticated facilitator capabilities. Added fail-closed hosted readiness; deferring could advertise a broken or unsafe source.
- Investigate Now — Actual private Host/peer networking, secret file permissions and disk restart persistence must be demonstrated after provisioning. Code and fixtures cannot prove Render behavior. Do not call lane PASS before those checks.
- Investigate Now — Track example-transaction requirement needs the retained core evidence plus a judge-accessible hosted demonstration. No new deployment or signature claimed.
- Ignore / Accept Risk — HTTP is confined to exact pinned Render private origin with private peers, Host allowlist and constant-time bearer authentication, following existing hosted payer topology. Platform private network is the trust boundary; public HTTP hosts are rejected.
- Park for Later — Managed RPC and Kora migration. Current official Devnet RPC and existing verified facilitator are sufficient until evidence shows a gap. Deferral may cause demo availability delays under RPC quota.

## Presentation hook and integration impact

Hook: Choose Cardano or Solana; Capsule honors your selected funding source.

Shared files: package.json scripts, tsconfig.build.json preflight entry, hosted MCP config/router, Solana facilitator config, ledger directory durability, affected hosted MCP tests. No shared UI/docs or root render.yaml edit. Integration must reconcile package scripts with other lanes and rerun affected payment/OAuth checks. This lane is not merged or deployed. Recommend a fresh integration chat only after external readiness/persistence evidence exists.

## Newer main discovered after lane creation

Origin/main advanced during this parallel build to 57fde8a64e3a3065c9db938e2b7c2e07b51309fa. All four lanes keep their exact common base; none was rebased or merged. New main introduces a public HTTPS free Cardano payer and PostgreSQL history. It changes hosted MCP config/router/tests and removes private BridgeAccess, isPrivatePeer and listenPrivate from clients/payer/bridge.ts. This Solana lane deliberately requires a private signer service and imports those older private helpers, so a direct merge into newer main will need code reconciliation, not just conflict resolution. Preserve new main Cardano behavior while restoring isolated Solana private access or moving the private bridge into a separate Solana module. Do not switch Solana to a public signer to avoid billing. Integration risk is HIGH until that adaptation and affected security tests pass.
