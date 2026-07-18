import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  fromEnv: vi.fn(),
  getSignedDownloadUrl: vi.fn(),
}));

vi.mock("@/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/storage/s3-object-store", () => ({
  S3ObjectStore: {
    fromEnv: mocks.fromEnv,
  },
}));

import type { SessionUser } from "@/lib/auth/session";
import {
  AdminReadError,
  getImportAdminSummary,
  getImportFileDownload,
  getImportJobDetail,
  listImportJobs,
  listRateCardVersions,
} from "@/lib/imports/admin-read-model";

const actor: SessionUser = {
  id: "actor-1",
  email: "admin@example.com",
  displayName: "Admin",
  status: "active",
  permissions: ["data.audit.read", "data.file.download"],
};

function chainFor(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "leftJoin", "where", "groupBy", "orderBy", "limit", "offset"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function queuedDatabase(...responses: unknown[][]) {
  const queue = [...responses];
  return {
    select: vi.fn(() => chainFor(queue.shift() ?? [])),
  };
}

function authorizedRows(...permissions: string[]) {
  return permissions.map((permissionKey) => ({
    id: actor.id,
    status: "active",
    permissionKey,
  }));
}

describe("protected import administration read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fromEnv.mockReturnValue({ getSignedDownloadUrl: mocks.getSignedDownloadUrl });
  });

  test.each([
    ["summary", () => getImportAdminSummary(actor)],
    ["jobs", () => listImportJobs(actor, { limit: 25, offset: 0 })],
    ["detail", () => getImportJobDetail(actor, "job-1")],
    ["rate cards", () => listRateCardVersions(actor)],
    ["file", () => getImportFileDownload(actor, "job-1", "file-1")],
  ])("%s independently rejects session claims when the database actor is inactive", async (_name, read) => {
    const db = queuedDatabase([
      { id: actor.id, status: "inactive", permissionKey: "data.audit.read" },
      { id: actor.id, status: "inactive", permissionKey: "data.file.download" },
    ]);
    mocks.getDb.mockReturnValue(db);

    await expect(read()).rejects.toEqual(new AdminReadError(403, "PERMISSION_DENIED"));
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(mocks.fromEnv).not.toHaveBeenCalled();
  });

  test("requires the current database audit permission even when the session claims it", async () => {
    mocks.getDb.mockReturnValue(queuedDatabase([{ id: actor.id, status: "active", permissionKey: null }]));

    await expect(listImportJobs(actor, { limit: 25, offset: 0 })).rejects.toMatchObject({
      status: 403,
      key: "PERMISSION_DENIED",
    });
  });

  test("sorts jobs deterministically and returns ISO dates", async () => {
    mocks.getDb.mockReturnValue(queuedDatabase(
      authorizedRows("data.audit.read"),
      [
        {
          id: "job-old", dataType: "building", templateVersion: "TMN-IMPORT-2", state: "published",
          totalRows: 2, validRows: 2, invalidRows: 0, sourceType: "manual", failureSummary: null,
          uploadedById: "u1", uploadedByEmail: "u@example.com", uploadedByDisplayName: "Uploader",
          publishedById: null, publishedByEmail: null, publishedByDisplayName: null,
          createdAt: new Date("2026-07-17T08:00:00Z"), updatedAt: new Date("2026-07-17T09:00:00Z"), publishedAt: new Date("2026-07-17T09:00:00Z"),
        },
        {
          id: "job-new", dataType: "package", templateVersion: "TMN-IMPORT-2", state: "ready_to_publish",
          totalRows: 3, validRows: 3, invalidRows: 0, sourceType: "manual", failureSummary: null,
          uploadedById: "u1", uploadedByEmail: "u@example.com", uploadedByDisplayName: "Uploader",
          publishedById: null, publishedByEmail: null, publishedByDisplayName: null,
          createdAt: new Date("2026-07-18T08:00:00Z"), updatedAt: new Date("2026-07-18T09:00:00Z"), publishedAt: null,
        },
      ],
    ));

    const jobs = await listImportJobs(actor, { limit: 25, offset: 0 });

    expect(jobs.map((job) => job.id)).toEqual(["job-new", "job-old"]);
    expect(jobs[0].createdAt).toBe("2026-07-18T08:00:00.000Z");
    expect(jobs[1].publishedAt).toBe("2026-07-17T09:00:00.000Z");
  });

  test("summarizes entity states and deterministic job buckets", async () => {
    mocks.getDb.mockReturnValue(queuedDatabase(
      authorizedRows("data.audit.read"),
      [{ versionCode: "RC-2026-0002", publishedAt: new Date("2026-07-18T10:00:00Z") }],
      [{ status: "active", count: 4 }, { status: "inactive", count: 2 }],
      [{ status: "active", count: 3 }],
      [
        { state: "uploading", count: 1 }, { state: "uploaded", count: 2 }, { state: "validating", count: 3 },
        { state: "ready_to_publish", count: 4 }, { state: "draft", count: 5 }, { state: "validation_failed", count: 6 },
      ],
      [],
    ));

    await expect(getImportAdminSummary(actor)).resolves.toMatchObject({
      currentRateCard: { versionCode: "RC-2026-0002", publishedAt: "2026-07-18T10:00:00.000Z" },
      buildings: { active: 4, inactive: 2 },
      packages: { active: 3, inactive: 0 },
      jobs: { validating: 6, ready: 9, failed: 6 },
      recentPublications: [],
    });
  });

  test("returns detail support data without an object-storage key", async () => {
    mocks.getDb.mockReturnValue(queuedDatabase(
      authorizedRows("data.audit.read"),
      [{
        id: "job-1", dataType: "building", templateVersion: "TMN-IMPORT-2", state: "validation_failed",
        totalRows: 1, validRows: 0, invalidRows: 1, sourceType: "manual", failureSummary: "import.error.value_invalid",
        uploadedById: "u1", uploadedByEmail: "u@example.com", uploadedByDisplayName: "Uploader",
        publishedById: null, publishedByEmail: null, publishedByDisplayName: null,
        createdAt: new Date("2026-07-18T08:00:00Z"), updatedAt: new Date("2026-07-18T08:01:00Z"), publishedAt: null,
      }],
      [{ id: "e1", filename: "building.csv", sheetName: "Data", rowNumber: 2, columnName: "Name", errorKey: "import.error.value_invalid", localizedParameters: { b: 2, a: 1 }, createdAt: new Date("2026-07-18T08:01:00Z") }],
      [{ id: "c1", entityType: "building", entityId: null, changeType: "added", beforeValue: null, afterValue: { id: "B1" }, createdAt: new Date("2026-07-18T08:01:00Z") }],
      [{ id: "f1", originalFilename: "building.csv", mimeType: "text/csv", sizeBytes: 123, purpose: "original", createdAt: new Date("2026-07-18T08:00:00Z") }],
      [{ id: "a1", actorUserId: "u1", actorEmail: "u@example.com", actorDisplayName: "Uploader", action: "import.uploaded", entityType: "import_job", entityId: "job-1", source: "manual", reason: null, beforeMetadata: null, afterMetadata: {}, createdAt: new Date("2026-07-18T08:00:00Z") }],
    ));

    const detail = await getImportJobDetail(actor, "job-1");

    expect(detail.errors[0]).toMatchObject({ file: "building.csv", sheet: "Data", row: 2, column: "Name" });
    expect(detail.files[0]).toEqual({
      id: "f1", originalFilename: "building.csv", mimeType: "text/csv", sizeBytes: 123,
      purpose: "original", createdAt: "2026-07-18T08:00:00.000Z",
    });
    expect(JSON.stringify(detail)).not.toContain("objectStorageKey");
  });

  test("returns not found only after database authorization succeeds", async () => {
    mocks.getDb.mockReturnValue(queuedDatabase(authorizedRows("data.audit.read"), []));

    await expect(getImportJobDetail(actor, "missing")).rejects.toMatchObject({
      status: 404,
      key: "IMPORT_JOB_NOT_FOUND",
    });
  });

  test("orders Current Rate Card before Historical versions and serializes dates", async () => {
    mocks.getDb.mockReturnValue(queuedDatabase(
      authorizedRows("data.audit.read"),
      [
        { id: "old", versionCode: "RC-1", currency: "IDR", status: "historical", importJobId: "job-1", uploadedById: "u1", uploadedByEmail: "u@example.com", uploadedByDisplayName: "Uploader", publishedById: "u1", publishedByEmail: "u@example.com", publishedByDisplayName: "Uploader", uploadedAt: new Date("2026-07-01T00:00:00Z"), publishedAt: new Date("2026-07-01T01:00:00Z") },
        { id: "current", versionCode: "RC-2", currency: "IDR", status: "current", importJobId: "job-2", uploadedById: "u1", uploadedByEmail: "u@example.com", uploadedByDisplayName: "Uploader", publishedById: "u1", publishedByEmail: "u@example.com", publishedByDisplayName: "Uploader", uploadedAt: new Date("2026-07-18T00:00:00Z"), publishedAt: new Date("2026-07-18T01:00:00Z") },
      ],
    ));

    const versions = await listRateCardVersions(actor);

    expect(versions.map((version) => version.status)).toEqual(["current", "historical"]);
    expect(versions[0].publishedAt).toBe("2026-07-18T01:00:00.000Z");
  });

  test("requires both current permissions, job ownership, then signs for exactly 300 seconds", async () => {
    mocks.getDb.mockReturnValue(queuedDatabase(
      authorizedRows("data.audit.read", "data.file.download"),
      [{ objectStorageKey: "imports/job-1/original/building.csv" }],
    ));
    mocks.getSignedDownloadUrl.mockResolvedValue("https://objects.test/signed");

    await expect(getImportFileDownload(actor, "job-1", "file-1")).resolves.toBe("https://objects.test/signed");
    expect(mocks.getSignedDownloadUrl).toHaveBeenCalledWith("imports/job-1/original/building.csv", 300);
  });

  test("does not initialize storage or sign when the file does not belong to the job", async () => {
    mocks.getDb.mockReturnValue(queuedDatabase(
      authorizedRows("data.audit.read", "data.file.download"),
      [],
    ));

    await expect(getImportFileDownload(actor, "job-1", "file-from-job-2")).rejects.toMatchObject({
      status: 404,
      key: "IMPORT_FILE_NOT_FOUND",
    });
    expect(mocks.fromEnv).not.toHaveBeenCalled();
    expect(mocks.getSignedDownloadUrl).not.toHaveBeenCalled();
  });
});
