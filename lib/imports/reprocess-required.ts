import { and, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditEvents, importJobs } from "@/db/schema";

export interface ImportPreviewToken {
  state: "ready_to_publish" | "draft";
  revision: string;
}

interface TokenizedStalePublicationError {
  key: "IMPORT_CHANGE_STALE";
  previewToken?: ImportPreviewToken;
}

export function isStalePublicationError(
  error: unknown,
): error is TokenizedStalePublicationError {
  return typeof error === "object"
    && error !== null
    && "key" in error
    && error.key === "IMPORT_CHANGE_STALE";
}

export function attachStalePublicationToken(
  error: unknown,
  previewToken: ImportPreviewToken,
): void {
  if (isStalePublicationError(error)) error.previewToken = previewToken;
}

export function stalePublicationToken(error: unknown): ImportPreviewToken | null {
  if (!isStalePublicationError(error)) return null;
  const token = error.previewToken;
  if (
    !token
    || (token.state !== "ready_to_publish" && token.state !== "draft")
    || !/^\d+$/u.test(token.revision)
  ) {
    return null;
  }
  return token;
}

export function importPreviewRevisionSql() {
  return sql<string>`xmin::text`;
}

export async function markImportReprocessRequired(
  jobId: string,
  actorUserId: string,
  previewToken: ImportPreviewToken,
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [job] = await tx.select({
      state: importJobs.state,
      revision: importPreviewRevisionSql(),
    })
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .limit(1)
      .for("update");
    if (
      !job
      || job.state === "reprocess_required"
      || job.state !== previewToken.state
      || job.revision !== previewToken.revision
    ) {
      return false;
    }

    const now = new Date();
    const [updated] = await tx.update(importJobs).set({
      state: "reprocess_required",
      failureSummary: "IMPORT_REPROCESS_REQUIRED",
      updatedAt: now,
    }).where(and(
      eq(importJobs.id, jobId),
      eq(importJobs.state, previewToken.state),
      sql`${importPreviewRevisionSql()} = ${previewToken.revision}`,
    )).returning({ id: importJobs.id });
    if (!updated) return false;

    await tx.insert(auditEvents).values({
      actorUserId,
      action: "import.job.reprocess_required",
      entityType: "import_job",
      entityId: jobId,
      importJobId: jobId,
      source: "import",
      beforeMetadata: { state: previewToken.state },
      afterMetadata: { state: "reprocess_required" },
      createdAt: now,
    });
    return true;
  });
}
