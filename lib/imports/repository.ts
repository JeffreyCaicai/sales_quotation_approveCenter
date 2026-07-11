import { and, eq, inArray, lte } from "drizzle-orm";

import { getDb } from "@/db";
import { importFiles, importJobs } from "@/db/schema";
import type {
  ImportJobRepository,
  FinalizeUploadInput,
  UploadReconciliationOperations,
  UploadReservationRecord,
  UploadedJobRecord,
} from "@/lib/imports/contracts";
import {
  acquireImportChecksumLock,
  acquireImportUploadAttemptLock,
} from "@/lib/imports/import-lock";
import type { PendingObject } from "@/lib/storage/object-store";

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

  async reserveUpload(record: UploadReservationRecord): Promise<"reserved" | "duplicate"> {
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
        state: "uploading",
        sourceType: record.sourceType,
        uploadedBy: record.uploadedBy,
        uploadAttemptId: record.attemptId,
        uploadLeaseExpiresAt: record.leaseExpiresAt,
        createdAt: record.createdAt,
        updatedAt: record.createdAt,
      });
      return "reserved" as const;
    });
  }

  async finalizeUpload(
    input: FinalizeUploadInput,
    markCommitted: () => Promise<void>,
  ): Promise<"uploaded" | "stale"> {
    return getDb().transaction(async (tx) => {
      await acquireImportUploadAttemptLock(tx, input.attemptId);
      const [job] = await tx
        .select({
          id: importJobs.id,
          state: importJobs.state,
          lease: importJobs.uploadLeaseExpiresAt,
        })
        .from(importJobs)
        .where(eq(importJobs.uploadAttemptId, input.attemptId))
        .limit(1);
      if (!job || job.state !== "uploading" || !job.lease || job.lease < input.now) {
        return "stale" as const;
      }
      await markCommitted();
      if (input.files.length > 0) {
        await tx.insert(importFiles).values(input.files.map((file) => ({
          importJobId: job.id,
          ...file,
        })));
      }
      await tx.update(importJobs).set({
        state: "uploaded",
        uploadLeaseExpiresAt: null,
        updatedAt: input.now,
      }).where(and(
        eq(importJobs.id, job.id),
        eq(importJobs.uploadAttemptId, input.attemptId),
        eq(importJobs.state, "uploading"),
      ));
      return "uploaded" as const;
    });
  }

  async cleanupUploadAttempt(
    attemptId: string,
    failureSummary: string,
    cleanup: () => Promise<void>,
  ): Promise<"failed" | "referenced" | "missing"> {
    return getDb().transaction(async (tx) => {
      await acquireImportUploadAttemptLock(tx, attemptId);
      const [job] = await tx.select({ id: importJobs.id, state: importJobs.state })
        .from(importJobs)
        .where(eq(importJobs.uploadAttemptId, attemptId))
        .limit(1);
      if (!job) {
        await cleanup();
        return "missing" as const;
      }
      const [reference] = await tx.select({ id: importFiles.id })
        .from(importFiles)
        .where(eq(importFiles.importJobId, job.id))
        .limit(1);
      if (reference || job.state === "uploaded") return "referenced" as const;
      await cleanup();
      await tx.update(importJobs).set({
        state: "validation_failed",
        uploadLeaseExpiresAt: null,
        failureSummary,
        updatedAt: new Date(),
      }).where(eq(importJobs.id, job.id));
      return "failed" as const;
    });
  }

  async listExpiredUploadAttemptIds(now: Date): Promise<string[]> {
    const rows = await getDb().select({ attemptId: importJobs.uploadAttemptId })
      .from(importJobs)
      .where(and(
        eq(importJobs.state, "uploading"),
        lte(importJobs.uploadLeaseExpiresAt, now),
      ));
    return rows.flatMap(({ attemptId }) => attemptId ? [attemptId] : []);
  }

  async reconcileUploadAttempt(
    attemptId: string,
    now: Date,
    _objects: readonly PendingObject[],
    operations: UploadReconciliationOperations,
  ): Promise<"skipped" | "committed" | "failed" | "missing"> {
    void _objects;
    return getDb().transaction(async (tx) => {
      await acquireImportUploadAttemptLock(tx, attemptId);
      const [job] = await tx.select({
        id: importJobs.id,
        state: importJobs.state,
        lease: importJobs.uploadLeaseExpiresAt,
      }).from(importJobs)
        .where(eq(importJobs.uploadAttemptId, attemptId))
        .limit(1);
      if (!job) {
        await operations.cleanup();
        return "missing" as const;
      }
      const [reference] = await tx.select({ id: importFiles.id })
        .from(importFiles)
        .where(eq(importFiles.importJobId, job.id))
        .limit(1);
      if (job.state === "uploaded" || reference) {
        await operations.commit();
        return "committed" as const;
      }
      if (job.state === "uploading" && job.lease && job.lease > now) {
        return "skipped" as const;
      }
      if (job.state !== "uploading" && job.state !== "validation_failed") {
        return "skipped" as const;
      }
      await operations.cleanup();
      await tx.update(importJobs).set({
        state: "validation_failed",
        uploadLeaseExpiresAt: null,
        failureSummary: "IMPORT_UPLOAD_LEASE_EXPIRED",
        updatedAt: now,
      }).where(eq(importJobs.id, job.id));
      return "failed" as const;
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
