# Localization Task 4 Audit Report

## Status

`DONE_WITH_CONCERNS`

The production localization audit and required local evidence gate are complete. Two concrete defects were fixed with TDD: default metadata was still Chinese, and domain/internal validation guards retained locale-bound Chinese prose/punctuation. Publishing and deployed-output verification were intentionally not performed because the coordinator owns Sites credentials and deployment.

## Hardcoded-copy audit

The final production TS/TSX Chinese scan reports 222 matching lines across exactly two files:

| Classification | File | Matching lines | Disposition |
| --- | --- | ---: | --- |
| Dictionary values | `lib/i18n.ts` | 182 | Expected bilingual copy. English and Chinese leaf-key parity is tested. |
| Mock/proper data | `lib/mock-data.ts` | 40 | Expected demo user names, industries/categories, descriptions, and user-authored approval comments. Preserved as fixture data. |
| Defects | All other production TS/TSX | 0 | No Chinese UI literal remains in components, metadata, domain logic, or persistence guards. |

The English-literal review found no untranslated English prose rendered in Chinese mode. Remaining raw component tokens are intentional language-neutral/product markers: `DEMO`, numbered document-section markers, `A`, `B`, `P`, and symbols/arrows. Customer/building/brand names and `Spot`, `Bonus`, `Rate Card`, `CEO`, `CNY`, and `QUOTATION` are proper/domain terminology; user-facing labels around them are dictionary-backed. The provider's English error (`useLocale must be used within LocaleProvider`) is a developer invariant and is never UI copy.

## Defects fixed with TDD

1. English-first metadata:
   - RED: `English-first metadata contains no Chinese default copy` failed on `app/layout.tsx`.
   - GREEN: page title/description, Open Graph title/description/locale/alt, and X title/description/alt now use English default metadata (`en_US`).
   - Rendered evidence: the canonical-origin test asserts the English OG/X values while preserving the configured canonical origin and rejecting hostile/malformed origins.
2. Domain/error separation:
   - RED: `domain and persistence guards contain no locale-bound error copy` failed on Chinese domain exceptions and full-width Chinese join punctuation.
   - GREEN: authorization/transition failures now use stable `quotation.*` codes; validation-key aggregation is locale neutral. Existing workflow tests assert the stable codes.

## Acceptance evidence

| Scenario | Evidence | Result |
| --- | --- | --- |
| English first visit | `loadLocale()` defaults to `en`; provider initializes `useState<Locale>("en")`; server-rendered login and metadata tests assert English. | Pass |
| Stored Chinese restore after mount | Storage helper returns `zh-CN`; provider test asserts deterministic English hydration followed by effect-based restore. | Pass |
| Reset independence | `resetQuotes()` removes only `quotation-prototype-v1`; test preserves `quotation-locale-v1=zh-CN`. | Pass |
| State-preserving switch | `LocaleProvider` wraps `QuotationWorkspace`; switching changes only provider locale and storage. Quote/user/wizard/approval/progress/quotation state remains owned by the mounted workspace. | Pass by source inspection |
| English create/submit/approve/return/resubmit/print | Logic tests cover submit, manager/CEO approval, return, immutable V1→V2 resubmission, shared persisted state, and exact approval paths. Rendered tests cover approved-only print and V2 history navigation; all workflow components consume the English dictionary. | Pass |
| Preserved Chinese flow | English/Chinese dictionaries have identical string leaf keys; all workflow screens subscribe to locale; the same locale-neutral handlers and business logic serve both locales. | Pass |
| Mobile switch accessibility | Switch is a translated `role="group"`; buttons expose `lang` and `aria-pressed`; mobile CSS positions it above navigation, allows wrapping, and provides 40px minimum height and focus-visible treatment. | Pass by source/CSS inspection |

## Whole-change review

- Dictionary completeness: exact leaf-key parity and required workflow-key coverage pass.
- State preservation: one provider surrounds one workspace; no locale key/remount or duplicated quote state exists.
- Domain/error separation: validators and transition guards emit stable keys/codes; UI translation remains at render boundaries.
- Formatting: money, number, and date helpers use the active locale; user-authored fixture comments remain data.
- Accessibility: translated navigation/control labels, pressed state, focus treatment, field error associations, dialog semantics, and mobile labels are present.
- Responsive/overflow: long controls wrap; wizard/table horizontal overflow is contained; mobile document/facts/delivery layouts collapse appropriately.
- Print: A4 page setup, chrome/language-control hiding, table overflow release, row/pricing break avoidance, and a single current-locale quotation DOM are preserved.
- Business logic: localization introduced no second workflow path; submit/approve/return/resubmit remain shared functions.
- Metadata: English default is appropriate for first visit; runtime Chinese remains an in-app preference, while canonical OG/X metadata stays deterministic English.

No Critical or Important findings remain in the inspected code and automated evidence.

## Fresh evidence gate

Exact command:

```text
npm run test:localization && npm run test:logic && npm test && npm run lint && npm run build && git diff --check
```

Final result: exit 0.

- Localization: 15 passed, 0 failed.
- Logic: 53 passed, 0 failed.
- Rendered HTML: 5 passed, 0 failed.
- ESLint: 0 errors, 0 warnings.
- Production builds: both the `npm test` build and explicit final build completed.
- Diff whitespace check: passed.

## Concerns and exclusions

- The in-app Browser plugin was present but could not acquire a browser (`No browser is available`). Standalone Playwright is not installed, and no dependency was added. Mobile layout, interactive locale switching, console health, and print appearance therefore have automated/source/CSS evidence but no new screenshot/manual-browser evidence in this task.
- Sites publishing and deployed-output verification were not attempted by instruction. The coordinator must publish the exact validated branch head and verify the live URL/default preference context.
