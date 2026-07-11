import { describe, expect, test, vi } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import { createImportJob } from "@/lib/imports/create-job";
import { reconcilePendingObjects } from "@/lib/imports/reconcile-pending-objects";
import type { ObjectStore, PendingObject } from "@/lib/storage/object-store";

const actor: SessionUser = {
  id: "00000000-0000-4000-8000-000000000099",
  email: "uploader@example.com",
  displayName: "Uploader",
  status: "active",
  permissions: ["data.import.building"],
};

function preparedCsv() {
  return { filename: "building.csv", mimeType: "text/csv", body: new TextEncoder().encode("code\nB-1") };
}

describe("durable upload lease orchestration", () => {
  test("reserves before PUT and finalizes S3 commit while the attempt lock is held", async () => {
    const events: string[] = [];
    const pending = { key: "imports/key", attemptId: "attempt", versionId: "version" };
    const store = {
      putImmutable: vi.fn(async () => { events.push("put"); return pending; }),
      commitPending: vi.fn(async () => { events.push("commit"); }),
      cleanupPending: vi.fn(), listPendingObjects: vi.fn(), getSignedDownloadUrl: vi.fn(),
    } as unknown as ObjectStore;
    const repository = {
      hasPublishedChecksum: vi.fn(async () => false),
      reserveUpload: vi.fn(async () => { events.push("reserve"); return "reserved"; }),
      finalizeUpload: vi.fn(async () => {
        events.push("finalize-lock");
        events.push("insert-files-update-job");
        return "uploaded";
      }),
      cleanupUploadAttempt: vi.fn(),
      recordStorageSyncWarning: vi.fn(),
    };
    let sequence = 0;
    await expect(createImportJob(
      { dataType: "building", templateVersion: "TMN-IMPORT-2", files: [preparedCsv()] },
      actor,
      {
        repository: repository as never,
        objectStore: store,
        now: () => new Date("2026-07-11T00:00:00Z"),
        randomUUID: () => sequence++ === 0 ? "00000000-0000-4000-8000-000000000001" : "00000000-0000-4000-8000-000000000002",
      },
    )).resolves.toEqual({ jobId: "00000000-0000-4000-8000-000000000001", state: "uploaded" });
    expect(events).toEqual(["reserve", "put", "finalize-lock", "insert-files-update-job", "commit"]);
  });

  test("returns the committed job after partial tag failure and records a recoverable warning", async () => {
    const pending = [
      { key: "imports/one", attemptId: "attempt", versionId: "v1" },
      { key: "imports/two", attemptId: "attempt", versionId: "v2" },
    ];
    let puts = 0;
    let commits = 0;
    const store = {
      putImmutable: vi.fn(async () => pending[puts++ % 2]),
      commitPending: vi.fn(async () => { commits += 1; if (commits === 2) throw new Error("tag failed"); }),
      cleanupPending: vi.fn(), listPendingObjects: vi.fn(), getSignedDownloadUrl: vi.fn(),
    } as unknown as ObjectStore;
    const repository = {
      hasPublishedChecksum: vi.fn(async () => false), reserveUpload: vi.fn(async () => "reserved"),
      finalizeUpload: vi.fn(async () => "uploaded"), cleanupUploadAttempt: vi.fn(),
      recordStorageSyncWarning: vi.fn(async () => undefined),
      listExpiredUploadAttemptIds: vi.fn(async () => []),
      listStorageSyncWarningAttemptIds: vi.fn(async () => []),
      reconcileUploadAttempt: vi.fn(async (_attemptId: string, _now: Date, _objects: PendingObject[], operations: import("@/lib/imports/contracts").UploadReconciliationOperations) => {
        await operations.commitReferencedKeys(["imports/one", "imports/two", "imports/three", "imports/four"]);
        return "committed" as const;
      }),
    };
    let sequence = 0;
    const files = ["metadata.csv", "building-prices.csv", "package-prices.csv", "package-buildings.csv"]
      .map((filename) => ({ filename, mimeType: "text/csv", body: new TextEncoder().encode("code\n1") }));
    await expect(createImportJob(
      { dataType: "rate_card", templateVersion: "TMN-IMPORT-2", files },
      { ...actor, permissions: ["rate_card.upload"] },
      { repository: repository as never, objectStore: store, now: () => new Date("2026-07-11T00:00:00Z"), randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` },
    )).resolves.toMatchObject({ state: "uploaded" });
    expect(repository.cleanupUploadAttempt).not.toHaveBeenCalled();
    expect(repository.recordStorageSyncWarning).toHaveBeenCalledWith(expect.any(String), "IMPORT_STORAGE_SYNC_PENDING");
    store.listPendingObjects = vi.fn(async () => [pending[1]]);
    await expect(reconcilePendingObjects(store, repository as never)).resolves.toEqual({ committed: 4, deleted: 0, failed: 0, skipped: 0 });
    expect(store.cleanupPending).not.toHaveBeenCalled();
  });

  test("processes a DB storage warning even when S3 discovery is empty", async () => {
    const store = {
      listPendingObjects: vi.fn(async () => []),
      commitPending: vi.fn(async () => undefined), cleanupPending: vi.fn(),
    } as unknown as ObjectStore;
    const repository = {
      listExpiredUploadAttemptIds: vi.fn(async () => []),
      listStorageSyncWarningAttemptIds: vi.fn(async () => ["warning-attempt"]),
      reconcileUploadAttempt: vi.fn(async (_id: string, _now: Date, _objects: PendingObject[], operations: import("@/lib/imports/contracts").UploadReconciliationOperations) => {
        await operations.commitReferencedKeys(["imports/db-key"]);
        return "committed" as const;
      }),
    };
    await expect(reconcilePendingObjects(store, repository as never)).resolves.toEqual({ committed: 1, deleted: 0, failed: 0, skipped: 0 });
    expect(store.commitPending).toHaveBeenCalledWith({ key: "imports/db-key", attemptId: "warning-attempt" });
  });

  test("fails a warning attempt when any DB-referenced key is missing and never cleans it", async () => {
    const store = {
      listPendingObjects: vi.fn(async () => []),
      commitPending: vi.fn(async ({ key }: PendingObject) => {
        if (key === "imports/missing") throw new Error("STORAGE_SYNC_FAILED");
      }),
      cleanupPending: vi.fn(),
    } as unknown as ObjectStore;
    const repository = {
      listExpiredUploadAttemptIds: vi.fn(async () => []),
      listStorageSyncWarningAttemptIds: vi.fn(async () => ["warning-attempt"]),
      reconcileUploadAttempt: vi.fn(async (_id: string, _now: Date, _objects: PendingObject[], operations: import("@/lib/imports/contracts").UploadReconciliationOperations) => {
        await operations.commitReferencedKeys(["imports/ok", "imports/missing"]);
        return "committed" as const;
      }),
    };
    await expect(reconcilePendingObjects(store, repository as never, { maxAttempts: 1 })).rejects.toThrow("STORAGE_SYNC_FAILED");
    expect(store.cleanupPending).not.toHaveBeenCalled();
  });

  test("reconciliation locks every observed attempt and never deletes an active lease", async () => {
    const object: PendingObject = { key: "imports/key", attemptId: "active-attempt", versionId: "v1" };
    const store = {
      listPendingObjects: vi.fn(async () => [object]),
      cleanupPending: vi.fn(), commitPending: vi.fn(),
    } as unknown as ObjectStore;
    const repository = {
      listExpiredUploadAttemptIds: vi.fn(async () => []),
      listStorageSyncWarningAttemptIds: vi.fn(async () => []),
      reconcileUploadAttempt: vi.fn(async () => "skipped"),
    };
    await expect(reconcilePendingObjects(store, repository as never, { now: new Date("2026-07-11T00:00:00Z") })).resolves.toEqual({ committed: 0, deleted: 0, failed: 0, skipped: 1 });
    expect(repository.reconcileUploadAttempt).toHaveBeenCalledWith(
      "active-attempt",
      expect.any(Date),
      [object],
      expect.objectContaining({ commit: expect.any(Function), cleanup: expect.any(Function) }),
    );
    expect(store.cleanupPending).not.toHaveBeenCalled();
  });
});
