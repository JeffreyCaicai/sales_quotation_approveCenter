# Task 4 Report — Rate Card V2 staging and Current-version differences

## Result

Implemented the confirmed Rate Card V2 contract without adding publication behavior:

- one exact four-column CSV contract with `BUILDING_PRICE`, `PACKAGE_PRICE`, and `PACKAGE_MEMBER` records;
- an XLSX workbook limited to Instructions, Metadata, Building Prices, Package Prices, and Package Membership;
- normalized `buildingPrices`, `packagePrices`, and `packageMemberships` data with no user-entered version or effective dates;
- strict nonnegative canonical integer validation, reference checks, duplicate checks, and price/membership pairing checks;
- Current-only baseline loading and deterministic added/modified/removed/unchanged differences for every union key;
- full staged payloads carrying `basedOnVersionId`, persisted change before/after values, and transition to `draft`.

The physical database table `rate_card_package_buildings` remains unchanged. Domain-facing references use `packageMemberships`.

## TDD evidence

RED command:

```bash
npx vitest run tests/import-parser.test.ts tests/import-template-generation.test.ts tests/import-rate-card-diff.test.ts tests/import-processing.test.ts
```

Initial RED result: 4 failed files; 19 failed and 35 passed tests. Failures demonstrated the absent three-record parser, workbook contract, Current-difference calculator, and draft staging behavior.

Focused GREEN result for the same command: 4 files and 55 tests passed.

Extended focused command:

```bash
npx vitest run tests/import-parser.test.ts tests/import-template-generation.test.ts tests/import-rate-card-diff.test.ts tests/import-processing.test.ts tests/import-rate-card-building-resolution.test.ts tests/import-building-validation.test.ts
```

Extended focused result: 6 files and 68 tests passed.

Full unit command and result:

```bash
npx vitest run
```

Result: 34 files and 405 tests passed.

The executable PGlite portion of `tests/import-building-lifecycle.integration.test.ts` passed with the V2 contract. The native PostgreSQL portion was skipped and its suite setup reported the expected `DATABASE_URL is required` condition because no integration database was provided in this worktree.

## Static verification

Scoped ESLint passed for all Task 4 source and test files, including the approved resolver/lifecycle compatibility files.

```bash
git diff --check
```

Passed.

```bash
npx tsc --noEmit
```

Exited 2 only on the known Task 5 publication surface: `lib/imports/publish-rate-card.ts`, `tests/import-rate-card-publication.test.ts`, and `tests/import-rate-card-publication.integration.test.ts` still reference the legacy `versionCode`, `effectiveDate`, `packageBuildings`, and draft/published statuses. Task 4 does not alter or hide those errors because publication is explicitly owned by Task 5. No Task 4 implementation file or approved compatibility file appears in the final TypeScript error list.

## Approved shared-file alignment

The controller additionally authorized these files after the brief was issued:

- `lib/imports/resolve-rate-card-building-references.ts`
- `tests/import-rate-card-building-resolution.test.ts`
- `tests/import-building-validation.test.ts`
- `tests/import-building-lifecycle.integration.test.ts`

They were changed only to align the domain rename and the new V2 Rate Card input shape. Database table names, publication behavior, and Building lifecycle semantics were not changed.

## Unresolved concerns

- Task 5 must update the publication path to assemble an unpublished Current version, atomically replace the prior Current version, and publish immutable child rows using the staged full payload.
- This task intentionally does not add version publication, UI approval controls, Sites changes, VPS changes, pushing, merging, or deployment.

## Commit and worktree

- Commit message: `feat: stage current rate card differences`
- Final commit hash: reported in the controller handoff (a commit cannot embed its own resulting hash).
- The controller-owned `.superpowers/sdd/task-1-report.md` remains unstaged and unmodified by this task.
