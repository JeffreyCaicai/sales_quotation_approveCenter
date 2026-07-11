import { and, asc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  auditEvents,
  buildings,
  importChanges,
  importJobs,
  userPermissions,
  users,
} from "@/db/schema";
import { deriveErpLinkStatus, normalizeExternalId } from "@/lib/buildings/identity";
import type { SessionUser } from "@/lib/auth/session";
import type {
  ImportChange,
  NormalizedBuilding,
  NormalizedCurrentBuilding,
} from "@/lib/imports/diff";

const BUILDING_IMPORT_PERMISSION = "data.import.building";
const IMPORT_PUBLICATION_LOCK_NAME = "import-publish-data-type-v1";

export interface PublicationResult {
  jobId: string;
  state: "published";
  publishedChanges: number;
}

export type PublicationErrorKey =
  | "IMPORT_JOB_NOT_FOUND"
  | "IMPORT_JOB_NOT_READY"
  | "IMPORT_DATA_TYPE_UNSUPPORTED"
  | "IMPORT_CHANGE_INVALID"
  | "IMPORT_CHANGE_STALE"
  | "PERMISSION_DENIED";

export class PublicationError extends Error {
  constructor(
    public readonly key: PublicationErrorKey,
    public readonly status: 400 | 403 | 404 | 409,
  ) {
    super(key);
    this.name = "PublicationError";
  }
}

export async function publishImport(
  jobId: string,
  actor: SessionUser,
): Promise<PublicationResult> {
  return getDb().transaction(async (tx) => {
    const [candidate] = await tx
      .select({ dataType: importJobs.dataType })
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .limit(1);
    if (!candidate) {
      throw new PublicationError("IMPORT_JOB_NOT_FOUND", 404);
    }
    if (candidate.dataType !== "building") {
      throw new PublicationError("IMPORT_DATA_TYPE_UNSUPPORTED", 400);
    }

    const lockIdentity = `${IMPORT_PUBLICATION_LOCK_NAME}:${candidate.dataType}`;
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${lockIdentity}, 0))`,
    );

    const [job] = await tx
      .select({ state: importJobs.state, dataType: importJobs.dataType })
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .limit(1);
    if (!job) {
      throw new PublicationError("IMPORT_JOB_NOT_FOUND", 404);
    }
    if (job.dataType !== "building") {
      throw new PublicationError("IMPORT_DATA_TYPE_UNSUPPORTED", 400);
    }
    if (job.state !== "ready_to_publish") {
      throw new PublicationError("IMPORT_JOB_NOT_READY", 409);
    }

    await assertCurrentPermission(tx, actor);

    const stagedRows = await tx
      .select({
        entityId: importChanges.entityId,
        changeType: importChanges.changeType,
        beforeValue: importChanges.beforeValue,
        afterValue: importChanges.afterValue,
      })
      .from(importChanges)
      .where(and(
        eq(importChanges.importJobId, jobId),
        eq(importChanges.entityType, "building"),
      ))
      .orderBy(asc(importChanges.createdAt), asc(importChanges.id));

    const changes = stagedRows.map(toImportChange);
    const now = new Date();
    let publishedChanges = 0;

    for (const change of changes) {
      if (change.type === "unchanged") continue;

      const [current] = await tx
        .select({ id: buildings.id })
        .from(buildings)
        .where(eq(buildings.irisBuildingId, change.entityKey))
        .limit(1);
      const values = publicationValues(change.after, jobId, now);
      let buildingId: string;

      if (change.type === "added") {
        if (current) {
          throw new PublicationError("IMPORT_CHANGE_STALE", 409);
        }
        const [inserted] = await tx
          .insert(buildings)
          .values({ irisBuildingId: change.entityKey, ...values })
          .returning({ id: buildings.id });
        buildingId = inserted.id;
      } else {
        if (
          !current
          || current.id !== change.before.id
          || change.before.irisBuildingId !== change.entityKey
        ) {
          throw new PublicationError("IMPORT_CHANGE_STALE", 409);
        }
        const [updated] = await tx
          .update(buildings)
          .set(values)
          .where(and(
            eq(buildings.id, current.id),
            eq(buildings.irisBuildingId, change.entityKey),
          ))
          .returning({ id: buildings.id });
        if (!updated) {
          throw new PublicationError("IMPORT_CHANGE_STALE", 409);
        }
        buildingId = updated.id;
      }

      await tx.insert(auditEvents).values({
        actorUserId: actor.id,
        action: `import.building.${change.type}`,
        entityType: "building",
        entityId: buildingId,
        importJobId: jobId,
        source: "import",
        beforeMetadata: change.before,
        afterMetadata: normalizedAfter(change.after),
        createdAt: now,
      });
      publishedChanges += 1;
    }

    const [published] = await tx
      .update(importJobs)
      .set({
        state: "published",
        publishedBy: actor.id,
        publishedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(importJobs.id, jobId),
        eq(importJobs.state, "ready_to_publish"),
      ))
      .returning({ id: importJobs.id });
    if (!published) {
      throw new PublicationError("IMPORT_JOB_NOT_READY", 409);
    }

    return { jobId, state: "published", publishedChanges };
  });
}

type PublicationTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

async function assertCurrentPermission(
  tx: PublicationTransaction,
  actor: SessionUser,
): Promise<void> {
  const [authorized] = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(
      userPermissions,
      and(
        eq(userPermissions.userId, users.id),
        eq(userPermissions.permissionKey, BUILDING_IMPORT_PERMISSION),
      ),
    )
    .where(and(eq(users.id, actor.id), eq(users.status, "active")))
    .limit(1);
  if (!authorized) {
    throw new PublicationError("PERMISSION_DENIED", 403);
  }
}

function publicationValues(
  after: NormalizedBuilding,
  jobId: string,
  now: Date,
) {
  const normalized = normalizedAfter(after);
  return {
    erpBuildingId: normalized.erpBuildingId,
    erpLinkStatus: deriveErpLinkStatus(normalized.erpBuildingId),
    name: normalized.buildingName,
    buildingType: normalized.buildingType,
    gradeResource: normalized.gradeResource,
    area: normalized.area,
    city: normalized.city,
    cbdArea: normalized.cbdArea,
    subDistrict: normalized.subDistrict,
    address: normalized.address,
    dataSource: normalized.dataSource,
    status: normalized.operationalStatus,
    sourceImportJobId: jobId,
    updatedAt: now,
  };
}

function normalizedAfter(after: NormalizedBuilding): NormalizedBuilding {
  return {
    ...after,
    erpBuildingId: normalizeExternalId(after.erpBuildingId),
  };
}

function toImportChange(row: {
  entityId: string | null;
  changeType: "added" | "modified" | "deactivated" | "unchanged";
  beforeValue: unknown;
  afterValue: unknown;
}): ImportChange {
  const after = parseNormalizedBuilding(row.afterValue);
  const entityKey = after.irisBuildingId;
  if (row.changeType === "added") {
    if (row.entityId !== null || row.beforeValue !== null) invalidChange();
    return { type: "added", entityKey, before: null, after };
  }

  const before = parseCurrentBuilding(row.beforeValue);
  if (
    row.entityId === null
    || row.entityId !== before.id
    || before.irisBuildingId !== entityKey
  ) {
    invalidChange();
  }
  return { type: row.changeType, entityKey, before, after };
}

function parseCurrentBuilding(value: unknown): NormalizedCurrentBuilding {
  const building = parseNormalizedBuilding(value);
  if (!isRecord(value) || typeof value.id !== "string") invalidChange();
  return { id: value.id, ...building };
}

function parseNormalizedBuilding(value: unknown): NormalizedBuilding {
  if (
    !isRecord(value)
    || typeof value.irisBuildingId !== "string"
    || value.irisBuildingId.trim().length === 0
    || value.irisBuildingId !== value.irisBuildingId.trim()
    || !nullableString(value.erpBuildingId)
    || typeof value.buildingName !== "string"
    || !nullableString(value.buildingType)
    || !nullableString(value.gradeResource)
    || !nullableString(value.area)
    || !nullableString(value.city)
    || !nullableString(value.cbdArea)
    || !nullableString(value.subDistrict)
    || typeof value.address !== "string"
    || (value.operationalStatus !== "active" && value.operationalStatus !== "inactive")
    || (value.dataSource !== "building_team" && value.dataSource !== "erp")
  ) {
    invalidChange();
  }
  return {
    irisBuildingId: value.irisBuildingId,
    erpBuildingId: value.erpBuildingId,
    buildingName: value.buildingName,
    buildingType: value.buildingType,
    gradeResource: value.gradeResource,
    area: value.area,
    city: value.city,
    cbdArea: value.cbdArea,
    subDistrict: value.subDistrict,
    address: value.address,
    operationalStatus: value.operationalStatus,
    dataSource: value.dataSource,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function invalidChange(): never {
  throw new PublicationError("IMPORT_CHANGE_INVALID", 400);
}
