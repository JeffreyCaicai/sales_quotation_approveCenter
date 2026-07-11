import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { importFiles, importJobs } from "@/db/schema";
import type {
  ImportJobRepository,
  UploadedJobRecord,
} from "@/lib/imports/contracts";
import { acquireImportChecksumLock } from "@/lib/imports/import-lock";

const publishedStates = [
  "published",
  "active",
  "superseded",
  "rolled_back",
] as const;

export class PostgresImportJobRepository implements ImportJobRepository {
  async hasPublishedChecksum(dataType: string, checksum: string): Promise<boolean> {
    const [found] = await getDb()
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(
        and(
          eq(importJobs.dataType, dataType as typeof importJobs.dataType.enumValues[number]),
          eq(importJobs.checksum, checksum),
          inArray(importJobs.state, publishedStates),
        ),
      )
      .limit(1);
    return Boolean(found);
  }

  async createUploadedJob(record: UploadedJobRecord): Promise<void | "duplicate"> {
    return getDb().transaction(async (tx) => {
      await acquireImportChecksumLock(tx, record.dataType, record.checksum);
      const [duplicate] = await tx
        .select({ id: importJobs.id })
        .from(importJobs)
        .where(and(
          eq(importJobs.dataType, record.dataType),
          eq(importJobs.checksum, record.checksum),
          inArray(importJobs.state, publishedStates),
        ))
        .limit(1);
      if (duplicate) return "duplicate" as const;
      await tx.insert(importJobs).values({
        id: record.id,
        dataType: record.dataType,
        templateVersion: record.templateVersion,
        checksum: record.checksum,
        state: record.state,
        sourceType: record.sourceType,
        normalizedPayload: record.normalizedPayload,
        uploadedBy: record.uploadedBy,
        createdAt: new Date(record.createdAt),
        updatedAt: new Date(record.createdAt),
      });
      if (record.files.length > 0) {
        await tx.insert(importFiles).values(
          record.files.map((file) => ({
            importJobId: record.id,
            ...file,
          })),
        );
      }
      return undefined;
    });
  }

  async hasObjectKeyReference(key: string): Promise<boolean> {
    const [found] = await getDb()
      .select({ id: importFiles.id })
      .from(importFiles)
      .where(eq(importFiles.objectStorageKey, key))
      .limit(1);
    return Boolean(found);
  }
}
