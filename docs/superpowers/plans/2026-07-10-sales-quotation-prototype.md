# Sales Quotation Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish a responsive Chinese interactive prototype that demonstrates role switching, quotation creation, discount approval, rejection/resubmission, and printable Quotation generation with realistic mock data.

**Architecture:** Use the Sites vinext starter as a single-route client application. Keep mock entities, pure quotation/approval rules, and persisted UI state in focused modules; render role-specific screens from one client-side application shell and store demo changes in `localStorage`.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, vinext/Vite, CSS, Node test runner, Cloudflare-compatible Sites hosting.

## Global Constraints

- The prototype uses simulated identities and data; it must not imply production authentication or live pricing.
- Every submitted quotation goes to Sales Manager first; discounts above 70% go to CEO only after manager approval.
- Rejection requires a reason, returns the quotation to Sales, and preserves version/approval history.
- Approved quotations expose a printable Quotation view with building and approval summaries.
- Chinese is the primary language; retain Rate Card, Spot, Bonus, and Quotation as business terms.
- Desktop is primary, with usable mobile layouts and keyboard-accessible controls.
- Use RMB formatting and show that the tax rate and data are simulated.
- Do not add D1, R2, uploads, external authentication, email, signatures, or server-side PDF generation.

---

## Planned File Structure

- `app/page.tsx` — mounts the interactive prototype and replaces the starter preview.
- `app/layout.tsx` — finished Chinese metadata and site shell metadata.
- `app/globals.css` — complete responsive visual system and print styles.
- `components/quotation-app.tsx` — screen routing, role switching, persistence, and cross-screen actions.
- `components/login-screen.tsx` — simulated role selection.
- `components/app-shell.tsx` — navigation, role badge, main layout, and demo reset.
- `components/dashboard-screen.tsx` — role-specific metrics and quotation queues.
- `components/quote-wizard.tsx` — guided create/edit form and live pricing summary.
- `components/approval-screen.tsx` — manager/CEO detail review, approve, and reject interactions.
- `components/quotation-screen.tsx` — final printable document view.
- `components/ui.tsx` — shared badges, money display, modal, empty state, and icon wrappers.
- `lib/types.ts` — domain types and union states.
- `lib/mock-data.ts` — customers, brands, buildings, packages, users, and seeded quotations.
- `lib/quotation.ts` — pure pricing, validation, approval routing, and state-transition functions.
- `lib/store.ts` — localStorage load/save/reset helpers and seed hydration.
- `tests/quotation.test.ts` — pure business-rule tests.
- `tests/rendered-html.test.mjs` — production output smoke assertions.

---

### Task 1: Scaffold the Sites Project and Lock the Domain Contract

**Files:**
- Create/retain: Sites vinext starter files at project root
- Create: `lib/types.ts`
- Create: `lib/quotation.ts`
- Create: `tests/quotation.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `DiscountBand`, `QuoteStatus`, `Quote`, `ApprovalEvent`, `QuoteInput`, `PricingSummary` types.
- Produces: `getDiscountBand(discount: number): DiscountBand`, `getNextApproval(discount: number, managerApproved: boolean): QuoteStatus`, `calculatePricing(input: QuoteInput): PricingSummary`, and `validateQuote(input: QuoteInput): Record<string, string>`.

- [ ] **Step 1: Initialize the Sites starter without losing the approved docs**

Temporarily relocate `docs`, run the bundled `init-site.sh "$PWD"`, restore `docs`, retain the generated lockfile, and start `npm run dev` in a persistent session. Open the exact printed Local URL once in Codex.

- [ ] **Step 2: Add the failing business-rule tests and test script**

Add `"test:logic": "node --experimental-strip-types --test tests/quotation.test.ts"` to `package.json`. Test exact boundaries and calculations:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { calculatePricing, getDiscountBand, getNextApproval, validateQuote } from "../lib/quotation.ts";

test("discount bands keep 60 and 70 inside their stated bands", () => {
  assert.equal(getDiscountBand(60), "standard");
  assert.equal(getDiscountBand(60.01), "elevated");
  assert.equal(getDiscountBand(70), "elevated");
  assert.equal(getDiscountBand(70.01), "executive");
});

test("every quote reaches manager before an executive discount reaches CEO", () => {
  assert.equal(getNextApproval(50, false), "pending_manager");
  assert.equal(getNextApproval(75, false), "pending_manager");
  assert.equal(getNextApproval(75, true), "pending_ceo");
  assert.equal(getNextApproval(70, true), "approved");
});

test("pricing applies discount then simulated 6 percent tax", () => {
  assert.deepEqual(calculatePricing({ basePrice: 100000, discount: 25, taxRate: 0.06 }), {
    basePrice: 100000,
    discountAmount: 25000,
    netPrice: 75000,
    tax: 4500,
    total: 79500,
  });
});

test("invalid quote fields return field-level messages", () => {
  const errors = validateQuote({ customerId: "", brandId: "", placementIds: [], weeks: 0, spots: 0, discount: 101 });
  assert.equal(errors.customerId, "请选择客户");
  assert.equal(errors.placementIds, "请至少选择一栋楼宇或一个销售包");
  assert.equal(errors.discount, "折扣必须在 0%–100% 之间");
});
```

- [ ] **Step 3: Run the tests to verify failure**

Run: `npm run test:logic`

Expected: FAIL because `lib/quotation.ts` does not exist.

- [ ] **Step 4: Define exact domain types and minimal pure rules**

Implement discriminated unions for roles (`sales | manager | ceo`), placement modes (`building | package`), and statuses (`draft | pending_manager | pending_ceo | returned | approved`). Implement the four functions above with 60 and 70 inclusive in the lower bands and tax rounded to the nearest integer RMB cent representation used by the prototype.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:logic`

Expected: 4 passing tests.

Commit: `feat: define quotation domain rules`

---

### Task 2: Add Realistic Mock Data and Persistent Demo State

**Files:**
- Create: `lib/mock-data.ts`
- Create: `lib/store.ts`
- Modify: `lib/types.ts`
- Modify: `tests/quotation.test.ts`

**Interfaces:**
- Produces: `USERS`, `CUSTOMERS`, `BUILDINGS`, `PACKAGES`, `SEEDED_QUOTES`, and `DEMO_TAX_RATE`.
- Produces: `loadQuotes(): Quote[]`, `saveQuotes(quotes: Quote[]): void`, `resetQuotes(): Quote[]`, and `quotesForRole(quotes: Quote[], role: Role, userId: string): Quote[]`.

- [ ] **Step 1: Write failing role-filter and seed-shape tests**

Assert that a salesperson only receives their own quotations, a manager receives team quotations, a CEO receives only `pending_ceo` items in the action queue, each package references existing buildings, and each seeded quote has at least one approval-history event.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:logic`

Expected: FAIL because mock constants and store helpers do not exist.

- [ ] **Step 3: Implement realistic linked fixtures**

Create three users, at least four customer-brand relationships, eight Jakarta-area buildings, three sales packages, and seeded examples covering returned, manager-pending, CEO-pending, and approved statuses. Include traffic, impressions, location, category, and RMB prices. Mark all values as demo data in exported copy.

- [ ] **Step 4: Implement guarded localStorage persistence**

Use a single key `quotation-prototype-v1`. Return a deep-cloned seed array during server rendering, unavailable storage, parse failure, or schema mismatch. `resetQuotes()` clears the key and returns fresh seeds.

- [ ] **Step 5: Run tests and commit**

Run: `npm run test:logic`

Expected: all tests pass.

Commit: `feat: add quotation demo data store`

---

### Task 3: Build Login, Application Shell, and Role Dashboards

**Files:**
- Create: `components/quotation-app.tsx`
- Create: `components/login-screen.tsx`
- Create: `components/app-shell.tsx`
- Create: `components/dashboard-screen.tsx`
- Create: `components/ui.tsx`
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: domain types, seeded data, and persistence helpers from Tasks 1–2.
- Produces: `QuotationApp`, reusable `StatusBadge`, `Money`, `Modal`, and screen-navigation callbacks.

- [ ] **Step 1: Extend the rendered HTML smoke test**

Assert the production HTML contains `报价审批中心`, `销售`, `销售主管`, `CEO`, and does not contain the starter preview marker.

- [ ] **Step 2: Run the smoke test to verify failure**

Run: `npm test`

Expected: FAIL because the starter renders instead of the product.

- [ ] **Step 3: Replace the starter with the role-based shell**

Make `app/page.tsx` mount `QuotationApp`. Build a premium enterprise login with three explicit role cards, then an authenticated shell with product mark, primary navigation, role switcher, user menu, demo-data label, and reset action. Remove `app/_sites-preview` imports and files.

- [ ] **Step 4: Implement role-specific dashboard content**

Sales sees draft/returned/pending/approved counts and own quote rows. Manager sees the team queue and risk bands. CEO sees only executive approvals plus a concise approved-value summary. Every row exposes only valid actions for the current role and status.

- [ ] **Step 5: Add the base responsive design system**

Use a warm off-white canvas, navy/ink text, teal primary action, restrained amber/coral risk states, 14–16px body copy, high-contrast focus rings, fluid card grids, and a compact mobile navigation. Avoid generic dashboard gradients and decorative imagery.

- [ ] **Step 6: Build, run smoke test, and commit**

Run: `npm test`

Expected: build succeeds and smoke assertions pass.

Commit: `feat: build role based quotation workspace`

---

### Task 4: Implement the Guided Quote Wizard and Live Calculation

**Files:**
- Create: `components/quote-wizard.tsx`
- Modify: `components/quotation-app.tsx`
- Modify: `components/ui.tsx`
- Modify: `app/globals.css`
- Modify: `tests/quotation.test.ts`

**Interfaces:**
- Consumes: `validateQuote`, `calculatePricing`, mock customer/building/package data, and active sales user.
- Produces: `QuoteWizard({ initialQuote?, salesUser, onCancel, onSave, onSubmit })`.

- [ ] **Step 1: Add failing quote-submission transition tests**

Test that submitting a valid new quote creates version 1 with `pending_manager`; resubmitting a returned quote increments its version, appends a `resubmitted` history event, and returns to `pending_manager` regardless of discount.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:logic`

Expected: FAIL because the transition helper is absent.

- [ ] **Step 3: Implement the quote transition helper**

Add `submitQuote(input, previousQuote?, actor): Quote` to `lib/quotation.ts`, generating stable demo IDs, preserving prior history, and appending a timestamped submission event.

- [ ] **Step 4: Build the six-step wizard**

Implement customer/brand filtering by Sales PIC, placement mode choice, searchable selectable building cards, package comparison, period/Spot/Bonus inputs, discount entry, and final review. Keep a sticky pricing summary showing base price, discount, net price, simulated 6% tax, total, traffic, and impressions.

- [ ] **Step 5: Add approval-path and validation feedback**

Show `销售主管审批`, `较高折扣 · 销售主管审批`, or `销售主管 → CEO` immediately as discount changes. Block forward navigation and submission with field-level Chinese messages from `validateQuote`.

- [ ] **Step 6: Test, build, and commit**

Run: `npm run test:logic && npm run build`

Expected: all logic tests pass and production build succeeds.

Commit: `feat: add interactive quotation builder`

---

### Task 5: Implement Manager and CEO Approval Workflows

**Files:**
- Create: `components/approval-screen.tsx`
- Modify: `components/quotation-app.tsx`
- Modify: `components/dashboard-screen.tsx`
- Modify: `lib/quotation.ts`
- Modify: `tests/quotation.test.ts`
- Modify: `app/globals.css`

**Interfaces:**
- Produces: `approveQuote(quote, actor): Quote` and `returnQuote(quote, actor, reason): Quote`.
- Produces: `ApprovalScreen({ quote, actor, onApprove, onReturn, onBack })`.

- [ ] **Step 1: Write failing transition tests**

Cover manager approval at 50% → `approved`, manager approval at 75% → `pending_ceo`, CEO approval at 75% → `approved`, blank rejection reason → thrown validation error, and valid rejection → `returned` with the exact reason in history.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:logic`

Expected: FAIL because approval helpers do not exist.

- [ ] **Step 3: Implement guarded approval transitions**

Reject transitions by the wrong role or from the wrong status. On final approval set `approvedAt`; on return preserve pricing and placement details, set `returned`, and append the actor, role, reason, timestamp, and version.

- [ ] **Step 4: Build the approval detail experience**

Show customer/brand, placement list, calculation ledger, discount-risk callout, chronological approval timeline, and version badge. Approval uses a confirmation modal. Return uses a modal with a required reason and inline error.

- [ ] **Step 5: Persist transitions across role switches**

Wire manager and CEO actions into the shared quotes collection, save after every transition, update role dashboards immediately, and let Sales open a returned quote in edit mode.

- [ ] **Step 6: Test, build, and commit**

Run: `npm run test:logic && npm run build`

Expected: all tests and build pass.

Commit: `feat: add discount approval workflow`

---

### Task 6: Build the Printable Quotation and Finish Product Metadata

**Files:**
- Create: `components/quotation-screen.tsx`
- Modify: `components/quotation-app.tsx`
- Modify: `components/dashboard-screen.tsx`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Modify: `public/favicon.svg`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces: `QuotationScreen({ quote, onBack, onPrint })` using `window.print()` for the prototype.

- [ ] **Step 1: Add failing finished-product smoke assertions**

Assert final metadata contains `报价审批中心`, the description mentions `楼宇报价与折扣审批`, and the rendered product contains `模拟数据`.

- [ ] **Step 2: Run smoke test to verify failure**

Run: `npm test`

Expected: FAIL until metadata is replaced.

- [ ] **Step 3: Implement the formal Quotation view**

Render quotation number, issue date, client and brand, sales owner, campaign period, building/package line items, Spot and Bonus, audience metrics, base price, discount, net price, simulated tax, total, terms note, building appendix, and approval record. Restrict access to `approved` quotes.

- [ ] **Step 4: Add print styles and final metadata**

Hide app navigation and buttons under `@media print`, format the document for A4 pages, keep totals together, and avoid splitting table rows. Replace starter title, description, preview marker, and favicon with product-specific values.

- [ ] **Step 5: Run complete verification and commit**

Run: `npm run test:logic && npm test`

Expected: logic tests pass, production build succeeds, and rendered HTML smoke tests pass.

Commit: `feat: add printable quotation experience`

---

### Task 7: Final Responsive and Accessibility Verification, Then Publish

**Files:**
- Modify only files implicated by real verification failures.
- Create/update: `.openai/hosting.json` only as required by the Sites starter/hosting flow; do not declare D1 or R2.

**Interfaces:**
- Consumes: the completed application.
- Produces: validated production build and deployed Sites URL.

- [ ] **Step 1: Verify required journeys in code and tests**

Confirm the seeded/demo UI supports: 50% manager approval; 65% manager approval with elevated warning; 75% manager then CEO approval; manager/CEO return with reason then sales resubmission; both building and package quote creation; and consistent data after role switching.

- [ ] **Step 2: Run final automated checks**

Run: `npm run test:logic && npm test`

Expected: all tests pass and build exits 0.

- [ ] **Step 3: Check responsive and accessibility implementation**

Inspect CSS and JSX for visible focus states, semantic buttons/labels, modal focus behavior, status text independent of color, mobile overflow, tap targets, and print-only visibility. Fix only concrete defects and rerun the relevant command.

- [ ] **Step 4: Commit verification fixes if any**

Commit only when files changed: `fix: finalize quotation prototype experience`

- [ ] **Step 5: Publish through Sites**

Invoke the `sites-hosting` skill, deploy the validated build, keep the development server alive until publishing completes, then stop the local server and return the deployed URL as the primary deliverable.

---

## Plan Self-Review

- Spec coverage: all ten specification sections map to Tasks 1–7.
- Scope: one interactive prototype; production authentication, external data, persistence, notification, and server PDF work remain excluded.
- Type consistency: discount/status names and transition signatures are defined once in Tasks 1, 4, and 5 and consumed consistently later.
- Placeholder scan: no implementation placeholders or unresolved product decisions remain.
