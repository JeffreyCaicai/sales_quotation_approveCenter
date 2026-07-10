# Task 4 Report: Guided Quote Wizard and Live Calculation

## Status

Implemented the scoped Task 4 quotation creation/editing workflow. Manager/CEO approval mutations and final printable Quotation remain intentionally out of scope.

## Delivered

- Added `submitQuote(input, previousQuote, actor)` with stable demo quote/event IDs, timestamped submission events, history preservation, first-submission handling for saved drafts, and returned-quote resubmission versioning.
- Added a six-step sales wizard:
  1. Sales-PIC-filtered customer and brand selection.
  2. Building versus package placement mode.
  3. Searchable multi-building selection or single-package comparison.
  4. Weeks, Spot, and Bonus parameters.
  5. Discount entry with a live approval-path warning.
  6. Final review and submission.
- Added a sticky live summary for Rate Card base price, discount, net price, simulated 6% tax, total, traffic, and impressions.
- Added field-level Chinese validation for each step and a final validation gate.
- Wired new quote creation, draft persistence, returned quote editing, resubmission, list replacement/insertion, and `localStorage` persistence into `QuotationApp`.
- Added responsive desktop/mobile wizard styles and reused the existing native `<dialog>` modal implementation unchanged.

## TDD Evidence

### RED

- `npm run test:logic` initially failed with `SyntaxError: ... does not provide an export named 'submitQuote'` after adding the new submission transition tests.
- The saved-draft transition test then failed with `2 !== 1`, proving the implementation incorrectly treated a draft's first submission as a resubmission.
- `node --test tests/rendered-html.test.mjs` initially failed with `ENOENT` for `components/quote-wizard.tsx` after adding the Task 4 source contract.

### GREEN

- `npm run test:logic`: 17 tests passed, 0 failed.
- `node --test tests/rendered-html.test.mjs`: 2 tests passed, 0 failed.
- The returned quote test confirms a 75% discount still returns to `pending_manager`, increments the version, preserves history, and appends `resubmitted`.
- The saved draft test confirms its first submission remains version 1 and appends `submitted`.

## Verification Output

- `npm run test:logic`: PASS — 17/17 logic tests.
- `npm run lint`: PASS — ESLint exited 0.
- `npm run build`: PASS — vinext completed all five build phases and produced `/`.
- `npm test`: PASS — production build plus 2/2 rendered/source smoke tests.
- `git diff --check`: PASS — no whitespace errors.

Direct `npx tsc --noEmit` is not a configured project script and still reports pre-existing workspace issues for Cloudflare worker globals, `cloudflare:workers`, and `.ts` extension imports. After fixing the one new wizard typing issue found by that command, none of its remaining diagnostics point to Task 4 component or quotation files.

## React and Accessibility Review

- Live pricing, selected metrics, customer/brand relationships, and approval path are render-derived; no synchronization effects were added.
- Static step labels and formatters are module-level, and step subcomponents are not declared inline.
- Customer/brand options are filtered directly by the active Sales PIC.
- Selection cards expose `aria-pressed`; steps expose dynamic `aria-current="step"`; errors use `aria-invalid`, `aria-describedby`, and alert semantics; approval changes use a polite live region.
- Existing native dialog cancel, backdrop, autofocus, and focus-restoration behavior is preserved.
- Mobile switches the wizard to a single column, keeps actions above the fixed mobile navigation, and moves the compact live summary before form content.

## Self-Review

- Scope check: no manager approval, CEO approval, return mutation, approved status mutation, or printable Quotation implementation was added.
- Transition check: all submissions first enter `pending_manager`; executive discount routing is warning-only until Task 5.
- Persistence check: new drafts prepend, edits replace by stable ID, and every save/submit writes the complete quote collection.
- Pricing check: fixture prices are four-week Rate Cards; base price scales by `weeks / 4`; tax uses the exported 6% demo rate.
- Boundary check: approval messaging is standard through 60%, elevated above 60% through 70%, and CEO-path above 70%.

## Concerns / Remaining Risk

- The Browser plugin was present but reported no available browser backends (`agent.browsers.list()` returned `[]`), so no screenshot-based desktop/mobile interaction pass was possible in this environment.
- Visual behavior is covered by responsive CSS review, successful production compilation, and source/render smoke checks, but a later browser pass should exercise both building and package journeys at desktop and mobile widths.
- Direct standalone TypeScript verification remains noisy because of the pre-existing project configuration issues listed above; the supported lint/build/test commands are green.

## Review Fixes: Numeric Safety, Referential Integrity, and Mobile Summary

### Review RED Evidence

- Logic tests first failed because `validateQuoteReferences` did not exist.
- The new pricing-input test then failed because infinite `basePrice` and non-finite `taxRate` were accepted.
- The storage-boundary regression failed after a NaN Bonus serialized to `null`, causing `loadQuotes()` to reject the stored array and fall back to all seeded quotes instead of preserving the last valid payload.
- The source/smoke contract first failed because the wizard did not call referential validation and mobile CSS hid `.pricing-ledger` entirely.

### Review GREEN Evidence

- Logic suite expanded from 17 to 26 passing tests.
- Weeks and Spot now require finite positive integers; Bonus requires a finite nonnegative integer; discount remains finite and constrained to 0%–100%.
- Explicit base price and tax-rate values must be finite and nonnegative.
- `submitQuote`, wizard save/submit actions, `QuotationApp` persistence, and `saveQuotes` each provide a defensive validation boundary.
- `saveQuotes` refuses non-finite, fractional, negative, or out-of-range quote numerics without overwriting the last valid local payload.
- Referential validation now rejects customers outside the active Sales PIC portfolio, brands outside the selected customer, building/package mode mismatches, unknown IDs, duplicate/package-multiplicity mismatches, and tampered base prices.
- Draft updates preserve an existing placement mode when a caller omits it, while new drafts still require an explicit mode.
- Placement mode and resource groups expose `aria-invalid` plus error-linked `aria-describedby`.
- The mobile summary now renders a compact two-column ledger containing Rate Card base, discount, net, simulated 6% tax, and full-width total instead of hiding core price figures.

### Review Verification

- `npm run test:logic`: PASS — 26/26 tests.
- `node --test tests/rendered-html.test.mjs`: PASS — 2/2 tests.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- `git diff --check`: PASS.

The previously recorded browser-backend limitation still applies; no live screenshot pass became available during this review fix.

## Final Review Fixes: Draft-Safe Saving

### Final RED Evidence

- The logic suite first failed because the pure `createDraftQuote` helper did not exist.
- After the helper was added, the incomplete-draft round-trip still failed because the storage schema rejected zero weeks/Spot and an unchosen placement mode, falling back to seed data.
- The source/smoke test failed because Bonus did not receive `errors.bonus` and Save Draft still called full `validateAll()`.

### Final GREEN Evidence

- Added a pure draft constructor that preserves incomplete customer, brand, resource, and placement-mode state while normalizing unsafe numeric inputs to finite values.
- A new early-step draft with zero weeks/Spot and no placement mode safely round-trips through local storage.
- NaN, Infinity, negative, and fractional campaign inputs normalize to safe draft values; the storage boundary continues to refuse any forged corrupt quote.
- `Quote.placementMode` is optional for work-in-progress records, and storage permits missing mode/zero period only for editable `draft` or `returned` states. Submitted states remain strict.
- Save Draft now calls `onSave(input)` directly and does not navigate to full-validation errors. Next and Submit still use step/full validation.
- Bonus now receives `error={errors.bonus}`, activating its visible field message, `aria-invalid`, and `aria-describedby` behavior through `NumberField`.

### Final Verification

- `npm run test:logic`: PASS — 28/28 tests.
- `node --test tests/rendered-html.test.mjs`: PASS — 2/2 tests.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- `git diff --check`: PASS.

The browser-backend and standalone-TypeScript configuration concerns documented above are unchanged.

## Draft Pricing Consistency Fix

### RED / GREEN Evidence

- RED: a draft with `weeks: 1.5` and a finite raw `basePrice: 64_000` normalized to zero weeks but incorrectly retained ¥64,000 base / ¥33,920 total.
- GREEN: draft construction now prices only when placement mode, at least one placement ID, and a positive normalized period are all present. Otherwise base price and all derived pricing clear to zero.
- Added a positive regression showing a valid four-week Pacific Place draft retains ¥128,000 base and ¥67,840 total after local-storage round-trip, matching both reopened summary and dashboard amount.

### Verification

- `npm run test:logic`: PASS — 30/30 tests.
- `node --test tests/rendered-html.test.mjs`: PASS — 2/2 tests.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- `git diff --check`: PASS.
