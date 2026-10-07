# SGD budgets and reference display

Shopify Global accepts SGD user budgets while merchant quotes and Cardano/Solana funding remain USD-based. Hotel and flight adapters retain their existing currency behavior. No API key, environment setting, dependency, or database migration is required. The gateway must be able to reach `api.frankfurter.dev` over HTTPS; Node 24 is required for exact JSON numeric lexemes, consistent with the existing engine requirement.

The MCP host maps “S$”, “SGD”, “Singapore dollar”, and “Singapore dollars” to `spendCeiling.currency: "SGD"`, using scale 2 and integer cents. There is no natural-language parser in the commerce core.

At search, the core requests `https://api.frankfurter.dev/v2/rate/USD/SGD`. The adapter validates the pair, positive decimal rate, and reference date, forbids redirects, and applies a 3-second timeout through response-body consumption. Numeric JSON rate text is retained exactly; all conversions use BigInt rationals. This is a latest/daily reference, not a trading price or a payment-provider conversion rate. An unavailable or malformed response returns `route_unavailable`: “Currency conversion is temporarily unavailable. Try again with a USD budget.” No provider search proceeds without the reference.

The original SGD intent remains stored as the user's authority. Each returned offer carries `searchConversion`: its `userBudget`, conservative `providerSearchCeiling`, and frozen `snapshot` (Frankfurter source, USD→SGD decimal rate, reference date, and fetch timestamp). The core divides the SGD ceiling by that rate and rounds down to USD cents. Only that USD inventory bound is passed to Shopify discovery, source refresh, and shadow preparation.

At exact quote, the USD merchant total plus USD service fee is multiplied by the same frozen rate and rounded up to SGD cents. It must fit the original SGD budget. Otherwise the core returns `spend_limit_exceeded` and stores no quote. Shipping, tax, and the service fee are therefore included in the final budget check; indicative search results may still exceed the budget when these charges are added.

Quotes add optional `displayConversion`, containing the search evidence plus `convertedPayable`. It participates in the immutable quote digest and is copied into purchase and receipt views. Stored JSON retains the evidence without a schema migration. Approval still binds the exact quote digest, its USD `payablePrincipal` as `maxTotal`, and the user-selected funding option. Quote/approval/funding/completion never refresh FX. USD requests omit both conversion blocks and make no FX call.

Example using a **synthetic** rate of 1 USD = 1.3 SGD:

- Original budget: S$60.00; provider inventory ceiling: US$46.15.
- Exact merchant total: US$43.19; service fee: US$0.00.
- Reference payable equivalent: about S$56.15 (rounded up), Frankfurter, reference date.
- Cardano Preprod funding under the existing 1:1000 policy: 0.043190 tUSDM.

The SGD reference and testnet notional are distinct. No merchant is described as charging SGD, and no chain is described as settling SGD. Completion keeps existing sandbox/provenance limitations, USD merchant amounts, and verified funding evidence, with the frozen SGD reference equivalent shown separately.

Tests mock Frankfurter and all purchase/payment activity. The normal suite requires the repository's existing local PostgreSQL fixture database, and makes no live FX call. An optional read-only API probe can confirm the current contract after tests. Deploy the gateway and MCP instructions together before the next hosted MCP run; older strict clients must accept the new optional conversion blocks.

## Live contract confirmation

After the checks passed on 7 October 2026, one read through the adapter returned `USD → SGD`, rate `1.2787`, reference date `2026-10-06`, fetched at `2026-10-07T00:17:20.145Z` (08:17 Singapore time). This confirms the v2 response contract and exact decimal parsing. At that reference rate, a S$60 budget gives a US$46.92 search bound and a hypothetical US$43.19 payable displays as about S$55.23. This observation does not pin a rate for future searches; each search obtains and freezes its own latest reference. No live purchase or blockchain payment was made.
