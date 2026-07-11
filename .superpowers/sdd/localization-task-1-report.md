# Localization Task 1 Report

## Status

DONE

## Files

- Added `lib/i18n.ts`: typed locales and keys, parity-friendly dictionaries, deterministic interpolation, locale-aware CNY/number/date formatting, and safe preference persistence under `quotation-locale-v1`.
- Added `components/locale-provider.tsx`: lazy locale initialization, synchronized document language, memoized context value, and stable locale-bound helpers.
- Added `components/language-switcher.tsx`: button-based, current-language-labeled accessible group with `aria-pressed` selection.
- Added `tests/localization.test.ts`: seven foundation and persistence regression tests.
- Updated `components/quotation-app.tsx`: provider and switcher wrap a stable `QuotationWorkspace`; quotation and navigation state remain owned by that child and are not remounted on locale changes.
- Updated `app/layout.tsx`: server HTML defaults to `lang="en"`.
- Updated `app/globals.css`: responsive, long-label-safe, focus-visible switcher styling and print exclusion.
- Updated `package.json`: added `test:localization`.

## Test Evidence

- RED: `npm run test:localization` failed with `ERR_MODULE_NOT_FOUND` for the intentionally absent `lib/i18n.ts`.
- GREEN: `npm run test:localization` — 7 passed, 0 failed.
- Regression: `npm run test:logic` — 53 passed, 0 failed.
- Render/build: `npm test` — build succeeded; 5 passed, 0 failed.
- Static checks: `npm run lint` — exit 0 with no findings.
- Diff hygiene: `git diff --check` — exit 0.

## Self-review

- The provider owns only locale state. `QuotationWorkspace` owns user, quote, wizard, approval, progress, and formal-quotation navigation state; its component identity and position remain stable when locale changes.
- Storage reads and writes tolerate SSR, unavailable storage, getter failures, and storage-operation failures.
- Dictionary parity is enforced recursively and all leaves are strings.
- Formatting delegates to `Intl` using the active locale and keeps currency fixed to CNY.
- The switcher uses real non-navigation buttons, localized group labeling, `aria-pressed`, visible focus inherited from the global focus rule, and responsive wrapping.
- The existing Chinese screens were intentionally not broadly localized in this task.

## Concerns

None.
