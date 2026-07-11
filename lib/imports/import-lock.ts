import { sql } from "drizzle-orm";

import type { ImportDataType } from "@/db/enums";

export const IMPORT_CHECKSUM_LOCK_NAME = "import-data-type-checksum-v1";

interface SqlExecutor {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
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
