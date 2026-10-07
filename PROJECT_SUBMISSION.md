# Capsule — TOKEN2049 Origins project submission

**Any agent. Agent-native money in. Ordinary commerce out.**

Capsule connects an AI assistant to ordinary commerce through a common transaction interface. The assistant handles the conversation. Capsule binds an exact quote to human approval, verifies funding, executes the provider operation and returns a result backed by payment and commerce evidence.

**Review draft, not a submission-ready declaration.** Source inspected: `5343235ebe6c341abdda95450065950a3d1051b7`. Chainlink source was inspected separately at `2695d6bd1110de4effa56e1b6e21232700025454`; it is not integrated into that main baseline. Evidence below describes the recorded runs and their environments, not a fresh test of this documentation branch.

[Problem and solution](#problem) · [Technology stack](#stack) · [Main](#main-track) · [Cardano](#cardano) · [Solana](#solana) · [Chainlink](#chainlink) · [Evidence](#evidence) · [Deliverables](#deliverables) · [Finalisation](#finalisation)

<a id="problem"></a>
## The problem and our solution

A traveller can ask an assistant to find a forgotten adapter, a flight or a hotel. Finding an option is only the beginning: someone still has to establish the final price, provide authorised payment, complete the provider's workflow and determine whether it actually succeeded.

An agent integration must distinguish a recommendation from an executable quote, a submitted payment from confirmed funding, and an order or reservation from a completed purchase. Retrying after a timeout must not quietly create a second purchase. Each provider also has different inputs and completion rules.

Capsule puts those responsibilities behind one commerce interface:

**Find → Quote → Authorise → Fund → Execute → Verify.**

The user stays in their existing assistant. They select an offer, see the exact price and available funding options, and approve the terms. Capsule manages the transaction; its separate console makes progress and proof visible. Retail, flights and hotels use the same outer contract without pretending their underlying provider workflows are identical.

This is a buyer-side gateway, not another chatbot, a merchant marketplace or a new wallet. The intended users are agent builders and people delegating purchases through their assistants. The prototype demonstrates that interaction; it does not claim public adoption, production settlement or commercial traction.

## Why agent-native money

Capsule's thesis is that an agent-facing commerce interface should work with programmable payment requirements and independently verifiable transfers, while retaining explicit human control. Cardano and Solana provide the demonstrated public-testnet funding paths. Commerce providers keep their own APIs and checkout workflows.

The hackathon deliberately separates that design from production economic settlement. Test tokens do not become bank money. A disclosed 1:1000 notional scale links the commercial test amount to the test-token quantity; merchant test payments remain separate. Frankfurter's SGD reference conversion is a different mechanism, not an off-ramp or the testnet scale.

## Product experience and technical approach

| Surface | Responsibility |
| --- | --- |
| Assistant / MCP | Understand the request, ask for missing information, present offers, obtain choice and approval. |
| Capsule core | Validate input, freeze quote and funding terms, verify funding, persist execution and reconcile outcomes. |
| Capsule console | Read the transaction, payment, provider result and receipt; do not approve or spend. |

The core receives typed input rather than trusting conversational assertions. Approval binds the quote digest, maximum commercial amount and selected funding option. Signing runs separately from the gateway. Durable checkpoints precede irreversible provider calls; ambiguous outcomes are reconciled by readback rather than blind repetition. Payment confirmation and merchant completion remain separate facts.

The current integration map and exact security/recovery boundaries are in [ARCHITECTURE.md](ARCHITECTURE.md). Executable schemas live in [src/contracts](src/contracts/); runtime composition is in [src/wiring.ts](src/wiring.ts).

<a id="stack"></a>
## Technology stack and connections

This is the shared inventory for all tracks, not a list of services that each purchase necessarily calls. Installed dependencies and source paths establish implementation; the evidence section establishes what was exercised.

| Layer / connection | Role and boundary | Source |
| --- | --- | --- |
| Node.js 24+, TypeScript, Express, Zod | Gateway runtime, typed schemas and HTTP API. | [package.json](package.json), [composition](src/composition.ts) |
| MCP TypeScript SDK; HTTP / OAuth | Four agent tools; hosted Streamable HTTP with OAuth, plus local MCP. ChatGPT is the documented evaluation host, not proof of every-client compatibility. | [hosted MCP](docs/channels/hosted-mcp.md), [channel contract](docs/contracts/CHANNEL_CONTRACT.md) |
| React, React DOM, Vite | Read-only Capsule console; gateway-backed and separately labelled sample sources. | [console contract](docs/contracts/CONSOLE_CONTRACT.md), [web](web/) |
| PostgreSQL, node-postgres | Quotes, purchases, jobs, journal, evidence, hosted OAuth and payer history. | [database](src/infrastructure/db.ts), [architecture](ARCHITECTURE.md) |
| Shopify Global Catalog / UCP | Real product discovery, source offer refresh and provenance. | [Shopify executor](src/execution/shopify/) |
| Shopify Storefront and Admin APIs | Controlled test-store representation, exact quote support and independent order readback; webhooks supply reconciliation hints. | [runtime wiring](src/wiring.ts), [Shopify evidence](docs/evidence/shopify-global-sandbox-e2e.md) |
| Playwright / Chromium; Shopify test gateway | Controlled browser checkout and test payment, not an order at the discovered source store. | [Shopify executor](src/execution/shopify/), [package.json](package.json) |
| Atlas | Sandbox flight search, verification, order, authorised test-balance payment and ticketed readback. | [Atlas executor](src/execution/atlas/) |
| Nuitée / LiteAPI | Sandbox hotel rates, prebook, booking and confirmation readback. | [Nuitée executor](src/execution/nuitee/) |
| Cardano Preprod; x402 Cardano; Evolution SDK | Exact test-asset funding, separate payer signing and transaction verification. | [Cardano funding](src/funding/cardano/), [payer](clients/payer/), [package.json](package.json) |
| Blockfrost; configured Cardano facilitator | Cardano chain reads and x402 verification/settlement support; not merchant fiat payment. | [Cardano protocol](docs/evidence/cardano-protocol.md), [configuration](docs/ENVIRONMENT.md) |
| Solana Devnet; Solana Kit; x402 SVM; RPC | Test-token transfer, bounded payer, authenticated sponsor preparation and finalized readback. | [Solana funding](src/funding/solana/), [payer](clients/solana/) |
| Masumi payment service / registry; native MIP-003 runtime | Agent task remuneration, escrow/result/payout. Separate from merchant purchase principal. | [Masumi integration](docs/work/MASUMI_INTEGRATION.md), [runtime](src/channels/sokosumi/) |
| Sokosumi | Marketplace/channel work is distinct from the verified native Masumi path; public platform delivery is not established by that evidence. | [retained marketplace result](docs/evidence/sokosumi-runtime-live.json) |
| Chainlink CRE SDK / CLI; Bun; Javy / WebAssembly | Separate-branch HTTP-triggered commerce-verification workflow and successful local simulation; not a deployed DON workflow. | [pinned CRE report][cre-report] |
| Koios Preprod API | CRE's independent read of the Cardano transaction output. | [pinned CRE source][cre-source], [simulation][cre-evidence] |
| Frankfurter v2 | Free-of-key USD/SGD reference-rate connection for Shopify SGD budgets and display; snapshot frozen into quote evidence, not payment conversion. | [FX contract](docs/FX.md), [client](src/integrations/frankfurter/client.ts) |
| OCBC sandbox APIs | Read-only account/card/history observations; neither treasury truth nor a debit/settlement rail. | [OCBC protocol](docs/evidence/ocbc-protocol.md), [adapter](src/banking/ocbc/adapter.ts) |
| Render; Docker / Docker Compose | Hosted gateway/console/MCP and separate Cardano payer; PostgreSQL and reproducible container tooling. Deployment reports are point-in-time evidence. | [environment](docs/ENVIRONMENT.md), [hosted MCP](docs/channels/hosted-mcp.md) |
| Vitest, tsx, TypeScript checks | Development, contract and integration verification. No suite was rerun for this documentation-only change. | [package.json](package.json), [tests](tests/) |

No NOWNodes entry is planned. Stripe and production fiat conversion are not claimed integrations. SDKs, APIs and tools above are credited for their actual roles; this is not a claim of commercial partnership.

<a id="main-track"></a>
## Main track — TOKEN2049 Origins Hackathon

Main pool: **$100,000 in AWS credits**, shared by the Top 5, who present on stage; the split is not stated in the supplied Main page. [BuilderBase, “Prizes”][bb-main]

The shared project narrative above is the Main write-up; BuilderBase does not require a separate Main essay. The supplied Main page and dashboard require a judge-accessible GitHub repository, a live URL or hosted demo, and a Google Drive link to a `.ppt` or `.keynote` deck. There is no mandatory infrastructure stack. [BuilderBase: Main, “Tracks” and “What every team submits”][bb-main]

| BuilderBase judging dimension | Weight | Relevant material in this submission |
| --- | ---: | --- |
| Functionality & Execution | 30% | Typed commerce flow, retained combined runs, independent provider readback. |
| Technical Implementation & Integration | 25% | Common transaction core, isolated signing, durable recovery, full stack and architecture. |
| Innovation & Originality | 20% | Buyer-side commerce across agent channels, funding rails and ordinary providers. |
| Usefulness & Potential Impact | 15% | Concrete delegated-purchase use cases and the production boundary below. |
| Demo & Presentation | 10% | MCP interaction and visible console proof; final media still outstanding. |

This maps content to the rubric; it does not assign a score. Source: [BuilderBase Main, “Judging · Main track”][bb-main].

### Demonstration scenarios versus retained proof

The planned recording stories are a forgotten travel adapter and Bangkok–Singapore travel/accommodation for F1. These are narrative choices, not claims that every intended transaction has passed. Retained combined proof currently cited below includes a different flight route and different hotel dates. Search results or a hotel prebook do not prove a completed purchase, and no same-day adapter delivery claim is made.

<a id="cardano"></a>
## Cardano — Agentic Commerce

Prize pool: **$27,500** — first $15,000, second $7,500, third $5,000; each includes an introduction call to Draper Dragon’s Cometa Labs. [BuilderBase Cardano, prizes][bb-cardano]

### Problem, approach and Cardano's role

An agent buying a service or product needs a verifiable funding event attached to the exact authorised transaction. Capsule uses Cardano Preprod as a purchase-principal funding option, not as a decorative record added after checkout.

The user selects Cardano from the exact quote's funding options. Capsule freezes the network, asset, payee and amount. The separate bounded payer obtains the x402 requirement and signs under its own policy. The gateway records confirmed funding before the worker can execute the ordinary commerce operation. Blockfrost-backed reads and the configured facilitator support verification; persistent evidence links the payment to the approved purchase.

The demonstrated asset is six-decimal Preprod tUSDM. For example, the retained Atlas run used 0.022870 test tokens for USD 22.87 commercial notional. This is the disclosed test scale, not an exchange rate or redemption into dollars. The commercial operation used Atlas's sandbox test-balance path.

Masumi adds a separate agent-service remuneration path: native task fee/escrow, result and independently verified seller payout. A Masumi fee does not fund the flight, hotel or retail principal. Public Sokosumi listing/platform delivery is not implied by the native Masumi result. See [Masumi integration](docs/work/MASUMI_INTEGRATION.md).

Relevant tools and infrastructure are the TypeScript/Express core, PostgreSQL, x402 Cardano, Evolution SDK, Cardano Preprod, Blockfrost, configured facilitator and Masumi service/runtime listed in the shared stack. Implementation: [funding adapter](src/funding/cardano/), [bounded payer](clients/payer/), [native task runtime](src/channels/sokosumi/).

### Evidence and required write-up coverage

[The retained combined report](docs/evidence/atlas-cardano-combined-pass-20261007.md) records one approved Cardano payment followed by an Atlas sandbox flight order, test-balance payment, ticketed readback and a final receipt. Its route is MNL → CEB on 5 November 2026, not the proposed F1 journey.

Cardano transaction: `000a96cbf2c6155492e7f701f7e57500509125855d043d0057237e85bcf56da0`. The report and [verification JSON](docs/evidence/atlas-cardano-combined-pass-20261007.json) are the supporting records. An explorer link is useful evidence but is not stated as a mandatory Cardano artifact in the supplied BuilderBase page.

**Deployment and scaling — proposed, not implemented production capability.** The prototype is accessed through a hosted MCP gateway and console. A real deployment would need production provider permissions and settlement, customer-specific credentials and spending controls, supported operational recovery and funding infrastructure. The common provider/funding boundaries allow more adapters without making the assistant own transaction correctness. The demonstrated topology remains a single gateway/worker; horizontal-scale and mainnet-readiness claims are not made.

This section plus the shared problem, stack and architecture supplies Cardano's requested short write-up. The separate product-in-action video must be **no longer than three minutes**; its final link is outstanding. [BuilderBase Cardano, “To qualify” / “What to hand in”][bb-cardano]

**Requirement ambiguity:** “To qualify” asks for an **open-source repository with documentation**, while “What to hand in” allows a repository that is **public, or with judge access granted**. The inspected repository is private. These are not silently treated as equivalent; repository access/licensing or organiser clarification remains required before declaring compliance. No specific Preprod/Mainnet choice, mandatory Masumi listing or mandatory explorer artifact is stated in the supplied qualification text.

Cardano rubric: **30% Technical Execution & Use of Cardano Tech; 20% Innovation & Creativity; 20% User Experience & Design; 20% Impact & Feasibility; 10% Pitch & Presentation.** [BuilderBase Cardano, judging][bb-cardano]

<a id="solana"></a>
## Solana — Best Use of Solana

Prize pool: **$10,000** — first $5,000, second $3,000, third $2,000. [BuilderBase Solana, prizes][bb-solana]

Solana is an alternative purchase-principal funding rail using the same quote, approval, purchase and proof model. The supplied payer uses x402 SVM, validates the payment requirement, obtains authenticated sponsor preparation and preserves the signed candidate for recovery. Capsule verifies the transfer rather than accepting a user-supplied transaction label as proof.

**Recorded network:** Solana Devnet. **Recorded asset:** six-decimal test USDC. The integration uses existing token-program functionality; no custom deployed Solana program is claimed. BuilderBase permits meaningful integration with existing programs, requires Devnet or Mainnet Beta functionality and at least one Solana Explorer/Solscan transaction link, and asks for a Program ID and cluster if the project deploys its own program. A frontend that only reads chain data does not qualify. [BuilderBase Solana, “To qualify”][bb-solana]

**Example transaction:** [Solana Explorer — Devnet](https://explorer.solana.com/tx/66jSAnq9eywGKGULpyRWYpskjTneFGcy9VJbNwg6xkHBPYiXt2Ni5HQPzW9hGur6AB4qDNDFt1TfnKMVdgemsV8L?cluster=devnet).

[The combined Nuitée/Solana report](docs/evidence/nuitee-solana-combined-pass-20261007.md) records finalized funding of 0.091070 test USDC, a USD 91.07 sandbox booking at Jyu Capsule Hotel for 6–8 December 2026, independent provider readback and a final receipt. [Verification JSON](docs/evidence/nuitee-solana-combined-pass-20261007.json). These are retained execution facts, not a claim that this documentation change reran them.

**Judge-access boundary:** this run used the supplied payer/facilitator, not a universal stock wallet client. The inspected hosted MCP configuration supports automatic Cardano funding only. A self-contained Solana evaluation path for judges must be confirmed before submission; the retained transaction alone does not satisfy BuilderBase's separate request for a working demo judges can run and inspect without assistance. [Hosted configuration](src/channels/hosted-mcp/config.ts), [Solana payer](clients/solana/pay.ts), [BuilderBase Solana][bb-solana]

Solana rubric: **30% Technical Execution on Solana; 20% Innovation & Originality; 20% Product & User Experience; 15% Real-World Impact & Viability; 15% Demo & Presentation.** Its preference for a live demo concerns track evaluation; the Main stage rule still prohibits live demos. [BuilderBase Solana, judging][bb-solana]

<a id="chainlink"></a>
## Chainlink — Best Workflow with CRE

Prize pool: **$10,000** — the top five Chainlink projects receive $2,000 each. [BuilderBase Chainlink, prize summary][bb-chainlink]

Chainlink is included in the intended submission. Its existing work is a **post-purchase commerce-verification workflow**, not the gateway's purchase orchestrator.

The HTTP-triggered TypeScript CRE workflow reads a bounded Capsule proof and uses CRE's HTTP capability to query Koios for the corresponding Cardano Preprod transaction. It applies identical-result consensus aggregation to selected fields and checks the approved purchase/quote, funding facts, exact recipient/asset/quantity, merchant-result record and final receipt. It returns a sanitised verdict. Cardano is read through Koios HTTP; no CRE-native Cardano client is claimed.

The [recorded successful CLI simulation][cre-evidence] used a **retained Capsule proof served from a local read-only fixture**, plus a **fresh Koios public-chain read at simulation time**. It compiled the workflow to WebAssembly and returned `status: verified`. CRE did not independently query Atlas, rerun the purchase or deploy to a DON. Merchant/ticketing facts were checked against the retained Capsule record.

Source: [`feat/chainlink-cre`, pinned commit][cre-commit]. [Workflow][cre-source], [setup and reproduction][cre-report], [simulation evidence][cre-evidence]. The branch was 2 commits ahead / 29 behind the inspected main baseline. Links are pinned to that branch's commit because those files are absent from the documentation base. This docs lane does not merge them.

### Qualification and remaining boundary

BuilderBase requires a CRE workflow used as an orchestration layer in the project's core functionality, connecting at least one blockchain with an external API/system/data source/LLM/agent, plus successful CLI simulation **or** live CRE deployment. Simulation is sufficient; deployment and Confidential Workflows are optional. Accepted execution evidence includes video, terminal output, logs or deployment details. [BuilderBase Chainlink, “To qualify”, “What to hand in” and FAQ][bb-chainlink]

The recorded workflow demonstrates CRE orchestration of verification. **Still unresolved:** integration and judge access on the final submission candidate, and whether its bounded retained-proof workflow is sufficiently part of the product's core functionality under the BuilderBase wording. The production-mode evidence credential/live Capsule fetch was not demonstrated. These limits must not be rewritten as “live CRE validates all purchases.”

Confidential Workflows are not claimed. If used later, BuilderBase's TEE-handler, sensitive-value processing, core-integration and execution-evidence requirements would apply.

Chainlink rubric: **40% Blockchain; 40% Effective use of CRE; 20% WOW Factor.** [BuilderBase Chainlink, judging][bb-chainlink]

<a id="evidence"></a>
## Evidence and limitations

| Area | What the retained material establishes | Boundary |
| --- | --- | --- |
| Cardano + Atlas | Combined public-testnet payment and sandbox ticketed flight, with receipt. | Different route/date from the proposed F1 story; not fiat settlement. |
| Solana + Nuitée | Combined finalized Devnet payment and confirmed sandbox hotel booking. | Supplied payer; different hotel dates; not hosted Solana self-service. |
| Shopify Global | Live discovery and controlled test-store flow; the [append-only report](docs/evidence/shopify-global-sandbox-e2e.md) preserves the actual run history. | Source merchant receives no order/payment. Discovery, exact quote and paid acceptance must not be conflated. |
| Masumi | Native remuneration/result/payout evidence in [integration report](docs/work/MASUMI_INTEGRATION.md). | Fee and principal are separate; not proof of public Sokosumi delivery. |
| Chainlink | Successful separate-branch local CRE simulation with retained Capsule proof + fresh Koios read. | No DON deployment, live Capsule fetch or independent Atlas check. |
| Frankfurter | Implemented frozen USD/SGD reference flow and [recorded read-only API contract check](docs/FX.md). | Not execution FX or crypto-to-fiat conversion. |
| Hosted experience | [Deployment rehearsal](docs/evidence/render-rehearsal.md), current hosted source and console contract. | No new live login, provider or payment verification was performed in this docs lane. |

The prototype uses public-testnet assets and provider sandboxes. Historical successful runs remain useful proof, but do not certify every current provider route or final candidate. An unknown provider outcome stays unresolved; local tests, recordings and fixtures are never relabelled as new external results.

<a id="deliverables"></a>
## Submission artifacts and source requirements

All entered tracks reuse the shared repository, project link and stage-ready deck. Partner-specific written material is contained in this file.

| Deliverable | Required for | Location / state |
| --- | --- | --- |
| GitHub repository accessible to judges | Main and all three partners | Repository exists; private judge access and Cardano wording need final resolution. |
| Live URL or hosted demo | Main and all three partners | [Console](https://token2049-origins.onrender.com/console/) and [judge quick-start](README.md#judge-quick-start); final access check outstanding. |
| Google Drive link to `.ppt` or `.keynote` | Main and all three partners | Not supplied; slides to be created by Opus after document approval. |
| Embedded screen-recorded demo for stage | Top 5 stage presentation | Not supplied. Live stage demos are prohibited; no YouTube/external video dependency. |
| Product-in-action video, maximum 3 minutes | Cardano | Final video/link not supplied; file or hosting restrictions beyond this are not specified in supplied material. |
| Short problem/technical/deployment write-up + documentation | Cardano | Shared narrative/stack + Cardano section + architecture. |
| Solana Explorer or Solscan transaction link | Solana | Included above. Own Program ID/cluster applies only if a custom program is deployed. |
| Successful CRE simulation/deployment evidence | Chainlink | Pinned evidence included above; integration/qualification caveat retained. |

Sources: supplied [Main page/dashboard][bb-main], [Cardano][bb-cardano], [Solana][bb-solana], [Chainlink][bb-chainlink]. Section names above refer to the user's supplied BuilderBase screenshots and verbatim text, not a new authenticated form inspection.

**Process:** submit Main first, then add Cardano, Solana and Chainlink. More than one partner track is allowed. **Deadline wording:** 12:00am on 8 October 2026; submit by 11:59pm on 7 October. No late entries. The supplied deadline text does not specify its timezone. [Main FAQ / partner submission sections][bb-main]

**Deck rules:** `.ppt` or `.keynote` is the literal requested format; `.pptx` acceptance is not established. Google Slides/Gamma/Vercel page links are rejected as slides. Stage recordings must be embedded in the file. Main's stage text and dashboard say slides lock at submission, while the dashboard has a general pre-deadline update tip; do not assume submitted slides remain editable. No stage pitch duration or slide-count limit is stated in the supplied material. [Main, “Stage notes” and supplied dashboard][bb-main]

**Build provenance:** BuilderBase requires work entirely within the 36-hour event, excludes prior prototypes/substantial code, and allows public libraries/frameworks/APIs/tooling. Solana also requests README disclosure of any pre-existing work. A disclosure is not a waiver of Main eligibility. The owner's final build/reuse declaration is still needed; this draft does not certify it. Sources: [Main eligibility][bb-main], [Solana qualification][bb-solana].

<a id="finalisation"></a>
## Finalisation before approval and submission

The documentation structure is ready for review. These are open release inputs, not hidden completion claims:

| Classification | Missing confirmation or asset | Why it matters |
| --- | --- | --- |
| Investigate Now | Final judge MCP consent/access delivery, matching console key and independent Solana evaluation path. | Public access is intentionally closed; judges still need a usable evaluation route. Never paste the credentials here. |
| Act Now | Final Google Drive deck link, embedded recording and Cardano video/link. | Required submission media; not produced by this documentation-only lane. |
| Investigate Now | Final integrated candidate SHA and treatment of the separate CRE branch; core-functionality qualification. | Existing simulation is real evidence, but is not integrated candidate proof or automatic eligibility. |
| Investigate Now | Owner's build/reuse declaration and Cardano repository/open-source resolution. | Avoid asserting eligibility or licensing/access that has not been established. |
| Investigate Now | Deadline timezone and, if needed, `.pptx` acceptance. | BuilderBase supplied material does not resolve these; retain the literal deck format meanwhile. |
| Ignore / Accept Risk | Historical run dates, test funds and provider test environments. | Acceptable only when stated accurately; do not present them as current inventory or production purchases. |

### Input package for Opus

Use this document as the narrative/track source, [ARCHITECTURE.md](ARCHITECTURE.md) as technical support, [DESIGN.md](DESIGN.md) and [approved brand assets](assets/brand/) for visual identity, and the final recording as embedded media. The demo procedure remains in [docs/demo](docs/demo/). Do not turn an open item, proposed production path or separate-branch result into an implemented claim. The deck is a separate approval step, not an output of this reorganisation.

[bb-main]: https://builderbase.com/track-dashboard/token2049-origins-hackathon/event-site#rules
[bb-cardano]: https://builderbase.com/track/cardano-agentic-commerce
[bb-solana]: https://builderbase.com/track/solana-best-use-of-solana
[bb-chainlink]: https://builderbase.com/track/chainlink-best-workflow-with-cre
[cre-commit]: https://github.com/dropandresetmain-prog/token2049-origins/commit/2695d6bd1110de4effa56e1b6e21232700025454
[cre-report]: https://github.com/dropandresetmain-prog/token2049-origins/blob/2695d6bd1110de4effa56e1b6e21232700025454/docs/work/CHAINLINK_CRE.md
[cre-source]: https://github.com/dropandresetmain-prog/token2049-origins/blob/2695d6bd1110de4effa56e1b6e21232700025454/chainlink/capsule-chainlink/commerce-verification/main.ts
[cre-evidence]: https://github.com/dropandresetmain-prog/token2049-origins/blob/2695d6bd1110de4effa56e1b6e21232700025454/docs/evidence/chainlink-cre/commerce-verification-simulation.json
