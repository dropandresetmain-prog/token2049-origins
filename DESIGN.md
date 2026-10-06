# Capsule — UI design checkpoint

Status: V2 direction accepted for a checkpoint on 2026-10-06. Minor alignments remain open. This is not a production-readiness declaration or a pixel-perfect design freeze.

## Canonical reference

- Prototype: `docs/design/ui-v2/index.html` (keep its sibling CSS, JavaScript and assets).
- Research and rationale: `docs/design/ui-v2/REVIEW_NOTES.md`.
- Original review evidence: `docs/design/ui-v2/VERIFICATION.json`.
- Checkpoint scope and provenance: `docs/design/ui-v2/CHECKPOINT.md`.
- Existing approved logo assets: `assets/brand/capsule-wordmark-mono.webp`, `capsule-wordmark-accent.webp`, `capsule-mark.webp`.
- UI branch: `build/ui`; checkpoint parent: `aa7180b647cb12907f1bc93c1d9ec8ddfca5d234`.
- Backend authority: current executable schemas and `docs/contracts/CHANNEL_CONTRACT.md`. Prototype fixture helpers are not financial truth or new API contracts.

The earlier three-direction HTML was rejected. Do not reintroduce its oversized diagram columns, decorative dark panels or marketing copy in the application.

## Product identity and hierarchy

Capsule is a commerce gateway for external agents, not a hotel storefront, another chatbot, crypto wallet or physical capsule product. Preserve agent/funding on the left, Capsule in the middle and ordinary commerce on the right.

The accepted composition is one transaction workspace: purchase identity and amount; concise request and authorization context; compact horizontal route; primary progress column; quieter purchase-summary column. Technical records belong in a contextual inspector. Do not duplicate hashes, timestamps, receipts and timelines in several competing panels. Merchant-specific details demonstrate the outcome without taking over the product identity.

Use the same structure for hotels, retail and flights. Keep funding confirmation, merchant payment and provider outcome separate. A flight reservation is not a ticket; a created order is not necessarily paid. A confirmed chain payment does not itself prove commerce completion.

## Visual system

The exact CSS remains the implementation reference. These are its principal tokens:

| Role | Value |
| --- | --- |
| Canvas | `#F2EEE7` |
| Paper surface | `#FFFDF9` |
| Ivory | `#F8F6EF` |
| Primary ink | `#292625` |
| Secondary text | `#746D65` |
| Divider | `#E8E2D9` |
| Stone | `#D8D1C6` |
| Oxblood / primary actions | `#722D32` |
| Coral / transit accent | `#D27C6B` |
| Blush | `#F1E3DE` |
| Positive status | `#426751` on `#EDF3ED` |
| Review status | `#875527` on `#FAF0E3` |

Use the existing system sans stack for application text. The prototype names Inter with system fallbacks, but ships no font files and downloads no external fonts. Use tabular numerals for amounts; monospace is for identifiers and audit records. Do not replace product typography with oversized fashion-serif headings. The fashion influence comes from the restrained palette, spacing and hierarchy.

Retain the approved logo silhouettes, reversed E and detached rounded center stroke. Use the accent wordmark in the workspace header, mono in quiet contexts, and the split graphic mark in the compact gateway. Source raster artwork is not a vector master. The prototype's same-dimension cropped web exports are presentation derivatives, not replacement brand masters.

Use thin warm borders, restrained shadows and modest corner radii. Reserve the pill silhouette for the gateway/mark instead of making every container a pill. Network colors must not take over the brand.

## Screens and interactions

The checkpoint contains in-progress purchase, completed purchase, evidence inspector with audit tab, changed-price comparison, and purchases history with search/filter/empty states. Hotel and retail share the layout; additional examples in history are illustrative only.

Show the funding method before payment. The preview offers Cardano and Solana and visibly disables Stripe. Method selection is not signing, approval or proof of integration readiness. Confirmed funding is read-only. Changed financial terms require renewed authority even below a ceiling; the preview only copies an approval request, never executes it.

Evidence and sample receipt availability must follow the displayed state. Keep raw redacted state behind inspection. Do not show a completed receipt while provider confirmation is pending. Sokosumi task fees/escrow do not become purchase principal by changing a visual status.

Presentation mode simplifies this same workspace rather than introducing another theme. On narrow screens the route stacks; summary moves below progress; history scrolls in its table container. Preserve visible keyboard focus, dialog focus handling, Escape close, semantic controls and reduced-motion behavior. Small spacing/alignment details are explicitly deferred.

## Prototype versus integration

All IDs, totals, times, orders, asset valuations and outcomes here are local samples. Keep the illustrative-data labels and explicit no-payments disclosure. The Run sample timer is a design control, not a network timing promise. Do not copy local state switches, `paid()` heuristics or fixture exports into live funding/approval logic.

Integration must read authenticated channel identity, executable quote context and independent payment/provider evidence from the existing core. Do not infer paid status from overall purchase state. Keep operator treasury permissions separate from customer evidence. Preserve simulated purchasing capacity labels; receiving test crypto is not bank cash or a crypto-to-fiat conversion.

If external product discovery is paired with execution in our own Shopify test store, identify the discovery source and sandbox execution merchant separately. Do not imply the original merchant fulfilled the test purchase.

## Next work and exclusions

Park for Later: minor alignments and spacing, refined responsive details, and eventual vector-master preparation. These do not block this checkpoint.

Backend integration, real funding/provider runs, Treasury/Connections expansion and the landing page are not part of this commit. No deployment, merge, production build or backend test run is authorized by this design checkpoint. Refine this V2 in the same design chat; use a fresh implementation chat when a bounded integration milestone is approved.
