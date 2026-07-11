import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { ImportChange, NormalizedBuilding } from "@/lib/imports/diff";
import { publishImport } from "@/lib/imports/publish";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString, max: 4 });

function building(
  irisBuildingId: string,
  overrides: Partial<NormalizedBuilding> = {},
): NormalizedBuilding {
  return {
    irisBuildingId,
    erpBuildingId: null,
    buildingName: "Apartment 19th Avenue",
    buildingType: "Apartment",
    gradeResource: "A",
    area: "Tangerang",
    city: "Tangerang",
    cbdArea: null,
    subDistrict: "Pinang",
    address: "Jl. Boulevard 19",
    operationalStatus: "active",
    dataSource: "building_team",
    ...overrides,
  };
}

async function seedPublisher() {
  const id = randomUUID();
  await pool.query(
    `insert into users (id, email, password_hash, display_name)
     values ($1, $2, 'test-only-hash', 'Publication Tester')`,
    [id, `${id}@example.test`],
  );
  await pool.query(
    `insert into user_permissions (user_id, permission_key)
     values ($1, 'data.import.building')`,
    [id],
  );
  return {
    id,
    email: `${id}@example.test`,
    displayName: "Publication Tester",
    status: "active" as const,
    permissions: ["data.import.building" as const],
  };
}

async function seedReadyBuildingJob(
  actorId: string,
  changes: readonly ImportChange[],
) {
  const jobId = randomUUID();
  await pool.query(
    `insert into import_jobs (
       id, data_type, template_version, checksum, state, uploaded_by,
       total_rows, valid_rows
     ) values ($1, 'building', 'v2', $2, 'ready_to_publish', $3, $4, $4)`,
    [jobId, randomUUID(), actorId, changes.length],
  );
  for (const change of changes) {
    await pool.query(
      `insert into import_changes (
         import_job_id, entity_type, entity_id, change_type,
         before_value, after_value
       ) values ($1, 'building', $2, $3, $4, $5)`,
      [
        jobId,
        change.before?.id ?? null,
        change.type,
        change.before,
        change.after,
      ],
    );
  }
  return jobId;
}

describe("IRIS-keyed building publication", () => {
  beforeAll(async () => {
    const result = await pool.query<{ present: string | null }>(
      "select to_regclass('public.import_changes')::text as present",
    );
    if (!result.rows[0]?.present) {
      throw new Error("Run PostgreSQL migrations before integration tests");
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  test("adds an ERP mapping without replacing the building UUID or Rate Card foreign key", async () => {
    const actor = await seedPublisher();
    const initialImportId = randomUUID();
    await pool.query(
      `insert into import_jobs (
         id, data_type, template_version, checksum, state, uploaded_by,
         published_by, published_at
       ) values ($1, 'building', 'v2', $2, 'published', $3, $3, now())`,
      [initialImportId, randomUUID(), actor.id],
    );
    const seeded = await pool.query<{ id: string }>(
      `insert into buildings (
         iris_building_id, erp_building_id, name, building_type,
         grade_resource, area, city, cbd_area, sub_district, address,
         erp_link_status, data_source, status, source_import_job_id
       ) values (
         'B003004', null, 'Apartment 19th Avenue', 'Apartment',
         'A', 'Tangerang', 'Tangerang', null, 'Pinang', 'Jl. Boulevard 19',
         'manual_only', 'building_team', 'active', $1
       ) on conflict (iris_building_id) do update set
         erp_building_id = null,
         name = excluded.name,
         building_type = excluded.building_type,
         grade_resource = excluded.grade_resource,
         area = excluded.area,
         city = excluded.city,
         cbd_area = excluded.cbd_area,
         sub_district = excluded.sub_district,
         address = excluded.address,
         data_source = excluded.data_source,
         status = excluded.status,
         source_import_job_id = excluded.source_import_job_id
       returning id`,
      [initialImportId],
    );
    const buildingId = seeded.rows[0].id;

    const rateCardImportId = randomUUID();
    await pool.query(
      `insert into import_jobs (
         id, data_type, template_version, checksum, state, uploaded_by
       ) values ($1, 'rate_card', 'v1', $2, 'draft', $3)`,
      [rateCardImportId, randomUUID(), actor.id],
    );
    const version = await pool.query<{ id: string }>(
      `insert into rate_card_versions (
         version_code, effective_at, import_job_id, uploaded_by
       ) values ($1, now() + interval '1 day', $2, $3)
       returning id`,
      [`RC-${randomUUID()}`, rateCardImportId, actor.id],
    );
    await pool.query(
      `insert into rate_card_building_prices (
         rate_card_version_id, building_id, price_idr
       ) values ($1, $2, 1000000)`,
      [version.rows[0].id, buildingId],
    );
    await pool.query(
      `update rate_card_versions
       set status = 'published', published_by = $2, published_at = now()
       where id = $1`,
      [version.rows[0].id, actor.id],
    );

    const before = { id: buildingId, ...building("B003004") };
    const after = building("B003004", { erpBuildingId: " ERP-89321 " });
    const jobId = await seedReadyBuildingJob(actor.id, [{
      type: "modified",
      entityKey: "B003004",
      before,
      after,
    }]);

    await expect(publishImport(jobId, actor)).resolves.toEqual({
      jobId,
      state: "published",
      publishedChanges: 1,
    });

    const current = await pool.query<{
      id: string;
      erp_building_id: string | null;
      erp_link_status: string;
      source_import_job_id: string;
    }>(
      `select id, erp_building_id, erp_link_status, source_import_job_id
       from buildings where iris_building_id = 'B003004'`,
    );
    expect(current.rows).toEqual([{
      id: buildingId,
      erp_building_id: "ERP-89321",
      erp_link_status: "erp_linked",
      source_import_job_id: jobId,
    }]);

    const reference = await pool.query<{ building_id: string; status: string }>(
      `select price.building_id, version.status
       from rate_card_building_prices price
       join rate_card_versions version on version.id = price.rate_card_version_id
       where price.rate_card_version_id = $1`,
      [version.rows[0].id],
    );
    expect(reference.rows).toEqual([{
      building_id: buildingId,
      status: "published",
    }]);

    const audit = await pool.query<{
      entity_id: string;
      before_metadata: NormalizedBuilding & { id: string };
      after_metadata: NormalizedBuilding;
    }>(
      `select entity_id, before_metadata, after_metadata
       from audit_events
       where import_job_id = $1 and entity_type = 'building'`,
      [jobId],
    );
    expect(audit.rows).toEqual([{
      entity_id: buildingId,
      before_metadata: before,
      after_metadata: { ...after, erpBuildingId: "ERP-89321" },
    }]);
  });

  test("rolls back every building and audit write when an ERP mapping conflicts", async () => {
    const actor = await seedPublisher();
    const suffix = randomUUID();
    const ownerIrisId = `OWNER-${suffix}`;
    const targetIrisId = `TARGET-${suffix}`;
    const addedIrisId = `ADDED-${suffix}`;
    const erpId = `ERP-${suffix}`;
    const seeded = await pool.query<{ id: string; iris_building_id: string }>(
      `insert into buildings (
         iris_building_id, erp_building_id, name, address, erp_link_status
       ) values
         ($1, $3, 'ERP Owner', 'Jakarta', 'erp_linked'),
         ($2, null, 'Target', 'Jakarta', 'manual_only')
       returning id, iris_building_id`,
      [ownerIrisId, targetIrisId, erpId],
    );
    const target = seeded.rows.find((row) => row.iris_building_id === targetIrisId)!;
    const targetBefore = {
      id: target.id,
      ...building(targetIrisId, {
        buildingName: "Target",
        buildingType: null,
        gradeResource: null,
        area: null,
        city: null,
        cbdArea: null,
        subDistrict: null,
        address: "Jakarta",
      }),
    };
    const changes: ImportChange[] = [
      {
        type: "added",
        entityKey: addedIrisId,
        before: null,
        after: building(addedIrisId, { buildingName: "Must Roll Back" }),
      },
      {
        type: "modified",
        entityKey: targetIrisId,
        before: targetBefore,
        after: { ...targetBefore, erpBuildingId: erpId },
      },
    ];
    const jobId = await seedReadyBuildingJob(actor.id, changes);

    await expect(publishImport(jobId, actor)).rejects.toThrow(/erp_building_id/i);

    const rolledBackBuilding = await pool.query(
      "select id from buildings where iris_building_id = $1",
      [addedIrisId],
    );
    expect(rolledBackBuilding.rowCount).toBe(0);
    const targetAfter = await pool.query<{
      erp_building_id: string | null;
      erp_link_status: string;
    }>(
      `select erp_building_id, erp_link_status from buildings
       where iris_building_id = $1`,
      [targetIrisId],
    );
    expect(targetAfter.rows).toEqual([{
      erp_building_id: null,
      erp_link_status: "manual_only",
    }]);
    const audit = await pool.query(
      "select id from audit_events where import_job_id = $1",
      [jobId],
    );
    expect(audit.rowCount).toBe(0);
    const job = await pool.query<{ state: string; published_by: string | null }>(
      "select state, published_by from import_jobs where id = $1",
      [jobId],
    );
    expect(job.rows).toEqual([{
      state: "ready_to_publish",
      published_by: null,
    }]);
  });

  test("rejects a stale complete before snapshot and publishes no rows", async () => {
    const actor = await seedPublisher();
    const suffix = randomUUID();
    const staleIrisId = `STALE-${suffix}`;
    const addedIrisId = `STALE-ADDED-${suffix}`;
    const seeded = await pool.query<{ id: string }>(
      `insert into buildings (
         iris_building_id, name, building_type, grade_resource, area, city,
         cbd_area, sub_district, address, data_source, status
       ) values (
         $1, 'Live New Name', 'Office', 'A', 'Central', 'Jakarta',
         'CBD', 'Setiabudi', 'Live Address', 'building_team', 'active'
       ) returning id`,
      [staleIrisId],
    );
    const staleBefore = {
      id: seeded.rows[0].id,
      ...building(staleIrisId, {
        buildingName: "Staged Old Name",
        buildingType: "Office",
        area: "Central",
        city: "Jakarta",
        cbdArea: "CBD",
        subDistrict: "Setiabudi",
        address: "Live Address",
      }),
    };
    const jobId = await seedReadyBuildingJob(actor.id, [
      {
        type: "added",
        entityKey: addedIrisId,
        before: null,
        after: building(addedIrisId),
      },
      {
        type: "modified",
        entityKey: staleIrisId,
        before: staleBefore,
        after: { ...staleBefore, city: "Bandung" },
      },
    ]);

    await expect(publishImport(jobId, actor)).rejects.toMatchObject({
      key: "IMPORT_CHANGE_STALE",
    });

    const added = await pool.query(
      "select id from buildings where iris_building_id = $1",
      [addedIrisId],
    );
    expect(added.rowCount).toBe(0);
    const live = await pool.query<{ name: string; city: string }>(
      "select name, city from buildings where iris_building_id = $1",
      [staleIrisId],
    );
    expect(live.rows).toEqual([{ name: "Live New Name", city: "Jakarta" }]);
    const audit = await pool.query(
      "select id from audit_events where import_job_id = $1",
      [jobId],
    );
    expect(audit.rowCount).toBe(0);
    const job = await pool.query<{ state: string; published_by: string | null }>(
      "select state, published_by from import_jobs where id = $1",
      [jobId],
    );
    expect(job.rows).toEqual([{
      state: "ready_to_publish",
      published_by: null,
    }]);
  });
});
