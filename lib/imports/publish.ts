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
import { publishRateCardImport } from "@/lib/imports/publish-rate-card";
import { publishPackageImport } from "@/lib/imports/publish-package";
import { publicationLockIdentities } from "@/lib/imports/publication-locks";

const BUILDING_IMPORT_PERMISSION = "data.import.building";

export interface PublicationResult {
  jobId: string;
  state: "published";
  publishedChanges: number;
  generatedIdentifiers?: Array<{ rowNumber: number; identifier: string }>;
}

export function orderBuildingChangesForLocking(changes: readonly ImportChange[]): ImportChange[] {
  return [...changes].sort((left, right) => left.entityKey.localeCompare(right.entityKey));
}

export type PublicationErrorKey =
  | "IMPORT_JOB_NOT_FOUND"
  | "IMPORT_JOB_NOT_READY"
  | "IMPORT_DATA_TYPE_UNSUPPORTED"
  | "IMPORT_CHANGE_INVALID"
  | "IMPORT_CHANGE_TYPE_INVALID"
  | "IMPORT_CHANGE_STALE"
  | "IMPORT_BUILDING_REACTIVATION_REQUIRES_ADMIN_WORKFLOW"
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
  const [candidate] = await getDb().select({ dataType: importJobs.dataType })
    .from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
  if (!candidate) throw new PublicationError("IMPORT_JOB_NOT_FOUND", 404);
  return candidate.dataType === "rate_card"
    ? publishRateCardImport(jobId, actor)
    : candidate.dataType === "package"
      ? publishPackageImport(jobId, actor)
    : publishBuildingImport(jobId, actor);
}

async function publishBuildingImport(
  jobId: string,
  actor: SessionUser,
): Promise<PublicationResult> {
  return getDb().transaction(async (tx) => {
    for (const identity of publicationLockIdentities("building")) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
    }
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
    const liveBeforeByEntityKey = new Map<
      string,
      NormalizedCurrentBuilding | null
    >();
    for (const change of orderBuildingChangesForLocking(changes)) {
      const liveBefore = await selectBuildingForUpdate(
        tx,
        change.entityKey,
      );
      assertBuildingChangePublishable(change, liveBefore);
      liveBeforeByEntityKey.set(change.entityKey, liveBefore);
    }

    const now = new Date();
    let publishedChanges = 0;

    for (const change of changes) {
      if (change.type === "unchanged") continue;

      const liveBefore = liveBeforeByEntityKey.get(change.entityKey) ?? null;
      const values = publicationValues(change.after, jobId, now);
      let buildingId: string;

      if (change.type === "added") {
        const [inserted] = await tx
          .insert(buildings)
          .values({ irisBuildingId: change.entityKey, ...values })
          .returning({ id: buildings.id });
        buildingId = inserted.id;
      } else {
        if (!liveBefore) {
          throw new PublicationError("IMPORT_CHANGE_STALE", 409);
        }
        const [updated] = await tx
          .update(buildings)
          .set(values)
          .where(and(
            eq(buildings.id, liveBefore.id),
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
        beforeMetadata: liveBefore,
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

async function selectBuildingForUpdate(
  tx: PublicationTransaction,
  irisBuildingId: string,
): Promise<NormalizedCurrentBuilding | null> {
  const [current] = await tx
    .select({
      id: buildings.id,
      irisBuildingId: buildings.irisBuildingId,
      erpBuildingId: buildings.erpBuildingId,
      buildingName: buildings.name,
      buildingType: buildings.buildingType,
      gradeResource: buildings.gradeResource,
      area: buildings.area,
      city: buildings.city,
      cbdArea: buildings.cbdArea,
      subDistrict: buildings.subDistrict,
      address: buildings.address,
      operationalStatus: buildings.status,
      dataSource: buildings.dataSource,
    })
    .from(buildings)
    .where(eq(buildings.irisBuildingId, irisBuildingId))
    .limit(1)
    .for("update");
  if (!current) return null;
  if (
    (current.operationalStatus !== "active" && current.operationalStatus !== "inactive")
    || (current.dataSource !== "building_team" && current.dataSource !== "erp")
  ) {
    invalidChange();
  }
  return {
    ...current,
    irisBuildingId: current.irisBuildingId.trim(),
    erpBuildingId: normalizeExternalId(current.erpBuildingId),
    operationalStatus: current.operationalStatus,
    dataSource: current.dataSource,
  };
}

export function assertBuildingChangePublishable(
  change: ImportChange,
  liveBefore: NormalizedCurrentBuilding | null,
): void {
  if (change.type === "added") {
    if (liveBefore) staleChange();
    return;
  }

  if (!liveBefore || !currentBuildingEqual(liveBefore, change.before)) {
    staleChange();
  }

  const equalPayloads = normalizedBuildingEqual(change.before, change.after);
  if (
    change.before.operationalStatus === "inactive"
    && change.after.operationalStatus === "active"
  ) {
    throw new PublicationError(
      "IMPORT_BUILDING_REACTIVATION_REQUIRES_ADMIN_WORKFLOW",
      409,
    );
  }
  const isDeactivation = change.before.operationalStatus === "active"
    && change.after.operationalStatus === "inactive";

  if (
    (change.type === "unchanged" && !equalPayloads)
    || (change.type === "deactivated" && !isDeactivation)
    || (change.type === "modified" && (equalPayloads || isDeactivation))
  ) {
    throw new PublicationError("IMPORT_CHANGE_TYPE_INVALID", 400);
  }
}

function currentBuildingEqual(
  left: NormalizedCurrentBuilding,
  right: NormalizedCurrentBuilding,
): boolean {
  return left.id === right.id && normalizedBuildingEqual(left, right);
}

function normalizedBuildingEqual(
  left: NormalizedBuilding,
  right: NormalizedBuilding,
): boolean {
  return left.irisBuildingId === right.irisBuildingId
    && normalizeExternalId(left.erpBuildingId) === normalizeExternalId(right.erpBuildingId)
    && left.buildingName === right.buildingName
    && left.buildingType === right.buildingType
    && left.gradeResource === right.gradeResource
    && left.area === right.area
    && left.city === right.city
    && left.cbdArea === right.cbdArea
    && left.subDistrict === right.subDistrict
    && left.address === right.address
    && left.operationalStatus === right.operationalStatus
    && left.dataSource === right.dataSource;
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
  changeType: "added" | "modified" | "deactivated" | "unchanged" | "removed";
  beforeValue: unknown;
  afterValue: unknown;
}): ImportChange {
  if (row.changeType === "removed") invalidChange();
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
    || value.buildingName.trim().length === 0
    || !nullableString(value.buildingType)
    || !nullableString(value.gradeResource)
    || !nullableString(value.area)
    || !nullableString(value.city)
    || !nullableString(value.cbdArea)
    || !nullableString(value.subDistrict)
    || typeof value.address !== "string"
    || value.address.trim().length === 0
    || (value.operationalStatus !== "active" && value.operationalStatus !== "inactive")
    || (value.dataSource !== "building_team" && value.dataSource !== "erp")
  ) {
    invalidChange();
  }
  return {
    irisBuildingId: value.irisBuildingId,
    erpBuildingId: normalizeExternalId(value.erpBuildingId),
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

function staleChange(): never {
  throw new PublicationError("IMPORT_CHANGE_STALE", 409);
}
