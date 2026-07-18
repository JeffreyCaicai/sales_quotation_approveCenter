import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditEvents, importChanges, importJobs, salesPackages, userPermissions, users } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { canonicalJson } from "@/lib/imports/canonical-json";
import { createPackageCode } from "@/lib/imports/package-code";
import type { PackageChange, PackageSnapshot } from "@/lib/imports/package-diff";
import { publicationLockIdentities } from "@/lib/imports/publication-locks";
import { PublicationError, type PublicationResult } from "@/lib/imports/publish";
import { TEMPLATE_VERSION_V2 } from "@/lib/imports/template-v2";

interface LockedPackage extends PackageSnapshot {
  id: string;
}

export function orderPackageChangesForLocking(
  changes: readonly PackageChange[],
): PackageChange[] {
  return [...changes].sort((left, right) => left.entityKey.localeCompare(right.entityKey));
}

export function assertPackageChangePublishable(
  change: PackageChange,
  liveBefore: PackageSnapshot | null,
): void {
  assertPackageChangeShape(change);
  if (change.changeType === "added") {
    if (liveBefore !== null) staleChange();
    return;
  }

  if (change.before === null || liveBefore === null || !packageSnapshotsEqual(change.before, liveBefore)) {
    staleChange();
  }
  if (
    change.after.packageCode !== change.before.packageCode
    || change.after.packageName !== change.before.packageName
  ) {
    invalidChangeType();
  }

  const statusChanged = change.before.status !== change.after.status;
  const isDeactivation = change.before.status === "active" && change.after.status === "inactive";
  const isReactivation = change.before.status === "inactive" && change.after.status === "active";
  if (
    (change.changeType === "unchanged" && statusChanged)
    || (change.changeType === "deactivated" && !isDeactivation)
    || (change.changeType === "modified" && !isReactivation)
  ) {
    invalidChangeType();
  }
}

export function assertPackageNamesAvailable(
  changes: readonly PackageChange[],
  livePackages: readonly PackageSnapshot[],
): void {
  const liveOwnerByName = new Map<string, string>();
  for (const item of livePackages) {
    const name = normalizePackageName(item.packageName);
    const owner = liveOwnerByName.get(name);
    if (owner !== undefined && owner !== item.packageCode) staleChange();
    liveOwnerByName.set(name, item.packageCode);
  }
  const stagedOwnerByName = new Map<string, string>();
  for (const change of changes) {
    const name = normalizePackageName(change.after.packageName);
    const owner = change.after.packageCode ?? change.entityKey;
    const stagedOwner = stagedOwnerByName.get(name);
    if (stagedOwner !== undefined && stagedOwner !== owner) staleChange();
    stagedOwnerByName.set(name, owner);
    const liveOwner = liveOwnerByName.get(name);
    if (liveOwner !== undefined && liveOwner !== change.after.packageCode) staleChange();
  }
}

export async function publishPackageImport(
  jobId: string,
  actor: SessionUser,
): Promise<PublicationResult> {
  return getDb().transaction(async (tx) => {
    for (const identity of publicationLockIdentities("package")) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
    }

    const [job] = await tx.select({
      state: importJobs.state,
      dataType: importJobs.dataType,
      templateVersion: importJobs.templateVersion,
    }).from(importJobs).where(eq(importJobs.id, jobId)).limit(1).for("update");
    if (!job) throw new PublicationError("IMPORT_JOB_NOT_FOUND", 404);
    if (job.dataType !== "package" || job.templateVersion !== TEMPLATE_VERSION_V2) {
      throw new PublicationError("IMPORT_CHANGE_INVALID", 400);
    }
    await assertCurrentPackagePermission(tx, actor);

    if (job.state === "published") {
      return {
        jobId,
        state: "published",
        publishedChanges: 0,
        generatedIdentifiers: await generatedIdentifiersFromAudit(tx, jobId),
      };
    }
    if (job.state !== "ready_to_publish") {
      throw new PublicationError("IMPORT_JOB_NOT_READY", 409);
    }

    const stagedRows = await tx.select({
      changeType: importChanges.changeType,
      beforeValue: importChanges.beforeValue,
      afterValue: importChanges.afterValue,
    }).from(importChanges).where(and(
      eq(importChanges.importJobId, jobId),
      eq(importChanges.entityType, "package"),
    )).orderBy(asc(importChanges.createdAt), asc(importChanges.id));
    const changes = stagedRows.map(parseStoredPackageChange);

    const referencedCodes = [...new Set(changes.flatMap((change) => [
      change.before?.packageCode,
      change.after.packageCode,
    ]).filter((code): code is string => code !== null && code !== undefined))].sort();
    const lockedRows = referencedCodes.length === 0 ? [] : await tx.select({
      id: salesPackages.id,
      packageCode: salesPackages.packageCode,
      packageName: salesPackages.name,
      status: salesPackages.status,
    }).from(salesPackages)
      .where(inArray(salesPackages.packageCode, referencedCodes))
      .orderBy(asc(salesPackages.packageCode))
      .for("update");
    const lockedByCode = new Map(lockedRows.map((row) => {
      const locked = canonicalLockedPackage(row);
      return [locked.packageCode, locked] as const;
    }));

    const normalizedNames = [...new Set(changes.map((change) => normalizePackageName(change.after.packageName)))].sort();
    if (normalizedNames.length > 0) {
      const nameRows = await tx.select({
        id: salesPackages.id,
        packageCode: salesPackages.packageCode,
        packageName: salesPackages.name,
        status: salesPackages.status,
      }).from(salesPackages)
        .where(inArray(sql<string>`lower(btrim(${salesPackages.name}))`, normalizedNames))
        .orderBy(asc(salesPackages.packageCode))
        .for("update");
      for (const row of nameRows) {
        const locked = canonicalLockedPackage(row);
        lockedByCode.set(locked.packageCode, locked);
      }
    }

    for (const change of orderPackageChangesForLocking(changes)) {
      const code = change.before?.packageCode ?? change.after.packageCode;
      assertPackageChangePublishable(change, code === null ? null : lockedByCode.get(code) ?? null);
    }
    assertPackageNamesAvailable(changes, [...lockedByCode.values()]);

    const generatedIdentifiers: Array<{ rowNumber: number; identifier: string }> = [];
    const finalizedChanges = changes.map((change): PackageChange => {
      if (change.after.packageCode !== null) return change;
      const packageCode = createPackageCode(jobId, change.rowNumber);
      generatedIdentifiers.push({ rowNumber: change.rowNumber, identifier: packageCode });
      return {
        ...change,
        entityKey: packageCode,
        after: { ...change.after, packageCode },
      };
    });
    const finalizedCodes = finalizedChanges.map((change) => change.after.packageCode);
    if (finalizedCodes.some((code) => code === null) || new Set(finalizedCodes).size !== finalizedCodes.length) {
      staleChange();
    }

    const generatedCodes = generatedIdentifiers.map((item) => item.identifier).sort();
    if (generatedCodes.length > 0) {
      const collisions = await tx.select({ packageCode: salesPackages.packageCode })
        .from(salesPackages)
        .where(inArray(salesPackages.packageCode, generatedCodes))
        .orderBy(asc(salesPackages.packageCode))
        .for("update");
      if (collisions.length > 0 || generatedCodes.some((code) => referencedCodes.includes(code))) {
        staleChange();
      }
    }

    const now = new Date();
    let publishedChanges = 0;
    for (const change of finalizedChanges) {
      if (change.changeType === "unchanged") continue;
      const after = change.after as PackageSnapshot;
      const current = change.before === null ? null : lockedByCode.get(change.before.packageCode) ?? null;
      let packageId: string;
      if (change.changeType === "added") {
        const [inserted] = await tx.insert(salesPackages).values({
          packageCode: after.packageCode,
          name: after.packageName,
          status: after.status,
          sourceImportJobId: jobId,
          updatedAt: now,
        }).returning({ id: salesPackages.id });
        packageId = inserted.id;
      } else {
        if (current === null) staleChange();
        const [updated] = await tx.update(salesPackages).set({
          name: after.packageName,
          status: after.status,
          sourceImportJobId: jobId,
          updatedAt: now,
        }).where(and(
          eq(salesPackages.id, current.id),
          eq(salesPackages.packageCode, current.packageCode),
        )).returning({ id: salesPackages.id });
        if (!updated) staleChange();
        packageId = updated.id;
      }

      const generated = generatedIdentifiers.find((item) => item.rowNumber === change.rowNumber);
      await tx.insert(auditEvents).values({
        actorUserId: actor.id,
        action: `import.package.${change.changeType}`,
        entityType: "package",
        entityId: packageId,
        importJobId: jobId,
        source: "import",
        reason: generated ? `generated_package_code:${generated.rowNumber}` : null,
        beforeMetadata: change.before,
        afterMetadata: after,
        createdAt: now,
      });
      publishedChanges += 1;
    }

    const [published] = await tx.update(importJobs).set({
      state: "published",
      publishedBy: actor.id,
      publishedAt: now,
      updatedAt: now,
    }).where(and(
      eq(importJobs.id, jobId),
      eq(importJobs.state, "ready_to_publish"),
    )).returning({ id: importJobs.id });
    if (!published) throw new PublicationError("IMPORT_JOB_NOT_READY", 409);

    return { jobId, state: "published", publishedChanges, generatedIdentifiers };
  });
}

type PublicationTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function assertCurrentPackagePermission(
  tx: PublicationTransaction,
  actor: SessionUser,
): Promise<void> {
  const [authorized] = await tx.select({ id: users.id }).from(users)
    .innerJoin(userPermissions, and(
      eq(userPermissions.userId, users.id),
      eq(userPermissions.permissionKey, "data.import.package"),
    ))
    .where(and(eq(users.id, actor.id), eq(users.status, "active")))
    .limit(1);
  if (!authorized) throw new PublicationError("PERMISSION_DENIED", 403);
}

async function generatedIdentifiersFromAudit(
  tx: PublicationTransaction,
  jobId: string,
): Promise<Array<{ rowNumber: number; identifier: string }>> {
  const rows = await tx.select({
    reason: auditEvents.reason,
    afterMetadata: auditEvents.afterMetadata,
  }).from(auditEvents).where(and(
    eq(auditEvents.importJobId, jobId),
    eq(auditEvents.entityType, "package"),
  )).orderBy(asc(auditEvents.createdAt), asc(auditEvents.id));
  return rows.flatMap((row) => {
    const match = row.reason?.match(/^generated_package_code:(\d+)$/u);
    if (!match) return [];
    const after = parsePackageSnapshot(row.afterMetadata);
    return [{ rowNumber: Number(match[1]), identifier: after.packageCode }];
  }).sort((left, right) => left.rowNumber - right.rowNumber);
}

function parseStoredPackageChange(row: {
  changeType: "added" | "modified" | "deactivated" | "unchanged" | "removed";
  beforeValue: unknown;
  afterValue: unknown;
}): PackageChange {
  if (row.changeType === "removed" || !isRecord(row.afterValue) || !Number.isInteger(row.afterValue.rowNumber)) {
    invalidChange();
  }
  const rowNumber = row.afterValue.rowNumber as number;
  if (rowNumber < 1) invalidChange();
  const after = parsePackageAfter(row.afterValue);
  const before = row.beforeValue === null ? null : parsePackageSnapshot(row.beforeValue);
  const entityKey = after.packageCode ?? `row:${rowNumber}`;
  return { rowNumber, entityKey, changeType: row.changeType, before, after };
}

function parsePackageAfter(value: unknown): PackageChange["after"] {
  if (!isRecord(value) || (value.packageCode !== null && typeof value.packageCode !== "string")) invalidChange();
  return {
    packageCode: value.packageCode === null ? null : validTrimmedText(value.packageCode),
    packageName: validTrimmedText(value.packageName),
    status: validStatus(value.status),
  };
}

function parsePackageSnapshot(value: unknown): PackageSnapshot {
  if (!isRecord(value)) invalidChange();
  return {
    packageCode: validTrimmedText(value.packageCode),
    packageName: validTrimmedText(value.packageName),
    status: validStatus(value.status),
  };
}

function assertPackageChangeShape(change: PackageChange): void {
  if (!Number.isInteger(change.rowNumber) || change.rowNumber < 1 || change.after.packageName.trim().length === 0) {
    invalidChange();
  }
  if (change.changeType === "added") {
    if (change.before !== null || change.entityKey !== (change.after.packageCode ?? `row:${change.rowNumber}`)) invalidChange();
    return;
  }
  if (
    change.before === null
    || change.after.packageCode === null
    || change.entityKey !== change.before.packageCode
    || change.after.packageCode !== change.entityKey
  ) {
    invalidChange();
  }
}

function canonicalLockedPackage(row: {
  id: string;
  packageCode: string;
  packageName: string;
  status: string;
}): LockedPackage {
  return {
    id: row.id,
    packageCode: validTrimmedText(row.packageCode),
    packageName: validTrimmedText(row.packageName),
    status: validStatus(row.status),
  };
}

function packageSnapshotsEqual(left: PackageSnapshot, right: PackageSnapshot): boolean {
  return canonicalJson({
    packageCode: left.packageCode,
    packageName: left.packageName,
    status: left.status,
  }) === canonicalJson({
    packageCode: right.packageCode,
    packageName: right.packageName,
    status: right.status,
  });
}

function normalizePackageName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function validTrimmedText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) invalidChange();
  return value;
}

function validStatus(value: unknown): "active" | "inactive" {
  if (value !== "active" && value !== "inactive") invalidChange();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidChange(): never {
  throw new PublicationError("IMPORT_CHANGE_INVALID", 400);
}

function invalidChangeType(): never {
  throw new PublicationError("IMPORT_CHANGE_TYPE_INVALID", 400);
}

function staleChange(): never {
  throw new PublicationError("IMPORT_CHANGE_STALE", 409);
}
