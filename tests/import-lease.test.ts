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
      finalizeUpload: vi.fn(async (_input: unknown, markCommitted: () => Promise<void>) => {
        events.push("finalize-lock");
        await markCommitted();
        events.push("insert-files-update-job");
        return "uploaded";
      }),
      cleanupUploadAttempt: vi.fn(),
    };
    let sequence = 0;
    await expect(createImportJob(
      { dataType: "building", templateVersion: "v1", files: [preparedCsv()] },
      actor,
      {
        repository: repository as never,
        objectStore: store,
        now: () => new Date("2026-07-11T00:00:00Z"),
        randomUUID: () => sequence++ === 0 ? "00000000-0000-4000-8000-000000000001" : "00000000-0000-4000-8000-000000000002",
      },
    )).resolves.toEqual({ jobId: "00000000-0000-4000-8000-000000000001", state: "uploaded" });
    expect(events).toEqual(["reserve", "put", "finalize-lock", "commit", "insert-files-update-job"]);
  });

  test("reconciliation locks every observed attempt and never deletes an active lease", async () => {
    const object: PendingObject = { key: "imports/key", attemptId: "active-attempt", versionId: "v1" };
    const store = {
      listPendingObjects: vi.fn(async () => [object]),
      cleanupPending: vi.fn(), commitPending: vi.fn(),
    } as unknown as ObjectStore;
    const repository = {
      listExpiredUploadAttemptIds: vi.fn(async () => []),
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
