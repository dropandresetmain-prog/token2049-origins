# Capsule canonical demo

Status: target flow; final provider path must be selected after final integration/review and seed preflight.

## Judge story

Problem:
AI agents can reason about what a user wants, but ordinary commerce still expects human checkout, payment and provider-specific state.

Capsule:
Any agent. Agent-native money in. Ordinary commerce out.

Canonical story:

User intent
→ agent calls Capsule
→ Capsule finds an offer
→ exact quote
→ human sees and selects funding source
→ testnet payment is verified
→ Capsule executes ordinary commerce
→ provider result is independently read back
→ Capsule shows proof

## What the judge should understand in 30–60 seconds

1. The agent is not the source of truth for money.
2. The user explicitly authorizes exact terms and funding source.
3. A real public-testnet payment gates execution.
4. Capsule talks to ordinary commerce providers.
5. Unknown outcomes do not cause blind duplicate orders.
6. The proof page shows chain and provider evidence separately.

## Primary stage layout

Agent experience:
- natural request;
- needs_input follow-up only when required;
- offers;
- exact quote;
- explicit Cardano/Solana choice;
- approval;
- status.

Capsule transaction/proof view:
- request;
- commercial total;
- agent/channel;
- payment rail + public source identity;
- scaled testnet amount and 1:1000 disclosure;
- transaction confirmation;
- provider execution/result;
- receipt/evidence.

Use DESIGN.md/UI V3 as visual authority.

## Provider choice for final demo

Do not decide from aspiration. Choose the path that passes the final candidate E2E most reliably.

Current evidence:
- Shopify has the strongest product story but paid deterministic acceptance is unresolved; Global discovery/shadow is only partial.
- Nuitée has a passed sandbox booking/readback.
- Atlas has passed ticketing but ambiguous-create recovery is unverified.
- Cardano and Solana funding passed separately with merchant fixtures.

A final combined E2E is still required.

## Funding display

Always show:
- commercial amount;
- selected rail;
- network;
- exact test asset;
- public/masked payer source;
- scaled testnet amount;
- 1:1000 disclosure;
- real tx reference only when evidence exists.

Never imply testnet assets are redeemed into fiat.

## Unknown outcome behavior

If an irreversible operation becomes ambiguous:
- stop new writes;
- show Verifying result / unresolved;
- preserve exposure and evidence;
- reconcile read-only;
- never tell the user not to click again as the safety mechanism;
- never retry simply to make the demo green.

## Fallback

Before stage/demo submission capture:
- one known-good full recording once a canonical E2E passes;
- screenshots of payment proof, provider result and receipt;
- public-testnet explorer proof where relevant.

Fallback material must be labelled as a recording of a successful test run, not live behavior.
