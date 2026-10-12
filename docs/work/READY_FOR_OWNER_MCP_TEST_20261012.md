# Capsule paired release and activation — 12 October 2026

**READY_FOR_OWNER_MCP_TEST — LIVE E2E NOT YET VERIFIED**

## Authorization and exact deployment

The owner explicitly authorized deployment of c788418 to both existing Free services, verification, then enabling the three existing wallets and purchases if all gates passed. No further approval was requested. No customer purchase, quote, chain broadcast, merchant write, key relocation, cap/policy change, main promotion or infrastructure replacement was performed.

- Branch: codex/capsule-e2e-reliability; code SHA **c7884181ee0a23e535390b6f199217278465d638**. Later documentation commits do not change the deployed artifacts.
- Gateway: srv-db2jgqnavr4c73e9blrg / **dep-db67kdp42hec73b7fslg**, LIVE/Free.
- Payer: srv-db2mnk1srm7s73c1f5c0 / **dep-db67s6dckfvc73cfe94g**, LIVE/Free. Disabled verification deployment was dep-db67kdks728c73ffj660.
- Manual Render API commitId deployment; service branch remains codex/capsule-neon-migration, auto-deploy remains off. No branch retarget, main merge or obsolete repair-runner invocation.
- Actual gateway dist:139files / **0572598240edd56e681f08cd218f4969ab3b6b617880fb4020f8587b0dfdf663**. Actual payer dist:79files / **d2d7d70fd7f347ad97161ef892f2eff6a5ab6b1c5035a55ec68f411192429bc6**. Verified from startup attestations over actual Render filesystem bytes, not source equality.
- Startup command computes the regular-file dist fingerprint, refuses mismatch, then starts the normal server. The disabled payer performed one explicit bounded three-source initialization/readiness check. Activated normal startup removes that check and has no wallet RPC fan-out.
- Environment changes: MULTIWALLET_INSTANCE_ID capsule_3945f9c52cf7 → capsule_c7884181ee0a; MULTIWALLET_SIGNING_ENABLED temporarily false, finally true. All other environment values match the saved originals. Secret files were neither uploaded nor changed.
- Exactly three registrations/grants enabled for capsule_c7884181ee0a; original saved client scopes restored atomically after gates. Numeric token caps remain5100000per-payment/daily/total on all three rails. Gas/sponsor roles and fee limits remain independent and unchanged.
- Worker version00ee6d4a-afdd-4807-ad05-f46d33fa1986/moduleSHAdc652cc9fc9f22de757e0d35387e15726f985ba3929f162180313dab515cbf15; bindings unchanged, no schedules, no Worker mutation. Existing expired management OAuth was refreshed with the existing Wrangler4.149.0 session; no new consent/access.

## Gates and preserved evidence

1. Preflight: exact prior revisions, canonical verified-TLS database binding, Free plans/auto-deploy off, original identities/caps/scopes, retired fences, and zero open purchases/jobs/funding/merchant attempts/handoffs.
2. Temporary fence: existing demo write/fund scopes removed, three grants/registrations disabled, two services suspended before snapshot. Existing read-only console scopes were preserved/restored by its unchanged bootstrap.
3. Consistent backup and full disposable restore:44tables/985rows, PostgreSQL18.6; all table hashes/schema/functions/triggers/indexes/constraints/policies/sequences/default ACLs/app role match. BackupSHA **368061aa2a45b735717878d27a37790aa24a738f078482d204bd14c840ce39b3**. Private backup root consolidation-1791785284162. No authoritative restore or migration. The owned disposable restore database and its temporary container dump were removed after verification; the protected backup and original test database/container remain.
4. Actual disabled runtime: both fingerprints match; original Cardano/Solana/Sui identity/history initialization and read-only chain checks PASS. Node24.21.0;149456KiB peak.
5. Disabled hosted gate:37PASS; OAuth/PKCE, meaningful sign-in copy, metadata/audience, MCP tools, fixed invalid-ID400transport contract, historical ticket/receipt/proof, three registered sources, no unsafe artifact URLs/secrets, disabled scope/grant state and financial hashes.
6. Normal enabled-flag runtime with grants still fenced: exact payer build/fingerprint, expected environment differences only, no operator startup fan-out, no in-flight work/history drift.
7. Atomic owner-authorized grant/registration enable and exact original client scope restoration.
8. Final hosted gate:38PASS; exact live builds, initialized MCP, registered sources configured, original authority/scopes, historical ticket/proof, retired fences, no open transaction work and unchanged financial histories. Completed **2026-10-12T06:40:10.792Z**.
9. Historical proof link opened in actual deployed console: Ticket issued / TESTA20261011232029042 /0.0743TestnetUSDC; receipt/proof controls visible. No new purchase.

Operator checker corrections: its initial fence assertion incorrectly allowed only purchases:read and rejected the existing console's evidence:read/operator:read. Inspection proved these were the saved original read-only permissions; the checker was corrected without relaxing write/signing gates. Worker management initially returned401 from an expired session; normal existing-session refresh resolved it and all version/module/binding checks passed. Neither incident was an application/custody failure.

Protected journal and raw evidence: ~/.capsule/neon-migration-20261011/e2e-release-20261012-c788418. Local bounded runners: C:/Dev/token2049-origins/.runtime/e2e-release-20261012.mjs, e2e-hosted-verify-20261012.mjs, e2e-worker-readonly-20261012.mjs. No credential values, signed candidates or private exports are in Git.

## Verification boundaries and known limits

- Local closing gate reported27files/447PASS; root/console typechecks and clean-room builds passed in the implementation lane. This release independently ran3Cardano/bridge files/86PASS and the hosted gates above. No full-suite rerun is claimed.
- Current hosted transport checks were warm. The two genuine cold proofs on11October apply to prior gateway86f5194/payer3945f9c and are retained in PAYER_READINESS_REPAIR.md; they are not relabeled c788418cold acceptance. Timeout nesting/Worker are unchanged. Owner tests must observe cold behavior.
- Historical Sui reservations/signed candidates and the completed11October flight remain unchanged, including blocked exposure. Pending outcomes retain caps and existing candidates. Never reset them for headroom.
- Fresh live purchases: **all nine NOT RUN** on c788418. No agent live commerce or settlement test occurred.
- Secure provider ticket/voucher PDFs remain unavailable. Capsule supplies verified references, receipt and proof links; no fabricated document or real reservation claim.
- Demo ownership is one protected configured customer. Console public read-only demo access is fixed to that customer's redacted data, not general consumer onboarding.
- Free quota final snapshot: Hobby/no card/accrued/projectedUSD0;110.92/750hours,76/500pipeline minutes,140MB/5GB,6/25services. Shared counters may lag. No additional resources or paid changes.

## Owner handoff

MCP: https://token2049-origins.onrender.com/mcp
OAuth issuer: https://token2049-origins.onrender.com/
Console: https://token2049-origins.onrender.com/console/
Historical proof: https://token2049-origins.onrender.com/console/#/purchases/pur_01M4NRRCVHXW6GZEX35S7H20EM

Follow [the official refresh instructions](https://developers.openai.com/plugins/deploy/connect-chatgpt), fetched12October: open the existing connection in [ChatGPT Plugins](https://chatgpt.com/plugins), select Refresh, confirm updated metadata, and start a new conversation. Reconnect OAuth if needed. The existing passphrase remains unchanged; copy privately:

```powershell
Get-Content -Raw -LiteralPath 'C:/Dev/token2049-setup/secrets/hosted-demo/mcp-owner-passcode' | Set-Clipboard
```

Use [the nine-row manual sheet](../demo/MULTIWALLET_MANUAL_ACCEPTANCE.md). Every row starts with fresh search/dates/offers/quotes; explicitly select the offer, registered wallet, exact total and funding terms before buy. Do not repeat historical/expired purchases. On unknown outcomes retain the purchase ID and poll get_purchase; no second payment, wallet switch or booking. Retry only if the canonical result explicitly proves it safe.

**Stop here. Owner performs all purchases.**
