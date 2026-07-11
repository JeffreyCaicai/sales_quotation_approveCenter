import { and, eq, inArray } from "drizzle-orm";

import { getDb } from "@/db";
import { importFiles, importJobs } from "@/db/schema";
import type {
  ImportJobRepository,
  UploadedJobRecord,
} from "@/lib/imports/contracts";

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

  async createUploadedJob(record: UploadedJobRecord): Promise<void> {
    await getDb().transaction(async (tx) => {
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
    });
  }
}
