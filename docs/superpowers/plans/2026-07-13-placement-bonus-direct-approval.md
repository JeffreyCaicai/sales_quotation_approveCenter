# Placement, Bonus, and Direct Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prototype's numeric Bonus field with an optional, independently selected Bonus resource section; calculate effective discount from Placement plus free Bonus; and route each submitted quotation directly to Head of Sales, Head of Business Control, or CEO.

**Architecture:** Introduce a reusable nested commercial-selection model shared by Placement and Bonus, persist complete pricing/version snapshots, and centralize effective-discount routing in the domain layer. Refactor the six-step wizard and all quotation/approval surfaces around that model. Keep the production branch and the legacy Sites demo branch separate, then publish only the compatible demo layer to the existing Sites project.

**Tech Stack:** TypeScript 5.9, React 19, Next.js 16, Vitest, Node test runner, Playwright, localStorage demo persistence, Vinext/Cloudflare Sites for the hosted demo.

## Global constraints

- Approval uses effective discount and is direct, never sequential.
- Exact bands are `<=65%`, `>65% and <=70%`, and `>70%`.
- Approver names are demo/configuration data, never domain constants.
- Placement is required; Bonus is optional but complete when enabled.
- Placement and Bonus each have mode, resources, TVC duration, weeks, Spots, gross Rate Card value, traffic, and impressions.
- Bonus nett is always zero; its gross value contributes to effective discount.
- Tax remains the existing simulated 6% for this change.
- Sales ownership validation remains server/domain-side as well as visual.
- Returned quotations create a new snapshot on resubmission and reroute from recalculated pricing.
- Never modify or deploy the existing VPS from this branch.
- Never push to GitHub or merge `main`; the user will do that after demo review.
- Never create a new Sites project or loosen the existing demo access policy.
- Never add, delete, stage, or modify the original repository's untracked `exports/` directory.

---

### Task 1: Define the nested commercial model and pricing contract

**Files:**
- Modify: `tests/quotation.test.ts`
- Modify: `lib/types.ts`
- Modify: `lib/quotation.ts`

- [x] **Step 1: Write failing domain tests**

Replace old flat-input expectations with tests for a required Placement selection, optional Bonus selection, independent numeric validation, and explicit pricing:

```ts
test("free bonus contributes gross value and raises the effective discount", () => {
  const pricing = calculatePricing({
    ...validQuoteInput(),
    discount: 65,
    placement: selection({ grossPrice: 1_520_000_000 }),
    bonus: selection({ grossPrice: 280_000_000 }),
  });
  assert.equal(pricing.placementNet, 532_000_000);
  assert.equal(pricing.bonusNet, 0);
  assert.equal(pricing.totalGross, 1_800_000_000);
  assert.equal(pricing.totalNet, 532_000_000);
  assert.ok(Math.abs(pricing.effectiveDiscountRate - 70.444444) < 0.000001);
});

test("effective discount routes directly at confirmed boundaries", () => {
  assert.equal(getApprovalStatus(65), "pending_manager");
  assert.equal(getApprovalStatus(65.000001), "pending_business_control");
  assert.equal(getApprovalStatus(70), "pending_business_control");
  assert.equal(getApprovalStatus(70.000001), "pending_ceo");
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run test:logic
```

Expected: FAIL because nested selections, explicit pricing fields, Business Control role/status, and direct routing do not exist.

- [x] **Step 3: Implement the minimal domain model**

In `lib/types.ts`:

- add `business_control` to `Role`;
- add `pending_business_control` to `QuoteStatus`;
- allow approval events from manager, business control, or CEO;
- add `CommercialSelectionInput` and `CommercialSelection`;
- replace flat Placement fields and numeric Bonus with `placement` and optional `bonus`;
- replace the old pricing summary with explicit Placement, Bonus, total, and effective-discount fields;
- preserve both selections and the pricing snapshot in every submitted version.

In `lib/quotation.ts`:

- calculate Placement Nett, zero Bonus Nett, Total Gross, Total Nett, effective discount, tax, and total;
- route directly from effective discount;
- validate Placement always and Bonus only when enabled;
- validate finite integer campaign parameters and finite nonnegative gross/traffic/impressions.

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm run test:logic
```

Expected: all quotation domain tests pass.

---

### Task 2: Enforce resource references, snapshots, direct approval, and persistence

**Files:**
- Modify: `tests/quotation.test.ts`
- Modify: `lib/quotation.ts`
- Modify: `lib/store.ts`
- Modify: `lib/mock-data.ts`
- Modify: `lib/display-data.ts`

- [x] **Step 1: Add failing workflow and persistence tests**

Add tests that prove:

- Placement and Bonus validate their own building/package mode and four-week scaled Rate Card gross;
- package mode accepts exactly one package independently for each section;
- submit status is chosen from calculated effective discount;
- only the matching role can approve or return;
- approval is final in one action;
- resubmission creates V2, keeps V1 immutable, and can reroute to another role;
- browser storage rejects legacy flat records and round-trips the new nested shape;
- role visibility returns the Business Control queue only to Business Control.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run test:logic
```

Expected: FAIL on direct approval, Bonus reference validation, storage schema, and seeded data.

- [x] **Step 3: Implement workflow and persistence**

- derive submitted status from `pricing.effectiveDiscountRate`;
- make `approveQuote`, `returnQuote`, and `canApproveQuote` share one role-to-status map;
- clone both nested selections and explicit pricing for every version snapshot;
- increment the localStorage schema key and fail closed to fresh seeded data for legacy records;
- add a Head of Business Control demo user;
- update mock Head of Sales and CEO display data without coupling routing to names;
- regenerate seeded quotations for all three queues plus returned and approved examples.

- [x] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm run test:logic
```

Expected: all workflow, reference, snapshot, and persistence tests pass.

---

### Task 3: Localize the new roles, statuses, workflow, and pricing vocabulary

**Files:**
- Modify: `tests/localization.test.ts`
- Modify: `tests/localization-rendered-html.test.tsx`
- Modify: `lib/i18n.ts`
- Modify: `components/app-shell.tsx`
- Modify: `components/ui.tsx`

- [x] **Step 1: Add failing localization assertions**

Require English and Chinese keys and rendered labels for:

- Head of Business Control role;
- awaiting Head of Business Control status;
- Placement Gross/Nett and Bonus Gross/FREE;
- Total Gross/Nett and Effective Discount;
- No Bonus/Add Bonus;
- direct approver wording with no manager-then-CEO copy.

- [x] **Step 2: Run localization tests and verify RED**

Run:

```bash
npm run test:localization
npx vitest run tests/localization-rendered-html.test.tsx
```

Expected: FAIL because the new keys, role, and status are absent.

- [x] **Step 3: Implement translations and shared role/status rendering**

Add complete English and Chinese translations, extend the role switcher mapping, and extend `StatusBadge`. Remove stale copy that describes Bonus as a number or approval as sequential.

- [x] **Step 4: Run localization tests and verify GREEN**

Run:

```bash
npm run test:localization
npx vitest run tests/localization-rendered-html.test.tsx
```

Expected: localization tests pass with no missing or leaked keys.

---

### Task 4: Refactor the six-step quotation wizard

**Files:**
- Modify: `tests/frontend-source-structure.test.ts`
- Modify: `tests/localization-rendered-html.test.tsx`
- Modify: `components/quote-wizard.tsx`
- Modify: `app/globals.css`

- [x] **Step 1: Add failing source/render tests**

Assert that the wizard:

- has six steps in the new order;
- has reusable resource selectors for Placement and Bonus;
- provides No Bonus and Add Bonus controls;
- contains no numeric Bonus input;
- accepts separate TVC duration, weeks, and Spot values;
- displays the full explicit pricing ledger and calculated direct approver.

- [x] **Step 2: Run focused UI tests and verify RED**

Run:

```bash
npx vitest run tests/frontend-source-structure.test.ts tests/localization-rendered-html.test.tsx
```

Expected: FAIL because the old mode/resources/parameters steps and numeric Bonus input remain.

- [x] **Step 3: Implement the six-step wizard**

Use this sequence:

1. Customer and Brand
2. Placement mode and resources
3. No Bonus or Bonus mode and resources
4. Placement and Bonus parameters
5. Placement discount, calculated effective discount, and direct approver
6. Review and submit

Derive each gross price from selected resources and that section's weeks. Keep resource searches and package single-selection behavior independent. Save drafts safely even when later steps are incomplete.

- [x] **Step 4: Run focused UI tests and verify GREEN**

Run:

```bash
npx vitest run tests/frontend-source-structure.test.ts tests/localization-rendered-html.test.tsx
```

Expected: focused UI tests pass.

---

### Task 5: Update dashboards, approval, progress, history, and quotation preview

**Files:**
- Modify: `tests/localization-rendered-html.test.tsx`
- Modify: `components/quotation-app.tsx`
- Modify: `components/dashboard-screen.tsx`
- Modify: `components/approval-screen.tsx`
- Modify: `components/quote-progress-screen.tsx`
- Modify: `components/quote-version-history.tsx`
- Modify: `components/quotation-screen.tsx`
- Modify: `app/globals.css`

- [x] **Step 1: Add failing rendered-surface tests**

Require:

- Business Control dashboard queue and decision action;
- Sales pending counts including all three approval statuses;
- separate Placement and Bonus resource/parameter cards;
- pricing ledgers consistent with the domain calculation;
- approved quotation preview with Placement and Bonus rows and `FREE` Bonus Nett;
- history that identifies the direct approver and preserves old version totals.

- [x] **Step 2: Run rendered tests and verify RED**

Run:

```bash
npx vitest run tests/localization-rendered-html.test.tsx
```

Expected: FAIL because screens only understand manager/CEO and flat Placement fields.

- [x] **Step 3: Implement all downstream surfaces**

Extend `QuotationApp` action dispatch to Business Control. Refactor each screen to consume nested Placement/Bonus selections and the explicit pricing summary. Remove all sequential approval outcome messaging.

- [x] **Step 4: Run rendered tests and verify GREEN**

Run:

```bash
npx vitest run tests/localization-rendered-html.test.tsx
```

Expected: all rendered-surface tests pass.

---

### Task 6: Prove the complete browser workflow

**Files:**
- Modify: `tests/smoke.spec.ts`
- Modify: `tests/smoke-live.spec.ts`

- [ ] **Step 1: Add failing Playwright scenarios**

Add browser coverage for:

1. No Bonus submission routed to Head of Sales.
2. Placement at 65% plus free Bonus whose effective discount moves into Business Control.
3. A larger free Bonus whose effective discount moves above 70% to CEO.
4. Return, edit Bonus, resubmit, observe V2 and a recalculated direct approver.
5. Approve and view a quotation containing both Placement and Bonus lines.

- [ ] **Step 2: Run Playwright and verify RED**

Run:

```bash
npm run test:e2e
```

Expected: new scenarios fail until every integrated UI path is complete.

- [ ] **Step 3: Fix only integration defects found by Playwright**

Keep fixes within the confirmed workflow; do not broaden scope into authentication, final PDF, or Rate Card imports.

- [ ] **Step 4: Run Playwright and verify GREEN**

Run:

```bash
npm run test:e2e
```

Expected: browser workflows pass.

---

### Task 7: Verify the formal production branch

**Files:**
- Modify only if verification exposes an in-scope defect.

- [ ] **Step 1: Run the full verification suite**

Run:

```bash
npm run test:unit
npm run test:logic
npm run test:localization
npm run test:integration
npm run test:e2e
npm run lint
npm run check:committed-secrets
npm run build
git diff --check
git status --short
```

Expected: every command passes; only intended feature and documentation files are modified.

- [ ] **Step 2: Request independent code review**

Review the complete diff against the design for pricing correctness, exact approval boundaries, snapshot immutability, authorization, localization, and migration safety. Address verified findings and rerun affected tests.

- [ ] **Step 3: Commit the formal feature branch**

```bash
git add <reviewed feature files>
git commit -m "feat: add placement and bonus quotation flow"
```

Do not push or merge.

---

### Task 8: Port and publish the existing Sites demo

**Files:**
- Create worktree/branch from tag `sites-demo-v1`: `codex/placement-bonus-sites-demo`
- Modify the compatible `lib/`, `components/`, `app/`, and `tests/` files in that worktree
- Preserve: `.openai/hosting.json` project ID and access configuration

- [ ] **Step 1: Create the legacy Sites worktree**

Run from the repository root:

```bash
git worktree add .worktrees/placement-bonus-sites-demo -b codex/placement-bonus-sites-demo sites-demo-v1
```

- [ ] **Step 2: Port only compatible quotation changes**

Apply the domain types, localStorage persistence, demo data, localization, components, CSS, and browser/unit tests. Do not port PostgreSQL, MinIO, import APIs, Next standalone, Docker, or VPS deployment files.

- [ ] **Step 3: Verify the Sites build from a clean install**

Run the legacy project's declared install, unit/localization/browser tests, lint, and Sites build. Confirm that `.openai/hosting.json` still references `appgprj_6a5134e2aaa88191a3bca54e4c374ff9` and that the build emits the required Sites server artifact.

- [ ] **Step 4: Commit the demo branch**

```bash
git add <reviewed demo port files>
git commit -m "feat: update hosted quotation demo workflow"
```

- [ ] **Step 5: Package and publish a new version to the existing project**

Use the Sites packaging and deployment tools with the existing project ID. Preserve the current custom/private access mode. Never call `create_site`.

- [ ] **Step 6: Smoke-test the unchanged public URL**

Verify:

```text
https://sales-quotation-approval.jeffrey202510.chatgpt.site
```

Test English default copy, all four role choices, Placement, No Bonus/Add Bonus, calculated effective discount, all three direct approval queues, return/resubmit, and the approved quotation preview.

Expected: the existing URL serves the new demo while the VPS and GitHub `main` remain unchanged.
