# IRIS Final Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the production import lifecycle and close every final-review correctness, concurrency, identity, template, schema, and tooling finding without weakening protected boundaries.

**Architecture:** Add a state-checked orchestration service that reads immutable originals through the object-store abstraction, parses the canonical v2 contract, validates against durable database snapshots, and atomically stages either building differences or a Rate Card draft. Route publication through a dispatcher to focused transactional building and Rate Card publishers, with live permission and locked-reference rechecks inside PostgreSQL transactions.

**Tech Stack:** Next.js 16 route handlers, TypeScript 5.9, Drizzle ORM, PostgreSQL/PGlite, Vitest, XLSX/CSV parsers, S3-compatible immutable object storage.

## Global Constraints

- Canonical template version is exactly `TMN-IMPORT-2`; callers cannot select a persisted version.
- Building Type and Grade Resource values must come from an explicit injected or durable active snapshot; absent configuration fails closed.
- Validation failure stores stable structured errors and writes no business rows.
- Upload, processing, staging, and publication are retry-safe and state-checked; publication remains an explicit authenticated action.
- Rate Card publication locks every referenced building and rechecks packages, version uniqueness, job state, actor permission, and `IDR` inside one transaction.
- Preserve immutable uploads, authentication, template authorization, untracked `exports/`, hosting configuration, and the hosted demo.

---

### Task 1: Canonical parser and upload boundary

**Files:**
- Modify: `lib/imports/normalize.ts`
- Modify: `lib/imports/parse-workbook.ts`
- Modify: `lib/imports/create-job.ts`
- Modify: `lib/imports/contracts.ts`
- Modify: `app/api/imports/route.ts`
- Test: `tests/import-parser.test.ts`
- Test: `tests/import-upload.test.ts`
- Test: `tests/import-route.test.ts`

**Interfaces:**
- Produces: `canonicalTemplateVersion(dataType)` and parser failures at `ImportParseError`.

- [ ] Add failing tests for missing/mismatched Building XLSX Instructions versions, arbitrary upload versions, server-selected route version, and OOXML error wrapping.
- [ ] Run focused parser/upload/route tests and record expected failures.
- [ ] Implement exact Instructions version validation, canonical server selection, and parser-boundary wrapping.
- [ ] Re-run focused tests to green and refactor without changing behavior.

### Task 2: Required fields, controlled values, and reactivation prohibition

**Files:**
- Modify: `lib/imports/validate.ts`
- Modify: `lib/imports/diff.ts`
- Modify: `lib/imports/publish.ts`
- Modify: `db/schema.ts`
- Create: `drizzle/0007_import_lifecycle_controls.sql`
- Modify: `drizzle/meta/_journal.json`
- Test: `tests/import-building-validation.test.ts`
- Test: `tests/import-building-diff.test.ts`
- Test: `tests/import-publication-semantics.test.ts`
- Test: `tests/schema-migration.test.ts`

**Interfaces:**
- Produces: `BuildingControlledValuesSnapshot`, stable validation keys, and `IMPORT_BUILDING_REACTIVATION_REQUIRES_ADMIN_WORKFLOW`.

- [ ] Add failing tests for blank name/address, unknown/missing controlled values, full-batch rejection, inactive-to-active diff/validation/publication, blank database fields, and UUID mutation.
- [ ] Run focused tests and record expected failures.
- [ ] Implement fail-closed controlled snapshots, reactivation rejection at all three boundaries, database checks/storage, and UUID trigger protection.
- [ ] Re-run focused tests to green and refactor.

### Task 3: Production processing lifecycle

**Files:**
- Modify: `lib/storage/object-store.ts`
- Modify: `lib/storage/s3-object-store.ts`
- Create: `lib/imports/process-import.ts`
- Create: `lib/imports/processing-repository.ts`
- Create: `app/api/imports/[jobId]/process/route.ts`
- Test: `tests/import-processing.test.ts`
- Test: `tests/import-lifecycle-route.test.ts`

**Interfaces:**
- Produces: `processImport(jobId, actor, dependencies?)` with terminal `ready_to_publish`, `draft`, or `validation_failed` states.

- [ ] Add failing service/route tests entering through uploaded jobs and immutable files, including retry/state checks and structured validation failures.
- [ ] Run focused lifecycle tests and record expected failures.
- [ ] Implement immutable reads, canonical parsing, snapshot loading, validation/diff calculation, and atomic staging transitions.
- [ ] Re-run focused tests to green and refactor.

### Task 4: Transactional Rate Card publication and dispatcher

**Files:**
- Refactor: `lib/imports/publish.ts`
- Create: `lib/imports/publish-building.ts`
- Create: `lib/imports/publish-rate-card.ts`
- Create: `app/api/imports/[jobId]/publish/route.ts`
- Test: `tests/import-rate-card-publication.test.ts`
- Test: `tests/import-publication-route.test.ts`
- Test: `tests/import-rate-card-publication.integration.test.ts`

**Interfaces:**
- Consumes: staged normalized Rate Card payload from Task 3.
- Produces: publication dispatcher and focused Rate Card transaction.

- [ ] Add failing pure/PGlite and native PostgreSQL tests for success, inactive/missing/duplicate references, package status, permission, state, uniqueness, rollback, and concurrency.
- [ ] Run executable focused tests and record expected failures.
- [ ] Implement dispatcher and one-transaction Rate Card publisher with locked live building/package resolution, immutable version rows, audit events, and atomic job transition.
- [ ] Re-run focused tests to green and refactor.

### Task 5: Tooling, full verification, report, and commits

**Files:**
- Modify: `eslint.config.mjs`
- Modify: `docs/superpowers/specs/2026-07-11-building-identity-erp-mapping-design.md`
- Create: `.superpowers/sdd/iris-final-fix-report.md`

**Interfaces:**
- Produces: clean lint/diff and evidence-backed handoff.

- [ ] Add a lint/config assertion or reproduce exact `npm run lint` failure from generated `dist/`, then exclude `dist/**`.
- [ ] Fix spec whitespace and run `git diff --check`.
- [ ] Run all focused tests, full unit suite, TypeScript, exact lint, production build, 5,000-row performance, and every executable lifecycle test.
- [ ] Attempt the native PostgreSQL suite and record the exact result without treating PGlite as lock evidence.
- [ ] Read and follow `superpowers:verification-before-completion`, self-review the entire diff, write the full report, and commit focused changes while preserving `exports/`.
