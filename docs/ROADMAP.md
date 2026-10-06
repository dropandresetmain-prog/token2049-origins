# Capsule remaining hackathon roadmap

Integration base: main @ 84c0aef7a7acd1851c590c54ccd8881b9dc365d5; native Masumi source is integrated and its gate is docs/work/MASUMI_INTEGRATION.md.

Goal: smallest reliable, judge-clear system that proves agent-native funding -> ordinary commerce -> verifiable result.

## P0 — finish before final submission

### 1. Bound the remaining Sokosumi marketplace milestone
- Native Masumi fee/task/payout is integrated and independently verified; escrow is never merchant principal.
- Public host/listing, platform authentication and actual marketplace delivery remain unverified.
- Prepare that separate milestone only if it improves the chosen demo; do not block the canonical flow on it.
- Preserve native database, wallet and recovery history; do not repeat a paid task just to refresh evidence.

### 2. Seed/preflight audit
Implement the policy in docs/demo/SEED_DATA.md across:
- Shopify deterministic and Global/shadow paths;
- Nuitée;
- Atlas;
- Cardano;
- Solana;
- PostgreSQL demo identities/state;
- native Masumi fee/task runtime;
- UI/proof scenario references.

Outcome: one pre-demo command/checklist that verifies actual external state rather than trusting JSON.

### 3. Runtime UI V3
Wire the approved DESIGN.md / UI V3 into the runtime transaction/proof experience.
Prioritize:
- purchase intent and amount;
- agent/channel;
- explicit funding source;
- chain/testnet proof;
- provider execution/result;
- receipt/evidence;
- truthful pending/unknown states.

Do not build a shopping storefront or duplicate the agent conversation.

### 4. Deployment
Deploy the exact chosen candidate to Render:
- APP_ENV=sandbox;
- Render PostgreSQL internal DATABASE_URL;
- final PUBLIC_BASE_URL;
- required provider/funding secrets only;
- payer/signers remain separate/local where designed;
- migrations/readiness/browser runtime verified.

### 5. Client/host verification
- MCP stdio is implemented and locally proven.
- Verify ChatGPT host only if it materially strengthens the submission/demo.
- Preserve generic find_offers/create_quote/buy/get_purchase; do not add provider-specific MCP surfaces.

### 6. Final Astra review+fix
Run on the exact fully integrated candidate.
Focus on:
- money/approval/funding correctness;
- idempotency/recovery;
- provider truthfulness;
- deployment/security/secrets;
- demo reliability;
- sponsor-track compliance.
Fix Act Now findings, re-run affected gate, and freeze candidate.

### 7. Canonical final E2E
Run exactly once on the frozen SHA.
Target story:
Problem -> agent action -> explicit funding -> ordinary commerce -> result -> proof.

Choose the provider path with the strongest proven reliability at that moment. Do not retry unknown irreversible actions.

### 8. Submission freeze
Complete:
- public/readable repo and README;
- architecture explanation;
- track-specific evidence;
- explorer/provider proof;
- <= required video limits;
- deck/screenshots/forms/links;
- sponsor attribution;
- no committed secrets;
- fallback recording/screenshots.

## P1 — do only if P0 is healthy

- Resolve Shopify Global exact sandbox quote and paid order.
- Resolve deterministic Shopify paid ambiguity with a fresh, fully instrumented final candidate if justified; never retry the old unresolved purchase.
- Verify Atlas ambiguous-create recovery.
- Improve ChatGPT host integration.
- Add CRE workflow only if it carries real verification responsibility and does not jeopardize P0.
- Improve source/sandbox proof UX.

## Park for later

- Shopify SG market support.
- FX/cross-currency execution.
- automated shadow cleanup.
- delegated budgets.
- production/mainnet funding.
- operator refund/correction tooling.
- HA/distributed workers.
- generic browser commerce.
- arbitrary merchant account linking.

## Cut rule

Any task that does not improve:
- canonical E2E reliability;
- 30–60 second judge comprehension;
- partner-track qualification;
- technical credibility;
- submission completeness

should be deferred.
