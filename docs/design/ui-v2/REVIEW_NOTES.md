# Capsule — UI review 02

Status: V2 visual checkpoint requested by Min Htet on 2026-10-06. Minor alignment refinements are deferred. This remains a fixture-backed prototype, not a connected production frontend. See the repository root DESIGN.md for the accepted direction and boundaries.

## Open

Open `index.html` in a browser with its sibling files present. The reviewed HTML has been packaged as HTML, CSS, JavaScript and same-dimension web-optimized logo crops. Layout, styling, copy and behavior have not been revised. It does not load external fonts, scripts or images. The References links are optional outbound links.

The bottom controls select the five review views: in progress, completed, evidence, price change and purchases. The scenario selector switches hotel/retail. Run sample plays an eight-second local sequence. The expand icon at the top switches the same purchase into presentation layout.

The purchase list has working search, status filters, keyboard row navigation and empty states. Selected sample status changes stay consistent with the list until the page is reloaded. The evidence inspector separates payment and merchant outcomes and has an audit tab. Exports are explicitly labeled sample JSON.

## What changed

One product layout replaces three unrelated diagram treatments. A compact horizontal route preserves agent/funding on the left, Capsule in the middle and ordinary commerce on the right. The reading order is request and amount, route, current progress, then contextual properties. One evidence action opens the inspector instead of duplicating hashes, timestamps and receipts across panels. There is no product photography, 3D pharmaceutical pill or hotel shopping UI.

The approved ivory, graphite, stone, oxblood, coral and blush family is retained. The three approved logos are cropped from their existing raster files; no new logos or typography masters were generated. No font files are included.

## References inspected

These are the actual results inspected in Mobbin, not names assumed from search queries. The sources distinguish observed patterns from Capsule-specific proposals. No source screenshots are redistributed in this bundle.

### Mercury — Transactions + contextual inspector

[Open the source screen](https://mobbin.com/screens/d14e9441-a25f-4730-97a3-d7e7ed531af4)

Observed: A persistent transaction table remains visible while a right-side panel groups the selected amount, timeline, attachments and notes.

Applied: Keep the purchase list scannable. Put detailed evidence in a contextual inspector, not another dashboard card.

### Linear — Object detail + quiet properties

[Open the source screen](https://mobbin.com/screens/f00cc4fb-4083-43fc-a0fb-703a6c4ef771)

Observed: The issue title, description and activity occupy one primary reading column; status and project properties sit in a narrow right column.

Applied: Give the purchase a primary reading order, with the quote and scope in a separate properties column.

### Deel — Amount + payment-method review

[Open the source screen](https://mobbin.com/screens/d545ba4b-86b8-4bf2-81a0-76bcd8b06f98)

Observed: A clear total due is directly above a named payment method and a change-method action. A compact right column holds review progress and a payment breakdown.

Applied: Show the funding method explicitly before payment; keep settled payments read-only. Compare changed quotes before any approval.

### Stripe — State-filtered transaction history

[Open the source screen](https://mobbin.com/screens/1bbafee3-44a6-4a27-81d2-dfdab7388258)

Observed: Status categories and filters sit above an aligned transaction table. Amount and status can be scanned independently of other metadata.

Applied: Use status tabs, a working search and aligned amounts across agents and commerce categories.

## Data truth and integration boundary

The current channel contract and purchase schema were read on `build/ui` at `aa7180b647cb12907f1bc93c1d9ec8ddfca5d234`.

- Source schema: `src/contracts/commerce.ts`.
- Channel/evidence boundary: `docs/contracts/CHANNEL_CONTRACT.md`.
- The design-creation pass changed no production code, schema, branch, payment adapter or provider integration. The subsequent authorized checkpoint adds root DESIGN.md and this prototype package only.
- Everything displayed is a local design fixture. Named agents/rails/providers do not establish that a live integration is ready.
- Funding and merchant outcomes remain independent. A pending provider result never gets a completed receipt.
- The changed-price view pauses and compares exact quotes. Copy approval request only copies text; it does not authorize, refund, reassign previous funding or initiate a top-up.
- Cardano and Solana are preview choices before funding; Stripe is visible but disabled. Confirmed funding is not editable.
- The Sokosumi/Masumi sample deliberately remains unfunded at the purchase-principal level. Task fees/escrow are not shown as a completed purchase.
- Merchant names, test-asset amounts, quote references, timings, orders and receipts are illustrative. No explorer links or actual booking identifiers are fabricated.
- Provider-specific cancellation terms and quote expiry are not invented; the quote panel identifies that these must come from a real executable quote.

The frontend will still need authorized quote context, channel identity and evidence reads when integrated. This file does not propose a new API or bypass the existing signer/approval boundary.

## Verification

See `VERIFICATION.json` for 13 passing checks covering state-dependent evidence, receipts, quote review, search/filters, local state consistency, rail selection, sample playback, keyboard interaction, responsive overflow, presentation layout and absence of external requests.

Runtime: Chromium via Playwright. The harness injected the self-contained HTML using `set_content`; direct `file://` navigation is blocked by the test environment's browser policy. No backend suites, production build or external acceptance calls ran.

Screens were captured at 1440×960, 390 px mobile, and 1280×720 presentation. Additional horizontal-overflow checks ran at 1280×900, 1024×768 and 768×1024. Long/mobile detail views scroll; the core presentation route and evidence action fit above the review controls at 1280×720.

The user authorized committing this V2 checkpoint and deferring minor alignments. This does not authorize backend integration, deployment, a merge, or landing-page implementation. The original verification below belongs to the self-contained review artifact; it is not a new full test run on the packaged source.
