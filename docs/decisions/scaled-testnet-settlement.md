# Founder decision — public-testnet notional scale (2026-10-06)

Authority: the external acceptance hardening lane explicitly approves fixed 1:1000 testnet notional
settlement. It supersedes the historical warning against penny-sized transfers in the pinned
ARCHITECTURE_DECISIONS.md funding-shortage row, IMPLEMENTATION_PLAN.md full-quote funding paragraph,
and SETUP_AND_EVIDENCE.md funding design warning. Those snapshots remain unchanged. This is a visible
founder decision, never a silent bypass of commercial authority or funding requirements.

## Demo settlement policy

The hackathon demo uses a disclosed **1:1000 notional scale** for public-testnet stablecoins:
USD 183.40 commercial principal -> 0.183400 tUSDM on Cardano Preprod (183,400 base units at 6 decimals).
These test assets have no real-world value. This is a testnet notional scale, not an FX rate.
The chain transfer demonstrates payment authorization, amount binding, transaction settlement,
purchase gating and reconciliation. It does not prove USD redemption, crypto-to-fiat conversion,
Visa settlement, bank settlement or equivalent economic value. Provider sandbox commerce continues
at its full commercial test amount. SERVICE_FEE_BPS remains 0 by default; a configured non-zero fee
uses the same scale as principal.

Canonical secret-free scenario data: [demo/demo-data.json](../../demo/demo-data.json), validated by
[src/demo/config.ts](../../src/demo/config.ts). Runtime endpoints, secrets, exact asset identities,
protocol constants and independent signer/security caps remain runtime configuration or code.

## Frozen contract and accounting

SettlementPolicy accepts explicit full_notional (1/1) and scaled_testnet (1/1000) modes. New runnable
demo quotes use the canonical policy. USD cents only; unsupported currency or inexact representation
fails closed. BigInt computes commercialMinor * 10^chainDecimals * numerator / (100 * denominator).
No market price or FX conversion is inferred. Six decimals produce:

| Commercial principal | Testnet quantity | Base units |
|---|---|---|
| USD 1.00 | 0.001000 | 1000 |
| USD 10.00 | 0.010000 | 10000 |
| USD 183.40 | 0.183400 | 183400 |
| USD 123.47 | 0.123470 | 123470 |
| USD 500.00 configured default limit | 0.500000 | 500000 |

A funding option carries amount (network, exact assetId, symbol if recognized, decimals, base units),
rail, payTo and settlement: policy, commercialPrincipal, commercialServiceFee, commercialTotal,
principalBaseUnits, feeBaseUnits, totalBaseUnits. Commercial principal is merchantTotal; the historical
payablePrincipal field means commercial total including fee. Commercial USD 100.00 + USD 1.00 fee
becomes 100000 + 1000 = 101000 token base units, exactly.

Quote digest/approval binds this entire structure. Purchase funding_requirement_json freezes it;
quotes.public_json also retains the original option. No DDL migration is added. Public purchase,
receipt and evidence list/detail expose fundingRequirement after funding, so UI can always show both
commercial values and the original chain requirement. funding[].transferReference is actual verified
proof or an explicitly labelled offline fixture; no transaction identifier is synthesized for acceptance.

The Cardano x402 entry adds extra.settlement and extra.chainDecimals. Both are included in signed
metadata commitment 2049, alongside resource/purchase/quote/digest/expiry/network/asset/amount/payee.
Changing the current demo file or service fee configuration never recalculates existing requirements.
Legacy records retain stored requirements/commitment format and legacy fee accounting. The new bounded
payer permits scaled_testnet only; it refuses old unstructured/full-notional challenges. Requote for a
new demo payment; keep old obligations for reconciliation, without rewriting history.

Commercial reservations/journal entries remain simulated fiat:USD/2. Chain entries remain the exact
network/asset in token base units. The testnet principal/fee accounts record application of valueless
assets; they do not establish commercial USD income or conversion. Existing surplus/late-funding
liabilities remain separate, and excess observed transfers do not enlarge the approved purchase.

## Demo consolidation audit

Canonical buyer/shipping data now supplies the shared commerce harness and positive Shopify
adapter/browser fixtures. Hotel search offsets/destination/nationality/occupancy/maximum and synthetic
traveller supply scripts/nuitee-check.ts. Flight route/date offset/adults/maximum supply
scripts/atlas-check.ts and the Atlas read-only readiness probe. Demo labels and USD 183.40 scaling
example live in the JSON. Product handle remains null until the development-store product is known.
No scripts with external capability were executed in this lane.

Independent arbitrary edge-case fixtures keep their prices, dates, routes and identities: provider
wire-format, expiry, fee, capacity, redaction and concurrency tests must not move with a demo edit.
Shared fixture accounting explicitly opts into full_notional; focused tests exercise canonical
scaled_testnet through real local PostgreSQL. Cardano network IDs/asset policies, API hosts, Shopify
Bogus values, metadata label, HTTP timeouts, generic security limits, database URLs and all secrets
remain outside demo data. They define protocol/runtime/safety boundaries, not a demo scenario.
