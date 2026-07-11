import { closeDb } from "@/db";
import { PostgresImportJobRepository } from "@/lib/imports/repository";
import { reconcilePendingObjects } from "@/lib/imports/reconcile-pending-objects";
import { S3ObjectStore } from "@/lib/storage/s3-object-store";

async function main(): Promise<void> {
  const result = await reconcilePendingObjects(
    S3ObjectStore.fromEnv(),
    new PostgresImportJobRepository(),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "IMPORT_RECONCILIATION_FAILED"}\n`);
    process.exitCode = 1;
  })
  .finally(closeDb);
