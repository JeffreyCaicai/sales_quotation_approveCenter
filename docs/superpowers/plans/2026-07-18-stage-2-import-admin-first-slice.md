# Stage 2 Import Administration — First Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a bilingual, refresh-safe administration workflow that imports and atomically publishes Building Master, Sales Package Master, and the current Rate Card while retaining immutable history.

**Architecture:** Extend the existing authenticated import framework instead of replacing it. Dataset-specific parsers, validators, diff builders, and transactional publishers write to PostgreSQL and immutable object storage; a separate `/admin/imports` client consumes stable administration APIs and leaves the existing quotation demo unchanged. Rate Card publication demotes the previous Current version and promotes the new immutable version in one transaction, with a stored baseline version preventing stale previews from publishing.

**Tech Stack:** TypeScript 5.9, Next.js 16.2, React 19, PostgreSQL, Drizzle ORM, XLSX, csv-parse, S3-compatible object storage, Vitest, PGlite, Playwright.

## Global Constraints

- English is the default administration locale; Simplified Chinese is available and persists in the browser.
- Customer / Brand / Sales PIC is visible only as **Waiting for final template**; no provisional upload route is added.
- IRIS Building ID is immutable, unique, and non-reusable. Missing Building rows do not deactivate existing Buildings.
- Existing Package Codes and Package Names are immutable. A blank code is accepted only for a genuinely new, uniquely named package and receives a deterministic system code after full-batch validation.
- Rate Card files contain no effective or expiry date and no user-entered version code.
- A successful Rate Card publication becomes Current immediately; the former Current version becomes Historical in the same transaction.
- The three Rate Card datasets are standalone Building prices, Package prices, and Package membership.
- Publication remains server-authorized and all-or-nothing. A stale preview must be reprocessed.
- Existing quotation-demo data and screens remain unchanged in this slice.
- VAT, target-total reverse calculation, final IDR precision, CRM/ERP synchronization, final Group A/B mapping, PDF generation, and production deployment are excluded.
- Preserve the user-owned untracked `exports/` and `test-results/` directories. Do not stage, modify, or delete them.

---

### Task 1: Migrate Rate Card lifecycle to Current and Historical

**Files:**
- Modify: `db/enums.ts`
- Modify: `db/schema.ts`
- Create: `drizzle/0009_rate_card_current_history.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `tests/schema-migration.test.ts`
- Create: `tests/rate-card-version-code.test.ts`
- Create: `lib/imports/rate-card-version-code.ts`

- [ ] **Step 1: Write failing schema and version-code tests**

Add assertions to `tests/schema-migration.test.ts` that the migrated schema has no `effective_at` or `activated_at`, accepts only `current` and `historical`, and rejects a second Current row:

```ts
const columns = await db.query<{ column_name: string }>(sql`
  select column_name from information_schema.columns
  where table_name = 'rate_card_versions'
`);
expect(columns.rows.map((row) => row.column_name)).not.toContain("effective_at");
expect(columns.rows.map((row) => row.column_name)).not.toContain("activated_at");

await db.exec(`
  insert into rate_card_versions
    (version_code, currency, status, import_job_id, uploaded_by, uploaded_at)
  values ('RC-ONE', 'IDR', 'current', '${jobId}', '${userId}', now())
`);
await expect(db.exec(`
  insert into rate_card_versions
    (version_code, currency, status, import_job_id, uploaded_by, uploaded_at)
  values ('RC-TWO', 'IDR', 'current', '${secondJobId}', '${userId}', now())
`)).rejects.toThrow();
```

Create `tests/rate-card-version-code.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createRateCardVersionCode } from "@/lib/imports/rate-card-version-code";

describe("createRateCardVersionCode", () => {
  it("combines UTC publication time with a stable job suffix", () => {
    expect(createRateCardVersionCode(
      new Date("2026-07-18T03:04:05.000Z"),
      "12345678-abcd-4000-8000-123456789abc",
    )).toBe("RC-20260718T030405Z-12345678");
  });
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run tests/schema-migration.test.ts tests/rate-card-version-code.test.ts
```

Expected: FAIL because the schema still uses the import-state lifecycle and the version-code helper does not exist.

- [ ] **Step 3: Add the lifecycle enum, migration, and generator**

In `db/enums.ts` add:

```ts
export const rateCardVersionStatuses = ["current", "historical"] as const;
export type RateCardVersionStatus = (typeof rateCardVersionStatuses)[number];
```

In `db/schema.ts`, declare `rateCardVersionStatusEnum`, remove `effectiveAt` and `activatedAt`, and set:

```ts
status: rateCardVersionStatusEnum("status").notNull().default("historical"),
```

Create migration `0009_rate_card_current_history.sql` with these operations in order:

```sql
CREATE TYPE "public"."rate_card_version_status" AS ENUM('current', 'historical');
ALTER TABLE "rate_card_versions"
  ADD COLUMN "publication_status" "rate_card_version_status" NOT NULL DEFAULT 'historical';

WITH newest AS (
  SELECT id
  FROM rate_card_versions
  WHERE published_at IS NOT NULL
  ORDER BY published_at DESC, id DESC
  LIMIT 1
)
UPDATE rate_card_versions
SET publication_status = 'current'
WHERE id IN (SELECT id FROM newest);

ALTER TABLE "rate_card_versions" DROP COLUMN "status";
ALTER TABLE "rate_card_versions" DROP COLUMN "effective_at";
ALTER TABLE "rate_card_versions" DROP COLUMN "activated_at";
ALTER TABLE "rate_card_versions" RENAME COLUMN "publication_status" TO "status";
CREATE UNIQUE INDEX "rate_card_versions_one_current"
  ON "rate_card_versions" (status) WHERE status = 'current';
ALTER TYPE "public"."change_type" ADD VALUE IF NOT EXISTS 'removed';
```

Also append `"removed"` to `changeTypes` in `db/enums.ts` so the Drizzle type matches the migrated enum.

Update the Drizzle journal with index `9`, tag `0009_rate_card_current_history`, and the next timestamp. Create `lib/imports/rate-card-version-code.ts`:

```ts
export function createRateCardVersionCode(publishedAt: Date, jobId: string): string {
  const timestamp = publishedAt.toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
  const suffix = jobId.replace(/-/gu, "").slice(0, 8).toUpperCase();
  return `RC-${timestamp}-${suffix}`;
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npx vitest run tests/schema-migration.test.ts tests/rate-card-version-code.test.ts tests/schema.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit the lifecycle foundation**

```bash
git add db/enums.ts db/schema.ts drizzle/0009_rate_card_current_history.sql drizzle/meta/_journal.json tests/schema-migration.test.ts tests/rate-card-version-code.test.ts lib/imports/rate-card-version-code.ts
git commit -m "feat: version rate cards as current and historical"
```

---

### Task 2: Add the Sales Package Master template, parser, and validation

**Files:**
- Modify: `lib/imports/template-v2.ts`
- Modify: `lib/imports/contracts.ts`
- Modify: `lib/imports/normalize.ts`
- Modify: `lib/imports/parse-workbook.ts`
- Modify: `lib/imports/parse-csv.ts`
- Modify: `lib/imports/validate.ts`
- Modify: `lib/imports/generate-template.ts`
- Create: `lib/imports/package-code.ts`
- Create: `server-assets/templates/v2/03_Sales_Packages_Template.xlsx`
- Modify: `tests/import-parser.test.ts`
- Modify: `tests/import-template-generation.test.ts`
- Create: `tests/import-package-validation.test.ts`
- Create: `tests/package-code.test.ts`

- [ ] **Step 1: Write failing parser, template, validation, and code tests**

Add the package contract expectation:

```ts
expect(PACKAGE_HEADERS).toEqual([
  "Package Code",
  "Package Name",
  "Operational Status",
]);
```

Add parser cases for `.xlsx` and `.csv` that produce:

```ts
{
  templateVersion: "TMN-IMPORT-2",
  rows: [
    { rowNumber: 2, packageCode: "PKG-A", packageName: "Regional A", operationalStatus: "active" },
    { rowNumber: 3, packageCode: null, packageName: "New Metro", operationalStatus: "inactive" },
  ],
}
```

Create `tests/package-code.test.ts`:

```ts
it("generates a deterministic code from job and row", () => {
  expect(createPackageCode("12345678-abcd-4000-8000-123456789abc", 23))
    .toBe("PKG-12345678-0023");
});
```

Add validation cases proving that Package Name and status are required, supplied codes and normalized Package Names are unique, an existing code cannot change its Package Name, and two blank-code rows remain distinguishable by row number.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run tests/import-parser.test.ts tests/import-template-generation.test.ts tests/import-package-validation.test.ts tests/package-code.test.ts
```

Expected: FAIL because package imports and templates are unsupported.

- [ ] **Step 3: Implement the package import contract**

In `lib/imports/template-v2.ts` add:

```ts
export const PACKAGE_HEADERS = [
  "Package Code",
  "Package Name",
  "Operational Status",
] as const;

export interface PackageRow {
  rowNumber: number;
  packageCode: string | null;
  packageName: string;
  operationalStatus: "active" | "inactive";
}

export interface PackageImport {
  templateVersion: typeof TEMPLATE_VERSION_V2;
  rows: PackageRow[];
}
```

Extend `NormalizedImport`, parser dispatch, accepted data types, and validation dispatch with `package`. Update `canonicalTemplateVersionForDataType` so `building`, `package`, and `rate_card` all use `TMN-IMPORT-2`. Parse both formats through the same header normalization rules used by Buildings. Create `lib/imports/package-code.ts`:

```ts
export function createPackageCode(jobId: string, rowNumber: number): string {
  const job = jobId.replace(/-/gu, "").slice(0, 8).toUpperCase();
  return `PKG-${job}-${String(rowNumber).padStart(4, "0")}`;
}
```

Generate the workbook asset with an `Instructions` sheet and a `Sales Packages` data sheet containing the exact headers and sample values. Extend `generateImportTemplate` with:

```ts
package: "03_Sales_Packages_Template.xlsx",
```

- [ ] **Step 4: Run focused tests and verify GREEN**

```bash
npx vitest run tests/import-parser.test.ts tests/import-template-generation.test.ts tests/import-package-validation.test.ts tests/package-code.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit package input support**

```bash
git add lib/imports/template-v2.ts lib/imports/contracts.ts lib/imports/normalize.ts lib/imports/parse-workbook.ts lib/imports/parse-csv.ts lib/imports/validate.ts lib/imports/generate-template.ts lib/imports/package-code.ts server-assets/templates/v2/03_Sales_Packages_Template.xlsx tests/import-parser.test.ts tests/import-template-generation.test.ts tests/import-package-validation.test.ts tests/package-code.test.ts
git commit -m "feat: parse and validate sales package imports"
```

---

### Task 3: Stage Package differences and publish them atomically

**Files:**
- Create: `lib/imports/package-diff.ts`
- Modify: `lib/imports/processing-repository.ts`
- Modify: `lib/imports/process-import.ts`
- Create: `lib/imports/publish-package.ts`
- Modify: `lib/imports/publish.ts`
- Modify: `tests/import-processing.test.ts`
- Create: `tests/import-package-diff.test.ts`
- Create: `tests/import-package-publication.test.ts`
- Create: `tests/import-package-publication.integration.test.ts`

- [ ] **Step 1: Write failing diff, processor, and publisher tests**

Test the four preview categories. `modified` covers an explicit Inactive → Active transition; changing the Package Name of an existing code is a validation error:

```ts
expect(calculatePackageDiff(candidate, existing)).toMatchObject([
  { entityKey: "PKG-A", changeType: "modified" },
  { entityKey: "PKG-B", changeType: "deactivated" },
  { entityKey: "PKG-C", changeType: "unchanged" },
  { entityKey: "row:5", changeType: "added" },
]);
```

Add publication tests proving:

- blank Package Code is replaced by `createPackageCode(jobId, rowNumber)` only during publication;
- absent existing packages remain unchanged;
- all changes roll back when one stored before-snapshot is stale;
- only `data.import.package` may publish;
- replaying an already published job is idempotent;
- audit events contain generated codes and before/after values.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run tests/import-processing.test.ts tests/import-package-diff.test.ts tests/import-package-publication.test.ts
npm run test:integration -- tests/import-package-publication.integration.test.ts
```

Expected: FAIL because package processing and publication do not exist.

- [ ] **Step 3: Implement diff storage and processing**

Define in `lib/imports/package-diff.ts`:

```ts
export interface PackageSnapshot {
  packageCode: string;
  packageName: string;
  status: "active" | "inactive";
}

export interface PackageChange {
  rowNumber: number;
  entityKey: string;
  changeType: "added" | "modified" | "deactivated" | "unchanged";
  before: PackageSnapshot | null;
  after: PackageSnapshot & { packageCode: string | null };
}
```

Use `row:${rowNumber}` as preview identity for blank new codes. Extend `ProcessingJob.dataType`, repository snapshot loading, `completePackage`, and `processImport` dispatch. A valid package job ends in `ready_to_publish`; errors end in `validation_failed`.

- [ ] **Step 4: Implement the package publisher**

`publishPackageImport(jobId, actor)` must:

1. acquire `publicationLockIdentities("package")` advisory locks;
2. lock the job and recheck `data.import.package`;
3. require `ready_to_publish` and template V2;
4. lock every existing Package referenced by a stored change;
5. compare current rows with stored `beforeValue` using canonical JSON;
6. generate blank codes and reject any collision;
7. insert or update all non-unchanged rows;
8. mark the job published and write audit events in the same transaction.

Return:

```ts
{
  jobId,
  state: "published",
  publishedChanges,
  generatedIdentifiers: [{ rowNumber, identifier: packageCode }],
}
```

Extend `PublicationResult` with optional `generatedIdentifiers` and route `package` through `publishImport`.

- [ ] **Step 5: Run focused and integration tests and verify GREEN**

```bash
npx vitest run tests/import-processing.test.ts tests/import-package-diff.test.ts tests/import-package-publication.test.ts
npm run test:integration -- tests/import-package-publication.integration.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit package publication**

```bash
git add lib/imports/package-diff.ts lib/imports/processing-repository.ts lib/imports/process-import.ts lib/imports/publish-package.ts lib/imports/publish.ts tests/import-processing.test.ts tests/import-package-diff.test.ts tests/import-package-publication.test.ts tests/import-package-publication.integration.test.ts
git commit -m "feat: publish sales package master imports"
```

---

### Task 4: Replace the Rate Card file contract and build a stored difference preview

**Files:**
- Modify: `lib/imports/template-v2.ts`
- Modify: `lib/imports/contracts.ts`
- Modify: `lib/imports/parse-workbook.ts`
- Modify: `lib/imports/parse-csv.ts`
- Modify: `lib/imports/normalize.ts`
- Modify: `lib/imports/validate.ts`
- Modify: `lib/imports/process-import.ts`
- Modify: `lib/imports/processing-repository.ts`
- Create: `lib/imports/rate-card-diff.ts`
- Replace: `server-assets/templates/v2/04_Rate_Card_Template.xlsx`
- Modify: `tests/import-parser.test.ts`
- Modify: `tests/import-template-generation.test.ts`
- Create: `tests/import-rate-card-diff.test.ts`
- Modify: `tests/import-processing.test.ts`

- [ ] **Step 1: Write failing contract and diff tests**

Require the new single-CSV header:

```ts
export const RATE_CARD_HEADERS = [
  "Record Type",
  "IRIS Building ID",
  "Package Code",
  "Price IDR",
] as const;
```

Test all three record types:

```csv
Record Type,IRIS Building ID,Package Code,Price IDR
BUILDING_PRICE,B000001,,120000000
PACKAGE_PRICE,,PKG-A,900000000
PACKAGE_MEMBER,B000001,PKG-A,
```

Assert that unexpected data sheets, nonblank inapplicable cells, duplicate keys, negative/decimal prices, inactive references, missing package price, and missing membership fail validation. Zero is accepted as a nonnegative integer pending the final IDR calculation rules. Assert that Excel data sheets are exactly `Building Prices`, `Package Prices`, and `Package Membership`.

Create diff expectations using these keys:

```ts
"building:B000001"
"package:PKG-A"
"membership:PKG-A:B000001"
```

and change types `added`, `modified`, `removed`, `unchanged`.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run tests/import-parser.test.ts tests/import-template-generation.test.ts tests/import-rate-card-diff.test.ts tests/import-processing.test.ts
```

Expected: FAIL because the old contract requires Metadata Version Code, Effective Date, `Package Buildings`, and multiple CSV files.

- [ ] **Step 3: Implement the new parser and validator contract**

Replace `RateCardImport` with:

```ts
export interface RateCardImport {
  templateVersion: typeof TEMPLATE_VERSION_V2;
  currency: "IDR";
  buildingPrices: Array<{ rowNumber: number; irisBuildingId: string; priceIdr: string }>;
  packagePrices: Array<{ rowNumber: number; packageCode: string; priceIdr: string }>;
  packageMemberships: Array<{ rowNumber: number; packageCode: string; irisBuildingId: string }>;
}
```

Keep `Instructions` and `Metadata` as recognized non-data sheets, but reject any other sheet and require exactly the three approved data sheets. Metadata carries only Template Version and Currency. For CSV, parse one file and route each normalized row by `Record Type`; reject inapplicable nonblank fields.

Remove date parsing and user-entered version validation from processing. Accept prices matching `^(0|[1-9]\\d*)$`. Rename every `packageBuildings` domain reference to `packageMemberships` while leaving the database table name unchanged.

- [ ] **Step 4: Implement Rate Card baseline and diff storage**

Define:

```ts
export interface StagedRateCardImport extends RateCardImport {
  basedOnVersionId: string | null;
}

export interface RateCardDiffSnapshot {
  versionId: string | null;
  buildingPrices: Map<string, string>;
  packagePrices: Map<string, string>;
  packageMemberships: Set<string>;
}
```

`calculateRateCardDiff` must emit one `importChanges` row for every candidate/current union key. `ProcessingRepository.loadRateCardSnapshot` reads only the Current version. `completeRateCard` stores the staged payload and categorized changes, then moves the job to `draft`.

- [ ] **Step 5: Regenerate the workbook and verify GREEN**

Create a workbook with localized instructions, metadata containing only Template Version and Currency, and the three exact data sheets. Then run:

```bash
npx vitest run tests/import-parser.test.ts tests/import-template-generation.test.ts tests/import-rate-card-diff.test.ts tests/import-processing.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit the Rate Card contract**

```bash
git add lib/imports/template-v2.ts lib/imports/contracts.ts lib/imports/parse-workbook.ts lib/imports/parse-csv.ts lib/imports/normalize.ts lib/imports/validate.ts lib/imports/process-import.ts lib/imports/processing-repository.ts lib/imports/rate-card-diff.ts server-assets/templates/v2/04_Rate_Card_Template.xlsx tests/import-parser.test.ts tests/import-template-generation.test.ts tests/import-rate-card-diff.test.ts tests/import-processing.test.ts
git commit -m "feat: stage current rate card differences"
```

---

### Task 5: Publish Rate Cards with atomic Current/History switching

**Files:**
- Modify: `lib/imports/publish-rate-card.ts`
- Modify: `tests/import-rate-card-publication.test.ts`
- Modify: `tests/import-rate-card-publication.integration.test.ts`
- Modify: `tests/import-publication-semantics.test.ts`

- [ ] **Step 1: Write failing publication and concurrency tests**

Add cases proving:

- the version code is system-generated at publication;
- a publication with `basedOnVersionId: null` fails if a Current version now exists;
- a publication with a nonmatching baseline fails with `IMPORT_CHANGE_STALE`;
- the prior Current row becomes Historical and the new row becomes Current;
- source prices and memberships on the Historical version are unchanged;
- a failed insert leaves the former Current untouched;
- two competing transactions cannot both remain Current;
- exact uploaded checksum cannot be published twice for Rate Card.

- [ ] **Step 2: Run focused and integration tests and verify RED**

```bash
npx vitest run tests/import-rate-card-publication.test.ts tests/import-publication-semantics.test.ts
npm run test:integration -- tests/import-rate-card-publication.integration.test.ts
```

Expected: FAIL because publication still trusts file-supplied version/date and has no baseline or Current switch.

- [ ] **Step 3: Refactor publication around the stored baseline**

Update `RateCardPublicationErrorKey` with `IMPORT_CHANGE_STALE` and remove date/version collision errors. After acquiring dataset advisory locks and locking the job:

```ts
const now = new Date();
const input = parseStagedRateCardImport(job.normalizedPayload);
const [current] = await tx.select({ id: rateCardVersions.id })
  .from(rateCardVersions)
  .where(eq(rateCardVersions.status, "current"))
  .limit(1)
  .for("update");

if ((current?.id ?? null) !== input.basedOnVersionId) {
  throw new RateCardPublicationError("IMPORT_CHANGE_STALE", 409);
}

if (current) {
  await tx.update(rateCardVersions)
    .set({ status: "historical", updatedAt: now })
    .where(eq(rateCardVersions.id, current.id));
}

const versionCode = createRateCardVersionCode(now, jobId);
```

Before switching versions, query published Rate Card jobs under the same dataset lock and reject a different published job with the same checksum. Insert the immutable version directly with `status: "current"`, `publishedBy`, and `publishedAt`; insert all child rows; mark the job published; and write audit events for the demoted version, new Current version, and job. All operations remain in one transaction.

- [ ] **Step 4: Run focused and integration tests and verify GREEN**

```bash
npx vitest run tests/import-rate-card-publication.test.ts tests/import-publication-semantics.test.ts
npm run test:integration -- tests/import-rate-card-publication.integration.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit Current publication semantics**

```bash
git add lib/imports/publish-rate-card.ts tests/import-rate-card-publication.test.ts tests/import-rate-card-publication.integration.test.ts tests/import-publication-semantics.test.ts
git commit -m "feat: atomically publish the current rate card"
```

---

### Task 6: Complete upload, template, and lifecycle APIs for all three datasets

**Files:**
- Modify: `app/api/templates/[dataType]/route.ts`
- Modify: `app/api/imports/route.ts`
- Modify: `app/api/imports/[jobId]/process/route.ts`
- Modify: `app/api/imports/[jobId]/publish/route.ts`
- Modify: `tests/import-template-route.test.ts`
- Modify: `tests/import-route.test.ts`
- Modify: `tests/import-lifecycle-route.test.ts`

- [ ] **Step 1: Write failing route authorization and dispatch tests**

Add route matrix cases:

| Data type | Upload permission | Publish permission |
|---|---|---|
| building | `data.import.building` | `data.import.building` |
| package | `data.import.package` | `data.import.package` |
| rate_card | `rate_card.upload` | `rate_card.publish` |

Require package template download, package upload/process/publish, stable 409 responses for stale preview, and 404/400 for `customer_brand` template requests.

- [ ] **Step 2: Run route tests and verify RED**

```bash
npx vitest run tests/import-template-route.test.ts tests/import-route.test.ts tests/import-lifecycle-route.test.ts
```

Expected: FAIL on package dispatch and revised Rate Card lifecycle responses.

- [ ] **Step 3: Extend route allowlists and stable responses**

Use one shared mapping exported from `lib/imports/contracts.ts`:

```ts
export const importPermissionByDataType = {
  building: "data.import.building",
  package: "data.import.package",
  rate_card: "rate_card.upload",
} as const;
```

Accept only `building`, `package`, and `rate_card` at upload/template boundaries. Preserve server-side permission checks in both routes and publishers. Map `IMPORT_CHANGE_STALE` to HTTP 409 with a response body containing `{ error: "IMPORT_CHANGE_STALE", reprocessRequired: true }`.

- [ ] **Step 4: Run route tests and verify GREEN**

```bash
npx vitest run tests/import-template-route.test.ts tests/import-route.test.ts tests/import-lifecycle-route.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit API completion**

```bash
git add -- 'app/api/templates/[dataType]/route.ts' app/api/imports/route.ts 'app/api/imports/[jobId]/process/route.ts' 'app/api/imports/[jobId]/publish/route.ts' lib/imports/contracts.ts tests/import-template-route.test.ts tests/import-route.test.ts tests/import-lifecycle-route.test.ts
git commit -m "feat: expose package and current rate card import APIs"
```

---

### Task 7: Add administration read models, history, error reports, and protected downloads

**Files:**
- Create: `lib/imports/admin-contracts.ts`
- Create: `lib/imports/admin-read-model.ts`
- Create: `lib/imports/render-error-report.ts`
- Create: `app/api/admin/imports/summary/route.ts`
- Create: `app/api/admin/imports/route.ts`
- Create: `app/api/admin/imports/[jobId]/route.ts`
- Create: `app/api/admin/imports/[jobId]/errors.csv/route.ts`
- Create: `app/api/admin/imports/[jobId]/files/[fileId]/route.ts`
- Create: `app/api/admin/rate-cards/route.ts`
- Create: `tests/import-admin-read-model.test.ts`
- Create: `tests/import-admin-route.test.ts`
- Create: `tests/import-error-report.test.ts`

- [ ] **Step 1: Write failing read-model, route, and CSV tests**

Define expected response contracts:

```ts
export interface ImportAdminSummary {
  currentRateCard: null | { versionCode: string; publishedAt: string };
  buildings: { active: number; inactive: number };
  packages: { active: number; inactive: number };
  jobs: { validating: number; ready: number; failed: number };
  recentPublications: ImportJobListItem[];
}

export interface ImportJobDetail extends ImportJobListItem {
  errors: ImportErrorItem[];
  changes: ImportChangeItem[];
  files: ImportFileItem[];
  auditEvents: ImportAuditItem[];
}
```

Test that unauthenticated calls return 401; actors without `data.audit.read` return 403; file download additionally requires `data.file.download`; requested files must belong to the requested job; error CSV uses exact columns `File,Sheet,Row,Column,Error Key,Message,Parameters`; English and Chinese downloads localize Message while retaining the same Error Key; and the Current Rate Card appears before Historical versions.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npx vitest run tests/import-admin-read-model.test.ts tests/import-admin-route.test.ts tests/import-error-report.test.ts
```

Expected: FAIL because administration queries and routes do not exist.

- [ ] **Step 3: Implement read models and authorization**

`admin-read-model.ts` must expose:

```ts
export async function getImportAdminSummary(actor: SessionUser): Promise<ImportAdminSummary>;
export async function listImportJobs(actor: SessionUser, filters: ImportJobFilters): Promise<ImportJobListItem[]>;
export async function getImportJobDetail(actor: SessionUser, jobId: string): Promise<ImportJobDetail>;
export async function listRateCardVersions(actor: SessionUser): Promise<RateCardVersionListItem[]>;
export async function getImportFileDownload(actor: SessionUser, jobId: string, fileId: string): Promise<string>;
```

Every read method verifies the active database user and required permission rather than trusting session claims alone. `getImportFileDownload` asks the existing object store for a 300-second signed URL only after ownership and permission checks.

`renderImportErrorsCsv(errors, locale)` must escape quotes, commas, CR, and LF, render a localized English or Simplified Chinese Message, and serialize parameters as canonical JSON. Error Key remains stable for support and automation.

- [ ] **Step 4: Implement thin API routes**

Each route calls `requireSession`, delegates to the read model, and translates known authorization/not-found errors into stable JSON. The file route returns `NextResponse.redirect(signedUrl, 303)`. The CSV route accepts only `?locale=en` or `?locale=zh-CN`, defaults to English, and sets:

```ts
{
  "Content-Type": "text/csv; charset=utf-8",
  "Content-Disposition": `attachment; filename="import-${jobId}-errors.csv"`,
  "Cache-Control": "private, no-store",
}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
npx vitest run tests/import-admin-read-model.test.ts tests/import-admin-route.test.ts tests/import-error-report.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit administration APIs**

```bash
git add -- lib/imports/admin-contracts.ts lib/imports/admin-read-model.ts lib/imports/render-error-report.ts app/api/admin/imports/summary/route.ts app/api/admin/imports/route.ts 'app/api/admin/imports/[jobId]/route.ts' 'app/api/admin/imports/[jobId]/errors.csv/route.ts' 'app/api/admin/imports/[jobId]/files/[fileId]/route.ts' app/api/admin/rate-cards/route.ts tests/import-admin-read-model.test.ts tests/import-admin-route.test.ts tests/import-error-report.test.ts
git commit -m "feat: add protected import administration queries"
```

---

### Task 8: Build the bilingual Import Administration interface

**Files:**
- Create: `app/admin/imports/page.tsx`
- Create: `components/admin/import-admin-app.tsx`
- Create: `components/admin/admin-login.tsx`
- Create: `components/admin/import-admin-dashboard.tsx`
- Create: `components/admin/import-workspace.tsx`
- Create: `components/admin/import-job-detail.tsx`
- Create: `components/admin/import-history.tsx`
- Create: `components/admin/admin-locale-provider.tsx`
- Create: `components/admin/import-admin.module.css`
- Create: `lib/admin-i18n.ts`
- Create: `lib/client/import-admin-api.ts`
- Create: `tests/import-admin-localization.test.tsx`
- Create: `tests/import-admin-ui.test.tsx`
- Modify: `tests/frontend-source-structure.test.ts`

- [ ] **Step 1: Write failing localization and rendered-interface tests**

Require:

- English renders by default;
- locale switch renders Simplified Chinese and writes `tmn-import-admin-locale-v1`;
- cards exist for Buildings, Sales Packages, Rate Cards, and disabled Customer / Brand / Sales PIC;
- disabled card says `Waiting for final template` / `等待最终模板`;
- upload, validation, preview, publish confirmation, errors, history, and Current/Historical status labels exist in both locales;
- no source file contains quotation demo role-switcher imports.

- [ ] **Step 2: Run focused UI tests and verify RED**

```bash
npx vitest run tests/import-admin-localization.test.tsx tests/import-admin-ui.test.tsx tests/frontend-source-structure.test.ts
```

Expected: FAIL because the administration UI does not exist.

- [ ] **Step 3: Implement locale and API clients**

`admin-i18n.ts` exports a typed English/Chinese dictionary and `translateAdmin(locale, key, params)`. `AdminLocaleProvider` initializes with `"en"`, reads the saved browser value after mount, and persists user changes.

`import-admin-api.ts` exposes typed methods for login, summary, history, upload, processing, detail polling, publication, template download, error download, and original-file download. Non-2xx responses throw:

```ts
export class ImportAdminApiError extends Error {
  constructor(public readonly status: number, public readonly key: string) {
    super(key);
  }
}
```

- [ ] **Step 4: Implement the route shell and login state**

`app/admin/imports/page.tsx` renders only `ImportAdminApp`. On mount, the app requests summary. HTTP 401 shows `AdminLogin`, which posts email/password to `/api/auth/bootstrap` and reloads the summary without placing credentials in storage.

The shell contains Overview, Buildings, Sales Packages, Rate Cards, disabled Customer / Brand / Sales PIC, and Import History navigation. It does not import or mutate existing quotation components.

- [ ] **Step 5: Implement the complete dataset workflow**

For each operational dataset, `ImportWorkspace` must:

1. link to its current template;
2. accept one `.xlsx` or `.csv` file for Buildings and Sales Packages; for Rate Card accept one `.xlsx` or exactly the four named CSV files `building-prices.csv`, `metadata.csv`, `package-buildings.csv`, and `package-prices.csv` as one batch;
3. upload and show the durable Job ID;
4. call process and poll detail every two seconds while state is transient;
5. preserve the selected Job ID in `?job=` so refresh restores the view;
6. show error counts and error-report download on failure;
7. show categorized changes and generated-code notice on success;
8. require an explicit confirmation dialog before publication;
9. refresh summary, detail, and history after publication;
10. display stale-preview guidance and a Reprocess action on HTTP 409.

Use `aria-live="polite"` for status, labelled inputs, keyboard-operable navigation, and a real `<dialog>` or equivalent focus-managed modal for publication confirmation.

- [ ] **Step 6: Run focused UI tests and verify GREEN**

```bash
npx vitest run tests/import-admin-localization.test.tsx tests/import-admin-ui.test.tsx tests/frontend-source-structure.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit the bilingual interface**

```bash
git add app/admin/imports/page.tsx components/admin lib/admin-i18n.ts lib/client/import-admin-api.ts tests/import-admin-localization.test.tsx tests/import-admin-ui.test.tsx tests/frontend-source-structure.test.ts
git commit -m "feat: add bilingual import administration"
```

---

### Task 9: Add end-to-end workflow and performance acceptance coverage

**Files:**
- Create: `tests/admin-imports-smoke.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `package.json`
- Modify: `tests/import-performance.integration.test.ts`
- Create: `tests/import-admin-lifecycle.integration.test.ts`
- Create: `tests/fixtures/imports/v2/packages-valid.csv`
- Create: `tests/fixtures/imports/v2/rate-card-valid/building-prices.csv`
- Create: `tests/fixtures/imports/v2/rate-card-valid/metadata.csv`
- Create: `tests/fixtures/imports/v2/rate-card-valid/package-buildings.csv`
- Create: `tests/fixtures/imports/v2/rate-card-valid/package-prices.csv`
- Modify: `README.md`

- [ ] **Step 1: Write failing lifecycle and browser scenarios**

The integration scenario must bootstrap an admin and execute:

1. publish Building Master;
2. publish Package Master, including one generated code;
3. process and publish Rate Card with building price, package price, and membership;
4. publish a second Rate Card;
5. prove exactly one Current and one Historical version;
6. reload and prove job/history persistence;
7. deny a read-only user upload, publish, history, and file access.

The Playwright scenario must log in, verify English default, switch to Chinese, download a template, upload an invalid file and download its error report, then complete one valid preview/publication using API-seeded fixtures. It must also verify the disabled Customer / Brand / Sales PIC card.

- [ ] **Step 2: Run acceptance tests and verify RED**

```bash
npm run test:integration -- tests/import-admin-lifecycle.integration.test.ts tests/import-performance.integration.test.ts
npx playwright test tests/admin-imports-smoke.spec.ts
```

Expected: FAIL until the full vertical slice is connected and Playwright includes the admin scenario.

- [ ] **Step 3: Complete fixtures, test configuration, and operator documentation**

Add `admin-imports-smoke.spec.ts` to `test:e2e`:

```json
"test:e2e": "playwright test tests/smoke.spec.ts tests/admin-imports-smoke.spec.ts"
```

Keep the existing 5,000-row Building fixture generation and assert:

```ts
expect(elapsedMs).toBeLessThan(60_000);
expect(result.state).toBe("ready_to_publish");
expect(result.totalRows).toBe(5_000);
```

Document local migration, bootstrap-admin credentials via environment variables, `/admin/imports`, template filenames, three-dataset publication order, no-date Current semantics, and the fact that quotation screens still use demo data.

- [ ] **Step 4: Run the full verification ladder**

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run lint
npm run build
npm run check:committed-secrets
git diff --check
git status --short
```

Expected:

- all unit, integration, and browser tests pass;
- the 5,000-row Building import finishes under 60 seconds in the CI reference environment;
- lint and production build pass;
- committed-secret scan and whitespace check pass;
- `git status --short` shows only intentional changes plus untouched user-owned `exports/` and `test-results/` entries.

- [ ] **Step 5: Commit acceptance coverage and documentation**

```bash
git add tests/admin-imports-smoke.spec.ts playwright.config.ts package.json tests/import-performance.integration.test.ts tests/import-admin-lifecycle.integration.test.ts tests/fixtures/imports/v2/packages-valid.csv tests/fixtures/imports/v2/rate-card-valid README.md
git commit -m "test: verify the import administration workflow"
```

---

### Task 10: Final review without deployment

**Files:**
- Review: all files changed by Tasks 1–9
- Review: `docs/superpowers/specs/2026-07-18-stage-2-import-admin-first-slice-design.md`

- [ ] **Step 1: Review specification coverage**

Check every acceptance criterion in the approved specification against at least one named automated test. Confirm particularly that:

- missing Building/Package rows are not deactivated;
- generated Package Codes are returned and audited;
- Rate Card has no business-entered date or version;
- stale previews cannot publish;
- old Rate Card child rows remain immutable;
- the disabled Customer / Brand / Sales PIC state is visible;
- quotation demo code is unchanged;
- no deployment workflow or production secret changed.

- [ ] **Step 2: Review security boundaries**

Verify all administration and download routes authenticate server-side, query the active database user, enforce the specific permission, scope files to their job, avoid returning storage keys, and emit no SQL/server-path details. Confirm bootstrap login cookies retain existing `HttpOnly`, `Secure` in production, and `SameSite` settings.

- [ ] **Step 3: Review transaction and concurrency boundaries**

Inspect package and Rate Card publishers for advisory locks, row locks, stored-before comparisons, single-transaction writes, idempotent published-job replay, unique checksum behavior, and one-Current database enforcement.

- [ ] **Step 4: Re-run verification from a clean application state**

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
npm run lint
npm run build
npm run check:committed-secrets
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 5: Stop before external mutation**

Report the verified local commit range and the `/admin/imports` local URL. Do not push, merge, update Sites, connect to the VPS, or run a production migration. Those actions require a separate explicit user instruction after local review.
