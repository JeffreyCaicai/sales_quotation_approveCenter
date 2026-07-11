# IRIS Task 6 Verification Report

Date: 2026-07-12 (Asia/Jakarta)

Base: `1e53829527699627f4cf8c740037db8deac54ad0`

Commit subject: `test: verify IRIS building identity lifecycle`

## Scope delivered

- Added an executable PGlite lifecycle covering parse, validate, diff, a
  manual-only active building, Rate Card building price and package membership
  by IRIS ID, later ERP mapping on the same UUID, deactivation, rejection of new
  Rate Card references, and readability of the published historical references.
- Added the required native PostgreSQL lifecycle test using the existing
  `publishImport` interface so native transactional publication and audit rows
  can be verified when PostgreSQL is available.
- Added deterministic 5,000-row CSV coverage for `B000001` through `B005000`.
  Every row number divisible by three has a blank ERP ID; all other rows use the
  unique `ERP-000001` form.
- Documented Building Team and Sales Operations ownership, optional ERP
  mapping, deactivation instead of deletion/reuse, and historical retention.

No production implementation was changed. This task adds acceptance and
performance evidence around the interfaces delivered by IRIS Tasks 1-5.

## Verification evidence

| Check | Result | Evidence |
|---|---|---|
| Focused schema/parser/validation/diff | PASS | 5 files, 66 tests, 4.80 s |
| Full Vitest unit suite | PASS | 15 files, 186 tests, 5.23 s |
| PGlite identity lifecycle | PASS | 1 test, 584 ms |
| 5,000-row parse/validate/diff | PASS | parse 18.38 ms; validate 1.42 ms; diff 1.85 ms; total 21.65 ms |
| TypeScript | PASS | `npx tsc --noEmit`, exit 0 |
| Task 6 scoped ESLint | PASS | both new integration test files, exit 0 |
| Project ESLint excluding generated `dist/` | PASS | `npm run lint -- --ignore-pattern dist`, exit 0 |
| Production build | PASS | compiled 1,009 ms; TypeScript 1,451 ms; static pages 166 ms |
| Whitespace | PASS | `git diff --check`, exit 0 |

The first sandboxed build attempt failed because `next/font` could not reach
Google Fonts for Geist and Geist Mono. The authorized rerun with network access
passed. The exact `npm run lint` command exits 1 because the repository's
pre-existing generated `dist/` bundle is not excluded by the lint script (7
errors and 1,697 warnings); Task 6 sources are clean, and the same project lint
passes when `dist/` is excluded. No generated `dist/` file is included in this
commit.

## Native PostgreSQL gap

The required command was attempted:

```bash
DATABASE_URL=postgres://quotation:quotation@localhost:55432/quotation \
  npx vitest run --config vitest.integration.config.ts \
  tests/import-building-publication.integration.test.ts \
  tests/import-building-lifecycle.integration.test.ts \
  tests/import-performance.integration.test.ts --reporter=verbose
```

It failed before any native test body ran with `connect EPERM` for both
`::1:55432` and `127.0.0.1:55432`. The same run still executed and passed the
PGlite lifecycle (567 ms) and pure performance coverage (21.08 ms). There is no
Docker/container runtime in this environment. Therefore native PostgreSQL
advisory-lock behavior, transaction boundaries, and the native publication/audit
test are explicitly **not verified** by this task run. PGlite results are not
presented as evidence for those native-only behaviors.

## Preservation checks

- `exports/` remains untracked and untouched.
- No `.env`, confidential workbook, generated secret, or production data is
  staged.
- The hosted prototype and hosting configuration remain unchanged.
