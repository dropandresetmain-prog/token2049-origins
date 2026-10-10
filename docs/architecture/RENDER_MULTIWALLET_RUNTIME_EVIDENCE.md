# Render multiwallet runtime evidence

Research retrieved **2026-10-10 (Asia/Singapore)** from official Render, OpenAI, and Model Context Protocol documentation. The opened Render and OpenAI documentation pages did not expose a publication or last-updated date. The Render changelog entry for WebSocket idleness is dated **2026-02-24**. Render's compute-plan documentation says plan IDs changed in **August 2026**.

## Current read-only account evidence (10 October 2026)

Read-only authenticated Render CLI/API inspection verified:

- Database `token2049-origins-db`, ID `dpg-db29mujncjis73dtvf70-a`: Free PostgreSQL 18, Singapore, available; created `2026-10-06T06:55:54.699333Z`, expires `2026-11-05T06:55:54.699333Z` (**5 November 14:55:54 Singapore**). No HA, replica, managed pool or disk autoscaling. External-access allowlist is loopback-only; no network permission changed.
- Gateway `srv-db2jgqnavr4c73e9blrg`, `https://token2049-origins.onrender.com`: Free; live deployment `dep-db36quvlk1mc739kfp20` at known-good main `7c09b37eaaeda2bf3eec94fc1e3456118962f636`.
- Cardano payer `srv-db2mnk1srm7s73c1f5c0`, `https://t2o-cardano-payer.onrender.com`: Free. Reuse this service for the consolidated candidate only after approval.
- Solana payer `srv-db35psid0e5s73f7ltng`, `https://t2o-solana-payer.onrender.com`: Free. Preserve current authority until approved fencing.
- Workspace `tea-db1tjj1srm7s73d6vra0` shares its Free quota with other projects. No unrelated resource allocation was consumed or changed.

A protected read-only Cardano status request returned five accepted entries, no signing/signed entries, 94,820 committed units and 5,005,180 headroom. Its permanent import marker retains four entries / 66,830 units and source hash `0909a33e5de6296ebccb5df2a5f700c67e16a800cc3d195d8465fb25d46b9381`. This is history/cap evidence, not current chain-balance or candidate acceptance.

Protected historical Sui snapshot hash `3db74885426ee2e7e42226d3a4ebb64b0ab8834babc09ea35049fdcfee7817f0` retains two signed entries: 35,900 token units and 20,000,000 MIST gas budget. Both exact signatures/transaction facts verified offline against read-only canonical historical purchases. One rejected timestamp candidate and one historically successful checkout remain signed in the source ledger; neither was dropped or reclassified. No existing key was read or moved and no history was imported into Render.

**UNVERIFIED:** remaining workspace instance-hours/build minutes/bandwidth, payment-method/spend-limit configuration, latest owner-managed database export/restore, current Solana remaining exposure and actual consolidated Render initialization/memory/cold-start behavior. CLI metadata is not a quota balance. No candidate deploy occurred.

## Official Free-plan limits

| Area | Official documented limit / behavior | Evidence boundary |
|---|---|---|
| Free web service compute | `free` web plan: 0.1 CPU, 512 MB RAM. | Plan specification only; does not prove current service plan or runtime RSS. [Render compute plans](https://render.com/docs/compute-plans#web-service-plans) |
| Idle behavior | Spin down after 15 minutes without inbound HTTP requests or messages on an existing WebSocket; next HTTP request/new WebSocket connection triggers wake, which takes about one minute. Render may restart Free web services at any time. | Documented platform behavior; no true idle cold-start rehearsal is recorded for this candidate. [Render Free plan](https://render.com/docs/free#free-web-services), [WebSocket change, 2026-02-24](https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages) |
| Monthly runtime pool | 750 Free instance-hours per workspace per calendar month; spun-down services do not consume hours; the pool resets monthly and services suspend if exhausted. | Workspace-shared allowance; current remaining hours and total competing Free services are unknown. [Render Free plan](https://render.com/docs/free#monthly-usage-limits) |
| Bandwidth/build | Free web services use the workspace's included outbound-bandwidth and build-pipeline allowances. Depending on payment method and spend limit, excess usage may incur charges or disable services/builds. | Exact workspace allowance, remaining usage, billing setup, and build minutes are not proven here. [Render Free plan](https://render.com/docs/free#monthly-usage-limits) |
| Local filesystem / networking | Free web services use an ephemeral filesystem, have one instance, no persistent disks, and cannot receive private-network traffic; they may send private-network requests to same-region Render data stores and paid services. | Design implications only. Keep payer history in the existing database, never rely on local files for durable state. [Render Free plan](https://render.com/docs/free#other-limitations) |
| Free Postgres | 1 GB storage; expires 30 days after creation, followed by a 14-day grace period before deletion; Render may restart or maintain it; no managed connection pooling. Compute-plan page lists Free Postgres at 0.1 CPU, 256 MB, maximum 100 connections. | Current read-only metadata establishes the exact instance expiry above; account quota balances remain unknown. [Render Free plan](https://render.com/docs/free#free-postgres), [Postgres compute plans](https://render.com/docs/compute-plans#render-postgres-plans) |
| Backups/recovery | Render provides no Free Postgres backup or PITR. Manual `pg_dump` from a client is documented. | **Owner-managed export/backup status is unknown.** No export file/cadence was inspected. [Render recovery and backups](https://render.com/docs/postgresql-backups#logical-backups) |

## Conservative no-spend acceptance budget

These are recommended guardrails for accepting work on the published Free plan; they are not Render guarantees or limits.

- Keep aggregate Free web-service runtime at or below **600 instance-hours/month** across the workspace, reserving 150 hours below the 750-hour ceiling. Count gateway and consolidated payer together and include other Free services in the same workspace. Verify current usage in the owner dashboard before relying on this budget.
- Keep measured peak RSS at or below **350 MB per 512 MB Free web instance**, including the retained Playwright/Chromium workload, leaving about 160 MB for runtime/platform overhead and short spikes. Measure during the actual browser checkout path; a build-time Chromium smoke alone does not establish runtime memory.
- Keep outbound bandwidth and build-pipeline usage within the owner's actual included allowances. Since those allowances and remaining balances are UNVERIFIED here, this document cannot certify a no-spend month from published limits alone. Capture dashboard balances and spend-limit/payment configuration before acceptance.
- Use the official cold-start expectation (about one minute) as a user-facing latency budget for an idle Free service; do not use a wake-preparation request to disguise that delay. No candidate cold-start measurement is claimed.

## MCP, OAuth, progress, and OpenAI host constraints

The current MCP core spec is version **2026-07-28**. For HTTP authorization it uses OAuth 2.1-based authorization, protected-resource metadata, resource-bound tokens and bearer authorization on each request; the resource server must validate that tokens are intended for it. The current spec deprecates Dynamic Client Registration in favor of Client ID Metadata Documents, while retaining DCR for compatibility. Sources: [MCP 2026-07-28 authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [MCP core overview](https://modelcontextprotocol.io/specification/2026-07-28/basic).

OpenAI's ChatGPT/Codex plugin guide expects OAuth 2.1 conforming to MCP, including protected-resource metadata and PKCE, and requires the server to validate issuer, audience, expiry, and scopes. Tool-level OAuth linking requires auth metadata and a runtime `_meta["mcp/www_authenticate"]` challenge. For the Responses API, OpenAI documents a caller-supplied access token in the MCP tool's `authorization` field and explicit per-tool-call approval controls. Sources: [OpenAI MCP plugin authentication](https://developers.openai.com/plugins/build/auth), [OpenAI API MCP tools](https://developers.openai.com/api/docs/guides/tools-connectors-mcp).

MCP progress is optional. A client includes a unique `progressToken`; a server may send `notifications/progress` with increasing values or may send none. The Responses API reference documents `response.mcp_call.in_progress`, `.completed`, and `.failed`, but public docs do not confirm that arbitrary MCP progress notifications are surfaced to the model/client or that the current MCP Tasks extension is supported. Keep long-running browser/provider work resumable and validate visible progress behavior against the actual host before relying on it. This documentation lane did not initiate a provider call or test OAuth/progress behavior. Sources: [MCP progress](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress), [OpenAI Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events), [MCP Tasks extension](https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks).

## Local production-image check

The actual Node24 Linux production payer image passed eight disposable-key signing/serialization checks: Cardano Evolution/x402 signatures and metadata, Solana transfer/memo/signatures, Sui transaction/candidate/replay-bound nonce. Docker used `--network none --memory 512m --cpus 0.1 --read-only` and a16MiB temporary filesystem; no chain broadcast/provider write or existing-key access. Node24.21.0, Evolution0.5.14, x402Cardano2.26.0, SolanaKit5.1.0, MystenSui2.35.0. Measured peak RSS137.2MiB. This establishes local Linux cryptography compatibility, not hosted network, cold-start or merchant-checkout memory acceptance. Fixture provider data does not establish live chain readiness.

## Verification boundary

| Gate | Status | Evidence / remaining check |
|---|---|---|
| Existing infrastructure plans, PG18/network/expiry | PASS — read-only | Current authenticated metadata above; no resource mutation. |
| Ownership, nine provider/rail compositions, durable ledgers | Local fixture/native-PG verification | See task ledger for exact final commands/results; no external merchant/chain writes. |
| Historical Sui signatures/history | PASS — offline/read-only | Both retained signatures verified against historical canonical requirements; no hosted import. |
| Existing MCP OAuth/proof/console regression | Local verification | Final recorded gate lives in task ledger; actual host checks pending deployment. |
| Candidate Render signer initialization/memory/restart | UNVERIFIED | Existing-service deployment requires owner approval; local Linux checks do not substitute. |
| Retained Playwright actual merchant timing/memory | UNVERIFIED for candidate | No provider-side checkout preflight performed; owner live tests required. |
| Workspace remaining quota/no-spend capacity | UNVERIFIED | Owner account dashboard/access needed; preserve unrelated project allocation. |
| Database backup/restore | UNVERIFIED | Free has no managed backup; approved internal export method needed. |
| Nine new hosted live purchases | NOT RUN | Owner executes manual matrix after readiness. |

**Act Now:** approved protected backup/export before expiry and process/credential fencing before signer activation. **Investigate Now:** account quota/spend settings and actual Render candidate runtime. **Ignore / Accept Risk:** documented Free cold starts, subject to durable recovery. No candidate deployment, existing-wallet signing, chain broadcast, provider write, authoritative database mutation or secret relocation occurred. Local signing tests use disposable keys and fixtures only.
