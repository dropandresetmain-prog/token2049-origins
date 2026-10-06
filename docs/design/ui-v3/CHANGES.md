# Capsule UI V3: changes from V2

Status: approved on 2026-10-06; supersedes the V2 checkpoint (`607c21a`). V2 is kept unchanged in `../ui-v2/` for comparison. Open `../compare.html` to view both side by side on the same screen and viewport.

Same composition, information architecture, fixtures, data-truth rules and interactions as V2. V3 changes presentation only. No backend, payment, provider or contract changes.

## Changes

1. **Price change decision above the fold.** In V2 at 1440 x 900, "Review new quote" sat at y=865, under the review dock (y=842). V3 puts the explanation and the primary action in the top banner and drops the repeated "Approval needed" badge and summary paragraph. The section below only compares quotes.
2. **Type scale.** 20 font sizes became five tokens (12 / 13 / 14 / 16 / 28) and 7 weights became 3 (400 / 500 / 600). Nothing visible is smaller than 12px. In V2, 55 of 94 visible text nodes were 11px or smaller.
3. **Contrast.** `--muted` darkened from `#746D65` (4.41:1 on canvas) to `#6A635B` (5.1:1). On the price-change screen, the only text under 4.5:1 is the decorative breadcrumb slash. V2 had 19 failing elements, including the no-payments disclosure at 3.80:1.
4. **Tokens.** `styles.css` went from 145 unique hex values to 27, all declared in `:root`. Radii went from 14 values to four tokens (6 / 10 / 14 / pill), plus 50% for circles. The stylesheet is now readable rather than minified, with no override layers.
5. **Status colours.** "In progress" is now neutral ink with a small spinner (static under reduced motion), so only "Needs review" uses amber. "Awaiting payment" is outlined. Decorative status dots are removed. Coral is used only for the moving route indicator.
6. **Title.** The H1 is the purchase name ("Two nights in Singapore"), matching the purchases list. The ID is secondary, monospace and copyable. The breadcrumb shows the name too.
7. **Repetition removed.**
   - One currency format (`$286.00`); "USD" appears once, beside the total.
   - The amount is shown in the header and the cost breakdown only.
   - Five scattered sample-data labels became one persistent environment strip ("Sample data. No real payments, bookings or provider calls."), plus the evidence-panel disclaimer.
   - "Service fee" and "Capsule fee" are unified as "Capsule fee".
   - The duplicate wordmark under the gateway mark and the "One linked purchase" label are removed.
   - Middle-dot separators are reduced, and em/en dashes are removed from visible copy.
8. **Route panel.** Flat ivory background and a compact, centred route instead of long empty connector lines. The moving indicator now animates `transform` instead of `left`.
9. **Mobile navigation.** Below 560px a segmented Live / Purchases / Needs review row replaces the hidden sidebar. The prototype dock scrolls horizontally instead of clipping.
10. **Copy.** The marketing line "Every agent. Every purchase. One place to follow through." became the plain "Purchases requested by your connected agents." Sample names are written as plain phrases.

## Not done (needs a decision or assets)

- **Self-hosted fonts.** Still the system stack with Inter first. Weights now map to 400/500/600 so fallbacks render correctly, but bundling Inter or Geist plus a monospace font needs approval to add font files.
- **Icon library.** Icons are still the prototype's hand-drawn SVG paths. Swapping to Phosphor (Light) needs the dependency added in the real frontend.
- **Palette.** The brand palette is unchanged apart from `--muted`. Cooling the surfaces is a brand decision.
- **Loading skeletons.** The detail view still has no loading state. Add one at integration, once real data loads asynchronously.
- **`DESIGN.md`.** Updated to V3 as the canonical reference, with V3 tokens, type scale and radii.

## Verification (local, Chromium, served over http://127.0.0.1)

- `node --check prototype.js` passes. No console errors.
- No horizontal overflow at 1440 x 900, 1024 x 768 or 390 x 844.
- Presentation layout at 1280 x 720: the Evidence action ends at y=642, above the dock (y=662).
- Smoke checks: Run sample reaches Completed; receipt and changed-quote dialogs open and close; the Needs review queue shows 2 rows; search reaches the empty state and clears back to 6 rows; opening a row updates the title and breadcrumb.
