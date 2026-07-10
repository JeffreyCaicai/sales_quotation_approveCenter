# Task 5 Report: Manager and CEO Approval Workflows

## Status

Implemented Task 5 only. Manager and CEO approval workflows are connected to the shared quote collection and browser persistence. The final printable Quotation view remains intentionally out of scope.

## What changed

- Added guarded `approveQuote(quote, actor)` and `returnQuote(quote, actor, reason)` domain transitions.
  - Sales Manager can act only on `pending_manager` quotes.
  - Discounts from 0% through 70% become final `approved` quotes after manager approval.
  - Discounts above 70% move from manager approval to `pending_ceo`, then become final only after CEO approval.
  - CEO can act only on executive-discount `pending_ceo` quotes.
  - Final approvals set `approvedAt`; intermediate manager approvals do not.
  - Returns require a nonblank trimmed reason, preserve commercial details and version, and append actor/role/reason/timestamp/version history.
- Strengthened `ApprovalEvent` to a discriminated union. Returned events require `comment` at compile time, and persisted data now enforces valid role/action/comment combinations at runtime.
- Added `ApprovalScreen` with:
  - customer, brand, owner, version, status, and campaign parameters;
  - selected building/package resources;
  - pricing calculation ledger and progressive discount-risk guidance;
  - chronologically sorted, versioned approval timeline;
  - accessible native approval-confirmation and return-reason dialogs, focus restoration, and inline required-reason feedback.
- Wired approval mutations into `QuotationApp` using the shared quote state and `saveQuotes` after every decision. Role dashboards update from the same collection, and approval detail is closed safely on role switch/reset/logout.
- Kept Sales returned-quote editing and versioned resubmission intact, with the dashboard action clarified to “修改并重新提交”.
- Added responsive approval-detail styling without introducing a final Quotation screen.

## TDD evidence

### RED

- Added separate logic tests for manager final approval at 50%, manager-to-CEO routing at 75%, CEO final approval at 75%, blank return reason, returned-history preservation, and wrong-role/wrong-status guards.
- First logic run failed because `approveQuote` was not exported, confirming the missing behavior.
- Added the UI source contract before the component; its first run failed because `QuotationApp` did not render `ApprovalScreen`.

### GREEN

- `npm run test:logic`: 44 passed, 0 failed.
- `npm test`: production build succeeded and 2 rendered/source smoke tests passed.
- `npm run lint`: passed with no findings.
- `npm run build`: passed.

## React and accessibility review

- All quote/customer/resource/timeline presentation is render-derived; no synchronization effects or duplicated derived state were added.
- Approval selection stores only the quote ID, so each render resolves the latest shared quote instead of retaining a stale object.
- Dialog effects are limited to native `showModal` lifecycle and focus restoration. Decision logic remains in event handlers.
- Dialogs have accessible labels/descriptions, cancel handling, backdrop dismissal, keyboard focus, inline `role="alert"` validation, and `aria-invalid`/`aria-describedby` wiring.
- Components are module-level, formatters are hoisted, and no unnecessary memoization, data-fetch waterfall, or bundle-heavy dependency was introduced.

## Independent code review

- A read-only reviewer found no critical issues and identified two important persistence-boundary gaps.
- Resolved both before commit:
  - approval eligibility is now centralized in `canApproveQuote`, including the CEO discount boundary, and the UI and transition guard share it;
  - stored `pending_ceo` quotes must have an executive discount, timestamps must be canonical valid ISO values, and approval-event versions must be positive integers no newer than the quote version.
- Added RED/GREEN coverage for the shared eligibility rule and malformed persisted workflow/history metadata.

## Persistence-boundary follow-up

- Added failing tests before implementation for three forged-payload classes:
  - skipped or mismatched current-version workflows, including CEO routing without manager approval and final executive approval without CEO approval;
  - missing/mismatched final `approvedAt` and `approvedAt` leaked onto non-final states;
  - unknown event actors or known actors with forged role/name metadata.
- Persisted quotes now require an exact current-version sequence:
  - `pending_manager`: Sales submission/resubmission only;
  - `pending_ceo`: Sales submission/resubmission then Manager approval, only above 70%;
  - final approval through 70%: Sales submission/resubmission then Manager approval;
  - final approval above 70%: Sales submission/resubmission, Manager approval, then CEO approval;
  - return: Manager return, or Manager approval followed by CEO return for the executive path.
- The latest current-version event must be the latest history entry and must correspond to quote status. History timestamps and versions must be nondecreasing.
- Final `approved` records require `approvedAt` to equal the final approval event timestamp; all non-final states reject `approvedAt`.
- Every event actor must resolve to `USERS` with the exact stored role and name, and the submission actor must own the quote.
- Added exact 70% manager-final coverage, source-quote immutability coverage, and a generated Manager → CEO → final persistence round trip.

## Verification constraints and concerns

- The in-app Browser runtime was available, but browser discovery returned an empty backend list (`[]`). The development server started successfully on `http://localhost:3001/` and was stopped cleanly, but screenshot-based desktop/mobile interaction QA could not be performed in this environment.
- An ad-hoc `npx tsc --noEmit` remains unsuitable as a project gate because the existing repository reports pre-existing Cloudflare worker globals/module declarations, `.ts` import-extension configuration, and Quote Wizard indexing errors. The required Vinext production build succeeds and did not report errors in the Task 5 files.
- Persistence remains demo/browser-local (`localStorage`) by design; there is no server concurrency or real authentication in this prototype.

## Scope boundary

- No final Quotation rendering, print view, PDF behavior, backend, authentication, or external approval integration was added.
