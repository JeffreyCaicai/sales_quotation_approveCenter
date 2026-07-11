import { ImportError } from "@/lib/imports/contracts";
import type { ObjectStore, PendingObject } from "@/lib/storage/object-store";

export interface ObjectReferenceRepository {
  hasObjectKeyReference(key: string): Promise<boolean>;
}

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
  repository: ObjectReferenceRepository,
  options: { maxAttempts?: number } = {},
): Promise<{ committed: number; deleted: number }> {
  let committed = 0;
  let deleted = 0;
  for (const object of await store.listPendingObjects()) {
    if (await repository.hasObjectKeyReference(object.key)) {
      await retry(() => store.commitPending(object), options.maxAttempts ?? 3);
      committed += 1;
    } else {
      const result = await cleanupPendingWithRetry(store, object, options.maxAttempts ?? 3);
      if (result === "deleted") deleted += 1;
    }
  }
  return { committed, deleted };
}
