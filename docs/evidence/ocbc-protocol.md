# OCBC read-only observation adapter

The OCBC lane is an observation adapter. It reads the account listing, card summary and recent transaction resources, then stores a curated snapshot with source, sandbox environment, observed time and caveats. It does not issue cards, create authorizations, charge, debit, transfer funds or update the commerce journal or purchase-capacity pool. An OCBC observation does not prove that a gateway purchase reached a bank or card network.

## Host and endpoint provenance

The only allowed API origin is `https://api.ocbc.com`. The origin cannot be widened through environment variables or adapter options. Requests use fixed resource paths; provider identifiers are only sent as URL-encoded query values for follow-up reads.

| Resource | Path | Evidence |
|---|---|---|
| Corporate account listing | `/transactional/corporateAccountListing/1.0/` | Listed by the [official OCBC API Store](https://api.ocbc.com/store/OCBC/apis/documentation?name=Transactional_AccountListing&title=Corporate+Account+Listing&type=Transactional). The store describes sandbox selection and a `sessionToken` requirement. |
| Account transaction history | `/transactional/accounttransactionhistory/1.0/` | Verified against the live official sandbox on 2026-10-06 with GUID `accountId`: HTTP 200, `Success=true`, `Results.responseList[]`, exact SGD amounts and stated debit/credit direction. Also used by the read-only `tencent-hackathon` reference implementation. The former `/transactional/corpTransHistory/1.0` call returned HTTP 200 with `Success=false` for the same follow-up flow and is not used. |
| Credit-card listing | `/transactional/creditcardlisting/1.0/retrieveCreditCardList` | Inherited from local read-only inspection of `tencent-hackathon@d02f7ba68ba1c7c3ef881fa4d5a235b6e8941ebd`, `src/server/bank/providers/ocbc/`. Live sandbox access and normalization verified on 2026-10-06; current public Swagger was not independently retrieved. |
| Credit-card history | `/transactional/creditcardhistory/1.0/retrieveCreditCardTranHistory` | Inherited from the same local source. Live sandbox access and normalization verified on 2026-10-06; current public Swagger was not independently retrieved. |

The inherited sandbox flow mints an application token with client credentials at `/token` and can send `OCBC_SANDBOX_SESSION_TOKEN` for customer-authorized resources. The [official OCBC testing guide](https://api.ocbc.com/store/testing-the-apis) confirms application tokens and sandbox selection, but the exact token exchange and card resource details still depend on the configured application subscription. Readiness probes only the account-listing API; a passing probe does not establish access to the card or history APIs.

## Configuration and evidence limits

Configure `OCBC_API_CLIENT_ID` and `OCBC_API_CLIENT_SECRET` in the process environment. `OCBC_API_BASE_URL` is accepted only when it resolves to the fixed official origin. `OCBC_API_CALLS_PER_MINUTE` defaults to 8 and is capped at 60. Keep any optional session token in `OCBC_SANDBOX_SESSION_TOKEN`; values and upstream bodies are never returned by the adapter.

The adapter labels observations `sandbox` and carries a historical-test-data caveat. The sandbox may provide static or historical fixtures rather than live account state. Unknown or malformed amounts are omitted instead of rounded or guessed. Account and card references are masked to at most their final four characters. Card currency may be `XXX` when the API does not state one, and card transaction direction is not inferred.

## Fresh sandbox acceptance

On 2026-10-06, the updated adapter completed a real read-only sandbox acceptance run: application token, account listing, card listing, two account-history reads and one card-history read all returned HTTP 200. Readiness and `observe()` produced 3 account balances, 2 card summaries, 4 account transactions and 3 card transactions. The account-history resource returned `Success=true`; no API response was simulated. Masked references, exact amounts, source endpoint, fresh retrieval time and historical-data caveats were preserved. No customer session token was configured for this accepted application-token run. Credentials, tokens, raw identifiers and response bodies stayed private.

Evidence and the independently targeted endpoint regression are in `C:/Dev/token2049-origins/integration-e2e/ocbc/REPORT.md`; final promoted-source evidence is `evidence-2026-10-06T13-47-07-978Z.jsonl`. The focused suite passed 7/7, typecheck passed and `git diff --check` passed. The correction is in the writable hardening branch; the concurrently active E2E checkout was left unchanged.

This verifies all supported observation kinds, not every account/card history record. The default three-history-call budget interleaves accounts and cards; the data remains historical sandbox fixtures, and `XXX` card currency is not reinterpreted as SGD. The adapter's per-minute limiter is process-local, so multiple independent workers need coordinated pacing. These observations do not prove real balances, card charges, merchant payment or settlement. No issuance, charge, debit or transfer operation was called. Any additional endpoint still requires its own successful access and payload check before being called externally verified.
