# English-First Localization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add complete English and Simplified Chinese localization to the existing quotation prototype, defaulting first-time visitors to English while preserving all business and navigation state during language changes.

**Architecture:** Add one typed application dictionary and a lightweight locale context at the existing client application root. Components consume translated copy and locale-aware formatting through focused helpers; language preference uses its own versioned localStorage key and remains independent from quotation demo data.

**Tech Stack:** React 19, TypeScript 5.9, Next.js/vinext, React Context, browser localStorage, Node test runner, Sites hosting.

## Global Constraints

- First visit defaults to English; no browser-language auto-detection.
- Users can switch between `EN` and `中文` from login, desktop shell, and mobile account surfaces.
- Switching language preserves role, current screen, quote edits, approval state, and modal state.
- Language preference persists independently from quotation demo data and survives demo reset.
- All user-facing interface, validation, approval, progress, version-history, Quotation, print, empty-state, confirmation, and accessibility copy must be localized.
- Customer, brand, building, package, and person names remain unchanged source data; Rate Card, Spot, Bonus, and Quotation remain recognizable business terms.
- Currency remains CNY/¥; use locale-aware number/date formatting for `en` and `zh-CN`.
- Default HTML language is `en`; client switching updates `document.documentElement.lang`.
- Use one route and one set of business components; do not duplicate `/en` and `/zh` pages or business logic.
- Preserve the existing approval rules, immutable commercial snapshots, storage validation, print layout, responsive behavior, and Sites configuration.

---

## Planned File Structure

- `lib/i18n.ts` — locale type, complete typed dictionaries, lookup and locale-format helpers, preference key/load/save.
- `components/locale-provider.tsx` — English-first locale state, document language synchronization, and context API.
- `components/language-switcher.tsx` — reusable accessible `EN / 中文` segmented control.
- `components/quotation-app.tsx` — provider integration and state-preserving locale boundary.
- `components/login-screen.tsx`, `components/app-shell.tsx`, `components/dashboard-screen.tsx`, `components/ui.tsx` — localized entry, navigation, metrics, lists, statuses, dialogs, and mobile account surfaces.
- `components/quote-wizard.tsx`, `components/approval-screen.tsx`, `components/quote-progress-screen.tsx`, `components/quote-version-history.tsx`, `components/quotation-screen.tsx` — localized business flow and print document.
- `lib/quotation.ts` — replace UI-facing Chinese validation literals with stable error keys or locale-independent codes.
- `app/layout.tsx` — English-first HTML and bilingual/product metadata where appropriate.
- `app/globals.css` — language-switcher layout and overflow protection for longer English labels.
- `tests/localization.test.ts` — pure dictionary parity, preference, formatting, and error-key tests.
- `tests/rendered-html.test.mjs` — build/source contract coverage for English default, switchers, complete flow copy, and printed Quotation.

---

### Task 1: Build the Typed Localization Foundation

**Files:**
- Create: `lib/i18n.ts`
- Create: `components/locale-provider.tsx`
- Create: `components/language-switcher.tsx`
- Create: `tests/localization.test.ts`
- Modify: `package.json`
- Modify: `app/layout.tsx`
- Modify: `components/quotation-app.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `type Locale = "en" | "zh-CN"`, `translations`, `translate(locale, key, variables?)`, `formatMoney`, `formatNumber`, `formatDate`, `loadLocale`, `saveLocale`.
- Produces: `LocaleProvider`, `useLocale(): { locale, setLocale, t, formatMoney, formatNumber, formatDate }`, and `LanguageSwitcher`.

- [ ] **Step 1: Add failing foundation tests**

Test that English is the no-storage default, valid stored Chinese is restored, invalid stored values fall back to English, both dictionaries have identical leaf keys, interpolation is deterministic, RMB and dates use the active locale, and resetting quotation data does not remove the locale preference.

- [ ] **Step 2: Run the localization suite to verify RED**

Run: `npm run test:localization`

Expected: FAIL because `lib/i18n.ts` does not exist.

- [ ] **Step 3: Implement dictionary, formatting, and preference helpers**

Use key `quotation-locale-v1`. Make preference reads SSR-safe and exception-safe. Keep dictionary leaf values as strings and validate parity in tests. Use `Intl.NumberFormat` and `Intl.DateTimeFormat` with active locale; money remains `CNY`.

- [ ] **Step 4: Implement provider and switcher**

Use lazy locale initialization, synchronize `document.documentElement.lang` in an effect, and expose stable context helpers. The switcher must use real buttons with selected state, accessible group labeling in the current language, visible focus, and no page navigation.

- [ ] **Step 5: Make the root English-first**

Set server HTML `lang="en"`; wrap `QuotationApp` content without remounting its quote/navigation state when locale changes. Add language switcher CSS that remains usable on mobile and with long labels.

- [ ] **Step 6: Verify and commit**

Run: `npm run test:localization && npm run test:logic && npm test && npm run lint`

Expected: all suites and build pass.

Commit: `feat: add English-first localization foundation`

---

### Task 2: Localize Entry, Shell, Dashboards, and Shared UI

**Files:**
- Modify: `components/login-screen.tsx`
- Modify: `components/app-shell.tsx`
- Modify: `components/dashboard-screen.tsx`
- Modify: `components/ui.tsx`
- Modify: `components/quotation-app.tsx`
- Modify: `lib/i18n.ts`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `useLocale` and `LanguageSwitcher` from Task 1.
- Produces: fully localized login, desktop/mobile navigation, role names, metrics, quote lists, statuses, risk labels, empty states, reset/logout confirmations, and placeholder-free action labels.

- [ ] **Step 1: Add failing rendered/source contracts**

Assert English-first login copy and all three English role labels exist, language switchers are rendered on login and authenticated desktop/mobile surfaces, and Chinese equivalents remain in the dictionary rather than duplicated component literals.

- [ ] **Step 2: Verify RED**

Run: `npm test`

Expected: FAIL on missing English shell/localization contracts.

- [ ] **Step 3: Localize shared status and role mapping**

Replace component-level Chinese status maps with dictionary keys. Keep raw `QuoteStatus` and `Role` values unchanged. Ensure badges and risk callouts expose equivalent accessible text in each locale.

- [ ] **Step 4: Localize login, shell, and dashboards**

Place the switcher visibly on login, in desktop header/account area, and mobile account menu. Translate navigation, counts, column labels, actions, empty states, demo-data/reset copy, and confirmation dialog text. Switching language must not call logout, reset quotes, or change active screen.

- [ ] **Step 5: Verify and commit**

Run: `npm run test:localization && npm run test:logic && npm test && npm run lint && npm run build`

Expected: all checks pass.

Commit: `feat: localize quotation workspace shell`

---

### Task 3: Localize Quote Creation, Approval, Progress, and Quotation

**Files:**
- Modify: `components/quote-wizard.tsx`
- Modify: `components/approval-screen.tsx`
- Modify: `components/quote-progress-screen.tsx`
- Modify: `components/quote-version-history.tsx`
- Modify: `components/quotation-screen.tsx`
- Modify: `lib/quotation.ts`
- Modify: `lib/i18n.ts`
- Modify: `tests/quotation.test.ts`
- Modify: `tests/localization.test.ts`
- Modify: `tests/rendered-html.test.mjs`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: stable validation error codes/keys from domain validation, translated by UI at render time.
- Produces: English and Chinese six-step wizard, live pricing/risk path, approval/return dialogs, progress/version detail, and formal printed Quotation.

- [ ] **Step 1: Add failing validation and flow localization tests**

Assert domain validation returns stable keys rather than Chinese sentences; both dictionaries cover every validation key, approval action/status, wizard step, return/history term, price ledger label, Quotation field, terms note, and print action.

- [ ] **Step 2: Verify RED**

Run: `npm run test:localization && npm run test:logic`

Expected: FAIL until stable errors and business dictionaries are wired.

- [ ] **Step 3: Localize wizard and calculations**

Translate every step, helper, filter, selection mode, parameter label, field error, submit/save/cancel action, approval-path warning, traffic/impression summary, and money/date display. Preserve customer/resource data and form state during switching.

- [ ] **Step 4: Localize approval and progress/version experiences**

Translate eligibility labels, confirmation and return dialogs, required reason feedback, approval timeline actions, version headings, return callouts, back-navigation labels, and snapshot commercial summaries. User-authored rejection reasons remain verbatim.

- [ ] **Step 5: Localize formal Quotation and print**

Translate document heading, issue/client/campaign fields, line-item headings, totals, terms, appendix, approval record, toolbar, restricted-access alert, and print-only text. Use locale-aware dates/numbers and print only the current locale.

- [ ] **Step 6: Protect English layout and accessibility**

Inspect and adjust CSS for longer English buttons/table headings, mobile wrapping, print table widths, live-region labels, field error associations, and 24px+ action targets.

- [ ] **Step 7: Verify and commit**

Run: `npm run test:localization && npm run test:logic && npm test && npm run lint && npm run build && git diff --check`

Expected: all checks pass with no untranslated component literals except proper nouns/test fixtures.

Commit: `feat: localize quotation and approval flows`

---

### Task 4: Audit Coverage, Publish, and Verify the English Default

**Files:**
- Modify only files implicated by real audit failures.
- Update: `.openai/hosting.json` only if Sites requires a new version reference; preserve project ID and null D1/R2 bindings.

**Interfaces:**
- Consumes: complete bilingual application.
- Produces: saved and private deployed Sites version at the existing live URL.

- [ ] **Step 1: Run a hardcoded-copy audit**

Search all production TS/TSX for Chinese user-interface literals. Classify each remaining match as a proper noun/mock datum, dictionary value, or defect. Fix only defects. Search for unlocalized English literals in Chinese mode through the same dictionary coverage tests.

- [ ] **Step 2: Verify acceptance scenarios**

Use tests/source inspection to confirm English first visit, Chinese preference restore, reset independence, state-preserving switching, full English create/submit/approve/return/resubmit/print flow, preserved Chinese flow, and switcher accessibility on mobile.

- [ ] **Step 3: Run the final evidence gate**

Run: `npm run test:localization && npm run test:logic && npm test && npm run lint && npm run build && git diff --check`

Expected: all tests pass, build exits 0, and worktree is clean after commit.

- [ ] **Step 4: Independent whole-change review**

Review dictionary completeness, state preservation, domain/error separation, formatting, accessibility, print layout, and absence of duplicated business logic. Fix Critical/Important findings and rerun the evidence gate.

- [ ] **Step 5: Publish through Sites**

Push the exact validated branch head to the existing Sites source, package the build, save a new version, and deploy privately. Preserve `SITE_ORIGIN` as the existing canonical live URL.

- [ ] **Step 6: Verify deployed output**

Confirm the live page defaults to English for a fresh preference context, contains the language control, and still emits canonical OG/X metadata. Return the existing Sites URL.

---

## Plan Self-Review

- Spec coverage: all English-localization requirements and seven acceptance scenarios map to Tasks 1–4.
- Scope: no new routes, external translation service, data migration, or business-rule changes.
- Type consistency: locale, dictionary, formatting, preference, provider, and stable validation-key interfaces are defined in Task 1/3 and consumed consistently.
- Placeholder scan: no unresolved implementation decisions remain.
