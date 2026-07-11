import { and, eq, inArray, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { auditEvents, buildings, importJobs, rateCardBuildingPrices, rateCardPackageBuildings, rateCardPackageConfigs, rateCardVersions, salesPackages, userPermissions, users } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import type { PublicationResult } from "@/lib/imports/publish";
import { TEMPLATE_VERSION_V2, type RateCardImport } from "@/lib/imports/template-v2";

export type RateCardPublicationErrorKey =
  | "IMPORT_JOB_NOT_FOUND"
  | "IMPORT_JOB_NOT_READY"
  | "IMPORT_CHANGE_INVALID"
  | "IMPORT_RATE_CARD_BUILDING_REFERENCE_INVALID"
  | "IMPORT_RATE_CARD_PACKAGE_REFERENCE_INVALID"
  | "IMPORT_RATE_CARD_VERSION_EXISTS"
  | "PERMISSION_DENIED";

export class RateCardPublicationError extends Error {
  constructor(public readonly key: RateCardPublicationErrorKey, public readonly status: 400 | 403 | 404 | 409) {
    super(key);
    this.name = "RateCardPublicationError";
  }
}

interface LockedBuilding { id: string; irisBuildingId: string; status: "active" | "inactive" }
interface LockedPackage { id: string; packageCode: string; status: "active" | "inactive" }
export interface ResolvedRateCardPublication {
  buildingIdByIris: Map<string, string>;
  packageIdByCode: Map<string, string>;
}
const IMPORT_PUBLICATION_LOCK_NAME = "import-publish-data-type-v1";

export function jakartaMidnight(effectiveDate: string): Date {
  return new Date(`${effectiveDate}T00:00:00+07:00`);
}

export function assertRateCardPublicationSnapshot(
  input: RateCardImport,
  lockedBuildings: LockedBuilding[],
  lockedPackages: LockedPackage[],
): ResolvedRateCardPublication {
  assertRateCardRows(input);
  if (input.buildingPrices.length + input.packagePrices.length + input.packageBuildings.length === 0) {
    throw new RateCardPublicationError("IMPORT_CHANGE_INVALID", 400);
  }
  const buildingReferences = [...input.buildingPrices.map((row) => row.irisBuildingId.trim()), ...input.packageBuildings.map((row) => row.irisBuildingId.trim())];
  const buildingPriceKeys = input.buildingPrices.map((row) => row.irisBuildingId.trim());
  const memberships = input.packageBuildings.map((row) => `${row.packageCode.trim()}\0${row.irisBuildingId.trim()}`);
  const buildingIdByIris = new Map(lockedBuildings.map((row) => [row.irisBuildingId, row.id]));
  if (
    new Set(buildingPriceKeys).size !== buildingPriceKeys.length
    || new Set(memberships).size !== memberships.length
    || [...new Set(buildingReferences)].some((key) => !key || !buildingIdByIris.has(key) || lockedBuildings.find((row) => row.irisBuildingId === key)?.status !== "active")
  ) {
    throw new RateCardPublicationError("IMPORT_RATE_CARD_BUILDING_REFERENCE_INVALID", 409);
  }

  const packageReferences = [...input.packagePrices.map((row) => row.packageCode.trim()), ...input.packageBuildings.map((row) => row.packageCode.trim())];
  const packagePriceKeys = input.packagePrices.map((row) => row.packageCode.trim());
  const pricedPackages = new Set(packagePriceKeys);
  const memberPackages = new Set(input.packageBuildings.map((row) => row.packageCode.trim()));
  const packageIdByCode = new Map(lockedPackages.map((row) => [row.packageCode, row.id]));
  if (
    new Set(packagePriceKeys).size !== packagePriceKeys.length
    || [...pricedPackages].some((key) => !memberPackages.has(key))
    || [...memberPackages].some((key) => !pricedPackages.has(key))
    || [...new Set(packageReferences)].some((key) => !key || !packageIdByCode.has(key) || lockedPackages.find((row) => row.packageCode === key)?.status !== "active")
  ) {
    throw new RateCardPublicationError("IMPORT_RATE_CARD_PACKAGE_REFERENCE_INVALID", 409);
  }
  return { buildingIdByIris, packageIdByCode };
}

export function rateCardAuditMetadata(input: RateCardImport, resolved: ResolvedRateCardPublication) {
  return {
    versionCode: input.versionCode,
    effectiveDate: input.effectiveDate,
    currency: "IDR" as const,
    buildingPrices: input.buildingPrices.map((row) => ({ irisBuildingId: row.irisBuildingId.trim(), buildingId: resolved.buildingIdByIris.get(row.irisBuildingId.trim())!, priceIdr: row.priceIdr })),
    packageConfigs: input.packagePrices.map((row) => ({ packageCode: row.packageCode.trim(), packageId: resolved.packageIdByCode.get(row.packageCode.trim())!, priceIdr: row.priceIdr })),
    packageMemberships: input.packageBuildings.map((row) => ({ packageCode: row.packageCode.trim(), packageId: resolved.packageIdByCode.get(row.packageCode.trim())!, irisBuildingId: row.irisBuildingId.trim(), buildingId: resolved.buildingIdByIris.get(row.irisBuildingId.trim())! })),
  };
}

export async function publishRateCardImport(jobId: string, actor: SessionUser): Promise<PublicationResult> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${IMPORT_PUBLICATION_LOCK_NAME}:rate_card`}, 0))`);
    const [job] = await tx.select({ state: importJobs.state, dataType: importJobs.dataType, templateVersion: importJobs.templateVersion, normalizedPayload: importJobs.normalizedPayload, uploadedBy: importJobs.uploadedBy })
      .from(importJobs).where(eq(importJobs.id, jobId)).limit(1).for("update");
    if (!job) throw new RateCardPublicationError("IMPORT_JOB_NOT_FOUND", 404);
    if (job.dataType !== "rate_card") throw new RateCardPublicationError("IMPORT_CHANGE_INVALID", 400);
    await assertCurrentRateCardPermission(tx, actor);

    if (job.state === "published") {
      return { jobId, state: "published", publishedChanges: 0 };
    }
    if (job.state !== "draft") throw new RateCardPublicationError("IMPORT_JOB_NOT_READY", 409);
    if (job.templateVersion !== TEMPLATE_VERSION_V2) throw new RateCardPublicationError("IMPORT_CHANGE_INVALID", 400);
    const input = parseRateCardImport(job.normalizedPayload);
    if (input.currency !== "IDR") throw new RateCardPublicationError("IMPORT_CHANGE_INVALID", 400);

    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`rate-card-version:${input.versionCode}`}, 0))`);
    const [duplicateVersion] = await tx.select({ id: rateCardVersions.id }).from(rateCardVersions)
      .where(eq(rateCardVersions.versionCode, input.versionCode)).limit(1);
    if (duplicateVersion) throw new RateCardPublicationError("IMPORT_RATE_CARD_VERSION_EXISTS", 409);

    const irisIds = [...new Set([...input.buildingPrices.map((row) => row.irisBuildingId.trim()), ...input.packageBuildings.map((row) => row.irisBuildingId.trim())])];
    const packageCodes = [...new Set([...input.packagePrices.map((row) => row.packageCode.trim()), ...input.packageBuildings.map((row) => row.packageCode.trim())])];
    const lockedBuildings = irisIds.length === 0 ? [] : await tx.select({ id: buildings.id, irisBuildingId: buildings.irisBuildingId, status: buildings.status })
      .from(buildings).where(inArray(buildings.irisBuildingId, irisIds)).for("update");
    const lockedPackages = packageCodes.length === 0 ? [] : await tx.select({ id: salesPackages.id, packageCode: salesPackages.packageCode, status: salesPackages.status })
      .from(salesPackages).where(inArray(salesPackages.packageCode, packageCodes)).for("update");
    const resolved = assertRateCardPublicationSnapshot(input,
      lockedBuildings.map((row) => ({ ...row, status: row.status as "active" | "inactive" })),
      lockedPackages.map((row) => ({ ...row, status: row.status as "active" | "inactive" })),
    );

    const now = new Date();
    const [version] = await tx.insert(rateCardVersions).values({
      versionCode: input.versionCode,
      effectiveAt: jakartaMidnight(input.effectiveDate),
      currency: "IDR",
      status: "draft",
      importJobId: jobId,
      uploadedBy: job.uploadedBy,
      updatedAt: now,
    }).returning({ id: rateCardVersions.id });

    if (input.buildingPrices.length) await tx.insert(rateCardBuildingPrices).values(input.buildingPrices.map((row) => ({ rateCardVersionId: version.id, buildingId: resolved.buildingIdByIris.get(row.irisBuildingId.trim())!, priceIdr: row.priceIdr })));
    if (input.packagePrices.length) await tx.insert(rateCardPackageConfigs).values(input.packagePrices.map((row) => ({ rateCardVersionId: version.id, packageId: resolved.packageIdByCode.get(row.packageCode.trim())!, priceIdr: row.priceIdr })));
    if (input.packageBuildings.length) await tx.insert(rateCardPackageBuildings).values(input.packageBuildings.map((row) => ({ rateCardVersionId: version.id, packageId: resolved.packageIdByCode.get(row.packageCode.trim())!, buildingId: resolved.buildingIdByIris.get(row.irisBuildingId.trim())! })));

    const [publishedVersion] = await tx.update(rateCardVersions).set({
      status: "published", publishedBy: actor.id, publishedAt: now, updatedAt: now,
    }).where(and(eq(rateCardVersions.id, version.id), eq(rateCardVersions.status, "draft")))
      .returning({ id: rateCardVersions.id });
    if (!publishedVersion) throw new RateCardPublicationError("IMPORT_JOB_NOT_READY", 409);

    const [published] = await tx.update(importJobs).set({ state: "published", publishedBy: actor.id, publishedAt: now, updatedAt: now })
      .where(and(eq(importJobs.id, jobId), eq(importJobs.state, "draft"))).returning({ id: importJobs.id });
    if (!published) throw new RateCardPublicationError("IMPORT_JOB_NOT_READY", 409);
    await tx.insert(auditEvents).values([
      { actorUserId: actor.id, action: "import.rate_card.published", entityType: "rate_card_version", entityId: version.id, importJobId: jobId, source: "import", afterMetadata: rateCardAuditMetadata(input, resolved), createdAt: now },
      { actorUserId: actor.id, action: "import.job.published", entityType: "import_job", entityId: jobId, importJobId: jobId, source: "import", beforeMetadata: { state: "draft" }, afterMetadata: { state: "published", rateCardVersionId: version.id }, createdAt: now },
    ]);
    return { jobId, state: "published", publishedChanges: input.buildingPrices.length + input.packagePrices.length + input.packageBuildings.length + 1 };
  });
}

type PublicationTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function assertCurrentRateCardPermission(tx: PublicationTransaction, actor: SessionUser): Promise<void> {
  const [authorized] = await tx.select({ id: users.id }).from(users)
    .innerJoin(userPermissions, and(eq(userPermissions.userId, users.id), eq(userPermissions.permissionKey, "rate_card.publish")))
    .where(and(eq(users.id, actor.id), eq(users.status, "active"))).limit(1);
  if (!authorized) throw new RateCardPublicationError("PERMISSION_DENIED", 403);
}

function parseRateCardImport(value: unknown): RateCardImport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RateCardPublicationError("IMPORT_CHANGE_INVALID", 400);
  const item = value as Partial<RateCardImport>;
  if (item.templateVersion !== TEMPLATE_VERSION_V2 || typeof item.versionCode !== "string" || item.versionCode.trim().length === 0 || !/^\d{4}-\d{2}-\d{2}$/u.test(String(item.effectiveDate)) || Number.isNaN(Date.parse(`${item.effectiveDate}T00:00:00.000Z`)) || item.currency !== "IDR" || !Array.isArray(item.buildingPrices) || !Array.isArray(item.packagePrices) || !Array.isArray(item.packageBuildings)) {
    throw new RateCardPublicationError("IMPORT_CHANGE_INVALID", 400);
  }
  const parsed = item as RateCardImport;
  assertRateCardRows(parsed);
  return parsed;
}

function assertRateCardRows(input: RateCardImport): void {
  if (
    !Array.isArray(input.buildingPrices)
    || !Array.isArray(input.packagePrices)
    || !Array.isArray(input.packageBuildings)
    || input.buildingPrices.some((row) =>
      !row || !Number.isInteger(row.rowNumber) || typeof row.irisBuildingId !== "string" || row.irisBuildingId.trim().length === 0 || typeof row.priceIdr !== "string" || !/^[1-9]\d*$/u.test(row.priceIdr))
    || input.packagePrices.some((row) =>
      !row || !Number.isInteger(row.rowNumber) || typeof row.packageCode !== "string" || row.packageCode.trim().length === 0 || typeof row.priceIdr !== "string" || !/^[1-9]\d*$/u.test(row.priceIdr))
    || input.packageBuildings.some((row) =>
      !row || !Number.isInteger(row.rowNumber) || typeof row.packageCode !== "string" || row.packageCode.trim().length === 0 || typeof row.irisBuildingId !== "string" || row.irisBuildingId.trim().length === 0)
  ) {
    throw new RateCardPublicationError("IMPORT_CHANGE_INVALID", 400);
  }
}
