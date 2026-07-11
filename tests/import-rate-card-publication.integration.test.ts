import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { publishImport } from "@/lib/imports/publish";
import type { RateCardImport } from "@/lib/imports/template-v2";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString, max: 5 });

async function seed(status: "active" | "inactive" = "active") {
  const suffix = randomUUID();
  const actor = (await pool.query<{ id: string }>(`
    insert into users (email, password_hash, display_name) values ($1, 'hash', 'Rate Publisher') returning id
  `, [`rate-${suffix}@example.test`])).rows[0];
  const uploader = (await pool.query<{ id: string }>(`
    insert into users (email, password_hash, display_name) values ($1, 'hash', 'Rate Uploader') returning id
  `, [`uploader-${suffix}@example.test`])).rows[0];
  await pool.query(`insert into user_permissions (user_id, permission_key) values ($1, 'rate_card.publish')`, [actor.id]);
  const building = (await pool.query<{ id: string }>(`
    insert into buildings (iris_building_id, name, building_type, grade_resource, address, status)
    values ($1, 'Tower', 'Office', 'Grade A', 'Address', $2) returning id
  `, [`B-${suffix}`, status])).rows[0];
  const packageRow = (await pool.query<{ id: string }>(`
    insert into sales_packages (package_code, name) values ($1, 'Package') returning id
  `, [`P-${suffix}`])).rows[0];
  const payload: RateCardImport = {
    templateVersion: "TMN-IMPORT-2", versionCode: `RC-${suffix}`, effectiveDate: "2026-08-01", currency: "IDR",
    buildingPrices: [{ rowNumber: 2, irisBuildingId: `B-${suffix}`, priceIdr: "100" }],
    packagePrices: [{ rowNumber: 2, packageCode: `P-${suffix}`, priceIdr: "200" }],
    packageBuildings: [{ rowNumber: 2, packageCode: `P-${suffix}`, irisBuildingId: `B-${suffix}` }],
  };
  const job = (await pool.query<{ id: string }>(`
    insert into import_jobs (data_type, template_version, checksum, state, normalized_payload, uploaded_by)
    values ('rate_card', 'TMN-IMPORT-2', $1, 'draft', $2, $3) returning id
  `, [randomUUID(), payload, uploader.id])).rows[0];
  return {
    actor: { id: actor.id, email: `rate-${suffix}@example.test`, displayName: "Rate Publisher", status: "active" as const, permissions: ["rate_card.publish" as const] },
    uploaderId: uploader.id, buildingId: building.id, packageId: packageRow.id, jobId: job.id, versionCode: payload.versionCode,
  };
}

describe("native PostgreSQL Rate Card publication", () => {
  beforeAll(async () => {
    const result = await pool.query<{ present: string | null }>("select to_regclass('public.rate_card_versions')::text as present");
    if (!result.rows[0]?.present) throw new Error("Run PostgreSQL migrations before integration tests");
  });
  afterAll(async () => { await pool.end(); });

  test("publishes version, prices, configs, memberships, job, and audit atomically", async () => {
    const seedData = await seed();
    await expect(publishImport(seedData.jobId, seedData.actor)).resolves.toMatchObject({ state: "published", publishedChanges: 4 });
    const rows = await pool.query(`
      select r.status, r.currency, r.uploaded_by, r.published_by, r.effective_at, j.state,
        (select count(*)::int from rate_card_building_prices where rate_card_version_id = r.id) building_prices,
        (select count(*)::int from rate_card_package_configs where rate_card_version_id = r.id) package_configs,
        (select count(*)::int from rate_card_package_buildings where rate_card_version_id = r.id) memberships
      from rate_card_versions r join import_jobs j on j.id = r.import_job_id where r.import_job_id = $1
    `, [seedData.jobId]);
    expect(rows.rows[0]).toMatchObject({ status: "published", currency: "IDR", uploaded_by: seedData.uploaderId, published_by: seedData.actor.id, effective_at: new Date("2026-07-31T17:00:00.000Z"), state: "published", building_prices: 1, package_configs: 1, memberships: 1 });
  });

  test("rolls back every Rate Card row when a locked building is inactive", async () => {
    const seedData = await seed("inactive");
    await expect(publishImport(seedData.jobId, seedData.actor)).rejects.toMatchObject({ key: "IMPORT_RATE_CARD_BUILDING_REFERENCE_INVALID" });
    expect((await pool.query(`select count(*)::int count from rate_card_versions where import_job_id = $1`, [seedData.jobId])).rows[0].count).toBe(0);
    expect((await pool.query(`select state from import_jobs where id = $1`, [seedData.jobId])).rows[0].state).toBe("draft");
  });

  test("serializes concurrent retries without duplicate versions", async () => {
    const seedData = await seed();
    const results = await Promise.all([publishImport(seedData.jobId, seedData.actor), publishImport(seedData.jobId, seedData.actor)]);
    expect(results.map((item) => item.state)).toEqual(["published", "published"]);
    expect((await pool.query(`select count(*)::int count from rate_card_versions where import_job_id = $1`, [seedData.jobId])).rows[0].count).toBe(1);
  });
});
