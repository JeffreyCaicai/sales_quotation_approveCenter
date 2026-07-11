import { ImportError } from "@/lib/imports/contracts";
import type { ObjectStore, PendingObject } from "@/lib/storage/object-store";
import type { ImportJobRepository } from "@/lib/imports/contracts";

async function retry<T>(operation: () => Promise<T>, maxAttempts: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try { return await operation(); } catch (error) { lastError = error; }
  }
  throw lastError;
}

export async function cleanupPendingWithRetry(
  store: ObjectStore,
  object: PendingObject,
  maxAttempts = 3,
): Promise<"deleted" | "not_owned"> {
  try {
    return await retry(() => store.cleanupPending(object), maxAttempts);
  } catch {
    throw new ImportError(500, "IMPORT_CLEANUP_PENDING");
  }
}

export async function reconcilePendingObjects(
  store: ObjectStore,
  repository: Pick<ImportJobRepository, "listExpiredUploadAttemptIds" | "listStorageSyncWarningAttemptIds" | "reconcileUploadAttempt">,
  options: { maxAttempts?: number; now?: Date } = {},
): Promise<{ committed: number; deleted: number; failed: number; skipped: number }> {
  let committed = 0;
  let deleted = 0;
  let failed = 0;
  let skipped = 0;
  const groups = new Map<string, PendingObject[]>();
  for (const object of await store.listPendingObjects()) {
    const group = groups.get(object.attemptId) ?? [];
    group.push(object);
    groups.set(object.attemptId, group);
  }
  const now = options.now ?? new Date();
  const attemptIds = new Set([
    ...groups.keys(),
    ...await repository.listExpiredUploadAttemptIds(now),
    ...await repository.listStorageSyncWarningAttemptIds(),
  ]);
  for (const attemptId of attemptIds) {
    const objects = groups.get(attemptId) ?? [];
    const result = await repository.reconcileUploadAttempt(
      attemptId,
      now,
      objects,
      {
        commit: async () => {
          for (const object of objects) {
            await retry(() => store.commitPending(object), options.maxAttempts ?? 3);
            committed += 1;
          }
        },
        commitReferencedKeys: async (keys) => {
          for (const key of keys) {
            await retry(
              () => store.commitPending({ key, attemptId }),
              options.maxAttempts ?? 3,
            );
            committed += 1;
          }
        },
        cleanup: async () => {
          for (const object of objects) {
            const outcome = await cleanupPendingWithRetry(store, object, options.maxAttempts ?? 3);
            if (outcome === "deleted") deleted += 1;
          }
        },
      },
    );
    if (result === "failed" || result === "missing") failed += 1;
    if (result === "skipped") skipped += 1;
  }
  return { committed, deleted, failed, skipped };
}
