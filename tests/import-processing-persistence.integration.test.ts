import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { closeDb } from "@/db";
import type { SessionUser } from "@/lib/auth/session";
import type { ImportValidationError } from "@/lib/imports/errors";
import { PostgresImportProcessingRepository } from "@/lib/imports/processing-repository";
import type { RateCardChange } from "@/lib/imports/rate-card-diff";
import type { StagedRateCardImport } from "@/lib/imports/template-v2";

const connectionString = process.env.DATABASE_URL;
const pool = connectionString ? new Pool({ connectionString, max: 3 }) : null;

async function seedValidatingJob(dataType: "building" | "rate_card") {
  const userId = randomUUID();
  const jobId = randomUUID();
  const claimTime = new Date();
  await pool!.query(
    `insert into users (id, email, password_hash, display_name)
     values ($1, $2, 'test-only-hash', 'Persistence Tester')`,
    [userId, `${userId}@example.test`],
  );
  const permission = dataType === "building" ? "data.import.building" : "rate_card.upload";
  await pool!.query(
    "insert into user_permissions (user_id, permission_key) values ($1, $2)",
    [userId, permission],
  );
  await pool!.query(
    `insert into import_jobs (
       id, data_type, template_version, checksum, state, uploaded_by, updated_at
     ) values ($1, $2, 'TMN-IMPORT-2', $3, 'validating', $4, $5)`,
    [jobId, dataType, randomUUID(), userId, claimTime],
  );
  const actor: SessionUser = {
    id: userId,
    email: `${userId}@example.test`,
    displayName: "Persistence Tester",
    status: "active",
    permissions: [permission],
  };
  return { actor, jobId, claimToken: claimTime.toISOString() };
}

describe.skipIf(!connectionString)("native PostgreSQL worst-case processing persistence", () => {
  beforeAll(async () => {
    const result = await pool!.query<{ present: string | null }>(
      "select to_regclass('public.import_changes')::text as present",
    );
    if (!result.rows[0]?.present) {
      throw new Error("Run PostgreSQL migrations before integration tests");
    }
  });

  afterAll(async () => {
    await closeDb();
    await pool?.end();
  });

  test("atomically persists 30,000 Rate Card changes below the bind-parameter ceiling", async () => {
    const { jobId, claimToken } = await seedValidatingJob("rate_card");
    const rows = Array.from({ length: 10_000 }, (_, index) => index + 2);
    const normalized: StagedRateCardImport = {
      templateVersion: "TMN-IMPORT-2",
      currency: "IDR",
      basedOnVersionId: null,
      buildingPrices: rows.map((rowNumber) => ({
        rowNumber,
        irisBuildingId: `B-${rowNumber}`,
        priceIdr: "0",
      })),
      packagePrices: rows.map((rowNumber) => ({
        rowNumber,
        packageCode: `P-${rowNumber}`,
        priceIdr: "0",
      })),
      packageMemberships: rows.map((rowNumber) => ({
        rowNumber,
        packageCode: `P-${rowNumber}`,
        irisBuildingId: `B-${rowNumber}`,
      })),
    };
    const changes: RateCardChange[] = Array.from({ length: 30_000 }, (_, index) => ({
      entityKey: `building:B-${index}`,
      changeType: "added",
      before: null,
      after: { kind: "building_price", irisBuildingId: `B-${index}`, priceIdr: "0" },
    }));

    await new PostgresImportProcessingRepository().completeRateCard(
      jobId,
      claimToken,
      normalized,
      changes,
    );

    const persisted = await pool!.query<{ state: string; total_rows: number; changes: number }>(`
      select job.state, job.total_rows,
        (select count(*)::int from import_changes where import_job_id = job.id) changes
      from import_jobs job where job.id = $1
    `, [jobId]);
    expect(persisted.rows).toEqual([{
      state: "draft",
      total_rows: 30_000,
      changes: 30_000,
    }]);
  }, 120_000);

  test("atomically persists a complete 20,000-error validation report", async () => {
    const { jobId, claimToken } = await seedValidatingJob("building");
    const errors: ImportValidationError[] = Array.from({ length: 20_000 }, (_, index) => ({
      filename: "buildings.csv",
      sheet: "Data",
      rowNumber: (index % 10_000) + 2,
      column: index % 2 === 0 ? "Operational Status" : "Data Source",
      key: "import.error.value_invalid",
      params: {},
    }));

    await new PostgresImportProcessingRepository().fail(jobId, claimToken, errors);

    const persisted = await pool!.query<{
      state: string;
      invalid_rows: number;
      errors: number;
      changes: number;
    }>(`
      select job.state, job.invalid_rows,
        (select count(*)::int from import_errors where import_job_id = job.id) errors,
        (select count(*)::int from import_changes where import_job_id = job.id) changes
      from import_jobs job where job.id = $1
    `, [jobId]);
    expect(persisted.rows).toEqual([{
      state: "validation_failed",
      invalid_rows: 10_000,
      errors: 20_000,
      changes: 0,
    }]);
  }, 120_000);

  test("reclaims only a safely classified retryable processing incident and audits both transitions", async () => {
    const repository = new PostgresImportProcessingRepository();
    const retryable = await seedValidatingJob("building");
    await repository.processingFailure(
      retryable.jobId,
      retryable.claimToken,
      retryable.actor.id,
      {
        code: "IMPORT_PROCESSING_RETRYABLE",
        incidentId: "00000000-0000-4000-8000-000000000901",
        retryable: true,
      },
    );

    await expect(repository.claim(retryable.jobId, retryable.actor, new Date()))
      .resolves.toMatchObject({
        kind: "claimed",
        job: { id: retryable.jobId, dataType: "building" },
      });
    const retryableState = await pool!.query<{ state: string; failure_summary: string | null }>(
      "select state, failure_summary from import_jobs where id = $1",
      [retryable.jobId],
    );
    expect(retryableState.rows).toEqual([{ state: "validating", failure_summary: null }]);
    const retryableAudits = await pool!.query<{ action: string }>(
      "select action from audit_events where import_job_id = $1 order by created_at, action",
      [retryable.jobId],
    );
    expect(retryableAudits.rows.map((row) => row.action).sort()).toEqual([
      "import.job.processing_failed",
      "import.job.processing_retry",
    ]);

    const terminal = await seedValidatingJob("building");
    await repository.processingFailure(
      terminal.jobId,
      terminal.claimToken,
      terminal.actor.id,
      {
        code: "IMPORT_PROCESSING_TERMINAL",
        incidentId: "00000000-0000-4000-8000-000000000902",
        retryable: false,
      },
    );
    await expect(repository.claim(terminal.jobId, terminal.actor, new Date()))
      .resolves.toEqual({ kind: "terminal", state: "processing_failed" });
    expect((await pool!.query<{ action: string }>(
      "select action from audit_events where import_job_id = $1 order by created_at, action",
      [terminal.jobId],
    )).rows).toEqual([{ action: "import.job.processing_failed" }]);
  });
});
