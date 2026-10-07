# Final activation — protected-state checkpoint

Status: **PARTIAL**. Stopped at Phase 2 as instructed because independent chain reconciliation is unavailable. This is not the READY FOR FINAL SOLANA + NUITÉE E2E checkpoint. No deployment, import, retirement, payment or provider booking occurred.

## Candidate and deployment

- Isolated branch: integration/final-activation; worktree C:/Dev/t2o-wt-final-activation.
- Start: 26309913cf6e89537b6aee3c157b3770a927ff15; Astra ca5519ac6abb134b81f5cc194657a55718ec4701 is verified ancestry.
- CDP docs-only c74ff8b cherry-picked as 417afbb. Its referenced proof was omitted from Git by the broad wallet JSON ignore rule. The original sanitized file was found, independently verified and added explicitly, byte-for-byte. No runtime CDP change. Original evidence contains a SGT timezone typo; the new readback records the correct UTC timestamp.
- Runtime fix checkpoint: db62f82ae8fc583850f4dfd4c70d76107b3480e0. Resolve exact final evidence commit with git rev-parse integration/final-activation.
- Observed current hosted SHA: 974a39bfb59adb0a317d0db05a12268bbbb6242d; gateway and Cardano remain on main. Candidate not pushed or deployed.

## Protected Solana state

Payer: 5iSWoZSucVSaNjtxeVC5TCJTN1RQBC6nScw8P32X5MZ6; sponsor/treasury: 6QdrzAxbQMZGCSuk2R9ddneHum22VUJdabDM56ZAr6EU. Network: Solana Devnet; canonical mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU. Payer token account 2dWzL6j5sxpcfrqmuQdhbj22A4WXz2JwDNdbwa9wheMs; treasury token account 6imvBRJazCiUyJ96nBfFnFBBrKaJjZvALzyLCW8nkpJF. Both existing keys derive these identities; no signing occurred.

Original source hashes remain exact: payer 19483c72bfed83abb04fd3bedaf569e0eb33d1806424ac14cb83066122808664; sponsor 1966603b4d08fdfc7f8776f3040346b928c2e94694c5259ab394ac129356f9d4. Payer has 7 entries and 94220 base units committed; sponsor has 6 entries and 25002 fee lamports committed. Neither file was modified or retired.

Both 1050-unit candidates retain valid payer signatures, no sponsor signature and no matching sponsor reservation. They retain the old long memos described in historical simulation-failure evidence. Classification remains **unknown** because fresh chain history, token movements, balances and blockhash expiry cannot be independently checked. Public RPC returned HTTP 429 through four bounded attempts and one later attempt after cooldown. These are read-only requests. Local evidence is suggestive of signed-not-submitted, not sufficient to certify it.

Operator explicitly approved exact caps after automatic approval review rejected the first policy write. Approved policy now lives outside Git at C:/Dev/token2049-setup/secrets/hosted-demo-solana/final-activation.env, with operator-only ACLs. Per-payment 250000 base units; cumulative 500000; commercial ceiling 25000 USD minor; sponsor cumulative fees 100000 lamports. At 1:1000 these are USD 250 per payment and USD 500 cumulative notional. Arithmetic remaining cumulative: 405780; per-payment headroom: 250000; sponsor fee headroom: 74998. **Usable headroom and balances remain unverified.** No authorization change to Cardano.

Existing key directory and both key files now allow only the expected operator identity, with inheritance removed; key bytes unchanged. The candidate ACL checker needed a narrow fix: Node inherits PowerShell 7 module paths, so its Windows PowerShell child must explicitly import its own security module. Ledger checks now also require error-stop behavior and an exact success marker, preventing a failed Get-Acl from passing silently.

## Remaining phases

Real PostgreSQL import and legacy signer retirement are not performed. Local import tests cover atomic roles, exact identity/hash/count/totals/references, rerun markers, immutable rows and conflict rejection. The provisioner dry run passes the approved policy and identities but reports two incomplete reservations. Apply remains blocked. Current code refuses them even if subsequently proven unsent; any audited terminal classification must preserve original source hashes, fields and committed liabilities and prevent replay. Do not fabricate signatures to bypass the gate.

Cardano read-only connected source: Preprod USDM, headroom 5005180; status took 32961 ms. No controlled restart or public MCP recovery acceptance was run. Generic bounded read-only recovery tests pass; no wake or payment retries added.

Atlas candidate retains sandbox-only/test-balance/zero-fee/readback/checkpoint/single-pay guards. Live gate remains false; hosted executable acceptance not performed. Nuitée configuration exists with prior real E2E evidence retained; no final public search/quote/booking acceptance. Shopify was not changed or retested. Solana service does not exist. The read-only plan requests a free public Singapore Docker service with PostgreSQL and no disk/tunnel. Neither rail visibility nor explicit selection/fallback was newly accepted through public MCP.

Final Solana/Nuitée E2E was not started: no quote, purchase, transaction, booking, receipt or proof generated in this activation. Recording readiness not reached. E2E latency/memory/restart fields are unavailable. No second purchase.

## Checks and files

Typecheck and build PASS. Focused ACL/ledger: 6 tests, 2 files PASS. Providers/readiness/PostgreSQL import: 155 tests, 4 files PASS. Migrations 0001-0008 are byte-identical to the hosted-commerce candidate. Original ledger hashes unchanged. Bounded secret scan and diff check PASS. Console/full backend post-live gates deferred because E2E did not occur; no claim of final-gate completion.

Changed runtime files: clients/solana/signer.ts and ledger.ts; regression tests: tests/unit/solana-signer-permissions.test.ts. Documentation: ACTIVE_TASK.md, this report, COINBASE_CDP.md (cherry-pick), original CDP proof and docs/evidence/final-activation/*.json. External changes: operator-only key ACLs and explicitly approved protected policy only. No secret/key copies in Git.

## Issues and next action

| Classification | Issue / why it matters | Recommended action | Risk of deferral |
|---|---|---|---|
| Investigate Now | RPC rate limiting prevents balances and reservation classification. | Restore read-only Devnet access and repeat complete chain reconciliation. | Deployment and signing must stay unavailable. |
| Investigate Now | Two retained candidates remain unknown; local imports cannot make them safe automatically. | Establish terminal classifications without re-signing; preserve all liabilities and source fields in any audited import resolution. | Blind clearing/replay could duplicate spend or erase history. |
| Act Now, after closure | Real import, retirement and public service acceptance are still absent. | Stop legacy signers, preserve archives, atomically import exact histories and verify public status/restart only after unresolved entries close. | Concurrent signers or incomplete migration would invalidate cumulative controls. |
| Park for Later, until prior gates | Public provider/dual-rail acceptance and recording E2E are unexecuted. | Continue Phases 3-7 after Phase 2; stop at explicit recording approval. | Final demo remains incomplete. |

**Safe to merge final activation: NO. Safe to deploy/keep this candidate deployed: NO (not deployed). Existing deployment is unchanged.**

Resume in the **same chat**, which has the current policy authorization and reconciliation context. Next exact task: rerun read-only chain reconciliation when RPC is available, verify balances and expired blockhashes, classify both original candidates, then handle audited import status preservation without history reset or new signing. Local support scripts are ignored under .runtime/decode-reservations.mjs, chain-reconciliation.mjs, protected-preflight.ts, and activation-validation.mjs. Exclude Sokosumi, submission docs, new identities, rail fallback and all payment/provider writes until their gates.
