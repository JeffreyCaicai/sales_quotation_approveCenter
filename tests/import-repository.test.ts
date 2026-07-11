import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => ({ getDb: mocks.getDb }));

import type { UploadedJobRecord } from "@/lib/imports/contracts";
import { PostgresImportJobRepository } from "@/lib/imports/repository";

const record: UploadedJobRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  dataType: "building",
  templateVersion: "v1",
  checksum: "a".repeat(64),
  state: "uploaded",
  sourceType: "manual",
  normalizedPayload: null,
  uploadedBy: "00000000-0000-4000-8000-000000000002",
  createdAt: "2026-07-11T00:00:00.000Z",
  files: [],
};

function database(duplicate: boolean) {
  const events: string[] = [];
  const tx = {
    execute: vi.fn(async () => { events.push("lock"); }),
    select: vi.fn(() => ({
      from: () => ({ where: () => ({ limit: async () => {
        events.push("recheck");
        return duplicate ? [{ id: "published" }] : [];
      } }) }),
    })),
    insert: vi.fn(() => ({ values: async () => { events.push("insert"); } })),
  };
  return {
    events,
    db: { transaction: async (operation: (transaction: typeof tx) => Promise<unknown>) => operation(tx) },
  };
}

describe("Postgres atomic duplicate gate", () => {
  beforeEach(() => vi.clearAllMocks());

  test("orders advisory xact lock, published-state recheck, then insert", async () => {
    const fake = database(false);
    mocks.getDb.mockReturnValue(fake.db);
    await expect(new PostgresImportJobRepository().createUploadedJob(record)).resolves.toBeUndefined();
    expect(fake.events).toEqual(["lock", "recheck", "insert"]);
  });

  test("returns duplicate under the lock without inserting", async () => {
    const fake = database(true);
    mocks.getDb.mockReturnValue(fake.db);
    await expect(new PostgresImportJobRepository().createUploadedJob(record)).resolves.toBe("duplicate");
    expect(fake.events).toEqual(["lock", "recheck"]);
  });

  test("finalizes under the attempt lock with commit before files and job state", async () => {
    const events: string[] = [];
    let selects = 0;
    const tx = {
      execute: async () => { events.push("attempt-lock"); },
      select: () => ({ from: () => ({ where: () => ({ limit: async () => {
        selects += 1;
        events.push("load-reservation");
        return selects === 1 ? [{ id: record.id, state: "uploading", lease: new Date("2026-07-11T00:15:00Z") }] : [];
      } }) }) }),
      insert: () => ({ values: async () => { events.push("insert-files"); } }),
      update: () => ({ set: () => ({ where: async () => { events.push("update-uploaded"); } }) }),
    };
    mocks.getDb.mockReturnValue({ transaction: async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx) });
    const repository = new PostgresImportJobRepository();
    await expect(repository.finalizeUpload({
      attemptId: "00000000-0000-4000-8000-000000000003",
      now: new Date("2026-07-11T00:10:00Z"),
      files: [{ objectStorageKey: "imports/key", originalFilename: "building.csv", mimeType: "text/csv", sizeBytes: 1, checksum: "a".repeat(64), purpose: "original" }],
    })).resolves.toBe("uploaded");
    expect(events).toEqual(["attempt-lock", "load-reservation", "insert-files", "update-uploaded"]);
  });

  test.each([
    ["active lease", new Date("2026-07-11T00:15:00Z"), "skipped", false],
    ["expired lease", new Date("2026-07-10T23:59:00Z"), "failed", true],
  ])("reconciliation rechecks an %s under the attempt lock", async (_label, lease, expected, cleans) => {
    const events: string[] = [];
    let selects = 0;
    const tx = {
      execute: async () => { events.push("attempt-lock"); },
      select: () => ({ from: () => ({ where: () => ({ limit: async () => {
        selects += 1;
        events.push(selects === 1 ? "load-state" : "check-references");
        return selects === 1 ? [{ id: record.id, state: "uploading", lease }] : [];
      } }) }) }),
      update: () => ({ set: () => ({ where: async () => { events.push("mark-failed"); } }) }),
    };
    mocks.getDb.mockReturnValue({ transaction: async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx) });
    const cleanup = vi.fn(async () => { events.push("cleanup-s3"); });
    const result = await new PostgresImportJobRepository().reconcileUploadAttempt(
      "00000000-0000-4000-8000-000000000003",
      new Date("2026-07-11T00:10:00Z"),
      [],
      { cleanup, commit: vi.fn() },
    );
    expect(result).toBe(expected);
    expect(cleanup).toHaveBeenCalledTimes(cleans ? 1 : 0);
    expect(events[0]).toBe("attempt-lock");
    if (cleans) expect(events).toEqual(["attempt-lock", "load-state", "check-references", "cleanup-s3", "mark-failed"]);
  });

  test("reconciler-first expiry makes a later finalizer stale without creating a missing reference", async () => {
    const state = { jobState: "uploading", lease: new Date("2026-07-10T23:00:00Z") as Date | null, references: false };
    mocks.getDb.mockReturnValue(statefulLeaseDatabase(state));
    const repository = new PostgresImportJobRepository();
    const cleanup = vi.fn();
    await expect(repository.reconcileUploadAttempt(
      "00000000-0000-4000-8000-000000000003", new Date("2026-07-11T00:00:00Z"), [],
      { cleanup, commit: vi.fn() },
    )).resolves.toBe("failed");
    const commit = vi.fn();
    await expect(repository.finalizeUpload({
      attemptId: "00000000-0000-4000-8000-000000000003", now: new Date("2026-07-11T00:00:01Z"), files: [],
    })).resolves.toBe("stale");
    expect(state).toMatchObject({ jobState: "validation_failed", references: false });
    expect(commit).not.toHaveBeenCalled();
  });

  test("finalizer-first references make a later reconciler commit tags and never delete", async () => {
    const state = { jobState: "uploading", lease: new Date("2026-07-11T00:15:00Z") as Date | null, references: false, failureSummary: "IMPORT_STORAGE_SYNC_PENDING" as string | null };
    mocks.getDb.mockReturnValue(statefulLeaseDatabase(state));
    const repository = new PostgresImportJobRepository();
    await expect(repository.finalizeUpload({
      attemptId: "00000000-0000-4000-8000-000000000003", now: new Date("2026-07-11T00:00:00Z"),
      files: [{ objectStorageKey: "imports/key", originalFilename: "building.csv", mimeType: "text/csv", sizeBytes: 1, checksum: "a".repeat(64), purpose: "original" }],
    })).resolves.toBe("uploaded");
    const cleanup = vi.fn();
    const commit = vi.fn();
    await expect(repository.reconcileUploadAttempt(
      "00000000-0000-4000-8000-000000000003", new Date("2026-07-11T00:20:00Z"), [],
      { cleanup, commit },
    )).resolves.toBe("committed");
    expect(state).toMatchObject({ jobState: "uploaded", references: true });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
    expect(state.failureSummary).toBeNull();
  });

  test("keeps the storage warning when reconciliation cannot confirm all tags", async () => {
    const state = { jobState: "uploaded", lease: null as Date | null, references: true, failureSummary: "IMPORT_STORAGE_SYNC_PENDING" as string | null };
    mocks.getDb.mockReturnValue(statefulLeaseDatabase(state));
    await expect(new PostgresImportJobRepository().reconcileUploadAttempt(
      "00000000-0000-4000-8000-000000000003", new Date(), [],
      { cleanup: vi.fn(), commit: vi.fn(async () => { throw new Error("tag timeout"); }) },
    )).rejects.toThrow("tag timeout");
    expect(state.failureSummary).toBe("IMPORT_STORAGE_SYNC_PENDING");
  });
});

function statefulLeaseDatabase(state: { jobState: string; lease: Date | null; references: boolean; failureSummary?: string | null }) {
  return {
    transaction: async (operation: (transaction: unknown) => Promise<unknown>) => {
      let selects = 0;
      const tx = {
        execute: async () => undefined,
        select: () => ({ from: () => ({ where: () => ({ limit: async () => {
          selects += 1;
          if (selects === 1) return [{ id: record.id, state: state.jobState, lease: state.lease }];
          return state.references ? [{ id: "reference" }] : [];
        } }) }) }),
        insert: () => ({ values: async () => { state.references = true; } }),
        update: () => ({ set: (values: { state?: string; uploadLeaseExpiresAt?: Date | null; failureSummary?: string | null }) => ({ where: async () => {
          if (values.state) state.jobState = values.state;
          if (values.uploadLeaseExpiresAt !== undefined) state.lease = values.uploadLeaseExpiresAt;
          if (values.failureSummary !== undefined) state.failureSummary = values.failureSummary;
        } }) }),
      };
      return operation(tx);
    },
  };
}
