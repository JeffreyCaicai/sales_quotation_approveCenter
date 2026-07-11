# IRIS Final Review Fix Report

**Date:** 2026-07-12

**Base commit:** `2263704ee524bccb364d622aece5ff9df2e9e736`

**Implementation commit:** `6973bdb` (`fix: complete production import lifecycle`)

**Scope correction:** The implementation commit's subject and the original
report wording were broader than the delivered IRIS plan scope. This work
provides production processors/publishers for Building and Rate Card imports;
it does not complete the generic Stage 2 lifecycle.

## Outcome

The final-review wave connects the Building and Rate Card production processing lifecycle, adds explicit authenticated publication, implements a focused transactional Rate Card publisher, enforces required and controlled building fields without inventing business lists, enforces canonical template version `TMN-IMPORT-2`, blocks inactive-building identity takeover, strengthens database identity defenses, normalizes parser errors, and makes exact lint ignore generated `dist/`.

`exports/` remained untracked and was never staged or modified. Hosting configuration, the existing hosted demo, protected template downloads, multipart authentication order, immutable upload creation, S3 pending-object compensation, and published Rate Card immutability were preserved.

## Implementation details and files

### Production upload, processing, and publication lifecycle

- `app/api/imports/route.ts` creates the immutable upload and returns `uploaded` immediately. Processing is invoked explicitly through the service/endpoint or a future worker.
- `app/api/imports/[jobId]/process/route.ts` exposes authenticated retry/state-checked processing.
- `app/api/imports/[jobId]/publish/route.ts` exposes explicit authenticated confirmation/publication.
- `lib/imports/process-import.ts` reads originals, parses the canonical contract, validates, calculates differences, and selects the terminal preview state.
- `lib/imports/processing-repository.ts` provides PostgreSQL state claims, live processing permission checks, durable snapshots, and atomic staging/error transitions.
- `lib/storage/object-store.ts` and `lib/storage/s3-object-store.ts` add immutable checksum-verified reads.
- `lib/auth/session.ts` adds authenticated-session loading for endpoints whose exact publication permission is selected and rechecked inside the transaction.

### Transactional Rate Card publication

- `lib/imports/publish-rate-card.ts` rechecks the draft job, canonical payload, IDR, version uniqueness, active actor permission, all file-level duplicates, packages, and buildings in one transaction.
- Every referenced live building and package row returned by the identifier set is selected `FOR UPDATE`; file IRIS IDs and package codes resolve only from those locked active rows.
- The same transaction inserts the version, building prices, package configurations, package memberships, complete audit records, and the job transition to `published`.
- Missing/inactive/duplicate references, malformed staged data, uniqueness conflicts, permission loss, or state changes reject/roll back the whole transaction.
- `lib/imports/publish.ts` dispatches to the focused building or Rate Card publisher while retaining building publication semantics.
- `tests/import-rate-card-publication.test.ts` provides executable pure coverage for locked snapshot resolution and stable failures.
- `tests/import-rate-card-publication.integration.test.ts` adds native PostgreSQL success, rollback, and concurrent retry cases; see the native environment gap below.

### Building requirements, controlled values, and reactivation

- `lib/imports/validate.ts` rejects blank IRIS ID/name/address, unknown Building Type/Grade Resource, missing controlled configuration, duplicate/conflicting identities, and inactive-to-active reactivation.
- `lib/imports/diff.ts` refuses to classify inactive-to-active replacement as ordinary `modified`.
- `lib/imports/publish.ts` rechecks the reactivation prohibition and nonblank descriptors at publication.
- `db/schema.ts` and `drizzle/0007_import_lifecycle_controls.sql` add durable active controlled-value storage without seeding unconfirmed lists, database whitespace checks, and internal UUID immutability.
- Production processing loads active controls from `building_controlled_values` and fails the entire batch when either required control set is empty.

### Canonical template/parser boundary and minor fixes

- `lib/imports/create-job.ts` rejects caller-selected versions and persists only server canonical `TMN-IMPORT-2`.
- `lib/imports/normalize.ts` requires the exact Building `Instructions` `Template Version` cell; Rate Card metadata checking remains mandatory; CSV is bounded by exact v2 headers plus server canonical selection.
- `lib/imports/parse-workbook.ts` wraps OOXML-container `ImportError` failures as stable `ImportParseError`.
- `docs/superpowers/specs/2026-07-11-building-identity-erp-mapping-design.md` removes trailing Markdown whitespace.
- `eslint.config.mjs` excludes `dist/**` while retaining existing generated-output ignores.

## TDD RED/GREEN evidence

Initial focused RED run:

```text
npx vitest run tests/import-parser.test.ts tests/import-upload.test.ts \
  tests/import-building-validation.test.ts tests/import-building-diff.test.ts \
  tests/import-publication-semantics.test.ts tests/schema-migration.test.ts

9 expected failures:
- 2 Building XLSX version failures
- 1 arbitrary upload version failure
- 3 required/controlled/reactivation validation failures
- 1 reactivation diff failure
- 1 reactivation publication failure
- 1 schema UUID/blank-defense failure
```

Production processing RED began with a missing `process-import` module, then became GREEN with three service-interface lifecycle tests. Rate Card publication RED began with a missing publisher module and a route that stopped at upload, then became GREEN after the dispatcher/publisher/orchestration implementation. Final self-review added a malformed staged-identifier test that first reproduced a raw `TypeError`; it became GREEN with stable `IMPORT_CHANGE_INVALID` validation.

Focused GREEN evidence includes:

```text
73/73 parser, controlled-value, identity, publication-semantic, processing, and migration tests passed
11/11 final Rate Card publication and upload-route tests passed
```

## Verification results

| Command | Result |
|---|---|
| `npm run test:unit` | PASS — 19 files, 210 tests |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS — exact script `eslint . --ignore-pattern .next` |
| `npm run build` | PASS — Next.js production build, TypeScript, static generation, and all three import routes included; required permitted network access for configured Google Fonts |
| `git diff --check` | PASS |
| `npx vitest run --config vitest.integration.config.ts tests/import-performance.integration.test.ts --reporter verbose` | PASS — 5,000 rows; parse 18.35 ms, validate 1.78 ms, diff 1.39 ms, total 21.51 ms (60,000 ms limit) |
| `npx vitest run --config vitest.integration.config.ts tests/import-building-lifecycle.integration.test.ts -t 'executable PostgreSQL-compatible coverage'` | PASS — executable PGlite lifecycle; native-only case skipped by filter |
| Native PostgreSQL command with explicit requested URL | ATTEMPTED — details below |

### Native PostgreSQL attempt

Command:

```text
DATABASE_URL=postgres://quotation:quotation@localhost:55432/quotation \
npx vitest run --config vitest.integration.config.ts \
  tests/import-building-publication.integration.test.ts \
  tests/import-building-lifecycle.integration.test.ts \
  tests/import-rate-card-publication.integration.test.ts
```

Sandbox attempt reached local-network policy and failed with `EPERM`. The command was rerun with permitted local-network access and failed with:

```text
connect ECONNREFUSED ::1:55432
connect ECONNREFUSED 127.0.0.1:55432
```

The environment has no `docker` command, so the repository test PostgreSQL service could not be started here. Native tests did not execute: 3 files failed in connection hooks, 7 native tests skipped, while the colocated executable PGlite lifecycle test passed. PGlite/pure coverage is not represented as native row-lock evidence.

## Self-review

- Confirmed ordinary imports can deactivate but cannot reactivate an inactive building at validation, diff, and publication boundaries.
- Confirmed complete descriptor replacement cannot bypass the reactivation rule as `modified`.
- Confirmed production control lists are durable/injected and empty configuration fails closed; no unconfirmed business list is hardcoded outside fixtures.
- Confirmed the Rate Card transaction performs live permission/state/currency/version/reference checks before inserts and uses locked active rows for UUID resolution.
- Confirmed validation failures delete staged changes, store ordered structured errors, and do not touch business tables.
- Confirmed upload processing stops at previewable states and publication remains a separate authenticated request.
- Confirmed generated `dist/` is ignored by lint and `exports/` is excluded from commits.
- Confirmed final code paths reject malformed staged Rate Card identifiers with stable errors rather than runtime type failures.

## Remaining Stage 2 scope and verification concern

Generic customer/brand and package processing/publication, controlled business
rollback, Rate Card activation/supersession, the administration UI, and VPS
operations remain in the original
`docs/superpowers/plans/2026-07-11-stage-2-data-import-vps.md` plan. No generic
rollback was implemented in this IRIS-focused wave.

Within the delivered Building/Rate Card scope, native PostgreSQL
execution/concurrency evidence remains required because no server is listening
at the requested local URL and Docker is unavailable. The native test cases
remain executable and should run in CI or deployment verification with all
migrations applied. PGlite coverage is not represented as native row-lock
evidence.

---

## Second final-review fix wave

**Implementation commit:** `c2ae63d` (`fix: harden IRIS import state transitions`)

### Corrections delivered

- Restored the approved asynchronous upload contract. `POST /api/imports`
  authenticates, stores immutable originals, creates the job, and returns
  `uploaded` immediately. It does not invoke parsing or processing inline.
- Preserved the explicit `processImport` service and process endpoint for a
  future worker or authenticated explicit invocation. Customer/brand and
  package uploads are no longer coupled to processors that are not implemented.
- Unsupported customer/brand and package processing returns
  `IMPORT_PROCESSOR_NOT_IMPLEMENTED` with status 501 only after an exact live
  permission check; the job remains `uploaded`.
- Processing authorization now occurs before terminal state disclosure.
  Building and Rate Card claims persist a timestamp claim token, reject active
  concurrent claims, and conditionally reclaim `validating` claims after a
  bounded 15-minute stale interval.
- Every completion, validation failure, and retry transition matches both the
  `validating` state and persisted claim timestamp. An obsolete/crashed worker
  cannot delete or overwrite a newer worker's staging data.
- Persisted job template version is rechecked as exactly `TMN-IMPORT-2` before
  immutable object reads. Parser/business errors become structured
  `validation_failed`; transient S3/database/infrastructure errors conditionally
  return the job to retryable `uploaded`.
- Rate Card processing and publication reject completely empty datasets and
  enforce package completeness in both directions.
- Rate Card publication acquires the per-data-type lock, preserves the job's
  original uploader, and uses Jakarta midnight.
- The Rate Card version is inserted as `draft`, all children are inserted while
  the parent is mutable, and only then is it transitioned to `published` in the
  same transaction. Existing immutability triggers remain enforced.
- Rate Card audit metadata records the effective business date and exact
  resolved building/package UUID payloads.
- Migration `0008_normalize_controlled_values` trims controlled-value codes at
  the database boundary and rejects normalized blanks.
- README, implementation plan, and this report now state the delivered IRIS
  scope accurately. Generic rollback was not added.

### Second-wave TDD evidence

The focused RED run produced 12 expected failures covering asynchronous upload,
persisted template mismatch, transient retry, unsupported processors, empty
Rate Cards, package completeness, Jakarta effective time, process route status,
and controlled-code normalization. A later audit-payload test first failed
because the focused metadata builder did not exist. Crash/reclaim and terminal
probe regressions were also added before final verification.

### Second-wave verification

| Command | Result |
|---|---|
| `npm run test:unit` | PASS — 19 files, 226 tests |
| `npx tsc --noEmit` | PASS |
| `npm run lint` | PASS — exact script, no errors or warnings |
| `npm run build` | PASS — production Next.js build, with permitted Google Fonts fetch |
| `git diff --check` | PASS |
| 5,000-row performance | PASS — parse 18.04 ms, validate 1.72 ms, diff 1.39 ms, total 21.16 ms |
| PGlite migration/trigger suite | PASS — 14/14 tests |

The PGlite suite reproduces the immutable-child failure when a child is inserted
beneath a published parent, while the seeded draft path confirms children can
be inserted before publication. It also verifies controlled-code normalization.

### Native PostgreSQL attempt after the second wave

The required native command was attempted again with
`DATABASE_URL=postgres://quotation:quotation@localhost:55432/quotation` and
failed before native cases could execute:

```text
connect ECONNREFUSED ::1:55432
connect ECONNREFUSED 127.0.0.1:55432
```

Native PostgreSQL remains a required CI/deployment gate for row/advisory locks,
transaction rollback, concurrency, uploader/publisher separation, and Jakarta
timestamp persistence. PGlite is not claimed as native lock evidence.

### Remaining original Stage 2 work

Customer/brand processors, package processors, controlled business rollback,
Rate Card activation/supersession, administration UI, and VPS operations remain
in `docs/superpowers/plans/2026-07-11-stage-2-data-import-vps.md`.
