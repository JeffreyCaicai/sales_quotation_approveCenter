import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { closeDb } from "@/db";
import { permissions } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";
import {
  getImportFileDownload,
  listImportJobs,
  listRateCardVersions,
} from "@/lib/imports/admin-read-model";
import type { ActiveImportDataType, PreparedUploadFile } from "@/lib/imports/contracts";
import { createImportJob } from "@/lib/imports/create-job";
import { processImport, reprocessImport } from "@/lib/imports/process-import";
import { PostgresImportProcessingRepository } from "@/lib/imports/processing-repository";
import { publishImport } from "@/lib/imports/publish";
import { PostgresImportJobRepository } from "@/lib/imports/repository";
import { S3ObjectStore } from "@/lib/storage/s3-object-store";

const connectionString = process.env.DATABASE_URL;
const endpoint = process.env.MINIO_SMOKE_ENDPOINT;
const accessKeyId = process.env.MINIO_SMOKE_ACCESS_KEY_ID;
const secretAccessKey = process.env.MINIO_SMOKE_SECRET_ACCESS_KEY;
const servicesConfigured = Boolean(connectionString && endpoint && accessKeyId && secretAccessKey);
const pool = servicesConfigured ? new Pool({ connectionString, max: 4 }) : null;
const bucket = `quotation-import-lifecycle-${randomUUID()}`;
const s3Client = servicesConfigured ? new S3Client({
  endpoint,
  region: "us-east-1",
  forcePathStyle: true,
  credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
}) : null;
const objectStore = servicesConfigured ? new S3ObjectStore({
  endpoint: endpoint!,
  region: "us-east-1",
  bucket,
  accessKeyId: accessKeyId!,
  secretAccessKey: secretAccessKey!,
}) : null;
const fixtureRoot = join(process.cwd(), "tests", "fixtures", "imports", "v2");

function database(): Pool {
  if (!pool) throw new Error("native PostgreSQL lifecycle requires DATABASE_URL");
  return pool;
}

async function csvFixture(relativePath: string): Promise<PreparedUploadFile> {
  return {
    filename: relativePath.split("/").at(-1)!,
    mimeType: "text/csv",
    body: new Uint8Array(await readFile(join(fixtureRoot, relativePath))),
  };
}

async function uploadProcess(
  dataType: ActiveImportDataType,
  files: PreparedUploadFile[],
  actor: SessionUser,
): Promise<string> {
  if (!objectStore) throw new Error("native lifecycle requires MinIO");
  const uploaded = await createImportJob({
    dataType,
    templateVersion: "TMN-IMPORT-2",
    files,
  }, actor, {
    repository: new PostgresImportJobRepository(),
    objectStore,
    now: () => new Date(),
    randomUUID,
  });
  const processed = await processImport(uploaded.jobId, actor, {
    repository: new PostgresImportProcessingRepository(),
    objectStore,
  });
  expect(processed.state).toBe(dataType === "rate_card" ? "draft" : "ready_to_publish");
  return uploaded.jobId;
}

describe.skipIf(!servicesConfigured)("native PostgreSQL/MinIO import administration lifecycle", () => {
  let admin: SessionUser;
  let readOnly: SessionUser;

  beforeAll(async () => {
    await s3Client!.send(new CreateBucketCommand({ Bucket: bucket }));
    await database().query(`
      truncate table audit_events, import_changes, import_errors, import_files,
        rate_card_package_buildings, rate_card_package_configs, rate_card_building_prices,
        rate_card_versions, import_jobs, building_controlled_values, user_permissions,
        sales_packages, buildings, users restart identity cascade
    `);
    await database().query(`
      insert into building_controlled_values (field, value, status) values
        ('building_type', 'Apartment', 'active'),
        ('grade_resource', 'Grade A', 'active')
    `);
    const adminRow = (await database().query<{ id: string }>(`
      insert into users (email, password_hash, display_name, status)
      values ('acceptance-admin@example.test', 'test-only-hash', 'Acceptance Admin', 'active')
      returning id
    `)).rows[0];
    const readOnlyRow = (await database().query<{ id: string }>(`
      insert into users (email, password_hash, display_name, status)
      values ('acceptance-reader@example.test', 'test-only-hash', 'Acceptance Reader', 'active')
      returning id
    `)).rows[0];
    for (const permission of permissions) {
      await database().query(
        "insert into user_permissions (user_id, permission_key) values ($1, $2)",
        [adminRow.id, permission],
      );
    }
    admin = {
      id: adminRow.id,
      email: "acceptance-admin@example.test",
      displayName: "Acceptance Admin",
      status: "active",
      permissions: [...permissions],
    };
    readOnly = {
      id: readOnlyRow.id,
      email: "acceptance-reader@example.test",
      displayName: "Acceptance Reader",
      status: "active",
      permissions: [],
    };
  });

  afterAll(async () => {
    if (s3Client) {
      let continuationToken: string | undefined;
      do {
        const page = await s3Client.send(new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
        }));
        const objects = (page.Contents ?? []).flatMap((item) => item.Key ? [{ Key: item.Key }] : []);
        if (objects.length > 0) {
          await s3Client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects } }));
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
      await s3Client.send(new DeleteBucketCommand({ Bucket: bucket }));
      s3Client.destroy();
    }
    await closeDb();
    await pool?.end();
  });

  test("publishes Building, Package, and two complete Rate Cards with durable history and strict read-only denial", async () => {
    const buildingFile = await csvFixture("buildings-valid.csv");
    const buildingJobId = await uploadProcess("building", [buildingFile], admin);
    await expect(publishImport(buildingJobId, admin)).resolves.toMatchObject({
      state: "published",
      publishedChanges: 1,
    });

    const packageJobId = await uploadProcess("package", [await csvFixture("packages-valid.csv")], admin);
    const packagePublication = await publishImport(packageJobId, admin);
    expect(packagePublication).toMatchObject({ state: "published", publishedChanges: 2 });
    expect(packagePublication.generatedIdentifiers).toEqual([
      { rowNumber: 3, identifier: expect.stringMatching(/^PKG-[A-F0-9]{8}-0003$/u) },
    ]);

    const rateCardFiles = await Promise.all([
      "rate-card-valid/building-prices.csv",
      "rate-card-valid/metadata.csv",
      "rate-card-valid/package-buildings.csv",
      "rate-card-valid/package-prices.csv",
    ].map(csvFixture));
    const firstRateCardJobId = await uploadProcess("rate_card", rateCardFiles, admin);
    const secondFiles = rateCardFiles.map((file) => ({
      ...file,
      body: new TextEncoder().encode(
        new TextDecoder().decode(file.body)
          .replace("1000000", "1100000")
          .replace("1500000", "1600000"),
      ),
    }));
    const secondRateCardJobId = await uploadProcess("rate_card", secondFiles, admin);
    await expect(publishImport(firstRateCardJobId, admin)).resolves.toMatchObject({
      state: "published",
      publishedChanges: 4,
    });
    await expect(publishImport(secondRateCardJobId, admin)).rejects.toMatchObject({
      key: "IMPORT_CHANGE_STALE",
      status: 409,
    });
    await expect(database().query<{ state: string }>(
      "select state from import_jobs where id = $1",
      [secondRateCardJobId],
    )).resolves.toMatchObject({ rows: [{ state: "reprocess_required" }] });

    const firstCurrent = (await database().query<{ id: string }>(
      "select id from rate_card_versions where status = 'current'",
    )).rows[0];
    await expect(reprocessImport(secondRateCardJobId, admin, {
      repository: new PostgresImportProcessingRepository(),
      objectStore: objectStore!,
    })).resolves.toEqual({ jobId: secondRateCardJobId, state: "draft" });
    const refreshed = await database().query<{
      state: string;
      based_on_version_id: string;
      changes: number;
      reprocess_audits: number;
    }>(`
      select job.state,
        job.normalized_payload ->> 'basedOnVersionId' based_on_version_id,
        (select count(*)::int from import_changes where import_job_id = job.id) changes,
        (select count(*)::int from audit_events
          where import_job_id = job.id and action = 'import.job.reprocess') reprocess_audits
      from import_jobs job where job.id = $1
    `, [secondRateCardJobId]);
    expect(refreshed.rows).toEqual([{
      state: "draft",
      based_on_version_id: firstCurrent.id,
      changes: 3,
      reprocess_audits: 1,
    }]);
    await expect(publishImport(secondRateCardJobId, admin)).resolves.toMatchObject({
      state: "published",
      publishedChanges: 4,
    });

    const versions = await database().query<{
      id: string;
      status: string;
      building_price: string;
      package_price: string;
      memberships: number;
    }>(`
      select v.id, v.status,
        (select price_idr::text from rate_card_building_prices where rate_card_version_id = v.id) building_price,
        (select price_idr::text from rate_card_package_configs where rate_card_version_id = v.id) package_price,
        (select count(*)::int from rate_card_package_buildings where rate_card_version_id = v.id) memberships
      from rate_card_versions v order by v.status
    `);
    expect(versions.rows).toHaveLength(2);
    expect(versions.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "current", building_price: "1100000", package_price: "1600000", memberships: 1 }),
      expect.objectContaining({ status: "historical", building_price: "1000000", package_price: "1500000", memberships: 1 }),
    ]));

    const originalFile = (await database().query<{ id: string }>(
      "select id from import_files where import_job_id = $1 order by created_at limit 1",
      [buildingJobId],
    )).rows[0];
    await expect(createImportJob({
      dataType: "building",
      templateVersion: "TMN-IMPORT-2",
      files: [buildingFile],
    }, readOnly)).rejects.toMatchObject({ key: "PERMISSION_DENIED", status: 403 });
    await expect(publishImport(secondRateCardJobId, readOnly)).rejects.toMatchObject({
      key: "PERMISSION_DENIED",
      status: 403,
    });
    await expect(listImportJobs(readOnly, { limit: 50, offset: 0 })).rejects.toMatchObject({
      key: "PERMISSION_DENIED",
      status: 403,
    });
    await expect(getImportFileDownload(readOnly, buildingJobId, originalFile.id)).rejects.toMatchObject({
      key: "PERMISSION_DENIED",
      status: 403,
    });

    await closeDb();
    const reloadedHistory = await listImportJobs(admin, { limit: 50, offset: 0 });
    const reloadedVersions = await listRateCardVersions(admin);
    expect(reloadedHistory.filter((job) => job.state === "published")).toHaveLength(4);
    expect(reloadedHistory.map((job) => job.id)).toEqual(expect.arrayContaining([
      buildingJobId,
      packageJobId,
      firstRateCardJobId,
      secondRateCardJobId,
    ]));
    expect(reloadedVersions.map((version) => version.status)).toEqual(["current", "historical"]);
  }, 120_000);
});
