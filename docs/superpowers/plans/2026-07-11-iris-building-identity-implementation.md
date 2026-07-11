# IRIS Building Identity and ERP Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make IRIS Building ID the immutable business identifier used by building imports, Rate Cards, packages, and quotations while allowing a building to operate with no ERP Building ID and to receive a verified ERP mapping later.

**Architecture:** PostgreSQL keeps an internal UUID for relationships, stores IRIS Building ID as a required immutable unique business key, and stores ERP Building ID as a nullable unique mapping. Versioned import contracts normalize both building-master and Rate Card references to IRIS Building ID; validation and publication resolve it to the internal UUID. ERP link status is maintained consistently with the optional ERP ID and all mapping changes pass through the normal audited import lifecycle.

**Tech Stack:** Next.js 16, TypeScript 5.9, PostgreSQL, Drizzle ORM 0.45, PGlite migration tests, Zod 4, SheetJS, csv-parse, Vitest 4

## Global Constraints

- IRIS Building ID is required, globally unique, immutable, and never reused.
- Every building entering a published Rate Card must already exist as an active building with an IRIS Building ID.
- ERP Building ID is optional and unique when present; it never replaces IRIS Building ID or the internal UUID.
- Rate Card prices and package memberships reference IRIS Building ID in files and internal UUIDs in PostgreSQL.
- Blank ERP Building ID never blocks an otherwise valid active building from Rate Card use.
- Published Rate Card versions remain immutable.
- Building imports remain atomic: any validation error rejects the complete batch.
- Currency remains `IDR`; dates remain Jakarta-local business dates.
- Existing hosted prototype and its URL are not changed by this implementation branch.
- This plan supersedes the generic `Building Code` portions of Tasks 5–8 in `docs/superpowers/plans/2026-07-11-stage-2-data-import-vps.md`.
- Live ERP polling, fuzzy-match suggestions, and an ERP reconciliation UI require the future ERP API contract and belong to a separate integration plan. This plan supports audited manual ERP-ID binding through the approved building import immediately and establishes the database boundary that the future adapter will use.

---

## File Structure

- `db/schema.ts` — canonical building columns, uniqueness, and consistency constraints.
- `drizzle/0006_iris_building_identity.sql` — non-destructive migration from the current generic building columns.
- `lib/buildings/identity.ts` — pure IRIS/ERP identity normalization and link-status helpers.
- `lib/imports/template-v2.ts` — exact `TMN-IMPORT-2` headers and controlled values.
- `lib/imports/normalize.ts` — normalized building and Rate Card contracts.
- `lib/imports/parse-workbook.ts` and `lib/imports/parse-csv.ts` — safe versioned parsers.
- `lib/imports/validate.ts` — duplicate, reference, status, and ERP mapping conflict validation.
- `lib/imports/diff.ts` — incremental comparison keyed by immutable IRIS Building ID.
- `lib/imports/publish.ts` — transactional application and audit of building and ERP mapping changes.
- `lib/imports/generate-template.ts` — downloadable v2 building and Rate Card templates.
- `app/api/templates/[dataType]/route.ts` — authenticated template download endpoint.
- `tests/fixtures/imports/v2/` — deterministic workbook and CSV fixtures.

---

### Task 1: Migrate the building identity schema

**Files:**
- Modify: `db/schema.ts`
- Create: `lib/buildings/identity.ts`
- Create: `drizzle/0006_iris_building_identity.sql`
- Modify: `drizzle/meta/_journal.json`
- Modify: `drizzle/meta/0006_snapshot.json`
- Modify: `tests/schema.test.ts`
- Modify: `tests/schema-migration.test.ts`

**Interfaces:**
- Produces: `buildings.irisBuildingId`, `erpBuildingId`, `erpLinkStatus`, `buildingType`, `gradeResource`, `city`, `cbdArea`, `subDistrict`, `address`, and `dataSource`.
- Produces: `deriveErpLinkStatus(erpBuildingId): "manual_only" | "erp_linked"`.
- Preserves: `buildings.id` and every existing foreign key to it.

- [ ] **Step 1: Write failing schema and migration tests**

Add assertions that the migration preserves a seeded building UUID while renaming `building_code` to `iris_building_id`, that two equal IRIS IDs fail, two equal nonblank ERP IDs fail, blank ERP IDs are accepted, link status must agree with ERP presence, and updating IRIS ID fails.

```ts
test("keeps IRIS identity immutable and allows a blank ERP mapping", async () => {
  db = new PGlite();
  await applyMigrations(db);
  const first = await db.query<{ id: string }>(`
    insert into buildings (
      iris_building_id, name, address, erp_link_status, data_source
    ) values ('B003004', 'Apartment 19th Avenue', 'Tangerang', 'manual_only', 'building_team')
    returning id
  `);

  await expect(db.query(`
    update buildings set iris_building_id = 'B999999'
    where id = '${first.rows[0].id}'
  `)).rejects.toThrow(/iris building id is immutable/i);

  await expect(db.query(`
    insert into buildings (
      iris_building_id, erp_building_id, name, address, erp_link_status, data_source
    ) values ('B000006', 'ERP-01', 'Tower A', 'Tangerang', 'erp_linked', 'building_team'),
             ('B000007', 'ERP-01', 'Tower B', 'Tangerang', 'erp_linked', 'building_team')
  `)).rejects.toThrow(/erp_building_id/i);
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npx vitest run tests/schema.test.ts tests/schema-migration.test.ts`

Expected: FAIL because `iris_building_id` and its constraints do not exist.

- [ ] **Step 3: Add identity helpers and the Drizzle schema**

```ts
export type ErpLinkStatus = "manual_only" | "erp_linked";

export function normalizeExternalId(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length === 0 ? null : normalized;
}

export function deriveErpLinkStatus(
  erpBuildingId: string | null | undefined,
): ErpLinkStatus {
  return normalizeExternalId(erpBuildingId) === null
    ? "manual_only"
    : "erp_linked";
}
```

Define the Drizzle building record with `iris_building_id` required and unique, `erp_building_id` nullable with a partial unique index, and checks limiting `erp_link_status` to `manual_only|erp_linked` and `data_source` to `building_team|erp`.

```ts
export const buildings = pgTable(
  "buildings",
  {
    id: id(),
    irisBuildingId: text("iris_building_id").notNull().unique(),
    erpBuildingId: text("erp_building_id"),
    name: text("name").notNull(),
    buildingType: text("building_type"),
    gradeResource: text("grade_resource"),
    area: text("area"),
    city: text("city"),
    cbdArea: text("cbd_area"),
    subDistrict: text("sub_district"),
    address: text("address").notNull(),
    traffic: bigint("traffic", { mode: "number" }),
    impressions: bigint("impressions", { mode: "number" }),
    erpLinkStatus: text("erp_link_status").notNull().default("manual_only"),
    dataSource: text("data_source").notNull().default("building_team"),
    status: entityStatusEnum("status").notNull().default("active"),
    sourceImportJobId: uuid("source_import_job_id").references(() => importJobs.id),
    sourceAttributes: jsonb("source_attributes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("buildings_erp_building_id_unique")
      .on(table.erpBuildingId)
      .where(sql`${table.erpBuildingId} is not null`),
    check("buildings_erp_link_status_check", sql`(
      (${table.erpBuildingId} is null and ${table.erpLinkStatus} = 'manual_only') or
      (${table.erpBuildingId} is not null and ${table.erpLinkStatus} = 'erp_linked')
    )`),
    check("buildings_data_source_check", sql`${table.dataSource} in ('building_team', 'erp')`),
  ],
);
```

- [ ] **Step 4: Create and verify the non-destructive migration**

The SQL migration renames existing columns to preserve values, adds optional columns, backfills required defaults, renames the unique constraint, and installs an update trigger that rejects changes to `iris_building_id`.

```sql
ALTER TABLE buildings RENAME COLUMN building_code TO iris_building_id;
ALTER TABLE buildings RENAME COLUMN location TO address;
ALTER TABLE buildings RENAME COLUMN category TO building_type;
ALTER TABLE buildings RENAME CONSTRAINT buildings_building_code_unique TO buildings_iris_building_id_unique;
ALTER TABLE buildings ADD COLUMN erp_building_id text;
ALTER TABLE buildings ADD COLUMN grade_resource text;
ALTER TABLE buildings ADD COLUMN city text;
ALTER TABLE buildings ADD COLUMN cbd_area text;
ALTER TABLE buildings ADD COLUMN sub_district text;
ALTER TABLE buildings ADD COLUMN erp_link_status text NOT NULL DEFAULT 'manual_only';
ALTER TABLE buildings ADD COLUMN data_source text NOT NULL DEFAULT 'building_team';
CREATE UNIQUE INDEX buildings_erp_building_id_unique
  ON buildings (erp_building_id) WHERE erp_building_id IS NOT NULL;
ALTER TABLE buildings ADD CONSTRAINT buildings_erp_link_status_check CHECK (
  (erp_building_id IS NULL AND erp_link_status = 'manual_only') OR
  (erp_building_id IS NOT NULL AND erp_link_status = 'erp_linked')
);
ALTER TABLE buildings ADD CONSTRAINT buildings_data_source_check
  CHECK (data_source IN ('building_team', 'erp'));

CREATE FUNCTION protect_iris_building_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.iris_building_id IS DISTINCT FROM OLD.iris_building_id THEN
    RAISE EXCEPTION 'IRIS Building ID is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_iris_building_id_trigger
BEFORE UPDATE ON buildings
FOR EACH ROW
EXECUTE FUNCTION protect_iris_building_id();
```

Run: `npm run db:generate -- --name iris_building_identity`

Expected: Drizzle creates `drizzle/0006_iris_building_identity.sql`, updates `drizzle/meta/_journal.json`, and creates `drizzle/meta/0006_snapshot.json`. Compare the generated SQL with the approved non-destructive operations above before running tests.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/schema.test.ts tests/schema-migration.test.ts`

Expected: PASS with the original building UUID preserved and all new identity constraints enforced.

```bash
git add db/schema.ts lib/buildings/identity.ts drizzle tests/schema.test.ts tests/schema-migration.test.ts
git commit -m "feat: establish immutable IRIS building identity"
```

---

### Task 2: Add the TMN-IMPORT-2 building and Rate Card contracts

**Files:**
- Create: `lib/imports/template-v2.ts`
- Create: `lib/imports/normalize.ts`
- Create: `lib/imports/parse-workbook.ts`
- Create: `lib/imports/parse-csv.ts`
- Create: `tests/fixtures/imports/v2/buildings-valid.xlsx`
- Create: `tests/fixtures/imports/v2/buildings-valid.csv`
- Create: `tests/fixtures/imports/v2/rate-card-valid.xlsx`
- Create: `tests/fixtures/imports/v2/buildings-duplicate-iris.xlsx`
- Create: `tests/import-parser.test.ts`

**Interfaces:**
- Produces: `parseImportFiles(dataType, files): Promise<NormalizedImport>`.
- Produces: `BuildingRow` keyed by `irisBuildingId`.
- Produces: `RateCardImport` whose building references are `irisBuildingId`.
- Template version: exact string `TMN-IMPORT-2`.

- [ ] **Step 1: Write failing parser contract tests**

```ts
test("parses active buildings without ERP IDs", async () => {
  const result = await parseImportFiles("building", [fixture("buildings-valid.xlsx")]);
  expect(result).toMatchObject({
    templateVersion: "TMN-IMPORT-2",
    rows: [{
      irisBuildingId: "B003004",
      erpBuildingId: null,
      buildingName: "Apartment 19th Avenue",
      operationalStatus: "active",
    }],
  });
});

test("normalizes Rate Card references as IRIS IDs", async () => {
  const result = await parseImportFiles("rate_card", [fixture("rate-card-valid.xlsx")]);
  expect(result.buildingPrices[0].irisBuildingId).toBe("B003004");
  expect(result.packageBuildings[0].irisBuildingId).toBe("B003004");
});
```

- [ ] **Step 2: Run parser tests and verify failure**

Run: `npx vitest run tests/import-parser.test.ts`

Expected: FAIL because the v2 contracts and parsers do not exist.

- [ ] **Step 3: Define the exact normalized contracts**

```ts
export interface BuildingRow {
  rowNumber: number;
  irisBuildingId: string;
  erpBuildingId: string | null;
  buildingName: string;
  buildingType: string | null;
  gradeResource: string | null;
  area: string | null;
  city: string | null;
  cbdArea: string | null;
  subDistrict: string | null;
  address: string;
  operationalStatus: "active" | "inactive";
  dataSource: "building_team" | "erp";
}

export interface RateCardImport {
  templateVersion: "TMN-IMPORT-2";
  versionCode: string;
  effectiveDate: string;
  currency: "IDR";
  buildingPrices: Array<{
    rowNumber: number;
    irisBuildingId: string;
    priceIdr: string;
  }>;
  packagePrices: Array<{
    rowNumber: number;
    packageCode: string;
    priceIdr: string;
  }>;
  packageBuildings: Array<{
    rowNumber: number;
    packageCode: string;
    irisBuildingId: string;
  }>;
}
```

- [ ] **Step 4: Implement strict versioned parsing**

Accept exact headers `IRIS Building ID`, `ERP Building ID`, `Building Name`, `Building Type`, `Grade Resource`, `Area`, `City`, `CBD Area`, `Sub-District`, `Address`, `Operational Status`, and `Data Source`. Trim surrounding whitespace, preserve identifier case, convert a blank ERP cell to `null`, reject formulas/macros, and retain the 10,000-row ceiling.

Rate Card `Building Prices` and `Package Buildings` sheets must use `IRIS Building ID`; a legacy `Building Code` header is rejected under `TMN-IMPORT-2` with `import.error.unknown_column`.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/import-parser.test.ts`

Expected: PASS for XLSX and UTF-8 CSV fixtures, including blank ERP IDs.

```bash
git add lib/imports tests/fixtures/imports/v2 tests/import-parser.test.ts
git commit -m "feat: parse IRIS building import contracts"
```

---

### Task 3: Validate identities and calculate IRIS-keyed differences

**Files:**
- Create: `lib/imports/errors.ts`
- Create: `lib/imports/validate.ts`
- Create: `lib/imports/diff.ts`
- Create: `tests/import-building-validation.test.ts`
- Create: `tests/import-building-diff.test.ts`

**Interfaces:**
- Produces: `validateBuildingRows(rows, snapshot): ImportValidationError[]`.
- Produces: `validateRateCardBuildings(input, snapshot): ImportValidationError[]`.
- Produces: `calculateBuildingDiff(rows, snapshot): ImportChange[]`.

- [ ] **Step 1: Write failing validation tests**

Cover blank and duplicate IRIS IDs, duplicate ERP IDs in the batch, ERP IDs linked to another current building, inactive/missing Rate Card buildings, blank ERP IDs, changed names with stable IRIS IDs, and absent-row unchanged behavior.

```ts
test("accepts a manual-only active building", () => {
  expect(validateBuildingRows([
    building({ irisBuildingId: "B003004", erpBuildingId: null }),
  ], emptySnapshot())).toEqual([]);
});

test("rejects an ERP ID already linked to another IRIS building", () => {
  const errors = validateBuildingRows([
    building({ irisBuildingId: "B000007", erpBuildingId: "ERP-01" }),
  ], snapshot({
    buildings: [{ id: "uuid-a", irisBuildingId: "B000006", erpBuildingId: "ERP-01", status: "active" }],
  }));
  expect(errors[0]).toMatchObject({
    column: "ERP Building ID",
    key: "import.error.erp_building_id_conflict",
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run tests/import-building-validation.test.ts tests/import-building-diff.test.ts`

Expected: FAIL because the validators and IRIS-keyed diff do not exist.

- [ ] **Step 3: Implement deterministic validation and diffing**

Index both candidate and current buildings by exact trimmed IRIS ID. Index nonblank ERP IDs separately. Collect every error and sort by sheet, row, and column. Never match or merge by building name, address, or fuzzy similarity.

```ts
export function buildingIdentityKey(row: Pick<BuildingRow, "irisBuildingId">) {
  return row.irisBuildingId.trim();
}

export function calculateBuildingDiff(
  rows: BuildingRow[],
  snapshot: BuildingSnapshot,
): ImportChange[] {
  const current = new Map(snapshot.buildings.map((item) => [item.irisBuildingId, item]));
  return rows.map((row) => {
    const before = current.get(buildingIdentityKey(row));
    if (!before) return { type: "added", entityKey: row.irisBuildingId, before: null, after: row };
    const after = normalizeBuildingForDiff(row);
    return deepEqual(normalizeBuildingForDiff(before), after)
      ? { type: "unchanged", entityKey: row.irisBuildingId, before, after }
      : { type: row.operationalStatus === "inactive" && before.status === "active" ? "deactivated" : "modified", entityKey: row.irisBuildingId, before, after };
  });
}
```

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run tests/import-building-validation.test.ts tests/import-building-diff.test.ts`

Expected: PASS with deterministic localized error keys and no name-based matching.

```bash
git add lib/imports tests/import-building-validation.test.ts tests/import-building-diff.test.ts
git commit -m "feat: validate and diff IRIS building data"
```

---

### Task 4: Publish building and ERP mapping changes transactionally

**Files:**
- Create: `lib/imports/publish.ts`
- Create: `tests/import-building-publication.integration.test.ts`
- Create: `vitest.integration.config.ts`

**Interfaces:**
- Produces: `publishImport(jobId, actor): Promise<PublicationResult>`.
- Consumes: validated `ImportChange[]` whose building `entityKey` is IRIS Building ID.
- Preserves: existing building UUID when ERP ID or other attributes change.

- [ ] **Step 1: Write failing PostgreSQL integration tests**

Seed `B003004` without ERP ID, publish a second import that adds `ERP-89321`, and assert that the UUID is unchanged, `erp_link_status` becomes `erp_linked`, the Rate Card foreign key still points to that UUID, and an audit event contains the ERP before/after change. Also assert an ERP conflict rolls back the complete transaction.

- [ ] **Step 2: Run integration tests and verify failure**

Run: `DATABASE_URL=postgres://quotation:quotation@localhost:55432/quotation npx vitest run --config vitest.integration.config.ts tests/import-building-publication.integration.test.ts`

Expected: FAIL because publication does not yet apply IRIS-keyed changes.

- [ ] **Step 3: Implement transactional upsert by IRIS ID**

Within the existing per-data-type PostgreSQL advisory lock, resolve the record by `iris_building_id`, never by name. Insert new records, update mutable attributes on existing records, derive link status from normalized ERP ID, and persist the complete before/after payload in `audit_events`.

```ts
const erpBuildingId = normalizeExternalId(change.after.erpBuildingId);
const values = {
  erpBuildingId,
  erpLinkStatus: deriveErpLinkStatus(erpBuildingId),
  name: change.after.buildingName,
  buildingType: change.after.buildingType,
  gradeResource: change.after.gradeResource,
  area: change.after.area,
  city: change.after.city,
  cbdArea: change.after.cbdArea,
  subDistrict: change.after.subDistrict,
  address: change.after.address,
  dataSource: change.after.dataSource,
  status: change.after.operationalStatus,
  sourceImportJobId: jobId,
  updatedAt: new Date(),
};

await tx.update(buildings)
  .set(values)
  .where(eq(buildings.irisBuildingId, change.entityKey));
```

- [ ] **Step 4: Verify and commit**

Run: `DATABASE_URL=postgres://quotation:quotation@localhost:55432/quotation npx vitest run --config vitest.integration.config.ts tests/import-building-publication.integration.test.ts`

Expected: PASS; mapping updates preserve UUIDs and conflicts publish no rows.

```bash
git add lib/imports/publish.ts tests/import-building-publication.integration.test.ts vitest.integration.config.ts
git commit -m "feat: publish audited ERP building mappings"
```

---

### Task 5: Generate and expose the formal v2 templates

**Files:**
- Create: `lib/imports/generate-template.ts`
- Create: `scripts/export-import-templates.ts`
- Create: `app/api/templates/[dataType]/route.ts`
- Create: `tests/import-template-generation.test.ts`
- Create: `tests/import-template-route.test.ts`
- Generate delivery artifact: `outputs/stage2_formal_templates_2026-07-11/02_Buildings_Template.xlsx`
- Generate delivery artifact: `outputs/stage2_formal_templates_2026-07-11/04_Rate_Card_Template.xlsx`

**Interfaces:**
- Produces: `generateImportTemplate("building" | "rate_card", "TMN-IMPORT-2"): Promise<Buffer>`.
- Produces: authenticated `GET /api/templates/building` and `GET /api/templates/rate_card`.

- [ ] **Step 1: Write failing generation and route tests**

Assert the building workbook contains the exact v2 headers, the Rate Card sheets use `IRIS Building ID`, the metadata declares `TMN-IMPORT-2`, example ERP cells are blank, IDR cells are numeric integers, and an unauthenticated download returns `401`.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run tests/import-template-generation.test.ts tests/import-template-route.test.ts`

Expected: FAIL because v2 template generation is not implemented.

- [ ] **Step 3: Implement deterministic template generation**

Use the exact header arrays exported from `template-v2.ts`, protect header names from accidental drift, format example rows visually, and include bilingual instructions stating that IRIS IDs are permanent while ERP IDs may be blank.

```ts
export const BUILDING_V2_HEADERS = [
  "IRIS Building ID",
  "ERP Building ID",
  "Building Name",
  "Building Type",
  "Grade Resource",
  "Area",
  "City",
  "CBD Area",
  "Sub-District",
  "Address",
  "Operational Status",
  "Data Source",
] as const;
```

- [ ] **Step 4: Regenerate and inspect the two formal workbooks**

Create an export script that calls `generateImportTemplate` for both data types and writes only the two delivery artifacts to the ignored `outputs/` directory.

Run: `npx tsx scripts/export-import-templates.ts`

Expected: both `.xlsx` files open without repair warnings; every worksheet is rendered to PNG for visual inspection; no formula-error token is present.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run tests/import-template-generation.test.ts tests/import-template-route.test.ts`

Expected: PASS for workbook structure, exact headers, metadata, authorization, and content type.

```bash
git add lib/imports/generate-template.ts scripts/export-import-templates.ts app/api/templates tests/import-template-generation.test.ts tests/import-template-route.test.ts
git commit -m "feat: provide IRIS building import templates"
```

---

### Task 6: Verify the complete identity lifecycle and performance

**Files:**
- Create: `tests/import-building-lifecycle.integration.test.ts`
- Create: `tests/import-performance.integration.test.ts`
- Modify: `README.md`
- Modify: `.superpowers/sdd/stage-2-progress.md`

**Interfaces:**
- Verifies: workbook → parse → validate → diff → publish → Rate Card reference → later ERP mapping.

- [ ] **Step 1: Add the end-to-end lifecycle test**

The test imports `B003004` with no ERP ID, publishes a Rate Card price and package membership referencing `B003004`, publishes a later building batch adding `ERP-89321`, and verifies that all foreign keys and historical records retain the original UUID. It then deactivates the building and verifies that a new Rate Card rejects it while the historical Rate Card remains readable.

- [ ] **Step 2: Add the representative 5,000-row fixture**

Generate deterministic IRIS IDs `B000001` through `B005000`; leave every third ERP ID blank and assign unique `ERP-000001` style values to the remainder. Assert parsing, validation, and diffing finish within 60 seconds on the target VPS class.

- [ ] **Step 3: Run focused and full verification**

Run:

```bash
npx vitest run tests/schema.test.ts tests/schema-migration.test.ts tests/import-parser.test.ts tests/import-building-validation.test.ts tests/import-building-diff.test.ts
DATABASE_URL=postgres://quotation:quotation@localhost:55432/quotation npx vitest run --config vitest.integration.config.ts tests/import-building-publication.integration.test.ts tests/import-building-lifecycle.integration.test.ts tests/import-performance.integration.test.ts
npm run lint
npm run build
```

Expected: all tests PASS, lint exits `0`, production build exits `0`, and the 5,000-row case completes under 60 seconds.

- [ ] **Step 4: Document operational ownership and commit**

Document that the Building Team allocates IRIS IDs, Sales Operations publishes approved files, ERP mapping is optional, and an identifier is deactivated rather than deleted or reused.

```bash
git add tests/import-building-lifecycle.integration.test.ts tests/import-performance.integration.test.ts README.md .superpowers/sdd/stage-2-progress.md
git commit -m "test: verify IRIS building identity lifecycle"
```

---

## Final Review Gate

- Run `git diff --check` and confirm no generated secrets, source workbooks containing confidential production data, or `.env` files are staged.
- Run `git status --short` and confirm unrelated `exports/` artifacts remain untracked.
- Review every task against `docs/superpowers/specs/2026-07-11-building-identity-erp-mapping-design.md`.
- Request a code-quality review after all six tasks pass.
- Keep the existing hosted prototype unchanged until the VPS deployment phase is explicitly authorized.
