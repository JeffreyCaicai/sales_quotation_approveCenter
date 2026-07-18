import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { publishImport } from "@/lib/imports/publish";
import type { StagedRateCardImport } from "@/lib/imports/template-v2";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString, max: 6 });

interface SeedContext {
  actor: SessionUser;
  uploaderId: string;
  buildingId: string;
  packageId: string;
  irisBuildingId: string;
  packageCode: string;
}

async function seedContext(): Promise<SeedContext> {
  const suffix = randomUUID();
  const actor = (await pool.query<{ id: string }>(`
    insert into users (email, password_hash, display_name)
    values ($1, 'hash', 'Rate Publisher') returning id
  `, [`rate-${suffix}@example.test`])).rows[0];
  const uploader = (await pool.query<{ id: string }>(`
    insert into users (email, password_hash, display_name)
    values ($1, 'hash', 'Rate Uploader') returning id
  `, [`uploader-${suffix}@example.test`])).rows[0];
  await pool.query(
    "insert into user_permissions (user_id, permission_key) values ($1, 'rate_card.publish')",
    [actor.id],
  );
  const irisBuildingId = `B-${suffix}`;
  const packageCode = `P-${suffix}`;
  const building = (await pool.query<{ id: string }>(`
    insert into buildings (iris_building_id, name, building_type, grade_resource, address, status)
    values ($1, 'Tower', 'Office', 'Grade A', 'Address', 'active') returning id
  `, [irisBuildingId])).rows[0];
  const packageRow = (await pool.query<{ id: string }>(`
    insert into sales_packages (package_code, name, status)
    values ($1, 'Package', 'active') returning id
  `, [packageCode])).rows[0];
  return {
    actor: {
      id: actor.id,
      email: `rate-${suffix}@example.test`,
      displayName: "Rate Publisher",
      status: "active",
      permissions: ["rate_card.publish"],
    },
    uploaderId: uploader.id,
    buildingId: building.id,
    packageId: packageRow.id,
    irisBuildingId,
    packageCode,
  };
}

function payload(context: SeedContext, basedOnVersionId: string | null): StagedRateCardImport {
  return {
    templateVersion: "TMN-IMPORT-2",
    currency: "IDR",
    basedOnVersionId,
    buildingPrices: [{ rowNumber: 2, irisBuildingId: context.irisBuildingId, priceIdr: "100" }],
    packagePrices: [{ rowNumber: 2, packageCode: context.packageCode, priceIdr: "200" }],
    packageMemberships: [{ rowNumber: 2, packageCode: context.packageCode, irisBuildingId: context.irisBuildingId }],
  };
}

async function seedJob(
  context: SeedContext,
  normalizedPayload: StagedRateCardImport,
  options: { checksum?: string; extraPayload?: Record<string, unknown> } = {},
): Promise<string> {
  const job = (await pool.query<{ id: string }>(`
    insert into import_jobs (
      data_type, template_version, checksum, state, normalized_payload, uploaded_by
    ) values ('rate_card', 'TMN-IMPORT-2', $1, 'draft', $2, $3) returning id
  `, [
    options.checksum ?? randomUUID(),
    { ...normalizedPayload, ...options.extraPayload },
    context.uploaderId,
  ])).rows[0];
  return job.id;
}

async function seedCurrent(context: SeedContext): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const job = (await client.query<{ id: string }>(`
      insert into import_jobs (
        data_type, template_version, checksum, state, normalized_payload,
        uploaded_by, published_by, published_at
      ) values ('rate_card', 'TMN-IMPORT-2', $1, 'published', $2, $3, $4, now())
      returning id
    `, [randomUUID(), payload(context, null), context.uploaderId, context.actor.id])).rows[0];
    const version = (await client.query<{ id: string }>(`
      insert into rate_card_versions (
        version_code, currency, status, import_job_id, uploaded_by, published_at
      ) values ($1, 'IDR', 'current', $2, $3, null) returning id
    `, [`RC-BASE-${randomUUID()}`, job.id, context.uploaderId])).rows[0];
    await client.query(`
      insert into rate_card_building_prices (rate_card_version_id, building_id, price_idr)
      values ($1, $2, 90)
    `, [version.id, context.buildingId]);
    await client.query(`
      insert into rate_card_package_configs (rate_card_version_id, package_id, price_idr)
      values ($1, $2, 180)
    `, [version.id, context.packageId]);
    await client.query(`
      insert into rate_card_package_buildings (rate_card_version_id, package_id, building_id)
      values ($1, $2, $3)
    `, [version.id, context.packageId, context.buildingId]);
    await client.query(`
      update rate_card_versions
      set published_by = $2, published_at = now()
      where id = $1
    `, [version.id, context.actor.id]);
    await client.query("commit");
    return version.id;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

describe("native PostgreSQL Rate Card publication", () => {
  beforeAll(async () => {
    const result = await pool.query<{ present: string | null }>(
      "select to_regclass('public.rate_card_versions')::text as present",
    );
    if (!result.rows[0]?.present) throw new Error("Run PostgreSQL migrations before integration tests");
  });

  beforeEach(async () => {
    await pool.query(`
      truncate table audit_events, import_changes, import_errors, import_files,
        rate_card_package_buildings, rate_card_package_configs, rate_card_building_prices,
        rate_card_versions, import_jobs, user_permissions, sales_packages, buildings, users
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  test("system-generates the version code and publishes all children before finalizing Current", async () => {
    const context = await seedContext();
    const jobId = await seedJob(context, payload(context, null), {
      extraPayload: { versionCode: "FILE-SUPPLIED", effectiveDate: "2026-08-01" },
    });

    await expect(publishImport(jobId, context.actor)).resolves.toMatchObject({
      state: "published",
      publishedChanges: 4,
    });
    const suffix = jobId.replace(/-/gu, "").slice(0, 8).toUpperCase();
    const rows = await pool.query<{
      version_code: string;
      status: string;
      published_by: string;
      published_at: Date;
      state: string;
      building_prices: number;
      package_configs: number;
      memberships: number;
    }>(`
      select r.version_code, r.status, r.published_by, r.published_at, j.state,
        (select count(*)::int from rate_card_building_prices where rate_card_version_id = r.id) building_prices,
        (select count(*)::int from rate_card_package_configs where rate_card_version_id = r.id) package_configs,
        (select count(*)::int from rate_card_package_buildings where rate_card_version_id = r.id) memberships
      from rate_card_versions r
      join import_jobs j on j.id = r.import_job_id
      where r.import_job_id = $1
    `, [jobId]);
    expect(rows.rows[0]).toMatchObject({
      status: "current",
      published_by: context.actor.id,
      state: "published",
      building_prices: 1,
      package_configs: 1,
      memberships: 1,
    });
    expect(rows.rows[0].published_at).toBeInstanceOf(Date);
    expect(rows.rows[0].version_code).toMatch(new RegExp(`^RC-\\d{8}T\\d{6}Z-${suffix}$`, "u"));
    expect(rows.rows[0].version_code).not.toBe("FILE-SUPPLIED");
  });

  test("rejects null and mismatched baselines after locking the live Current row", async () => {
    const context = await seedContext();
    const nullBaselineJob = await seedJob(context, payload(context, null));
    const currentId = await seedCurrent(context);
    await expect(publishImport(nullBaselineJob, context.actor)).rejects.toMatchObject({
      key: "IMPORT_CHANGE_STALE",
      status: 409,
    });

    const mismatchedJob = await seedJob(
      context,
      payload(context, "00000000-0000-4000-8000-000000000099"),
    );
    await expect(publishImport(mismatchedJob, context.actor)).rejects.toMatchObject({
      key: "IMPORT_CHANGE_STALE",
      status: 409,
    });
    expect((await pool.query(
      "select id, status from rate_card_versions where status = 'current'",
    )).rows).toEqual([{ id: currentId, status: "current" }]);
  });

  test.each(["building", "package"] as const)(
    "marks a Rate Card reprocess-required when its live %s reference becomes inactive",
    async (reference) => {
      const context = await seedContext();
      const jobId = await seedJob(context, payload(context, null));
      if (reference === "building") {
        await pool.query("update buildings set status = 'inactive' where id = $1", [context.buildingId]);
      } else {
        await pool.query("update sales_packages set status = 'inactive' where id = $1", [context.packageId]);
      }

      await expect(publishImport(jobId, context.actor)).rejects.toMatchObject({
        key: "IMPORT_CHANGE_STALE",
        status: 409,
      });
      expect((await pool.query<{ state: string }>(
        "select state from import_jobs where id = $1",
        [jobId],
      )).rows).toEqual([{ state: "reprocess_required" }]);
      expect((await pool.query<{ action: string }>(
        "select action from audit_events where import_job_id = $1 order by action",
        [jobId],
      )).rows).toEqual([{ action: "import.job.reprocess_required" }]);
      expect((await pool.query(
        "select id from rate_card_versions where import_job_id = $1",
        [jobId],
      )).rowCount).toBe(0);
    },
  );

  test("demotes the former Current while preserving every Historical child row", async () => {
    const context = await seedContext();
    const formerId = await seedCurrent(context);
    const before = await pool.query(
      `select 'building' kind, building_id entity_id, price_idr::text value
       from rate_card_building_prices where rate_card_version_id = $1
       union all
       select 'package', package_id, price_idr::text
       from rate_card_package_configs where rate_card_version_id = $1
       union all
       select 'membership', package_id, building_id::text
       from rate_card_package_buildings where rate_card_version_id = $1
       order by kind`,
      [formerId],
    );
    const jobId = await seedJob(context, payload(context, formerId));

    await publishImport(jobId, context.actor);

    expect((await pool.query(
      "select status from rate_card_versions where id = $1",
      [formerId],
    )).rows[0].status).toBe("historical");
    expect((await pool.query(
      "select count(*)::int count from rate_card_versions where status = 'current'",
    )).rows[0].count).toBe(1);
    const after = await pool.query(
      `select 'building' kind, building_id entity_id, price_idr::text value
       from rate_card_building_prices where rate_card_version_id = $1
       union all
       select 'package', package_id, price_idr::text
       from rate_card_package_configs where rate_card_version_id = $1
       union all
       select 'membership', package_id, building_id::text
       from rate_card_package_buildings where rate_card_version_id = $1
       order by kind`,
      [formerId],
    );
    expect(after.rows).toEqual(before.rows);

    const audits = await pool.query<{ action: string; entity_id: string }>(
      "select action, entity_id from audit_events where import_job_id = $1 order by action",
      [jobId],
    );
    expect(audits.rows).toEqual(expect.arrayContaining([
      { action: "import.job.published", entity_id: jobId },
      { action: "import.rate_card.historical", entity_id: formerId },
      { action: "import.rate_card.published", entity_id: expect.any(String) },
    ]));
  });

  test("rolls back the Current switch when a child insert fails", async () => {
    const context = await seedContext();
    const formerId = await seedCurrent(context);
    const invalid = payload(context, formerId);
    invalid.buildingPrices[0].priceIdr = "1000000000000000000";
    const jobId = await seedJob(context, invalid);

    await expect(publishImport(jobId, context.actor)).rejects.toBeDefined();

    expect((await pool.query(
      "select id, status from rate_card_versions order by created_at",
    )).rows).toEqual([{ id: formerId, status: "current" }]);
    expect((await pool.query("select state from import_jobs where id = $1", [jobId])).rows[0].state)
      .toBe("draft");
    expect((await pool.query("select count(*)::int count from audit_events where import_job_id = $1", [jobId])).rows[0].count)
      .toBe(0);
  });

  test("serializes competing jobs so only one Current publication commits", async () => {
    const context = await seedContext();
    const firstJobId = await seedJob(context, payload(context, null));
    const secondJobId = await seedJob(context, payload(context, null));

    const results = await Promise.allSettled([
      publishImport(firstJobId, context.actor),
      publishImport(secondJobId, context.actor),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ key: "IMPORT_CHANGE_STALE", status: 409 }),
    });
    expect((await pool.query(
      "select count(*)::int count from rate_card_versions where status = 'current'",
    )).rows[0].count).toBe(1);
    expect((await pool.query(
      "select count(*)::int count from import_jobs where id = any($1::uuid[]) and state = 'published'",
      [[firstJobId, secondJobId]],
    )).rows[0].count).toBe(1);
    expect((await pool.query<{ state: string }>(
      "select state from import_jobs where id = any($1::uuid[]) order by state",
      [[firstJobId, secondJobId]],
    )).rows).toEqual([{ state: "published" }, { state: "reprocess_required" }]);
  });

  test("rejects a different published job with the exact checksum and replays the same job idempotently", async () => {
    const context = await seedContext();
    const checksum = "a".repeat(64);
    const firstJobId = await seedJob(context, payload(context, null), { checksum });
    const first = await publishImport(firstJobId, context.actor);
    const current = (await pool.query<{ id: string }>(
      "select id from rate_card_versions where status = 'current'",
    )).rows[0];
    const duplicateJobId = await seedJob(context, payload(context, current.id), { checksum });

    await expect(publishImport(duplicateJobId, context.actor)).rejects.toMatchObject({
      key: "IMPORT_DUPLICATE_PUBLISHED",
      status: 409,
    });
    await expect(publishImport(firstJobId, context.actor)).resolves.toEqual({
      jobId: firstJobId,
      state: "published",
      publishedChanges: 0,
    });
    expect(first).toMatchObject({ jobId: firstJobId, state: "published", publishedChanges: 4 });
    expect((await pool.query(
      "select count(*)::int count from rate_card_versions",
    )).rows[0].count).toBe(1);
    expect((await pool.query(
      "select state from import_jobs where id = $1",
      [duplicateJobId],
    )).rows[0].state).toBe("draft");
  });
});
