import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

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
import type { SessionUser } from "@/lib/auth/session";
import { getImportJobDetail } from "@/lib/imports/admin-read-model";
import { createImportJob } from "@/lib/imports/create-job";
import {
  processImport,
  type ImportProcessingRepository,
  type ProcessImportDependencies,
} from "@/lib/imports/process-import";
import { PostgresImportProcessingRepository } from "@/lib/imports/processing-repository";
import { PostgresImportJobRepository } from "@/lib/imports/repository";
import { S3ObjectStore } from "@/lib/storage/s3-object-store";

const ROW_COUNT = 5_000;
const DEADLINE_MS = 60_000;
const HEADER = "IRIS Building ID,ERP Building ID,Building Name,Building Type,Grade Resource,Area,City,CBD Area,Sub-District,Address,Operational Status,Data Source";

function fixture() {
  const rows = Array.from({ length: ROW_COUNT }, (_, offset) => {
    const number = offset + 1;
    const padded = String(number).padStart(6, "0");
    const erpBuildingId = number % 3 === 0 ? "" : `ERP-${padded}`;
    return `B${padded},${erpBuildingId},Building ${padded},Office,Grade A,Jakarta,Jakarta,CBD,Setiabudi,Address ${padded},active,building_team`;
  });
  return new TextEncoder().encode([HEADER, ...rows].join("\n"));
}

describe("in-memory representative Building import microbenchmark", () => {
  test("processes exactly 5,000 rows to ready-to-publish within 60 seconds", async () => {
    const body = fixture();
    let completedRows = 0;
    let completedChanges = 0;
    const repository: ImportProcessingRepository = {
      claim: async () => ({
        kind: "claimed",
        job: {
          id: "performance-job",
          dataType: "building",
          templateVersion: "TMN-IMPORT-2",
          claimToken: new Date().toISOString(),
          files: [{
            objectStorageKey: "imports/performance/buildings.csv",
            originalFilename: "buildings-5000.csv",
            checksum: "performance-checksum",
          }],
        },
      }),
      buildingSnapshot: async () => ({
        buildings: [],
        controlledValues: { buildingTypes: ["Office"], gradeResources: ["Grade A"] },
      }),
      packageSnapshot: async () => ({ packages: [] }),
      loadRateCardSnapshot: async () => ({
        buildings: [],
        controlledValues: { buildingTypes: [], gradeResources: [] },
        packages: [],
        versionId: null,
        buildingPrices: new Map(),
        packagePrices: new Map(),
        packageMemberships: [],
      }),
      completeBuilding: async (_jobId, _claimToken, normalized, changes) => {
        completedRows = normalized.rows.length;
        completedChanges = changes.length;
      },
      completePackage: async () => { throw new Error("unexpected package completion"); },
      completeRateCard: async () => { throw new Error("unexpected Rate Card completion"); },
      fail: async () => { throw new Error("unexpected validation failure"); },
      processingFailure: async () => { throw new Error("unexpected processing failure"); },
    };
    const dependencies: ProcessImportDependencies = {
      repository,
      objectStore: { readImmutable: async () => body },
    };
    const actor: SessionUser = {
      id: "performance-user",
      email: "performance@example.test",
      displayName: "Performance User",
      status: "active",
      permissions: ["data.import.building"],
    };

    const startedAt = performance.now();
    const result = await processImport("performance-job", actor, dependencies);
    const elapsedMs = performance.now() - startedAt;

    expect(result).toEqual({ jobId: "performance-job", state: "ready_to_publish" });
    expect(completedRows).toBe(ROW_COUNT);
    expect(completedChanges).toBe(ROW_COUNT);
    expect(elapsedMs).toBeLessThan(DEADLINE_MS);
    console.info(JSON.stringify({
      rows: completedRows,
      state: result.state,
      totalMs: Number(elapsedMs.toFixed(2)),
    }));
  }, 70_000);
});

const connectionString = process.env.DATABASE_URL;
const endpoint = process.env.MINIO_SMOKE_ENDPOINT;
const accessKeyId = process.env.MINIO_SMOKE_ACCESS_KEY_ID;
const secretAccessKey = process.env.MINIO_SMOKE_SECRET_ACCESS_KEY;
const servicesConfigured = Boolean(connectionString && endpoint && accessKeyId && secretAccessKey);
const pool = servicesConfigured ? new Pool({ connectionString, max: 4 }) : null;
const bucket = `quotation-import-perf-${randomUUID()}`;
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

async function emptyAndDeleteBucket(): Promise<void> {
  if (!s3Client) return;
  let continuationToken: string | undefined;
  do {
    const page = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
    }));
    const objects = (page.Contents ?? []).flatMap((item) => item.Key ? [{ Key: item.Key }] : []);
    if (objects.length > 0) {
      await s3Client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: objects },
      }));
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  await s3Client.send(new DeleteBucketCommand({ Bucket: bucket }));
}

describe.skipIf(!servicesConfigured)("native PostgreSQL/MinIO 5,000-row Building acceptance", () => {
  let bucketCreated = false;

  beforeAll(async () => {
    await s3Client!.send(new CreateBucketCommand({ Bucket: bucket }));
    bucketCreated = true;
  });

  afterAll(async () => {
    await closeDb();
    await pool?.end();
    if (bucketCreated) await emptyAndDeleteBucket();
    s3Client?.destroy();
  });

  test("persists and reloads exactly 5,000 preview rows and changes within 60 seconds", async () => {
    const actorId = randomUUID();
    const actor: SessionUser = {
      id: actorId,
      email: `performance-${actorId}@example.test`,
      displayName: "Native Performance User",
      status: "active",
      permissions: ["data.import.building", "data.audit.read"],
    };
    await pool!.query(
      `insert into users (id, email, password_hash, display_name, status)
       values ($1, $2, 'test-only-hash', $3, 'active')`,
      [actor.id, actor.email, actor.displayName],
    );
    await pool!.query(
      `insert into user_permissions (user_id, permission_key)
       values ($1, 'data.import.building'), ($1, 'data.audit.read')`,
      [actor.id],
    );
    await pool!.query(`
      insert into building_controlled_values (field, value, status)
      values ('building_type', 'Office', 'active'), ('grade_resource', 'Grade A', 'active')
      on conflict (field, value) do update set status = 'active'
    `);

    const body = fixture();
    const startedAt = performance.now();
    const uploaded = await createImportJob({
      dataType: "building",
      templateVersion: "TMN-IMPORT-2",
      files: [{ filename: "buildings-5000.csv", mimeType: "text/csv", body }],
    }, actor, {
      repository: new PostgresImportJobRepository(),
      objectStore: objectStore!,
      now: () => new Date(),
      randomUUID,
    });
    const result = await processImport(uploaded.jobId, actor, {
      repository: new PostgresImportProcessingRepository(),
      objectStore: objectStore!,
    });
    const elapsedMs = performance.now() - startedAt;

    expect(result).toEqual({ jobId: uploaded.jobId, state: "ready_to_publish" });
    expect(elapsedMs).toBeLessThan(DEADLINE_MS);
    const persisted = await pool!.query<{
      state: string;
      total_rows: number;
      valid_rows: number;
      invalid_rows: number;
      normalized_rows: number;
      changes: number;
      files: number;
    }>(`
      select job.state, job.total_rows, job.valid_rows, job.invalid_rows,
        jsonb_array_length(job.normalized_payload -> 'rows')::int normalized_rows,
        (select count(*)::int from import_changes where import_job_id = job.id) changes,
        (select count(*)::int from import_files where import_job_id = job.id) files
      from import_jobs job where job.id = $1
    `, [uploaded.jobId]);
    expect(persisted.rows).toEqual([{
      state: "ready_to_publish",
      total_rows: ROW_COUNT,
      valid_rows: ROW_COUNT,
      invalid_rows: 0,
      normalized_rows: ROW_COUNT,
      changes: ROW_COUNT,
      files: 1,
    }]);

    await closeDb();
    const reloaded = await getImportJobDetail(actor, uploaded.jobId);
    expect(reloaded).toMatchObject({
      id: uploaded.jobId,
      state: "ready_to_publish",
      totalRows: ROW_COUNT,
      validRows: ROW_COUNT,
      invalidRows: 0,
    });
    expect(reloaded.changes).toHaveLength(ROW_COUNT);
    expect(reloaded.files).toHaveLength(1);
    console.info(JSON.stringify({
      infrastructure: "postgresql+minio",
      rows: reloaded.totalRows,
      changes: reloaded.changes.length,
      state: reloaded.state,
      totalMs: Number(elapsedMs.toFixed(2)),
    }));
  }, 70_000);
});
