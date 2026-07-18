# Task 10 final-review fix report

## Outcome

All Critical and Important findings in the Task 10 brief were implemented with focused RED → GREEN coverage. Independent review also identified a refresh-safety gap and then three edge cases in the stale-preview design. Those gaps are now closed with a durable `reprocess_required` job state, a guarded/audited transition after publication rollback, publisher-observed compare-and-set tokens, complete live-drift classification, and reload/remount coverage.

No production test backdoor, secret, deployment action, push, merge, or prior-commit amendment was introduced. Controller-owned `.superpowers/sdd/task-1-report.md` and `.superpowers/sdd/task-4-report-new.md` were left unstaged.

## Fixes delivered

### Safe legacy Rate Card migration

- `0009_rate_card_current_history.sql` now recognizes only explicit eligible legacy states.
- An actual legacy `active` version wins; otherwise only the newest published version may become Current.
- Draft, superseded, rolled-back, and unpublished records are never promoted or silently relabeled Historical.
- Preflight checks fail the migration transaction on ambiguous active records, ineligible/unpublished records, invalid statuses, or a Rate Card history with no eligible Current candidate.
- PGlite coverage exercises status matrices, deterministic fallback, ambiguity, and transactional rollback.

### Durable stale-preview reprocessing

- Added the durable `reprocess_required` import state and localized status labels.
- Every Building, Package, and Rate Card stale publication conflict rolls back its publisher transaction before a second guarded transaction marks the job `reprocess_required` and writes `import.job.reprocess_required` audit metadata.
- The marker compare-and-sets both the publisher-observed state and PostgreSQL's lossless row revision (`xmin`). It does not round-trip a microsecond database timestamp through JavaScript `Date`, and a delayed stale request cannot overwrite a fresh preview completed by concurrent reprocessing.
- Building IRIS/ERP unique-owner drift and Rate Card missing/inactive live Building or Package references are classified as stale; malformed staged duplicates remain publication-invalid rather than being mislabeled as live drift.
- Repeated publish attempts stay blocked with `IMPORT_CHANGE_STALE`; refreshes and remounts restore the warning and Reprocess action from server state, with Publish absent.
- The dedicated reprocess endpoint takes a fresh permission check, locks the job, compare-and-sets `ready_to_publish`, `draft`, or `reprocess_required` to `validating`, clears the marker, audits the transition, rereads immutable source objects, and rebuilds validation output, normalized payload, differences, and Rate Card baseline.
- A native PostgreSQL + MinIO lifecycle test stages two Rate Cards on one baseline, publishes the winner, asserts the loser becomes `reprocess_required`, reprocesses it against the new Current, and then publishes it.

### Rate Card price range

- A shared IDR price guard accepts only integer values from `0` through `999999999999999999`.
- Processing and publication both revalidate Building and Package Rate Card prices.
- Database checks enforce the same lower and upper bounds on both price tables.
- Tests cover zero, the 18-digit maximum, negative values, 19-digit overflow, precision/scale, validation, publication, and migration/schema boundaries.

### Chunked persistence

- Import changes and validation errors are inserted in chunks of 1,000 inside the existing transaction.
- Unit tests exercise 30,000 changes and 20,000 errors without exceeding bind-parameter-safe chunk sizes.
- A native PostgreSQL integration test verifies persisted counts, state transitions, and audits after reload.

### Safe, recoverable processing failures

- Unexpected processor faults move jobs to `processing_failed`, never back into an endless uploaded/polling loop.
- Safe persisted summaries contain only retryable/terminal codes plus a UUID incident identifier; raw errors go only to the server logger.
- Retry classification handles bounded/cycle-safe wrapped causes, PostgreSQL connectivity codes, transient object-store/network failures, and permanent storage integrity/not-found failures.
- The repository supports audited retry claims only for explicitly retryable incidents. The UI offers Retry only for retryable failures and otherwise gives terminal operator guidance.
- API/read-model/UI tests prove SQL text, paths, stack/error messages, and arbitrary objects do not leak.

### Database-enforced Package identity

- Migration preflights trim/collision problems before applying constraints.
- Database checks reject blank or whitespace-padded Package Code/Name values.
- A normalized, case-insensitive unique Package Name index prevents reuse and collisions.
- Triggers prevent UUID, Package Code, or Package Name changes and prevent deletion; deactivation remains allowed.
- Publisher normalization matches the database expression, and wrapped PostgreSQL unique violations map to the safe stale-preview path.

### Complete enumeration validation

- Building and Package parsers preserve raw candidate enum values through parsing.
- Validators collect all invalid status/data-source errors across the batch before producing typed normalized rows.
- Multi-row and multi-enum CSV/XLSX tests prove complete localized error reporting.

### Minimal Building contract

- Only IRIS Building ID, Building Name, and Status are required.
- Optional controlled fields remain nullable and are validated only when supplied; missing Data Source defaults to `building_team` after validation.
- The schema/migration makes address nullable, and publication/lifecycle coverage includes a minimal Building row.
- IRIS identity permanence, missing-row unchanged behavior, and explicit deactivation semantics remain intact.

### Real 5,000-row acceptance

- The old in-memory timing check is explicitly retained as a microbenchmark.
- A new native PostgreSQL + MinIO acceptance path uploads a real 5,000-row Building file through immutable object storage, processing, durable change persistence, reload, and exact count assertions with a 60-second limit.
- It is included by the existing CI integration job, which provisions PostgreSQL, MinIO, and migrations with test-only credentials.

### Low-risk cleanups

- Building publication replay is idempotent and checks current permission before replay.
- Only explicit `IMPORT_CHANGE_STALE`/reprocess-required metadata activates stale UI behavior; not-ready/checksum conflicts do not.
- Rate Card parse/encoding failures retain the exact failing CSV filename in durable/localized error reports.

## RED → GREEN ledger

- Candidate enum collection, minimal Building fields, price boundaries, and Rate Card filename attribution: RED 9 focused failures; GREEN 103 focused tests.
- Safe Rate Card migration status handling: RED 7 failures; GREEN 24, then 25 migration tests after the no-eligible preflight case.
- Chunking: RED 2; GREEN 2.
- Processing failure recovery: RED 3; GREEN 3.
- Guarded reprocess endpoint: RED missing endpoint/2 failures; GREEN 2, then RED/GREEN 2 for authorization-before-mutation.
- Stale UI classification/reprocess flow: RED 4; GREEN 4.
- Building replay idempotency/authorization: RED 2; GREEN 2.
- Data-source localization: RED 1; GREEN 1.
- Wrapped infrastructure retry classification: RED 3; GREEN 5.
- Wrapped Package uniqueness: RED 1; GREEN 11.
- Durable stale state after refresh: RED 6 files (missing marker plus five behavioral failures, while 108 neighboring tests passed); GREEN 7 files / 117 tests. Focused publisher regression then passed 6 files / 88 tests.
- Independent stale-edge re-audit (preview-token race, Building unique drift, and Rate Card reference drift): RED 10 focused failures; GREEN 3 files / 38 tests. Native assertions now require `reprocess_required`, exactly one marker audit, and zero entity publication writes/audits.
- Lossless preview revision follow-up: RED 5 focused failures after replacing the test token with a database revision; GREEN 3 files / 38 tests. Native Building coverage explicitly seeds a six-digit fractional `updated_at` value and proves stale marking does not depend on lossy JS timestamp precision.

## Verification

- `npm run test:unit`: **PASS**, 44 files / 601 tests.
- Focused durable-stale suite: **PASS**, 7 files / 117 tests.
- Focused publication regression suite: **PASS**, 6 files / 88 tests.
- Focused stale race/drift suite: **PASS**, 3 files / 38 tests.
- Independent read-only final re-audit: **PASS**, no remaining Critical or Important findings; its final focused run passed 4 files / 49 tests plus TypeScript, ESLint, and diff checks.
- `npx tsc --noEmit`: **PASS**.
- `npm run lint`: **PASS**.
- `npm run test:logic`: **PASS**, 32 tests.
- `npm run test:localization`: **PASS**, 22 tests.
- `npm run build`: **PASS** after allowing network access for the configured Google Fonts; compilation, TypeScript, 9 static pages, and all API routes (including `/api/imports/[jobId]/reprocess`) completed.
- `git diff --check`: **PASS**.
- `npm run check:committed-secrets`: **PASS** after explicit staging of the intentional Task 10 files.

## Local environment limitation

`npm run test:integration` was invoked against the final tree. This machine has no `DATABASE_URL`, MinIO endpoint/credentials, S3 variables, bucket, or auth secret. Four native suites therefore stopped at their explicit `DATABASE_URL is required` guard; the service-gated suites skipped. Result: 1 file passed, 2 skipped, 4 environment-blocked; 2 tests passed and 6 skipped. This is not reported as a native pass.

The PostgreSQL/MinIO acceptance and browser paths remain wired into CI with real service containers and no production route/backdoor. Browser execution was also unavailable locally for the same missing database/object-storage/bootstrap environment.

## Re-review follow-up — 2026-07-19

### Additional fixes

- Migration `0009` now stops for reconciliation if any legacy Rate Card row has status `rolled_back`. The active/published/superseded success matrix remains intact, and the active-plus-rolled-back regression proves the failed migration rolls the transaction back without relabeling either row.
- Building source ingestion now requires only the three contractual headers `IRIS Building ID`, `Building Name`, and `Operational Status`; the other nine canonical headers may be absent and normalize to nullable values, with missing Data Source defaulting to `building_team` only after validation. Both CSV and XLSX are covered through parsing, processing, and native publication. Template generation remains the full 12-column workbook.
- Retry classification now preserves `ECONNRESET` and also recognizes `ECONNREFUSED`, `ENETUNREACH`, `EHOSTUNREACH`, `ECONNABORTED`, and `EPIPE`. Direct errors, wrapped object-store causes, and wrapped database causes are covered; validation failures and permanent object-storage 404s remain terminal.
- Rate Card version codes now include the full dashless uppercase job UUID, preventing same-second collisions between jobs that share the first UUID segment.
- Publication dispatch now loads the active actor's current database publication permissions before the protected job lookup, requires the exact permission for Building, Package, or Rate Card before dispatch, rejects unsupported data types explicitly, and retains every publisher's locked transactional permission recheck.
- Admin-detail limiting was deliberately deferred: the current UI derives exact totals from the complete change array and the complete error CSV reuses the detail model, so a blunt limit would silently truncate both contracts. A safe future change needs explicit totals/page metadata plus a separate authorized complete-report query.

### Additional RED → GREEN evidence

- Required migration, true three-column Building, transient-network, and collision regressions: **RED**, 4 files failed with 17 failed / 90 passed tests. After the production changes: **GREEN**, 4 files / 107 tests.
- Authorization-before-dispatch regressions: **RED**, 1 file / 3 failed tests (missing-job disclosure, unsupported fallthrough, and wrong-type permission dispatch). After the live preflight and explicit dispatcher: **GREEN**, the dispatcher plus all three publisher unit suites passed 4 files / 46 tests.
- Final focused re-review suite, including the unchanged 12-column template contract and wrapped database cases: **PASS**, 6 files / 124 tests.
- Independent read-only review found no Critical or Important issues and assessed the implementation ready. Its one Minor recommendation was applied: the rolled-back migration test now proves DDL rollback by asserting the newly created enum type is absent after rejection. The affected migration suite then **PASSED**, 1 file / 26 tests.

### Additional verification

- `npm run test:unit`: **PASS**, 45 files / 627 tests.
- `npx tsc --noEmit`: **PASS**.
- `npm run lint`: **PASS**.
- `npm run test:logic`: **PASS**, 32 tests.
- `npm run test:localization`: **PASS**, 22 tests.
- `npm run build`: the sandboxed attempt stopped only because Google Fonts network access was unavailable; the approved network-enabled rerun **PASSED**, including compilation, TypeScript, all 9 static pages, and route generation.
- `git diff --check`: **PASS** before final staging.
- `npm run check:committed-secrets`: **PASS** against the 14 explicitly staged follow-up files; controller-owned Task 1 and Task 4 reports remained unstaged.
- `npm run test:integration`: invoked and not reported as a native pass. Without `DATABASE_URL`, 4 native suites stopped at their explicit environment guard; result was 1 file passed, 2 skipped, 4 environment-blocked, with 2 tests passed and 6 skipped.
