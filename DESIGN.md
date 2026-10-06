# Capsule: UI design reference

Status: V3 approved on 2026-10-06. V3 supersedes the V2 checkpoint (`607c21a`); it keeps V2's composition, information architecture and data-truth rules and revises presentation only. This is not a production-readiness declaration or a pixel-perfect design freeze.

## Canonical reference

- Prototype: `docs/design/ui-v3/index.html` (keep its sibling CSS, JavaScript and assets).
- V3 change log and verification: `docs/design/ui-v3/CHANGES.md`.
- V2 to V3 side-by-side comparison: `docs/design/compare.html`.
- Superseded V2 checkpoint, kept for history: `docs/design/ui-v2/` (research and rationale in `REVIEW_NOTES.md`, original review evidence in `VERIFICATION.json`, provenance in `CHECKPOINT.md`). The Mobbin research in `REVIEW_NOTES.md` still applies to V3.
- Existing approved logo assets: `assets/brand/capsule-wordmark-mono.webp`, `capsule-wordmark-accent.webp`, `capsule-mark.webp`.
- UI branch: `build/ui`.
- Backend authority: current executable schemas and `docs/contracts/CHANNEL_CONTRACT.md`. Prototype fixture helpers are not financial truth or new API contracts.

The earlier three-direction HTML was rejected. Do not reintroduce its oversized diagram columns, decorative dark panels or marketing copy in the application.

## Product identity and hierarchy

Capsule is a commerce gateway for external agents, not a hotel storefront, another chatbot, crypto wallet or physical capsule product. Preserve agent/funding on the left, Capsule in the middle and ordinary commerce on the right.

The accepted composition is one transaction workspace: purchase name and amount; concise request and authorization context; compact horizontal route; primary progress column; quieter purchase-summary column. Technical records belong in a contextual inspector. Do not duplicate hashes, timestamps, receipts and timelines in several competing panels. Merchant-specific details demonstrate the outcome without taking over the product identity.

The page title is the purchase name (for example "Two nights in Singapore"), matching the purchases list. The purchase ID is secondary, monospace and copyable. Show each amount once in the header and once in the cost breakdown, in one currency format (`$286.00`), with the currency code beside the purchase total.

Use the same structure for hotels, retail and flights. Keep funding confirmation, merchant payment and provider outcome separate. A flight reservation is not a ticket; a created order is not necessarily paid. A confirmed chain payment does not itself prove commerce completion.

## Visual system

The exact CSS (`docs/design/ui-v3/styles.css`) is the implementation reference. Every raw colour value is declared once in `:root`; components reference tokens only. Do not add one-off hex values in components.

| Role | Token | Value |
| --- | --- | --- |
| Canvas | `--canvas` | `#F2EEE7` |
| Paper surface | `--paper` | `#FFFDF9` |
| Ivory | `--ivory` | `#F8F6EF` |
| Primary ink | `--ink` | `#292625` |
| Secondary text | `--muted` | `#6A635B` (V2 `#746D65` failed AA on canvas) |
| Divider | `--line` | `#E8E2D9` |
| Stone | `--stone` | `#D8D1C6` |
| Oxblood / primary actions | `--ox` | `#722D32` |
| Coral / route movement only | `--coral` | `#D27C6B` |
| Blush | `--blush` | `#F1E3DE` |
| Positive status | `--positive` on `--positive-bg` | `#426751` on `#EDF3ED` |
| Review status | `--warning` on `--warning-bg` | `#875527` on `#FAF0E3` |

Oxblood is the single brand accent. Coral appears only on the moving route indicator. Status colour carries meaning, not decoration:

- In progress: neutral ink with a small spinner (static under reduced motion).
- Needs review: amber. This is the only warm status, reserved for states that need a person to act.
- Completed: green.
- Awaiting payment: outlined neutral.
- No decorative status dots.

Typography uses five sizes and three weights:

| Token | Size | Use |
| --- | --- | --- |
| `--fs-xs` | 12px | Metadata, labels, badges, timestamps. The minimum visible size. |
| `--fs-sm` | 13px | Secondary text, table cells, controls |
| `--fs-md` | 14px | Body, step names |
| `--fs-lg` | 16px | Section headings, request text, dialog and inspector titles |
| `--fs-xl` | 28px (24px under 560px) | Page title and purchase total |

Weights are 400, 500 and 600 only, so system fallbacks render as intended. All text meets WCAG AA (4.5:1) against its background.

Use the existing system sans stack for application text. The prototype names Inter with system fallbacks, but ships no font files and downloads no external fonts. Self-hosting a sans and monospace pair is an open decision for the production frontend. Use tabular numerals for amounts; monospace is for identifiers and audit records. Do not replace product typography with oversized fashion-serif headings. The fashion influence comes from the restrained palette, spacing and hierarchy.

Retain the approved logo silhouettes, reversed E and detached rounded center stroke. Use the accent wordmark in the workspace header, mono in quiet contexts, and the split graphic mark alone in the compact gateway (no wordmark beneath it). Source raster artwork is not a vector master. The prototype's same-dimension cropped web exports are presentation derivatives, not replacement brand masters.

Use thin warm borders, restrained shadows and four corner radii: `--r-sm` 6px for controls, `--r-md` 10px for panels, `--r-lg` 14px for surfaces and dialogs, and `--r-pill` for the gateway/mark only. Network colors must not take over the brand. Animate `transform` and `opacity` only.

## Screens and interactions

The prototype contains in-progress purchase, completed purchase, evidence inspector with audit tab, changed-price comparison, and purchases history with search/filter/empty states. Hotel and retail share the layout; additional examples in history are illustrative only.

Show the funding method before payment. The preview offers Cardano and Solana and visibly disables Stripe. Method selection is not signing, approval or proof of integration readiness. Confirmed funding is read-only. Changed financial terms require renewed authority even below a ceiling. The changed-quote explanation and its primary action ("Review new quote") sit in a banner above the route, visible without scrolling. The preview only copies an approval request, never executes it.

Evidence and sample receipt availability must follow the displayed state. Keep raw redacted state behind inspection. Do not show a completed receipt while provider confirmation is pending. Sokosumi task fees/escrow do not become purchase principal by changing a visual status.

Presentation mode simplifies this same workspace rather than introducing another theme. On narrow screens the route stacks; summary moves below progress; history scrolls in its table container. Below 560px a segmented Live / Purchases / Needs review row replaces the sidebar. Preserve visible keyboard focus, dialog focus handling, Escape close, semantic controls and reduced-motion behavior.

## Prototype versus integration

All IDs, totals, times, orders, asset valuations and outcomes here are local samples. Keep the explicit no-payments disclosure: one persistent environment strip ("Sample data. No real payments, bookings or provider calls.") plus the evidence-panel disclaimer. In a real sandbox environment the same strip pattern identifies test mode. The Run sample timer is a design control, not a network timing promise. Do not copy local state switches, `paid()` heuristics or fixture exports into live funding/approval logic.

Integration must read authenticated channel identity, executable quote context and independent payment/provider evidence from the existing core. Do not infer paid status from overall purchase state. Keep operator treasury permissions separate from customer evidence. Preserve simulated purchasing capacity labels; receiving test crypto is not bank cash or a crypto-to-fiat conversion.

If external product discovery is paired with execution in our own Shopify test store, identify the discovery source and sandbox execution merchant separately. Do not imply the original merchant fulfilled the test purchase.

## Next work and exclusions

Open decisions for the production frontend:

- Self-hosted fonts (a sans plus a monospace).
- Replacing the prototype's hand-drawn SVG icons with one maintained library (Phosphor Light suggested).
- Loading skeletons for asynchronous data.
- Eventual vector-master preparation.

Backend integration, real funding/provider runs, Treasury/Connections expansion and the landing page are not part of this design. No deployment, merge, production build or backend test run is authorized by this design reference. Use a fresh implementation chat when a bounded integration milestone is approved.
