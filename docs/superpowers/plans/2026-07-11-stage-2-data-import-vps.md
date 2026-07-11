# Stage 2 Data Import and VPS Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser-only reference data with a PostgreSQL-backed import administration system, then deploy the bilingual application safely to one production VPS.

**Architecture:** Convert the current Vinext/Cloudflare runtime to standard Next.js Node.js while preserving the existing quotation prototype. A web process accepts and displays imports, a separately compiled lightweight worker claims PostgreSQL jobs, MinIO provides S3-compatible immutable file storage, and PostgreSQL applies validated changes transactionally. Rootless Docker Compose runs web, worker, PostgreSQL, and MinIO under an unprivileged deploy account; host-level Caddy terminates HTTPS and proxies only to the web service on loopback. GitHub Actions tests and deploys tagged releases over SSH.

**Tech Stack:** Node.js 22, Next.js 16, React 19, TypeScript 5.9, PostgreSQL 17, Drizzle ORM 0.45, `pg`, `xlsx`, `csv-parse`, Zod, AWS SDK S3 client, Vitest, Playwright, Docker Compose, MinIO, Caddy, GitHub Actions

## Global Constraints

- English is the default locale; Simplified Chinese remains available for every new administrative screen and error key.
- Currency is always `IDR`; persisted Rate Card amounts are integer rupiah represented as decimal strings at the database boundary.
- Imports are independent for customer/brand/Sales PIC, buildings, package master data, and Rate Card versions.
- Base-data imports use incremental upsert: matching IDs update, new IDs insert, absent rows remain unchanged, and only explicit `Inactive` deactivates.
- Any validation error rejects the entire batch; partial publication is prohibited.
- Published Rate Card versions and their price/membership rows are immutable.
- Upload and publish permissions remain separate even when the same initial sales assistant holds both.
- Original files, validation reports, difference reports, checksums, and audit history are retained.
- No business record can be edited directly in the admin UI.
- Typical building imports contain about 5,000 rows; other imports remain below 5,000 rows and occur approximately monthly.
- Rate Card effective dates use `Asia/Jakarta`; activation supersedes the prior active version atomically.
- Existing quotation prototype behavior and its current logic/localization tests must remain green after every task.
- The existing Sites deployment at `https://sales-quotation-approval.jeffrey202510.chatgpt.site/` must not be deleted, overwritten, or republished during Stage 2; VPS deployment uses a separate address after user acceptance.
- The production server exposes only ports 22, 80, and 443. PostgreSQL and MinIO API/console ports remain on the private Docker network.
- Production secrets exist only in `/opt/sales-quotation/shared/.env.production` with mode `0600`; they are never committed.

---

### Task 1: Convert the application to a standard Node.js runtime

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `next.config.ts`
- Modify: `tsconfig.json`
- Modify: `db/index.ts`
- Delete: `worker/index.ts`
- Delete: `vite.config.ts`
- Delete: `build/sites-vite-plugin.ts`
- Delete: `.openai/hosting.json`
- Delete: `examples/d1/app/api/notes/route.ts`
- Delete: `examples/d1/db/schema.ts`
- Create: `tests/runtime-config.test.ts`
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: `getDb(): NodePgDatabase<typeof schema>` using `DATABASE_URL`.
- Produces: Next.js standalone output in `.next/standalone`.
- Preserves: `npm run test:logic`, `npm run test:localization`, `npm run build`.

- [ ] **Step 0: Preserve a recoverable Sites source anchor**

Create annotated tag `sites-demo-v1` at the pre-migration commit and verify the existing Sites URL responds successfully. Do not invoke any Sites publish, redeploy, or delete operation. The tag is the source recovery point; the unchanged hosted deployment remains the business-discussion URL.

- [ ] **Step 1: Write the failing runtime contract test**

```ts
import { readFileSync } from "node:fs";
import { test, expect } from "vitest";

test("production runtime is Node standalone without Cloudflare bindings", () => {
  const nextConfig = readFileSync("next.config.ts", "utf8");
  const db = readFileSync("db/index.ts", "utf8");
  expect(nextConfig).toContain('output: "standalone"');
  expect(db).toContain("DATABASE_URL");
  expect(db).not.toContain("cloudflare:workers");
});
```

- [ ] **Step 2: Install the Node runtime and test dependencies**

Run: `npm install pg zod && npm install -D @types/pg vitest tsx`

Expected: `package-lock.json` updates and npm exits `0`.

Configure `vitest.config.ts` with alias `@` mapped to the repository root and exclude `**/*.integration.test.ts`; integration tests run only through the dedicated configuration added in Task 7.

- [ ] **Step 3: Verify the test fails before the migration**

Run: `npx vitest run tests/runtime-config.test.ts`

Expected: FAIL because standalone output and `DATABASE_URL` are absent.

- [ ] **Step 4: Replace Vinext scripts and configure standalone output**

Use these scripts in `package.json`:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test:unit": "vitest run",
  "test:logic": "node --experimental-strip-types --test tests/quotation.test.ts",
  "test:localization": "node --experimental-strip-types --test tests/localization.test.ts",
  "lint": "eslint . --ignore-pattern .next",
  "db:generate": "drizzle-kit generate",
  "db:migrate": "tsx scripts/migrate.ts"
}
```

Set `next.config.ts` to:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 5: Replace the D1 database factory**

```ts
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let pool: Pool | undefined;

export function getDb(): NodePgDatabase<typeof schema> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  pool ??= new Pool({ connectionString, max: 10 });
  return drizzle(pool, { schema });
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
```

- [ ] **Step 6: Remove Cloudflare-only files and packages, then verify**

Run: `npm uninstall @cloudflare/vite-plugin @vitejs/plugin-react @vitejs/plugin-rsc react-server-dom-webpack vinext vite wrangler`

Run: `npx vitest run tests/runtime-config.test.ts && npm run test:logic && npm run test:localization && npm run build`

Expected: all tests PASS and `.next/standalone/server.js` exists.

- [ ] **Step 7: Commit the runtime migration**

```bash
git add package.json package-lock.json next.config.ts db/index.ts tests/runtime-config.test.ts
git add -u worker/index.ts vite.config.ts build/sites-vite-plugin.ts .openai/hosting.json
git commit -m "refactor: move quotation app to node runtime"
```

---

### Task 2: Add the PostgreSQL schema and migration runner

**Files:**
- Modify: `drizzle.config.ts`
- Replace: `db/schema.ts`
- Create: `db/enums.ts`
- Create: `scripts/migrate.ts`
- Create: `tests/schema.test.ts`
- Create: `docker-compose.test.yml`

**Interfaces:**
- Produces: exported Drizzle tables `users`, `userPermissions`, `customers`, `brands`, `salesAssignments`, `buildings`, `salesPackages`, `rateCardVersions`, `rateCardBuildingPrices`, `rateCardPackageConfigs`, `rateCardPackageBuildings`, `importJobs`, `importFiles`, `importErrors`, `importChanges`, `auditEvents`.
- Produces: `npm run db:generate` and `npm run db:migrate` for PostgreSQL migrations.

- [ ] **Step 1: Write a failing schema export test**

```ts
import { describe, expect, test } from "vitest";
import * as schema from "@/db/schema";

describe("stage 2 schema", () => {
  test.each([
    "users", "userPermissions", "customers", "brands", "salesAssignments", "buildings",
    "salesPackages", "rateCardVersions", "rateCardBuildingPrices",
    "rateCardPackageConfigs", "rateCardPackageBuildings", "importJobs",
    "importFiles", "importErrors", "importChanges", "auditEvents",
  ])("exports %s", (name) => expect(schema).toHaveProperty(name));
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npx vitest run tests/schema.test.ts`

Expected: FAIL because the tables do not exist.

- [ ] **Step 3: Define exact enum unions**

```ts
export const importDataTypes = ["customer_brand", "building", "package", "rate_card"] as const;
export const importStates = ["uploaded", "validating", "validation_failed", "ready_to_publish", "draft", "published", "active", "superseded", "rolled_back"] as const;
export const entityStatuses = ["active", "inactive"] as const;
export const changeTypes = ["added", "modified", "deactivated", "unchanged"] as const;
export const filePurposes = ["original", "validation_report", "difference_report"] as const;
export type ImportDataType = typeof importDataTypes[number];
export type ImportState = typeof importStates[number];
```

- [ ] **Step 4: Implement the schema with UUID keys, constraints, and indexes**

Use PostgreSQL UUID primary keys with `defaultRandom()`, `timestamp(..., { withTimezone: true })`, JSONB for normalized staging/before/after payloads, unique constraints on every business code and Rate Card version code, and foreign keys matching section 5 of the approved specification. Store IDR values as `numeric("price_idr", { precision: 18, scale: 0 })`. Add indexes on `import_jobs(state, created_at)`, `import_jobs(data_type, published_at)`, `import_errors(import_job_id, row_number)`, and `audit_events(entity_type, entity_id, created_at)`.

- [ ] **Step 5: Configure PostgreSQL migrations and runner**

Set `drizzle.config.ts` dialect to `postgresql`, schema to `./db/schema.ts`, and output to `./drizzle`. Implement `scripts/migrate.ts` with `migrate(getDb(), { migrationsFolder: "drizzle" })`, close the pool in `finally`, and exit nonzero on failure.

- [ ] **Step 6: Generate and test the migration against PostgreSQL 17**

Run: `docker compose -f docker-compose.test.yml up -d postgres`

Run: `DATABASE_URL=postgres://quotation:quotation@localhost:55432/quotation npm run db:generate && DATABASE_URL=postgres://quotation:quotation@localhost:55432/quotation npm run db:migrate`

Run: `npx vitest run tests/schema.test.ts`

Expected: migration and test PASS; all sixteen tables exist. `users` includes `passwordHash`, active status, immutable email, and timestamps; `user_permissions` has a composite unique constraint on user ID and permission key.

`docker-compose.test.yml` defines both PostgreSQL 17 on `localhost:55432` and MinIO on `localhost:59000`, with test-only credentials that are not reused by production.

- [ ] **Step 7: Commit the persistence foundation**

```bash
git add db scripts drizzle drizzle.config.ts docker-compose.test.yml tests/schema.test.ts package.json package-lock.json
git commit -m "feat: add stage 2 postgres schema"
```

---

### Task 3: Add bootstrap authentication and server-side permissions

**Files:**
- Create: `lib/auth/permissions.ts`
- Create: `lib/auth/session.ts`
- Create: `lib/auth/password.ts`
- Create: `app/api/auth/bootstrap/route.ts`
- Create: `scripts/create-bootstrap-admin.ts`
- Create: `proxy.ts`
- Create: `tests/auth.test.ts`

**Interfaces:**
- Produces: `Permission` union containing the eight approved permission keys.
- Produces: `requirePermission(permission: Permission): Promise<SessionUser>`.
- Produces: signed, HTTP-only `quotation_session` cookie with a 12-hour lifetime.

- [ ] **Step 1: Write failing authorization tests**

```ts
import { expect, test } from "vitest";
import { hasPermission } from "@/lib/auth/permissions";

test("permissions are exact and deny by default", () => {
  expect(hasPermission(["data.import.building"], "data.import.building")).toBe(true);
  expect(hasPermission([], "rate_card.publish")).toBe(false);
});
```

- [ ] **Step 2: Install authentication dependencies and verify failure**

Run: `npm install jose bcryptjs && npm install -D @types/bcryptjs`

Run: `npx vitest run tests/auth.test.ts`

Expected: FAIL because the permission module does not exist.

- [ ] **Step 3: Implement the permission boundary**

```ts
export const permissions = [
  "data.import.customer_brand", "data.import.building", "data.import.package",
  "rate_card.upload", "rate_card.publish", "data.rollback",
  "data.audit.read", "data.file.download",
] as const;
export type Permission = typeof permissions[number];
export const hasPermission = (owned: readonly string[], required: Permission) => owned.includes(required);
```

Implement `requirePermission` by verifying the `quotation_session` JWT with `AUTH_SECRET`, loading the active user and permissions from PostgreSQL, and returning `401` for no session or `403` for a missing permission. Never accept role or permission fields from request bodies.

- [ ] **Step 4: Implement one-time bootstrap administration**

`scripts/create-bootstrap-admin.ts` accepts `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`, hashes the password with bcrypt cost 12, upserts the active user, and assigns all eight permissions. The login route compares the stored hash and sets a `secure`, `httpOnly`, `sameSite: "lax"` cookie. The script must refuse passwords shorter than 14 characters.

- [ ] **Step 5: Protect administrative routes**

`proxy.ts` exports Next.js 16 function `proxy` and matches `/admin/:path*`; it redirects requests without a session cookie to `/login?next=/admin`. API routes still call `requirePermission` because the proxy is not the authorization boundary.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run tests/auth.test.ts && npm run build`

Expected: PASS with no client bundle import of `AUTH_SECRET` or password helpers.

```bash
git add app/api/auth lib/auth proxy.ts scripts/create-bootstrap-admin.ts tests/auth.test.ts package.json package-lock.json
git commit -m "feat: add bootstrap admin permissions"
```

---

### Task 4: Implement immutable object storage and upload job creation

**Files:**
- Create: `lib/storage/object-store.ts`
- Create: `lib/storage/s3-object-store.ts`
- Create: `lib/imports/contracts.ts`
- Create: `lib/imports/ingestion-service.ts`
- Create: `lib/imports/create-job.ts`
- Create: `app/api/imports/route.ts`
- Create: `tests/import-upload.test.ts`

**Interfaces:**
- Produces: `ObjectStore.putImmutable(key, body, contentType, sha256): Promise<void>` and `getSignedDownloadUrl(key, expiresSeconds): Promise<string>`.
- Produces: `createImportJob(input: CreateImportJobInput, actor: SessionUser): Promise<{ jobId: string; state: "uploaded" }>`.
- Produces: `submitNormalizedImport(input: NormalizedImport, source: "manual" | "crm", actor: SessionUser): Promise<{ jobId: string }>` as the reusable CRM boundary.
- Accepts: multipart files totaling at most 25 MiB and at most 10,000 rows per logical dataset.

- [ ] **Step 1: Write failing upload-contract tests**

Test that `.xlsm`, filename path traversal, a mismatched MIME/signature, a duplicate published checksum, and a caller without the data-type permission are rejected. Test that a valid `.xlsx` returns a job ID and stores a SHA-256 checksum.

- [ ] **Step 2: Install storage and parsing prerequisites**

Run: `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner xlsx csv-parse file-type`

Expected: npm exits `0`.

- [ ] **Step 3: Implement server-generated immutable keys**

Use `imports/{yyyy}/{mm}/{jobId}/{purpose}/{randomUUID()}`; retain the original filename only as database metadata. Configure the S3 client from `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`, with path-style access for MinIO.

- [ ] **Step 4: Implement atomic job creation**

Stream each file to a bounded buffer, calculate SHA-256, verify magic bytes/MIME, store the immutable original, then create `import_jobs` and `import_files` rows in one database transaction. For Rate Card CSV, require exactly four named parts: `metadata.csv`, `building-prices.csv`, `package-prices.csv`, and `package-buildings.csv`.

Route both manual parsing and the future CRM source through `submitNormalizedImport`; that service stores `sourceType`, creates the same staging job, and never writes active business tables. Add a contract test proving identical normalized rows produce identical validation/difference inputs for `manual` and `crm` sources.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run tests/import-upload.test.ts`

Expected: all upload and authorization cases PASS.

```bash
git add app/api/imports lib/imports lib/storage tests/import-upload.test.ts package.json package-lock.json
git commit -m "feat: create immutable import jobs"
```

---

### Task 5: Parse versioned Excel and CSV templates into normalized rows

**Files:**
- Create: `lib/imports/template-v1.ts`
- Create: `lib/imports/parse-workbook.ts`
- Create: `lib/imports/parse-csv.ts`
- Create: `lib/imports/normalize.ts`
- Create: `tests/fixtures/imports/`
- Create: `tests/import-parser.test.ts`

**Interfaces:**
- Produces: `parseImportFiles(dataType, files): Promise<NormalizedImport>`.
- Produces discriminated normalized rows for `CustomerBrandRow`, `BuildingRow`, `PackageRow`, and `RateCardImport`.
- Template version: exact string `TMN-IMPORT-1`.

- [ ] **Step 1: Create deterministic fixtures and failing parser tests**

Fixtures cover valid and invalid workbook/CSV variants. The exact v1 workbook sheets are `Instructions`, `Data` for base imports and `Metadata`, `Building Prices`, `Package Prices`, `Package Buildings` for Rate Card. Tests assert formulas are rejected, unknown sheets are ignored only when named `Instructions`, dates normalize to `YYYY-MM-DD`, whitespace is trimmed, and blank system IDs remain `null`.

- [ ] **Step 2: Define exact normalized contracts**

```ts
export interface BuildingRow {
  rowNumber: number;
  buildingCode: string;
  buildingName: string;
  location: string | null;
  category: string | null;
  traffic: number | null;
  impressions: number | null;
  status: "active" | "inactive";
}

export interface CustomerBrandRow {
  rowNumber: number;
  assignmentCode: string | null;
  customerCode: string | null;
  customerName: string;
  brandCode: string | null;
  brandName: string;
  salesPicIdentity: string;
  salesType: string;
  buyingChannel: string;
  clientStatus: string;
  clientType: string;
  registrationDate: string;
  expiredDate: string | null;
  remarks: string | null;
  status: "active" | "inactive";
}

export interface PackageRow {
  rowNumber: number;
  packageCode: string | null;
  packageName: string;
  status: "active" | "inactive";
}

export interface RateCardImport {
  templateVersion: "TMN-IMPORT-1";
  versionCode: string;
  effectiveDate: string;
  currency: "IDR";
  buildingPrices: Array<{ rowNumber: number; buildingCode: string; priceIdr: string }>;
  packagePrices: Array<{ rowNumber: number; packageCode: string; priceIdr: string }>;
  packageBuildings: Array<{ rowNumber: number; packageCode: string; buildingCode: string }>;
}
```

For `salesType`, `buyingChannel`, `clientStatus`, and `clientType`, validate against the exact value lists extracted from the approved source workbook fixture; store those lists in `template-v1.ts` and reject unknown values rather than silently remapping them. Task 5 begins only after the four source assets listed in section 16 of the approved specification are supplied; changing any list or column after v1 publication requires a new template version.

- [ ] **Step 3: Implement safe parsers**

Open XLSX with formula cells inspected before reading cached values; any formula or macro metadata returns stable error `file.formula_not_allowed`. Parse CSV with UTF-8 BOM support, headers enabled, strict column count, and a 10,000-record limit. Never evaluate formulas.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run tests/import-parser.test.ts`

Expected: all template contract tests PASS in under five seconds.

```bash
git add lib/imports tests/fixtures/imports tests/import-parser.test.ts
git commit -m "feat: parse versioned import templates"
```

---

### Task 6: Validate references and calculate a complete difference set

**Files:**
- Create: `lib/imports/errors.ts`
- Create: `lib/imports/validate.ts`
- Create: `lib/imports/diff.ts`
- Create: `lib/imports/generate-codes.ts`
- Create: `tests/import-validation.test.ts`
- Create: `tests/import-diff.test.ts`

**Interfaces:**
- Produces: `validateImport(input, referenceSnapshot): ImportValidationError[]`.
- Produces: `calculateDiff(input, currentSnapshot): ImportChange[]`.
- Produces: generated codes `CUS-000001`, `BRD-000001`, `ASN-000001`, `PKG-000001` using locked PostgreSQL sequences.

- [ ] **Step 1: Write failing validation and diff tests**

Cover duplicate codes, ambiguous first-import names, inactive/missing Sales PIC, brand/customer mismatch, inactive building membership, negative/non-integer IDR values, duplicate Rate Card version, explicit deactivation, absent-row unchanged behavior, and idempotent unchanged rows.

- [ ] **Step 2: Implement stable localized error records**

```ts
export interface ImportValidationError {
  sheet: string;
  rowNumber: number;
  column: string;
  key: `import.error.${string}`;
  params: Record<string, string | number>;
}
```

Sort errors by sheet, row, and column so English/Chinese reports are deterministic. Store keys and parameters, never rendered text, in PostgreSQL.

- [ ] **Step 3: Implement validation and diff rules**

Validate every row and collect every error without publishing any row. Diff by immutable system code after initial creation; use Building Code for buildings. Emit only `added`, `modified`, `deactivated`, or `unchanged`, with complete JSON before/after values and no direct database writes.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run tests/import-validation.test.ts tests/import-diff.test.ts`

Expected: all full-batch and incremental-upsert cases PASS.

```bash
git add lib/imports tests/import-validation.test.ts tests/import-diff.test.ts
git commit -m "feat: validate imports and calculate differences"
```

---

### Task 7: Process jobs, publish transactionally, and support rollback

**Files:**
- Create: `worker/import-worker.ts`
- Create: `lib/imports/claim-job.ts`
- Create: `lib/imports/process-job.ts`
- Create: `lib/imports/publish.ts`
- Create: `lib/imports/rollback.ts`
- Create: `tests/import-publication.integration.test.ts`
- Create: `tests/import-rollback.integration.test.ts`
- Create: `tests/import-performance.integration.test.ts`
- Create: `vitest.integration.config.ts`

**Interfaces:**
- Produces: worker command `npm run worker:imports`.
- Produces: compiled production worker `dist-worker/import-worker.mjs`.
- Produces: `publishImport(jobId, actor): Promise<PublicationResult>`.
- Produces: `rollbackImport(jobId, reason, actor): Promise<RollbackResult>`.

- [ ] **Step 1: Write failing PostgreSQL integration tests**

Test two workers cannot claim the same job (`FOR UPDATE SKIP LOCKED`), a validation failure persists errors but no business rows, publication is atomic, duplicate checksum publication is rejected, new Rate Card activation supersedes the old active version, and rollback either compensates the latest batch or returns dependent batch/version IDs.

- [ ] **Step 2: Add a reproducible worker build**

Run: `npm install -D tsup`

Add scripts `"build:worker": "tsup worker/import-worker.ts --format esm --platform node --target node22 --out-dir dist-worker --clean"`, `"worker:imports": "node dist-worker/import-worker.mjs"`, `"test:integration": "vitest run --config vitest.integration.config.ts"`, and change `build` to `next build && npm run build:worker`.

Expected: `npm run build:worker` creates `dist-worker/import-worker.mjs` without importing any Cloudflare runtime.

- [ ] **Step 3: Implement lightweight job claiming and processing**

Claim one `uploaded` job at a time in a short transaction, set it to `validating`, then parse/validate/diff outside the transaction. Poll every two seconds when idle and handle `SIGTERM` by finishing the current database transaction before exit. A base job ends at `ready_to_publish`; a valid Rate Card ends at `draft`.

- [ ] **Step 4: Persist reports and staged changes**

Store `import_errors` and generate bilingual CSV error reports when invalid. Store all `import_changes` and generate a categorized JSON/CSV difference report when valid. Upload reports through `ObjectStore.putImmutable` and save their keys in `import_files`.

- [ ] **Step 5: Implement publication and activation transactions**

Acquire a PostgreSQL advisory transaction lock keyed by data type, recheck state and actor permission, apply every non-unchanged change, record uploader and publisher separately, create audit events, and commit once. Rate Card publication creates immutable version rows. On every worker poll, a scheduler query activates the earliest due published version using Jakarta midnight and atomically marks the prior active version `superseded`.

- [ ] **Step 6: Implement compensating rollback**

Require a nonblank reason. Only the latest published batch of a data type rolls back directly unless dependency queries find no later references. Reverse changes from stored before values, never delete audit/import/file records, and reactivate the prior valid Rate Card when rolling back an active version.

- [ ] **Step 7: Verify and commit**

Run: `DATABASE_URL=postgres://quotation:quotation@localhost:55432/quotation npx vitest run tests/import-publication.integration.test.ts tests/import-rollback.integration.test.ts tests/import-performance.integration.test.ts`

Expected: all concurrency, atomicity, activation, and recovery tests PASS; the generated 5,000-row building fixture validates and diffs in under 60 seconds.

```bash
git add worker lib/imports tests/import-publication.integration.test.ts tests/import-rollback.integration.test.ts tests/import-performance.integration.test.ts vitest.integration.config.ts package.json package-lock.json
git commit -m "feat: publish and roll back import jobs"
```

---

### Task 8: Expose typed administration APIs and template exports

**Files:**
- Create: `app/api/imports/[jobId]/route.ts`
- Create: `app/api/imports/[jobId]/publish/route.ts`
- Create: `app/api/imports/[jobId]/rollback/route.ts`
- Create: `app/api/imports/[jobId]/files/[fileId]/route.ts`
- Create: `app/api/admin/summary/route.ts`
- Create: `app/api/templates/[dataType]/route.ts`
- Create: `app/api/exports/[dataType]/route.ts`
- Create: `lib/imports/generate-template.ts`
- Create: `tests/import-api.test.ts`

**Interfaces:**
- Produces: JSON job detail with counts, state, errors, changes, files, uploader, publisher, and audit timeline.
- Produces: permission-protected publish, rollback, report download, blank-template download, and current-data export routes.

- [ ] **Step 1: Write failing route tests**

Assert `401` without session, `403` without exact permission, `409` for stale job state, `422` for blank rollback reason, and `200` for authorized reads/actions. Assert download routes return a five-minute signed URL rather than proxying MinIO credentials.

- [ ] **Step 2: Implement state-safe route handlers**

Validate route parameters with Zod UUID schemas. Publish and rollback call only their domain services; routes never update business tables directly. Return stable API error shapes `{ error: { key, params } }`.

- [ ] **Step 3: Generate fixed templates and current-data exports**

Generate `TMN-IMPORT-1` files from code so required columns cannot drift from parsers. Current-data exports always include generated Customer, Brand, Assignment, and Package codes. Formula cells and macros are never emitted.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run tests/import-api.test.ts && npm run build`

Expected: route tests and production build PASS.

```bash
git add app/api lib/imports/generate-template.ts tests/import-api.test.ts
git commit -m "feat: expose import administration api"
```

---

### Task 9: Build the bilingual import administration interface

**Files:**
- Create: `app/admin/layout.tsx`
- Create: `app/admin/page.tsx`
- Create: `app/admin/imports/page.tsx`
- Create: `app/admin/imports/[jobId]/page.tsx`
- Create: `app/admin/rate-cards/page.tsx`
- Create: `components/admin/admin-dashboard.tsx`
- Create: `components/admin/import-center.tsx`
- Create: `components/admin/import-job-detail.tsx`
- Create: `components/admin/change-preview.tsx`
- Create: `components/admin/rate-card-list.tsx`
- Modify: `lib/i18n.ts`
- Modify: `app/globals.css`
- Create: `tests/admin-localization.test.ts`
- Create: `e2e/import-admin.spec.ts`
- Create: `playwright.config.ts`

**Interfaces:**
- Consumes: APIs from Task 8.
- Produces: English-first responsive admin dashboard, import center, persistent job progress, difference preview, publish/rollback confirmations, history, and Rate Card management.

- [ ] **Step 1: Add failing localization and end-to-end tests**

Test both dictionaries contain identical `admin.*` and `import.*` leaves. In Playwright, upload a valid building file, refresh during validation, observe `Ready to publish`, inspect Added/Modified/Deactivated/Unchanged groups, publish, and verify history. Repeat the visible labels in Chinese and verify the default fresh session is English.

- [ ] **Step 2: Install Playwright and configure one Chromium project**

Run: `npm install -D @playwright/test && npx playwright install chromium`

Expected: Chromium installs and Playwright lists `chromium`.

- [ ] **Step 3: Implement dashboard and import center**

Show active Rate Card/effective date, entity counts, processing/failed jobs, drafts awaiting publication, and recent audit events. Provide four separate import cards, blank-template download, current-data export, multiple-file Rate Card CSV selection, and accessible progress/state indicators.

- [ ] **Step 4: Implement detail, publish, and rollback flows**

Poll job detail every two seconds only while `uploaded` or `validating`; stop on terminal/decision states. Render localized validation errors and grouped before/after changes. Require confirmation for publish and a mandatory reason for rollback. Do not render row-edit controls.

- [ ] **Step 5: Verify all UI paths**

Run: `npx vitest run tests/admin-localization.test.ts && npm run test:logic && npm run test:localization && npm run build`

Run: `npx playwright test e2e/import-admin.spec.ts`

Expected: all tests PASS at desktop and mobile viewport widths.

- [ ] **Step 6: Commit the admin interface**

```bash
git add app/admin components/admin lib/i18n.ts app/globals.css tests/admin-localization.test.ts e2e playwright.config.ts package.json package-lock.json
git commit -m "feat: add bilingual import administration"
```

---

### Task 10: Package the production system with Docker Compose

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `docker-compose.yml`
- Create: `deploy/Caddyfile`
- Create: `deploy/env.production.example`
- Create: `deploy/healthcheck.sh`
- Create: `app/api/health/route.ts`
- Create: `tests/deployment-config.test.ts`

**Interfaces:**
- Produces: rootless Compose services `web`, `worker`, `postgres`, and `minio`, plus host-level Caddy configuration.
- Produces: public `GET /api/health` returning only `{ "status": "ok" }` when the web process and database are healthy.

- [ ] **Step 1: Write failing deployment configuration tests**

Assert only web publishes `127.0.0.1:3000:3000`, Postgres/MinIO have persistent volumes and no host ports, web and worker use the same immutable image, health checks exist, production containers use `restart: unless-stopped`, and no literal password/secret appears in Compose.

- [ ] **Step 2: Build a non-root multi-stage image**

Build dependencies, run `npm run build`, copy standalone output plus static/public assets and `dist-worker/import-worker.mjs`, and run as UID/GID `10001`. The image command defaults to `node server.js`; Compose overrides worker with `node dist-worker/import-worker.mjs` from the same release image.

- [ ] **Step 3: Define private services and persistent data**

Compose reads `/opt/sales-quotation/shared/.env.production`; creates private network `quotation_internal`; mounts named volumes for PostgreSQL and MinIO; adds health dependencies; and binds only the web service to `127.0.0.1:3000`. PostgreSQL and both MinIO endpoints have no host port mapping.

- [ ] **Step 4: Configure HTTPS reverse proxy**

`deploy/Caddyfile` uses `${APP_DOMAIN}`, enables encoding and request body limit `25MB`, adds security headers, proxies to `127.0.0.1:3000`, and leaves automatic HTTPS enabled. The root-owned host Caddy service reads this file; the DNS A/AAAA record must point to the VPS before first production start.

- [ ] **Step 5: Verify locally and commit**

Run: `npx vitest run tests/deployment-config.test.ts && docker compose config && docker build -t sales-quotation:test .`

Expected: tests PASS, Compose validates, and the image builds without root runtime or committed secrets.

```bash
git add Dockerfile .dockerignore docker-compose.yml deploy app/api/health tests/deployment-config.test.ts
git commit -m "build: package quotation system for vps"
```

---

### Task 11: Add secure VPS provisioning, deployment, backup, and rollback

**Files:**
- Create: `deploy/provision-vps.sh`
- Create: `deploy/install-release.sh`
- Create: `deploy/backup.sh`
- Create: `deploy/restore.sh`
- Create: `deploy/rollback.sh`
- Create: `deploy/sales-quotation-backup.service`
- Create: `deploy/sales-quotation-backup.timer`
- Create: `docs/operations/vps-runbook.md`
- Create: `tests/operations-scripts.test.ts`

**Interfaces:**
- Produces: locked-down `deploy` account using SSH public-key authentication and rootless Docker; routine releases require no sudo access.
- Produces: versioned releases under `/opt/sales-quotation/releases/<git-sha>` and symlink `/opt/sales-quotation/current`.
- Produces: encrypted daily PostgreSQL/MinIO backups with 30-day local retention, an off-VPS S3-compatible copy, and documented restore verification.

- [ ] **Step 1: Write failing static safety tests**

Assert scripts use `set -Eeuo pipefail`, reject root application execution, never accept passwords as command arguments, validate release SHA format, use atomic symlink replacement, run `pg_dump` before deployment, and require explicit confirmation plus backup path for restore.

- [ ] **Step 2: Implement one-time VPS provisioning**

The script is run once by the VPS owner with sudo. It creates `deploy` with no password, installs the supplied SSH public key as mode `0600`, installs rootless Docker for that user without adding it to the rootful `docker` group, enables user lingering for its rootless service, installs Caddy as a root-owned host service, grants ownership of `/opt/sales-quotation`, configures UFW for `OpenSSH`, `80/tcp`, and `443/tcp`, sets `PermitRootLogin no` and `PasswordAuthentication no`, validates SSH configuration, and reloads SSH only after a second key-authenticated session succeeds.

- [ ] **Step 3: Document the safe lockout-prevention sequence**

The runbook requires keeping the original root session open, opening a second terminal as `deploy`, confirming `sudo -n true` fails, confirming rootless `docker compose` works, and only then disabling password/root SSH. It explicitly instructs the user never to send a root password in chat and to provide a temporary public key or deploy account instead.

- [ ] **Step 4: Implement release install and rollback**

`install-release.sh` verifies the SHA, pulls the matching GitHub Container Registry image, runs database migrations, updates the release directory and `current` symlink atomically, starts Compose, waits for `/api/health`, and automatically invokes `rollback.sh` on failed health. Rollback switches to the previous image/release; irreversible database migrations must use expand/migrate/contract across separate releases.

- [ ] **Step 5: Implement backup and restore**

`backup.sh` creates a PostgreSQL custom-format dump, mirrors the MinIO bucket, writes SHA-256 manifests, encrypts the archive with `age` using `BACKUP_AGE_RECIPIENT`, uploads the encrypted archive to the separately credentialed S3-compatible `BACKUP_S3_ENDPOINT`/`BACKUP_S3_BUCKET`, and deletes only verified local backups older than 30 days. `restore.sh` restores into a new database/bucket namespace first, verifies row/file counts and checksums, and requires an explicit promotion command.

- [ ] **Step 6: Verify scripts and commit**

Run: `npx vitest run tests/operations-scripts.test.ts && shellcheck deploy/*.sh`

Expected: all safety tests PASS and ShellCheck reports no errors.

```bash
git add deploy docs/operations/vps-runbook.md tests/operations-scripts.test.ts
git commit -m "ops: secure vps deployment and recovery"
```

---

### Task 12: Add tested GitHub-to-VPS production delivery

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy-production.yml`
- Modify: `README.md`
- Create: `docs/operations/release-checklist.md`

**Interfaces:**
- Produces: CI on pull requests and `main` pushes.
- Produces: production deployment from a GitHub `production` environment after CI succeeds.
- Requires GitHub secrets: `VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_SSH_PRIVATE_KEY`, `VPS_HOST_KEY`; no application/database secret leaves the VPS.

- [ ] **Step 1: Add CI with exact quality gates**

Run Node 22 with `npm ci`, logic/localization/unit tests, ESLint, production build, PostgreSQL integration tests, Docker build, and Playwright. Cache only npm downloads; never cache `.env` or generated database contents.

- [ ] **Step 2: Add immutable image publication and deployment**

On a successful `main` workflow, build and push `ghcr.io/jeffreycaicai/sales_quotation_approvecenter:<git-sha>`. The production job uses the GitHub `production` environment, verifies the server host key from `VPS_HOST_KEY`, connects as `deploy`, and invokes `/opt/sales-quotation/current/deploy/install-release.sh <git-sha>`.

- [ ] **Step 3: Add concurrency and rollback protections**

Set workflow concurrency group `production` with `cancel-in-progress: false`. Do not deploy pull requests. Keep the prior two images/releases. Document manual rollback as a GitHub workflow dispatch selecting one of the retained SHAs.

- [ ] **Step 4: Run the complete local release gate**

Run: `npm ci && npm run test:logic && npm run test:localization && npm run test:unit && npm run lint && npm run build`

Run: `docker compose -f docker-compose.test.yml up -d postgres minio && npm run test:integration`

Run: `docker compose up -d && ./deploy/healthcheck.sh https://localhost --insecure-local-only`

Expected: every test passes, containers become healthy, an import can be uploaded/published, the existing quotation Demo still works, and no secret is present in `git grep` output.

- [ ] **Step 5: Commit the delivery pipeline**

```bash
git add .github README.md docs/operations/release-checklist.md package.json package-lock.json
git commit -m "ci: deploy tested releases to production vps"
```

---

## Final Acceptance Gate

- [ ] A fresh English session displays the existing quotation prototype and all Stage 2 admin pages in English; switching to Simplified Chinese updates all visible Stage 2 copy.
- [ ] Customer/brand, building, package, and Rate Card Excel/CSV fixtures complete their approved lifecycles with full-batch rejection on any error.
- [ ] A 5,000-row building fixture validates and produces a difference set within 60 seconds on the target VPS class.
- [ ] Publication is atomic, permission-protected, retry-safe, and fully audited; Rate Card activation supersedes the prior version at Jakarta midnight.
- [ ] Rollback retains history and refuses unsafe dependent rollbacks with actionable identifiers.
- [ ] Original files and generated reports remain downloadable only by authorized users through short-lived URLs.
- [ ] PostgreSQL and MinIO cannot be reached from the public internet; only SSH/HTTP/HTTPS are exposed.
- [ ] A failed release health check automatically returns traffic to the previous application release.
- [ ] A backup restore rehearsal succeeds into an isolated database/bucket before production promotion.
- [ ] `git grep` finds no VPS password, private SSH key, database password, `AUTH_SECRET`, S3 secret, or backup private key.

## Deferred Input Handling

The implementation uses template contract `TMN-IMPORT-1` exactly as defined in Task 5. When the business owner supplies final source workbooks, column differences are handled by adding `TMN-IMPORT-2` parser/template fixtures; the published v1 parser and historical import records remain unchanged. Stage 3 replaces bootstrap authentication with the approved real user/team model without changing the eight permission keys or import audit records. Stage 5 consumes immutable Rate Card version IDs and does not alter Stage 2 publication history.
