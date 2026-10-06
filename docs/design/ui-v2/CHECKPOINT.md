# Capsule UI V2 — checkpoint provenance

Date: 2026-10-06. Scope: preserve the reviewed V2 design on `build/ui`; leave minor alignment adjustments for later. This checkpoint is a prototype and design-guideline addition, not a connected frontend release.

## Reviewed sources

- Conversation artifact: `capsule-ui-v2.html` (843403 bytes).
- SHA-256: `d81afd1a19a1f51821e0bd54faf258aac916be39d639b0f07a4e6e38bdcb3dd3`.
- Conversation review archive: `capsule-ui-v2-review.zip` (2663475 bytes).
- SHA-256: `6cc1375b9373d9d25655d5c1a0d5765f4f2ea986dd312c0dbd9efa8436dcb687`.
- Parent UI commit: `aa7180b647cb12907f1bc93c1d9ec8ddfca5d234`.
- UI branch originally based on commerce core `45db8d6a2fd486947b9e6b5045493a849309f326`.

## Repository packaging

Open `index.html` with its sibling `styles.css`, `prototype.js` and `assets/` folder present. The self-contained review artifact is source-packaged here rather than stored with repeated inline image payloads.

The stylesheet is byte-identical to the reviewed style block. JavaScript is unchanged except relative logo asset paths and insignificant outer whitespace. HTML links those sibling resources. The three already-approved inline PNG logo crops were exported as quality-95 WebP, at the same pixel dimensions: accent 1018 x 117, mono 1007 x 114, graphic 507 x 244. These are presentation derivatives; existing `assets/brand/` originals are unchanged. No fonts are bundled or requested.

No alignment, layout, copy, application behavior, payment logic or provider logic was intentionally revised. `DESIGN.md` records the accepted direction and explicitly deferred polish. `REVIEW_NOTES.md` preserves research with updated checkpoint status. Reference screenshots and the review archive are not duplicated into the repository.

## Minimum checkpoint verification

- PASS: `node --check prototype.js`.
- PASS: extracted CSS matches the reviewed stylesheet; extracted JavaScript matches after logo-path substitution and outer-whitespace normalization.
- PASS: local asset references resolve to existing files; all three image dimensions match their reviewed crops.
- PASS: Chromium renders the packaged source through an inline `set_content` test harness; all logo images load.
- PASS: the route bounding box matches the original review at 1440 x 960.
- PASS: completed, evidence, Escape close, price-change and six-row history smoke checks.
- PASS: 390px purchase detail has no document-level horizontal overflow.
- PASS: no JavaScript page errors or external requests during this bounded smoke check.

The browser environment blocks direct file/URL navigation. Accordingly, actual file-navigation hosting is NOT verified; the harness inlines the local package solely for rendering tests. No browser policy was bypassed. Screenshot recompression differences are not claimed as pixel-identical artwork.

`VERIFICATION.json` is the unchanged historical 13-check report supplied with the original review bundle, not a claim that its full matrix was rerun during this checkpoint. No backend suite, production build, provider/chain call, deployment or merge was run.

## Follow-up boundary

Minor alignments and spacing remain Park for Later and do not block this checkpoint. Live funding truth, quote authority and provider evidence must come from the core before runtime integration; fixture helpers are not suitable substitutes. No next implementation phase starts automatically.
