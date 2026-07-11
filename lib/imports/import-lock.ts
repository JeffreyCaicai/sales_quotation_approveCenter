import { sql } from "drizzle-orm";

import type { ImportDataType } from "@/db/enums";

export const IMPORT_CHECKSUM_LOCK_NAME = "import-data-type-checksum-v1";
export const IMPORT_UPLOAD_ATTEMPT_LOCK_NAME = "import-upload-attempt-v1";

interface SqlExecutor {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

export async function acquireImportUploadAttemptLock(
  transaction: SqlExecutor,
  attemptId: string,
): Promise<void> {
  const identity = `${IMPORT_UPLOAD_ATTEMPT_LOCK_NAME}:${attemptId}`;
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`,
  );
}

export async function acquireImportChecksumLock(
  transaction: SqlExecutor,
  dataType: ImportDataType,
  checksum: string,
): Promise<void> {
  const identity = `${IMPORT_CHECKSUM_LOCK_NAME}:${dataType}:${checksum}`;
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`,
  );
}
