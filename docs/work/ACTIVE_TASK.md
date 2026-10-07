# Active task — final activation

## Base and scope
- Branch/worktree: integration/final-activation / C:/Dev/t2o-wt-final-activation.
- Start 26309913cf6e89537b6aee3c157b3770a927ff15; Astra ancestor ca5519ac6abb134b81f5cc194657a55718ec4701 verified.
- Preserve Astra; no Sokosumi, submission docs, shared-checkout edits, history reset, new identity, fallback or blind retry.
- Read before every major phase; detailed checkpoint docs/work/FINAL_ACTIVATION.md.

## Phase tracking
- Base: COMPLETE.
- CDP integration: PASS, docs-only cherry-pick plus omitted original proof independently verified/explicitly added.
- Solana reconciliation: BLOCKED; two 1050 reservations remain unknown because RPC HTTP 429. Original histories and liabilities unchanged.
- ACLs: PASS, operator-only keys/directory, exact identities and bytes retained. Windows module-loading/check-completion fix db62f82ae8fc583850f4dfd4c70d76107b3480e0.
- Caps: explicit operator approval saved at C:/Dev/token2049-setup/secrets/hosted-demo-solana/final-activation.env. Per-payment 250000, cumulative 500000, commercial USD minor 25000, sponsor fees 100000. Remaining arithmetic 405780; fee headroom 74998. Balances/usable headroom unverified. No further cap approval needed.
- PostgreSQL import/legacy retirement: NOT PERFORMED. Read-only provisioning dry run passes but reports incomplete=2. No archival changes.
- Cardano: read-only connected, headroom 5005180, status 32961 ms. Controlled restart/public MCP recovery not tested.
- Provider activation: candidate Atlas guards retained; live Atlas gate false; historical Atlas/Nuitée E2E retained. Public acceptance NOT STARTED.
- Deployment: BLOCKED; no service writes. Observed deployed SHA 974a39bfb59adb0a317d0db05a12268bbbb6242d. No hosted Solana service.
- Hosted dual-rail readiness: NOT ACCEPTED through public MCP.
- Final Solana/Nuitée E2E: NOT STARTED. Mandatory READY report and explicit recording/proceed approval remain required, then exact hotel/rail/quote approval before buy once.
- Evidence: docs/evidence/final-activation/*.json plus original CDP proof. No PII/secrets/raw keys.
- Validation: typecheck/build PASS; 161 focused tests PASS; migration bytes/hashes unchanged; bounded secret scan/diff hygiene PASS. Post-live console/full suite gates deferred.

## Next safe action / stop gate
Stopped under user instruction: genuinely unknown reservations block Solana deployment. When read-only RPC is available, verify complete histories, balances and both retained blockhashes; classify original attempts without re-signing or clearing liabilities. Current importer/readiness rejects incomplete rows; a terminal audited reconciliation must preserve original hashes/entries/references and deny old-candidate replay. Only after Phase 2 closes continue restart/provider/deployment/dual-rail phases. No automatic E2E, scheduling or repeated purchase. Same chat recommended; detailed report has local helper paths.
