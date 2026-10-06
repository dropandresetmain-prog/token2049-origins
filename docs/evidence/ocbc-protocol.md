# OCBC read-only observation adapter

The OCBC lane is an observation adapter. It reads the account listing, card summary and recent transaction resources, then stores a curated snapshot with source, sandbox environment, observed time and caveats. It does not issue cards, create authorizations, charge, debit, transfer funds or update the commerce journal or purchase-capacity pool. An OCBC observation does not prove that a gateway purchase reached a bank or card network.

## Host and endpoint provenance

The only allowed API origin is `https://api.ocbc.com`. The origin cannot be widened through environment variables or adapter options. Requests use fixed resource paths; provider identifiers are only sent as URL-encoded query values for follow-up reads.

| Resource | Path | Evidence |
|---|---|---|
| Corporate account listing | `/transactional/corporateAccountListing/1.0/` | Listed by the [official OCBC API Store](https://api.ocbc.com/store/OCBC/apis/documentation?name=Transactional_AccountListing&title=Corporate+Account+Listing&type=Transactional). The store describes sandbox selection and a `sessionToken` requirement. |
| Corporate transaction history | `/transactional/corpTransHistory/1.0` | Listed by the [official OCBC API Store](https://api.ocbc.com/store/ocbc/apis/documentation?name=Transactional_TransactionHistory&title=Corporate+Transaction+History&type=Transactional), which documents `accountId`, optional date filters and `debitCreditIndicator`. |
| Credit-card listing | `/transactional/creditcardlisting/1.0/retrieveCreditCardList` | Inherited from local read-only inspection of `tencent-hackathon@d02f7ba68ba1c7c3ef881fa4d5a235b6e8941ebd`, `src/server/bank/providers/ocbc/`. Current public documentation and entitlement were not independently confirmed. |
| Credit-card history | `/transactional/creditcardhistory/1.0/retrieveCreditCardTranHistory` | Inherited from the same local source. Current public documentation and entitlement were not independently confirmed. |

The inherited sandbox flow mints an application token with client credentials at `/token` and can send `OCBC_SANDBOX_SESSION_TOKEN` for customer-authorized resources. The [official OCBC testing guide](https://api.ocbc.com/store/testing-the-apis) confirms application tokens and sandbox selection, but the exact token exchange and card resource details still depend on the configured application subscription. Readiness probes only the account-listing API; a passing probe does not establish access to the card or history APIs.

## Configuration and evidence limits

Configure `OCBC_API_CLIENT_ID` and `OCBC_API_CLIENT_SECRET` in the process environment. `OCBC_API_BASE_URL` is accepted only when it resolves to the fixed official origin. `OCBC_API_CALLS_PER_MINUTE` defaults to 8 and is capped at 60. Keep any optional session token in `OCBC_SANDBOX_SESSION_TOKEN`; values and upstream bodies are never returned by the adapter.

The adapter labels observations `sandbox` and carries a historical-test-data caveat. The sandbox may provide static or historical fixtures rather than live account state. Unknown or malformed amounts are omitted instead of rounded or guessed. Account and card references are masked to at most their final four characters. Card currency may be `XXX` when the API does not state one, and card transaction direction is not inferred.

Before describing an endpoint as externally verified, provision sandbox credentials and confirm that the application is subscribed to that resource. No sandbox account or card operation has been performed by this adapter.
