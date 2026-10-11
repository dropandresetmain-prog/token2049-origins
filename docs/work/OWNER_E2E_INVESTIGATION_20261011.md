# Capsule owner E2E investigation — 11 October 2026

Investigation only. No application fixes, deployment, purchase, payment retry, chain broadcast, provider write, ledger reset or configuration change was performed. Times below are UTC; add eight hours for Singapore.

## Executive diagnosis

The session demonstrated one independently verified completed purchase: Atlas funded with Sui. The initial Sui confirmation was inconclusive but was mapped to a rejected-payment error, even while durable recovery continued. The same candidate settled and Atlas ticketing completed without another recorded funding or merchant attempt. Confidence: HIGH in the misclassification and recovery; the exact reason the first independent Sui read was inconclusive is UNKNOWN.

The reported Nuitée/Cardano success is NOT VERIFIED and contradicts Capsule's canonical records. Hotel discovery occurred, but no hotel quote, purchase, payment or receipt exists for this session. Booking reference 3899895 returns HTTP404/provider code4004 under the configured sandbox account. An unsupported assistant confirmation is the leading explanation, but the exact ChatGPT tool response and conversational inference are not retained server-side.

Shopify successfully prepared the chosen Mini Massage Gun quote, including a Solana funding option. Quote preparation took107.093s, beyond the MCP45s response window. The request trace shows no subsequent MCP POST collecting the result or buying it during the captured window. Confidence: HIGH that this was not a demonstrated Solana payment failure; MEDIUM that the assistant mishandled the pending result, because the host response bodies are unavailable.

These are separate integration and presentation failures, not evidence of a common broken payment bridge. No infrastructure rebuild is justified by this session.

## Exact checkpoint and proof boundaries

- Investigation source: codex/capsule-neon-migration at405368ccbb7df8d92bcd933bb8f8ced194b9d0c4; worktree C:/Dev/token2049-origins-neon-migration, clean before investigation. Remote dropandresetmain-prog/token2049-origins. Main remains7c09b37eaaeda2bf3eec94fc1e3456118962f636.
- Actual Render gateway revision86f519450b1d61d5c42f8bbadb685b49f01ea798, live deployment dep-db5q9jdckfvc73b35c50.
- Actual Render payer revision3945f9c52cf76e1960569d53416361bcd42de175, live deployment dep-db5la02jnfac73ast890.
- Existing health-only Worker version00ee6d4a-afdd-4807-ad05-f46d33fa1986 retained. Canonical database remains the authorized Neon deployment. No endpoint, custody, signing grant or source fence changed in this investigation.
- Authoritative evidence: native PostgreSQL repeatable-read/read-only SELECTs, persisted approval/events/jobs/rail ledgers, Render service configuration and logs, public Sui transaction readback, existing Atlas order-details readback and Nuitée existing-booking GET.
- Protected raw evidence is outside Git: ~/.capsule/neon-migration-20261011/owner-e2e-investigation-20261011. It contains private fulfillment/provider records; do not publish it. This report contains identifiers and sanitized findings only.
- Scope is the owner's just-completed session, including the exact flight reference, hotels and massage-gun offers. The three older expired incident purchases were not retried or modified.

## Per-journey evidence matrix

| Journey | Quote / purchase | Payment and bridge | Chain | Merchant / current state | Retry safety |
|---|---|---|---|---|---|
| Atlas / Sui | quo_01M4NRP0XJZYP3GZH13PR8QT9Y / pur_01M4NRRCVHXW6GZEX35S7H20EM | VERIFIED: one durable handoff, payer reached; HTTP422 payment_rejected after gateway fundingHTTP402. Original handoff remains failed/retry_safe=false. Canonical payment now confirmed. | VERIFIED: successful transaction Ay5s27wUT4GEtjQ2DtFTbgkVrbN8uQbxTrDYYLhrCCnX; exactly74300 USDC base units =0.07430 test USDC, checkpoint393742179. | VERIFIED: one successful merchant execution; Atlas order TESTA20261011232029042, orderStatus2/ticketStatus1; purchase succeeded/ticketed, receipt rcp_01M4NRT6FNB35NV4KQV7362Y1T. | Do not pay again. Completed purchase; read existing receipt/proof only. |
| Nuitée / Cardano | No session quote or purchase found. Claimed booking3899895 has no canonical match. | NOT VERIFIED: no payment claim, funding attempt or new Cardano ledger entry for this journey. | NOT VERIFIED: no associated hash exists to independently inspect. No new Cardano ledger record found. | NOT VERIFIED: no execution or receipt; configured Nuitée existing-booking readbackHTTP404/code4004. | No existing purchase to resume. A future attempt must start with fresh valid terms and approval; do not blindly reuse the claimed booking. |
| Shopify / Solana | VERIFIED quote quo_01M4NSPKAB116PPJ9Z0KVGHVT2; no purchase. | NOT RUN: no payment claim or payer /pay call for this journey. Solana funding option exists on the successful quote. | NOT RUN: no associated Solana payment record or signature. | NOT RUN: no merchant checkout completion/order. Only controlled sandbox quote preparation occurred during the owner's session. | Quote expired15:46UTC. Future testing requires a fresh quote and approval; do not attempt payment against this expired quote. |

The absence of a canonical hotel record is not proof about every external account or an unrecorded external action. It does mean the reported hotel/Cardano PASS cannot be accepted as Capsule evidence. Solana and Cardano live health were not exercised by completed purchases in this session.

## Flight timeline and root-cause trace

| Time UTC | Verified event |
|---|---|
|15:18:13.193|Exact USD74.30 quote created.|
|15:19:30.818|Purchase created; exact approval and selected source persisted; capacity reserved.|
|15:19:32.133|Initial payer ingress429.|
|15:19:55.333|Independent Render payer startup log.|
|15:20:04.641|Authenticated Worker resultHTTP200/upstream200,32.508s.|
|15:20:05.718|Direct payer readiness completed; overall preparation33.726s.|
|15:20:11.121|One durable Sui signed candidate recorded.|
|15:20:13.288|Canonical funding attempt prepared.|
|15:20:15.586|First MCP buy request returned after45.099s; pending behavior supported by source and timing.|
|15:20:16.247|Independent chain timestamp of the successful Sui transaction.|
|15:20:16.595|Canonical event funding.rejected, reason Sui outcome retained for independent recovery.|
|15:20:16.656|Payer returnedHTTP422/payment_rejected; handoff failed/retry_safe=false.|
|15:20:21.299|Later MCP POST completed in8ms, consistent with joining the pending operation. Exact body is not logged.|
|15:20:28.786|Same digest independently confirmed; execution queued.|
|15:20:29.848|One merchant execution succeeded in ticketing state; receipt issued.|
|15:21:30.300|Merchant readback refreshed to ticketed.|

Relevant code at the deployed-compatible source checkpoint:

- src/funding/sui/adapter.ts:9,16–41: missing/unfinalized evidence or a read exception returns a nondefinitive payment_required result with settlementAttempted=true. It is deliberately recoverable, not a definitive rejection.
- src/core/service.ts:674–691, verifyAndRecord: emits funding.rejected and throws for every non-ok verification, including this nondefinitive result. The authoritative unknown state and recovery candidate remain.
- clients/sui/pay.ts:101–109: forwards the gateway funding status and retains the same digest. Only202 marks the signer ledger entry accepted.
- clients/multiwallet/engines.ts:53: any non202 Sui result becomes payment_rejected. clients/payer/bridge.ts:30 maps that to422.
- src/channels/mcp/tools.ts:~510–549: persists the failed handoff and returns the rejected payment field. Its canonical status logic at528 correctly reports confirmation_pending for unknown payment state, so the response contains conflicting signals. This is not proof that the whole MCP result was marked as a definitive error.
- src/core/views.ts:40,77: retains the historical failed handoff even on a subsequently successful purchase. It needs to remain audit evidence without overruling canonical payment confirmation.

The independently read chain balance changes show payerUSDC-74300, payeeUSDC+74300 and separate gas2335624MIST. There is one funding candidate, one digest and one recorded merchant execution for this purchase. The signer ledger conservatively retains signed status; that status alone is not proof of an unsettled transaction.

Minimum correction: distinguish pending settlement from definitive rejection across funding verification, payer result, journal event and MCP presentation. Unknown must instruct read-only purchase polling; never another payment POST, candidate or wallet. Preserve the existing durable recovery and exactly-once merchant protections.

## Authorization and the owner password

src/channels/hosted-mcp/oauth.ts:19–24,188–240 implements a single-owner demo login/consent gate. The passcode protects access to the shared demo customer and its bounded wallets; it is not a blockchain key or a per-transfer wallet password.

Persisted OAuth grants show the same ChatGPT client initially had offers:read/purchases:read at14:39:13UTC. A new consent at15:11:53UTC added quotes:write/purchases:write. This permission expansion explains why the password screen appeared during the move from discovery into payment-capable tools. Subsequent calls can reuse that grant without another login prompt.

Connection consent, the host's permission card and exact purchase approval are distinct. buy declares destructiveHint=true at src/channels/mcp/tools.ts:440, but Capsule cannot guarantee a visible host card for every call. The Sui purchase persisted customer, selected source, funding option, exact maximum amount and quote digest. The hotel did not create a purchase; absence of its second card establishes neither authorization bypass nor a completed payment.

Minimum UX correction: label this as signing in to the Capsule demo account and explain the requested permissions before the shopping flow. Reuse the existing authenticated session. Do not remove the demo access gate or weaken quote/source approval to reduce friction.

## Shopify quote, latency and incomplete handoff

The selected source was Mini Massage Gun / Soleful-Living, source priceUSD12.99, offer off_01M4NSGDKDM7D0XMAY2M8WHA6H. Quote preparation started approximately15:34:13.519 and completed15:36:00.611, HTTP201/107.093s. Final quote:USD12.99 product +USD8 shipping +USD0 tax =USD20.99. All three rails were available; Solana option fop_01M4NSPKAAVPSZ4EPHQ70PVZWS requested20990 base units =0.020990 test USDC.

MCP returned after45.037s at15:34:58.516. BackgroundJobs and the pending response in src/channels/mcp/tools.ts:35–72,349–363 instruct an identical call to collect the same result. No later MCP POST appears before the captured15:45:14 GET. The quote itself proves that product mapping, sandbox publication and quote preparation succeeded. The exact host interpretation of the pending tool reply is UNKNOWN.

Existing timed logs isolate the107s:

- Shadow store assertion/source refresh/find/create/publish/readback took approximately4.8s; create-cart/select-delivery another1.6s.
- Browser fallback started15:34:20.066; shutdown finished15:36:00.089. Browser queue wait0ms, launch2.104s, open checkout15.081s, storefront password gate20.298s, select country9.100s, fill name15.308s, address7.496s, test billing9.699s, shipping3.196s, totals2.393s. All timed steps returned ok.
- Browser quote-complete container memory528,879,616bytes, approximately504.4MiB of512MiB. Memory-limit max counter rose1606 then1627; oom/oom_kill remained0. CPU throttling counters increased substantially. These show resource pressure, not an established crash or an exact attribution of all delay.
- Browser disposal completed1.691s and recorded container memory falling to approximately291.8MiB.

Minimum correction: make pending quote collection explicit and recoverable, preserve the existing offer/quote identity and immutable payload, and prevent a completed quote from being represented as an unavailable rail. Verify same-argument joining and restart behavior before adding any alternate collection API. Quote preparation can create a sandbox shadow product, so a blind re-run is not a harmless read. Do not introduce a queue or rebuild the checkout to avoid this investigation's actual evidence.

Separately investigate bounded browser waits and resource use on the existing runtime. Preserve actual checkout totals, the sandbox gateway guard and independent order readback; never substitute an Admin-created paid order.

## Fulfillment and discovery gaps

Flight documents: the independently retrieved Atlas order contains itineraryDownload and one passenger-ticket record. src/execution/atlas/wire.ts:78–92 does not model the download field; executor.ts:526–555 retains ticketing evidence/counts rather than document delivery. The returned itinerary URL is plainHTTP on an IP-address host. It was NOT fetched or exposed. Safe document delivery needs a demonstrated secure provider transport and customer-access control, not a silent proxy or manufactured ticket.

src/channels/mcp/tools.ts:291–345 returns receipt IDs and references without usable receipt/proof links. Existing purchase, evidence and proof GETs for the verified flight returned200. First expose those truthful links and a clearly named Capsule confirmation; distinguish it from a provider-issued itinerary or real travel reservation. Atlas ticket artifact delivery remains GitHub#1: https://github.com/dropandresetmain-prog/token2049-origins/issues/1.

Hotel fulfillment: there is no verified booking to supply a voucher for in this session. First prevent unsupported confirmation; then use verified booking readback for an accessible confirmation. Official existing-booking retrieval is https://docs.liteapi.travel/reference/get_bookings-bookingid. No secure hotel-voucher PDF capability was demonstrated. Guest discount vouchers and experience vouchers are different products.

Hotel geography: persisted intent mentioned District2/ThaoDien/AnPhu only in objective text, while destination was HoChiMinhCity/countryVN. src/execution/nuitee/offers.ts:72–90 sends city-level criteria; it does not derive geographic filters from objective prose. Coordinates/radius already exist in src/contracts/intent.ts:35–45. Use grounded neighborhood coordinates/radius and disclose approximation; do not claim unverified district membership.

Nationality: guestNationality is required for hotel search. The saved-profile merge is wired to quote fulfillment, not search intent, and the saved hotel guest/holder has no nationality field. The flight passenger does. Add a bound search default only when it is explicitly the same customer/traveler; do not copy another person's nationality by assumption.

Currency: find_offers currently instructs preserving SGD budgets generally, but src/core/service.ts:139 converts only executors declaring budgetConversionCurrency=USD. Retail does; Atlas/Nuitée do not. The core correctly rejects quote/currency mismatch at275–278. The session's400 quote request is consistent with the reported SGD issue, though its body was not logged. Align flight/hotel tool instructions with the owner's USD-input contract and retain the original SGD ceiling/reference. Preserve existing working retail FX/budget enforcement.

Retail discovery: src/execution/shopify/globalCatalog.ts:22–61 and MCP shortlist mapping omit useful media/details. Official Global Catalog documentation supports media and enriched descriptions/specifications: https://shopify.dev/docs/agents/catalog/global-catalog. Some enriched fields are inferred, so preserve provenance and distinguish them from merchant/manufacturer claims. Use genuine images, not generated product substitutes. GitHub#2: https://github.com/dropandresetmain-prog/token2049-origins/issues/2.

Disclosures: existing quote instructions already require one short testnet/sandbox statement immediately before approval. Keep those truthful limitations and discovery-versus-execution merchant distinction. Remove repetitive infrastructure commentary through copy/instructions; do not represent test tickets as real travel.

## Findings triage

| Classification | Finding / action | Risk of deferral; testing impact |
|---|---|---|
|Act Now|Pending Sui funding is labeled rejected. Correct nondefinitive contract/journal/MCP copy; retain same-candidate recovery.|Customer may pay twice or switch wallets after a misleading failure. Blocks a trustworthy payment demo.|
|Act Now|Hotel confirmation has no canonical supporting transaction. Strengthen instructions/structured confirmation so only verified completed purchase readback supports success.|False fulfillment claims. Blocks counting hotel/Cardano as accepted.|
|Act Now|Shopify quote completes but pending result is not collected. Make the next action and recoverable quote outcome unambiguous.|Customer abandons an executable quote or receives a false rail error. Blocks this retail journey.|
|Act Now|Receipt/proof links omitted from final confirmation. Add existing safe URLs and accurate confirmation artifact labels.|A technically successful purchase feels incomplete; avoid falsely promising a provider PDF.|
|Act Now|Flight/hotel SGD instructions conflict with executor currency support. Align USD contract and preserve user's original ceiling.|Repeat quote failures or mishandled budget. Blocks that documented request pattern.|
|Investigate Now|Browser near memory limit and CPU throttled during107s quote. Optimize only measured steps with fixtures/controlled non-writing content first.|Unpredictable latency/resource exhaustion. Relevant to retail reliability, not proof of Solana failure.|
|Investigate Now|Secure Atlas itinerary delivery and Nuitée confirmation capabilities. Validate transport/access/readback before exposing passenger documents.|Missing usable fulfillment; insecure links or PII disclosure if implemented carelessly.|
|Investigate Now|Exact first Sui read failure and missing host result bodies. Add sanitized stage diagnostics in a future authorized repair.|Limits precise timing attribution. Does not negate independently verified settlement.|
|Investigate Now|Search nationality defaults and geographic binding. Reuse only explicit customer attributes and grounded coordinates.|Unnecessary questions and irrelevant hotel options.|
|Investigate Now|Retail media/details/provenance omitted. Implement bounded schema/shortlist enrichment.|Weak purchase decisions; inferred specs could mislead if provenance is lost.|
|Ignore / Accept Risk|OAuth scope expansion required login; no purchase-authorization bypass established. Retain gate, improve labels/session reuse.|Demo account remains protected; some initial login friction remains.|
|Ignore / Accept Risk|Single truthful sandbox/testnet disclosure and Free cold-start delay. Retain disclosures and bounded progress.|Necessary product limits; no architecture migration justified.|
|Park for Later|Public onboarding, new hosting, generalized orchestration and broad performance rebuild.|Scope expansion would destabilize working flows without solving the observed handoffs.|

## Minimum repair and acceptance plan

1. Repair pending-versus-rejected payment semantics and canonical-success presentation. Fixture-test an inconclusive funding response followed by same-digest confirmation: one signing candidate, no payment retry, one merchant execution, pending then final truthful headline. Include lost response and stale failed-handoff display.
2. Repair quote continuation and confirmation grounding. Fixture-test45s quote_pending followed by identical collection of the completed USD20.99 quote with Solana available. Cover response loss/restart, changed arguments denied, no duplicate shadow preparation and no confirmation without a canonical completed purchase. Keep host instructions compact and explicit.
3. Add existing receipt/proof links and accessible accurate confirmation data; investigate secure provider document delivery independently. Test owner scope, redaction, ticketing/booking completion gates and absence of unsafe artifact URLs.
4. Align currency contract and minimum discovery defaults. Test SGD-request guidance/retained ceiling, explicit search nationality binding, coordinate/radius request translation and provenance of genuine catalog media/details.
5. Optimize only demonstrated browser delays/resource pressure. Reuse recorded timings and isolated fixtures; any fresh provider quote/shadow write or checkout needs its own authorized test scope. No payment POST retries, manual waking or infrastructure replacement.

Run affected tests, then one bounded integrated fixture gate across unchanged commerce/payment contracts. An independent review should focus on changes to financial states and recovery. Deploy only after the owner authorizes the exact repair release. The owner performs fresh live E2Es; the existing completed Sui purchase is inspected read-only, never replayed.

## Verification performed and remaining evidence

- Read-only production trace and independent readbacks described above; no new customer transactions initiated.
- npx vitest run tests/unit/sui-funding.test.ts tests/unit/mcp-background.test.ts:2files/51tests PASS. These are existing offline fixtures and do not prove a repaired implementation or hosted Cardano/Solana health.
- Existing flight purchase/evidence/proof accessHTTP200; deployed service revisions read back and matched.
- A local diagnostic initially failed under Node strip-only TypeScript; reran with the repository's tsx loader and captured the logs successfully. This was an operator-script loader issue, not a deployed failure.
- Missing: exact ChatGPT tool reply bodies, first Sui RPC substage classification, authenticated provider document retrieval. None should be invented from timing alone.
- Live acceptance from this session: Atlas/Sui VERIFIED PASS; Nuitée/Cardano NOT VERIFIED; Shopify/Solana quote succeeded but payment/merchant NOT RUN. Other six provider/rail live combinations remain NOT RUN for this session.

## Operational next step

Stop after this investigation. No fix is implemented or deployed. The next authorized coding task is the small pending-payment/quote-continuation/grounded-confirmation repair, followed by links and currency consistency; preserve all current histories and the original identities.

Use a fresh implementation chat with this report and ACTIVE_TASK.md as the compact handoff: the long infrastructure history is now noisy and this is a distinct UX/reliability milestone. Recommended primary model: GPT-6.1 Sol, high reasoning, with careful independent review of financial-state changes. Investigation source405368c, deployed gateway86f5194/payer3945f9c are separate checkpoints. Explicit exclusions: no replay of completed/expired purchases, new purchase/broadcast/provider write, key relocation, schema reset, infrastructure migration or automatic release replacement.

Owner authorization is required to implement this proposed repair scope if continuing beyond investigation, and separately for a named deployed release/provider-write preflight. Existing access is sufficient for code and fixture work; no passwords or transcript re-entry are required to begin it.
