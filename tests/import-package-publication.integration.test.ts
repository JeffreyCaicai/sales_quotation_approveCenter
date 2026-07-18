import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { createPackageCode } from "@/lib/imports/package-code";
import type { PackageChange, PackageSnapshot } from "@/lib/imports/package-diff";
import { publishImport } from "@/lib/imports/publish";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new Pool({ connectionString, max: 4 });

async function seedActor(hasPermission = true): Promise<SessionUser> {
  const id = randomUUID();
  const email = `package-publisher-${id}@example.test`;
  await pool.query(
    `insert into users (id, email, password_hash, display_name)
     values ($1, $2, 'test-only-hash', 'Package Publisher')`,
    [id, email],
  );
  if (hasPermission) {
    await pool.query(
      `insert into user_permissions (user_id, permission_key)
       values ($1, 'data.import.package')`,
      [id],
    );
  }
  return {
    id,
    email,
    displayName: "Package Publisher",
    status: "active",
    permissions: ["data.import.package"],
  };
}

async function seedPackage(
  packageCode: string,
  packageName: string,
  status: "active" | "inactive",
): Promise<void> {
  await pool.query(
    `insert into sales_packages (package_code, name, status)
     values ($1, $2, $3)`,
    [packageCode, packageName, status],
  );
}

async function seedReadyPackageJob(
  actorId: string,
  changes: readonly PackageChange[],
  options: { jobId?: string; templateVersion?: string } = {},
): Promise<string> {
  const jobId = options.jobId ?? randomUUID();
  await pool.query(
    `insert into import_jobs (
       id, data_type, template_version, checksum, state, uploaded_by,
       total_rows, valid_rows
     ) values ($1, 'package', $2, $3, 'ready_to_publish', $4, $5, $5)`,
    [jobId, options.templateVersion ?? "TMN-IMPORT-2", randomUUID(), actorId, changes.length],
  );
  for (const item of changes) {
    await pool.query(
      `insert into import_changes (
         import_job_id, entity_type, change_type, before_value, after_value
       ) values ($1, 'package', $2, $3, $4)`,
      [
        jobId,
        item.changeType,
        item.before,
        { rowNumber: item.rowNumber, ...item.after },
      ],
    );
  }
  return jobId;
}

function snapshot(
  packageCode: string,
  packageName: string,
  status: "active" | "inactive",
): PackageSnapshot {
  return { packageCode, packageName, status };
}

describe("native PostgreSQL Sales Package Master publication", () => {
  beforeAll(async () => {
    const result = await pool.query<{ present: string | null }>(
      "select to_regclass('public.sales_packages')::text as present",
    );
    if (!result.rows[0]?.present) throw new Error("Run PostgreSQL migrations before integration tests");
  });

  afterAll(async () => {
    await pool.end();
  });

  test("publishes explicit changes, preserves absent packages, records generated identifiers, and replays idempotently", async () => {
    const actor = await seedActor();
    const suffix = randomUUID();
    const codeA = `PKG-A-${suffix}`;
    const codeB = `PKG-B-${suffix}`;
    const codeC = `PKG-C-${suffix}`;
    const codeD = `PKG-D-${suffix}`;
    const absentCode = `PKG-ABSENT-${suffix}`;
    await seedPackage(codeA, "Package A", "inactive");
    await seedPackage(codeB, "Package B", "active");
    await seedPackage(codeC, "Package C", "active");
    await seedPackage(absentCode, "Absent Package", "active");
    const beforeA = snapshot(codeA, "Package A", "inactive");
    const beforeB = snapshot(codeB, "Package B", "active");
    const beforeC = snapshot(codeC, "Package C", "active");
    const jobId = await seedReadyPackageJob(actor.id, [
      { rowNumber: 2, entityKey: codeA, changeType: "modified", before: beforeA, after: { ...beforeA, status: "active" } },
      { rowNumber: 3, entityKey: codeB, changeType: "deactivated", before: beforeB, after: { ...beforeB, status: "inactive" } },
      { rowNumber: 4, entityKey: codeC, changeType: "unchanged", before: beforeC, after: beforeC },
      { rowNumber: 5, entityKey: "row:5", changeType: "added", before: null, after: { packageCode: null, packageName: "Generated Package", status: "active" } },
      { rowNumber: 6, entityKey: codeD, changeType: "added", before: null, after: snapshot(codeD, "Supplied Package", "inactive") },
    ]);

    const stagedBlank = await pool.query<{ after_value: { packageCode: string | null } }>(
      `select after_value from import_changes
       where import_job_id = $1 and after_value->>'rowNumber' = '5'`,
      [jobId],
    );
    expect(stagedBlank.rows[0].after_value.packageCode).toBeNull();

    const first = await publishImport(jobId, actor);
    expect(first).toMatchObject({ jobId, state: "published", publishedChanges: 4 });
    expect(first.generatedIdentifiers).toEqual([
      { rowNumber: 5, identifier: expect.stringMatching(/^PKG-[A-F0-9]{8}-0005$/u) },
    ]);
    const generatedCode = first.generatedIdentifiers![0].identifier;

    const rows = await pool.query<{ package_code: string; name: string; status: string }>(
      `select package_code, name, status from sales_packages
       where package_code = any($1::text[]) order by package_code`,
      [[codeA, codeB, codeC, codeD, absentCode, generatedCode]],
    );
    expect(rows.rows).toEqual(expect.arrayContaining([
      { package_code: codeA, name: "Package A", status: "active" },
      { package_code: codeB, name: "Package B", status: "inactive" },
      { package_code: codeC, name: "Package C", status: "active" },
      { package_code: codeD, name: "Supplied Package", status: "inactive" },
      { package_code: absentCode, name: "Absent Package", status: "active" },
      { package_code: generatedCode, name: "Generated Package", status: "active" },
    ]));

    const audit = await pool.query<{
      action: string;
      reason: string | null;
      before_metadata: PackageSnapshot | null;
      after_metadata: PackageSnapshot;
    }>(
      `select action, reason, before_metadata, after_metadata
       from audit_events where import_job_id = $1 and entity_type = 'package'
       order by action, after_metadata->>'packageCode'`,
      [jobId],
    );
    expect(audit.rows).toHaveLength(4);
    expect(audit.rows).toContainEqual(expect.objectContaining({
      action: "import.package.added",
      reason: "generated_package_code:5",
      before_metadata: null,
      after_metadata: { packageCode: generatedCode, packageName: "Generated Package", status: "active" },
    }));
    expect(audit.rows).toContainEqual(expect.objectContaining({
      action: "import.package.modified",
      before_metadata: beforeA,
      after_metadata: { ...beforeA, status: "active" },
    }));

    await expect(publishImport(jobId, actor)).resolves.toEqual({
      jobId,
      state: "published",
      publishedChanges: 0,
      generatedIdentifiers: [{ rowNumber: 5, identifier: generatedCode }],
    });
    expect((await pool.query(
      `select count(*)::int count from sales_packages where package_code = $1`,
      [generatedCode],
    )).rows[0].count).toBe(1);
    expect((await pool.query(
      `select count(*)::int count from audit_events where import_job_id = $1 and entity_type = 'package'`,
      [jobId],
    )).rows[0].count).toBe(4);
  });

  test("rolls back the entire batch when one stored before snapshot is stale", async () => {
    const actor = await seedActor();
    const suffix = randomUUID();
    const staleCode = `PKG-STALE-${suffix}`;
    const addedCode = `PKG-ROLLBACK-${suffix}`;
    await seedPackage(staleCode, "Live Package Name", "active");
    const stagedBefore = snapshot(staleCode, "Staged Package Name", "active");
    const jobId = await seedReadyPackageJob(actor.id, [
      { rowNumber: 2, entityKey: addedCode, changeType: "added", before: null, after: snapshot(addedCode, "Must Roll Back", "active") },
      { rowNumber: 3, entityKey: staleCode, changeType: "deactivated", before: stagedBefore, after: { ...stagedBefore, status: "inactive" } },
    ]);

    await expect(publishImport(jobId, actor)).rejects.toMatchObject({ key: "IMPORT_CHANGE_STALE" });
    expect((await pool.query("select id from sales_packages where package_code = $1", [addedCode])).rowCount).toBe(0);
    expect((await pool.query("select state from import_jobs where id = $1", [jobId])).rows[0].state).toBe("ready_to_publish");
    expect((await pool.query("select id from audit_events where import_job_id = $1", [jobId])).rowCount).toBe(0);
  });

  test("rechecks the package permission server-side and rejects non-V2 jobs", async () => {
    const unauthorized = await seedActor(false);
    const unauthorizedJobId = await seedReadyPackageJob(unauthorized.id, []);
    await expect(publishImport(unauthorizedJobId, unauthorized)).rejects.toMatchObject({
      key: "PERMISSION_DENIED",
      status: 403,
    });

    const actor = await seedActor();
    const oldJobId = await seedReadyPackageJob(actor.id, [], { templateVersion: "v2" });
    await expect(publishImport(oldJobId, actor)).rejects.toMatchObject({ key: "IMPORT_CHANGE_INVALID" });
    expect((await pool.query("select state from import_jobs where id = $1", [oldJobId])).rows[0].state).toBe("ready_to_publish");
  });

  test("rejects generated-code collisions without publishing any row", async () => {
    const actor = await seedActor();
    const jobId = randomUUID();
    const generatedCode = createPackageCode(jobId, 5);
    await seedPackage(generatedCode, "Collision Owner", "active");
    await seedReadyPackageJob(actor.id, [{
      rowNumber: 5,
      entityKey: "row:5",
      changeType: "added",
      before: null,
      after: { packageCode: null, packageName: "Must Not Publish", status: "active" },
    }], { jobId });

    await expect(publishImport(jobId, actor)).rejects.toMatchObject({ key: "IMPORT_CHANGE_STALE" });
    expect((await pool.query("select count(*)::int count from sales_packages where package_code = $1", [generatedCode])).rows[0].count).toBe(1);
    expect((await pool.query("select id from audit_events where import_job_id = $1", [jobId])).rowCount).toBe(0);
    expect((await pool.query("select state from import_jobs where id = $1", [jobId])).rows[0].state).toBe("ready_to_publish");
  });
});
