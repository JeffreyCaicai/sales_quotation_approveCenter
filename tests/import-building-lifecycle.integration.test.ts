import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { calculateBuildingDiff, type BuildingDiffSnapshot, type ImportChange } from "@/lib/imports/diff";
import { parseImportFiles } from "@/lib/imports/normalize";
import { publishImport } from "@/lib/imports/publish";
import {
  RateCardBuildingResolutionError,
  resolveRateCardBuildingReferences,
} from "@/lib/imports/resolve-rate-card-building-references";
import type { BuildingImport } from "@/lib/imports/template-v2";
import { validateBuildingRows, validateRateCardBuildings, type BuildingValidationSnapshot } from "@/lib/imports/validate";

const connectionString = process.env.DATABASE_URL;
const pool = connectionString ? new Pool({ connectionString, max: 4 }) : null;

const BUILDING_HEADER = "IRIS Building ID,ERP Building ID,Building Name,Building Type,Grade Resource,Area,City,CBD Area,Sub-District,Address,Operational Status,Data Source";

function buildingFile(
  irisBuildingId = "B003004",
  erpBuildingId = "",
  operationalStatus = "active",
) {
  return {
    filename: "building.csv",
    body: new TextEncoder().encode([
      BUILDING_HEADER,
      `${irisBuildingId},${erpBuildingId},Apartment 19th Avenue,Apartment,Grade A,West Jakarta,Jakarta,,Cengkareng,Jl. Daan Mogot,${operationalStatus},building_team`,
    ].join("\n")),
  };
}

function rateCardFiles(
  irisBuildingId = "B003004",
  packageCode = "PKG-IRIS",
) {
  const csv = (filename: string, rows: string[]) => ({
    filename,
    body: new TextEncoder().encode(rows.join("\n")),
  });
  return [
    csv("building-prices.csv", [
      "IRIS Building ID,Price IDR",
      `${irisBuildingId},1000000`,
    ]),
    csv("metadata.csv", [
      "Template Version,TMN-IMPORT-2",
      "Currency,IDR",
    ]),
    csv("package-buildings.csv", [
      "Package Code,IRIS Building ID",
      `${packageCode},${irisBuildingId}`,
    ]),
    csv("package-prices.csv", [
      "Package Code,Price IDR",
      `${packageCode},1500000`,
    ]),
  ];
}

async function applyMigrations(db: PGlite) {
  const journal = JSON.parse(await readFile(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const migration = await readFile(resolve(process.cwd(), "drizzle", `${entry.tag}.sql`), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) await db.exec(statement);
    }
  }
}

function validationSnapshot(id: string, erpBuildingId: string | null, status: "active" | "inactive", irisBuildingId = "B003004"): BuildingValidationSnapshot {
  return {
    buildings: [{ id, irisBuildingId, erpBuildingId, status }],
    controlledValues: { buildingTypes: ["Apartment"], gradeResources: ["Grade A"] },
  };
}

function diffSnapshot(id: string, erpBuildingId: string | null, status: "active" | "inactive", irisBuildingId = "B003004"): BuildingDiffSnapshot {
  return {
    buildings: [{
      id,
      irisBuildingId,
      erpBuildingId,
      buildingName: "Apartment 19th Avenue",
      buildingType: "Apartment",
      gradeResource: "Grade A",
      area: "West Jakarta",
      city: "Jakarta",
      cbdArea: null,
      subDistrict: "Cengkareng",
      address: "Jl. Daan Mogot",
      status,
      dataSource: "building_team",
    }],
  };
}

describe("IRIS identity lifecycle in executable PostgreSQL-compatible coverage", () => {
  let db: PGlite | undefined;

  afterEach(async () => {
    await db?.close();
  });

  test("keeps one UUID through manual-only use, ERP linking, history, and deactivation", async () => {
    db = new PGlite();
    await applyMigrations(db);

    const manual = await parseImportFiles("building", [buildingFile()]);
    expect(validateBuildingRows(manual.rows, {
      buildings: [],
      controlledValues: { buildingTypes: ["Apartment"], gradeResources: ["Grade A"] },
    })).toEqual([]);
    expect(calculateBuildingDiff(manual.rows, { buildings: [] })[0]).toMatchObject({ type: "added", entityKey: "B003004" });

    const user = await db.query<{ id: string }>(`insert into users (email, password_hash, display_name) values ('lifecycle@example.test', 'test-only-hash', 'Lifecycle') returning id`);
    const buildingJob = await db.query<{ id: string }>(`insert into import_jobs (data_type, template_version, checksum, state, uploaded_by, published_by, published_at) values ('building', 'v2', '${randomUUID()}', 'published', '${user.rows[0].id}', '${user.rows[0].id}', now()) returning id`);
    const inserted = await db.query<{ id: string; erp_link_status: string }>(`insert into buildings (iris_building_id, name, building_type, grade_resource, area, city, sub_district, address, status, data_source, source_import_job_id) values ('B003004', 'Apartment 19th Avenue', 'Apartment', 'Grade A', 'West Jakarta', 'Jakarta', 'Cengkareng', 'Jl. Daan Mogot', 'active', 'building_team', '${buildingJob.rows[0].id}') returning id, erp_link_status`);
    const buildingId = inserted.rows[0].id;
    expect(inserted.rows[0].erp_link_status).toBe("manual_only");

    const parsedRateCard = await parseImportFiles("rate_card", rateCardFiles());
    const resolvedRateCard = resolveRateCardBuildingReferences(
      parsedRateCard,
      validationSnapshot(buildingId, null, "active"),
    );
    expect(resolvedRateCard).toMatchObject({
      buildingPrices: [{ buildingId }],
      packageMemberships: [{ buildingId }],
    });
    const rateCardJob = await db.query<{ id: string }>(`insert into import_jobs (data_type, template_version, checksum, state, uploaded_by, published_by, published_at) values ('rate_card', 'v2', '${randomUUID()}', 'published', '${user.rows[0].id}', '${user.rows[0].id}', now()) returning id`);
    const packageRow = await db.query<{ id: string }>(`insert into sales_packages (package_code, name) values ('PKG-IRIS', 'IRIS Package') returning id`);
    const version = await db.query<{ id: string }>(`insert into rate_card_versions (version_code, status, import_job_id, uploaded_by) values ('RC-HISTORY', 'current', '${rateCardJob.rows[0].id}', '${user.rows[0].id}') returning id`);
    await db.exec(`
      insert into rate_card_building_prices (rate_card_version_id, building_id, price_idr) values ('${version.rows[0].id}', '${resolvedRateCard.buildingPrices[0].buildingId}', 1000000);
      insert into rate_card_package_configs (rate_card_version_id, package_id, price_idr) values ('${version.rows[0].id}', '${packageRow.rows[0].id}', 1500000);
      insert into rate_card_package_buildings (rate_card_version_id, package_id, building_id) values ('${version.rows[0].id}', '${packageRow.rows[0].id}', '${resolvedRateCard.packageMemberships[0].buildingId}');
      update rate_card_versions set published_by = '${user.rows[0].id}', published_at = now() where id = '${version.rows[0].id}';
    `);

    const linked = await parseImportFiles("building", [buildingFile("B003004", "ERP-89321")]);
    expect(validateBuildingRows(linked.rows, validationSnapshot(buildingId, null, "active"))).toEqual([]);
    expect(calculateBuildingDiff(linked.rows, diffSnapshot(buildingId, null, "active"))[0]).toMatchObject({ type: "modified", before: { id: buildingId }, after: { erpBuildingId: "ERP-89321" } });
    await db.exec(`update buildings set erp_building_id = 'ERP-89321' where id = '${buildingId}'`);

    const inactive = await parseImportFiles("building", [buildingFile("B003004", "ERP-89321", "inactive")]);
    expect(calculateBuildingDiff(inactive.rows, diffSnapshot(buildingId, "ERP-89321", "active"))[0]).toMatchObject({ type: "deactivated", before: { id: buildingId } });
    await db.exec(`update buildings set status = 'inactive' where id = '${buildingId}'`);
    const rejected = await parseImportFiles("rate_card", rateCardFiles());
    expect(() => resolveRateCardBuildingReferences(
      rejected,
      validationSnapshot(buildingId, "ERP-89321", "inactive"),
    )).toThrow(RateCardBuildingResolutionError);
    expect(validateRateCardBuildings(rejected, validationSnapshot(buildingId, "ERP-89321", "inactive"))).toEqual([
      { sheet: "Building Prices", rowNumber: 2, column: "IRIS Building ID", key: "import.error.building_inactive", params: { irisBuildingId: "B003004" } },
      { sheet: "Package Membership", rowNumber: 2, column: "IRIS Building ID", key: "import.error.building_inactive", params: { irisBuildingId: "B003004" } },
    ]);

    const history = await db.query<{ price_building_id: string; package_building_id: string; erp_building_id: string; status: string }>(`
      select price.building_id as price_building_id, member.building_id as package_building_id,
             building.erp_building_id, version.status
      from rate_card_versions version
      join rate_card_building_prices price on price.rate_card_version_id = version.id
      join rate_card_package_buildings member on member.rate_card_version_id = version.id
      join buildings building on building.id = price.building_id
      where version.id = '${version.rows[0].id}'
    `);
    expect(history.rows).toEqual([{ price_building_id: buildingId, package_building_id: buildingId, erp_building_id: "ERP-89321", status: "current" }]);
  });
});

async function nativeBuildingSnapshot(irisBuildingId: string): Promise<{ validation: BuildingValidationSnapshot; diff: BuildingDiffSnapshot }> {
  const result = await pool!.query<{ id: string; erp_building_id: string | null; name: string; building_type: string | null; grade_resource: string | null; area: string | null; city: string | null; cbd_area: string | null; sub_district: string | null; address: string; status: "active" | "inactive"; data_source: "building_team" | "erp" }>(`select id, erp_building_id, name, building_type, grade_resource, area, city, cbd_area, sub_district, address, status, data_source from buildings where iris_building_id = $1`, [irisBuildingId]);
  const row = result.rows[0];
  if (!row) return {
    validation: {
      buildings: [],
      controlledValues: { buildingTypes: ["Apartment"], gradeResources: ["Grade A"] },
    },
    diff: { buildings: [] },
  };
  return {
    validation: validationSnapshot(row.id, row.erp_building_id, row.status, irisBuildingId),
    diff: { buildings: [{ id: row.id, irisBuildingId, erpBuildingId: row.erp_building_id, buildingName: row.name, buildingType: row.building_type, gradeResource: row.grade_resource, area: row.area, city: row.city, cbdArea: row.cbd_area, subDistrict: row.sub_district, address: row.address, status: row.status, dataSource: row.data_source }] },
  };
}

async function seedNativeActor(): Promise<SessionUser> {
  const id = randomUUID();
  await pool!.query(`insert into users (id, email, password_hash, display_name) values ($1, $2, 'test-only-hash', 'Lifecycle')`, [id, `${id}@example.test`]);
  await pool!.query(`insert into user_permissions (user_id, permission_key) values ($1, 'data.import.building')`, [id]);
  return { id, email: `${id}@example.test`, displayName: "Lifecycle", status: "active", permissions: ["data.import.building"] };
}

async function publishNativeBuilding(actor: SessionUser, input: BuildingImport, changes: readonly ImportChange[]) {
  const jobId = randomUUID();
  await pool!.query(`insert into import_jobs (id, data_type, template_version, checksum, state, uploaded_by, total_rows, valid_rows) values ($1, 'building', 'v2', $2, 'ready_to_publish', $3, $4, $4)`, [jobId, randomUUID(), actor.id, input.rows.length]);
  for (const change of changes) {
    await pool!.query(`insert into import_changes (import_job_id, entity_type, entity_id, change_type, before_value, after_value) values ($1, 'building', $2, $3, $4, $5)`, [jobId, change.before?.id ?? null, change.type, change.before, change.after]);
  }
  await publishImport(jobId, actor);
  return jobId;
}

describe("complete native PostgreSQL IRIS identity lifecycle", () => {
  beforeAll(async () => {
    if (!pool) throw new Error("DATABASE_URL is required for native PostgreSQL lifecycle verification");
    const result = await pool.query<{ present: string | null }>("select to_regclass('public.import_changes')::text as present");
    if (!result.rows[0]?.present) throw new Error("Run PostgreSQL migrations before integration tests");
  });

  afterAll(async () => {
    await pool?.end();
  });

  test("publishes the full lifecycle through native transactional publication", async () => {
    const actor = await seedNativeActor();
    const suffix = randomUUID();
    const irisBuildingId = `B-NATIVE-${suffix}`;
    const erpBuildingId = `ERP-NATIVE-${suffix}`;
    const packageCode = `PKG-${suffix}`;

    const manual = await parseImportFiles("building", [buildingFile(irisBuildingId)]);
    let snapshot = await nativeBuildingSnapshot(irisBuildingId);
    expect(validateBuildingRows(manual.rows, snapshot.validation)).toEqual([]);
    const initialChanges = calculateBuildingDiff(manual.rows, snapshot.diff);
    expect(initialChanges).toMatchObject([{
      type: "added",
      entityKey: irisBuildingId,
      before: null,
    }]);
    await publishNativeBuilding(actor, manual, initialChanges);
    snapshot = await nativeBuildingSnapshot(irisBuildingId);
    const buildingId = snapshot.validation.buildings[0].id;
    expect(snapshot.validation.buildings[0]).toMatchObject({ erpBuildingId: null, status: "active" });

    const rateCard = await parseImportFiles("rate_card", rateCardFiles(irisBuildingId, packageCode));
    const resolvedRateCard = resolveRateCardBuildingReferences(
      rateCard,
      snapshot.validation,
    );
    expect(resolvedRateCard).toMatchObject({
      buildingPrices: [{ buildingId }],
      packageMemberships: [{ buildingId }],
    });
    const rateCardJob = await pool!.query<{ id: string }>(`insert into import_jobs (data_type, template_version, checksum, state, uploaded_by, published_by, published_at) values ('rate_card', 'v2', $1, 'published', $2, $2, now()) returning id`, [randomUUID(), actor.id]);
    const packageRow = await pool!.query<{ id: string }>(`insert into sales_packages (package_code, name) values ($1, 'IRIS Package') returning id`, [packageCode]);
    const version = await pool!.query<{ id: string }>(`insert into rate_card_versions (version_code, status, import_job_id, uploaded_by) values ($1, 'current', $2, $3) returning id`, [`RC-${randomUUID()}`, rateCardJob.rows[0].id, actor.id]);
    await pool!.query(`insert into rate_card_building_prices (rate_card_version_id, building_id, price_idr) values ($1, $2, $3)`, [version.rows[0].id, resolvedRateCard.buildingPrices[0].buildingId, resolvedRateCard.buildingPrices[0].priceIdr]);
    await pool!.query(`insert into rate_card_package_configs (rate_card_version_id, package_id, price_idr) values ($1, $2, 1500000)`, [version.rows[0].id, packageRow.rows[0].id]);
    await pool!.query(`insert into rate_card_package_buildings (rate_card_version_id, package_id, building_id) values ($1, $2, $3)`, [version.rows[0].id, packageRow.rows[0].id, resolvedRateCard.packageMemberships[0].buildingId]);
    await pool!.query(`update rate_card_versions set published_by = $2, published_at = now() where id = $1`, [version.rows[0].id, actor.id]);

    const linked = await parseImportFiles("building", [buildingFile(irisBuildingId, erpBuildingId)]);
    snapshot = await nativeBuildingSnapshot(irisBuildingId);
    expect(validateBuildingRows(linked.rows, snapshot.validation)).toEqual([]);
    const linkJobId = await publishNativeBuilding(actor, linked, calculateBuildingDiff(linked.rows, snapshot.diff));
    snapshot = await nativeBuildingSnapshot(irisBuildingId);
    expect(snapshot.validation.buildings[0]).toMatchObject({ id: buildingId, erpBuildingId });

    const inactive = await parseImportFiles("building", [buildingFile(irisBuildingId, erpBuildingId, "inactive")]);
    const deactivateJobId = await publishNativeBuilding(actor, inactive, calculateBuildingDiff(inactive.rows, snapshot.diff));
    snapshot = await nativeBuildingSnapshot(irisBuildingId);
    const rejected = await parseImportFiles("rate_card", rateCardFiles(irisBuildingId, packageCode));
    expect(() => resolveRateCardBuildingReferences(rejected, snapshot.validation))
      .toThrow(RateCardBuildingResolutionError);
    expect(validateRateCardBuildings(rejected, snapshot.validation).map((error) => error.key)).toEqual(["import.error.building_inactive", "import.error.building_inactive"]);

    const history = await pool!.query<{ price_building_id: string; package_building_id: string; status: string }>(`select price.building_id as price_building_id, member.building_id as package_building_id, version.status from rate_card_versions version join rate_card_building_prices price on price.rate_card_version_id = version.id join rate_card_package_buildings member on member.rate_card_version_id = version.id where version.id = $1`, [version.rows[0].id]);
    expect(history.rows).toEqual([{ price_building_id: buildingId, package_building_id: buildingId, status: "current" }]);
    const audits = await pool!.query<{ import_job_id: string; entity_id: string }>(`select import_job_id, entity_id from audit_events where import_job_id in ($1, $2) order by import_job_id`, [linkJobId, deactivateJobId]);
    expect(audits.rows).toHaveLength(2);
    expect(audits.rows.every((row) => row.entity_id === buildingId)).toBe(true);
  });
});
