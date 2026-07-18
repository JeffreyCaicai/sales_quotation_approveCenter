import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb } from "@/db";
import {
  auditEvents,
  buildings,
  importJobs,
  rateCardBuildingPrices,
  rateCardPackageBuildings,
  rateCardPackageConfigs,
  rateCardVersions,
  salesPackages,
  userPermissions,
  users,
} from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { publicationLockIdentities } from "@/lib/imports/publication-locks";
import type { PublicationResult } from "@/lib/imports/publish";
import { createRateCardVersionCode } from "@/lib/imports/rate-card-version-code";
import {
  TEMPLATE_VERSION_V2,
  type StagedRateCardImport,
} from "@/lib/imports/template-v2";

export type RateCardPublicationErrorKey =
  | "IMPORT_JOB_NOT_FOUND"
  | "IMPORT_JOB_NOT_READY"
  | "IMPORT_CHANGE_INVALID"
  | "IMPORT_CHANGE_STALE"
  | "IMPORT_DUPLICATE_PUBLISHED"
  | "IMPORT_RATE_CARD_BUILDING_REFERENCE_INVALID"
  | "IMPORT_RATE_CARD_PACKAGE_REFERENCE_INVALID"
  | "PERMISSION_DENIED";

export class RateCardPublicationError extends Error {
  constructor(
    public readonly key: RateCardPublicationErrorKey,
    public readonly status: 400 | 403 | 404 | 409,
  ) {
    super(key);
    this.name = "RateCardPublicationError";
  }
}

interface LockedBuilding {
  id: string;
  irisBuildingId: string;
  status: "active" | "inactive";
}

interface LockedPackage {
  id: string;
  packageCode: string;
  status: "active" | "inactive";
}

export interface ResolvedRateCardPublication {
  buildingIdByIris: Map<string, string>;
  packageIdByCode: Map<string, string>;
}

export function assertRateCardPublicationBaseline(
  basedOnVersionId: string | null,
  currentVersionId: string | null,
): void {
  if (basedOnVersionId !== currentVersionId) {
    throw new RateCardPublicationError("IMPORT_CHANGE_STALE", 409);
  }
}

export function assertRateCardPublicationSnapshot(
  input: StagedRateCardImport,
  lockedBuildings: LockedBuilding[],
  lockedPackages: LockedPackage[],
): ResolvedRateCardPublication {
  assertRateCardRows(input);
  if (
    input.buildingPrices.length
      + input.packagePrices.length
      + input.packageMemberships.length
    === 0
  ) {
    throw new RateCardPublicationError("IMPORT_CHANGE_INVALID", 400);
  }

  const buildingReferences = [
    ...input.buildingPrices.map((row) => row.irisBuildingId.trim()),
    ...input.packageMemberships.map((row) => row.irisBuildingId.trim()),
  ];
  const buildingPriceKeys = input.buildingPrices.map((row) => row.irisBuildingId.trim());
  const memberships = input.packageMemberships.map(
    (row) => `${row.packageCode.trim()}\0${row.irisBuildingId.trim()}`,
  );
  const buildingIdByIris = new Map(
    lockedBuildings.map((row) => [row.irisBuildingId, row.id]),
  );
  const buildingStatusByIris = new Map(
    lockedBuildings.map((row) => [row.irisBuildingId, row.status]),
  );
  if (
    new Set(buildingPriceKeys).size !== buildingPriceKeys.length
    || new Set(memberships).size !== memberships.length
    || [...new Set(buildingReferences)].some(
      (key) => !key || !buildingIdByIris.has(key) || buildingStatusByIris.get(key) !== "active",
    )
  ) {
    throw new RateCardPublicationError(
      "IMPORT_RATE_CARD_BUILDING_REFERENCE_INVALID",
      409,
    );
  }

  const packageReferences = [
    ...input.packagePrices.map((row) => row.packageCode.trim()),
    ...input.packageMemberships.map((row) => row.packageCode.trim()),
  ];
  const packagePriceKeys = input.packagePrices.map((row) => row.packageCode.trim());
  const pricedPackages = new Set(packagePriceKeys);
  const memberPackages = new Set(
    input.packageMemberships.map((row) => row.packageCode.trim()),
  );
  const packageIdByCode = new Map(
    lockedPackages.map((row) => [row.packageCode, row.id]),
  );
  const packageStatusByCode = new Map(
    lockedPackages.map((row) => [row.packageCode, row.status]),
  );
  if (
    new Set(packagePriceKeys).size !== packagePriceKeys.length
    || [...pricedPackages].some((key) => !memberPackages.has(key))
    || [...memberPackages].some((key) => !pricedPackages.has(key))
    || [...new Set(packageReferences)].some(
      (key) => !key || !packageIdByCode.has(key) || packageStatusByCode.get(key) !== "active",
    )
  ) {
    throw new RateCardPublicationError(
      "IMPORT_RATE_CARD_PACKAGE_REFERENCE_INVALID",
      409,
    );
  }

  return { buildingIdByIris, packageIdByCode };
}

export function rateCardAuditMetadata(
  input: StagedRateCardImport,
  resolved: ResolvedRateCardPublication,
  versionCode: string,
) {
  return {
    versionCode,
    currency: "IDR" as const,
    basedOnVersionId: input.basedOnVersionId,
    buildingPrices: input.buildingPrices.map((row) => ({
      irisBuildingId: row.irisBuildingId.trim(),
      buildingId: resolved.buildingIdByIris.get(row.irisBuildingId.trim())!,
      priceIdr: row.priceIdr,
    })),
    packageConfigs: input.packagePrices.map((row) => ({
      packageCode: row.packageCode.trim(),
      packageId: resolved.packageIdByCode.get(row.packageCode.trim())!,
      priceIdr: row.priceIdr,
    })),
    packageMemberships: input.packageMemberships.map((row) => ({
      packageCode: row.packageCode.trim(),
      packageId: resolved.packageIdByCode.get(row.packageCode.trim())!,
      irisBuildingId: row.irisBuildingId.trim(),
      buildingId: resolved.buildingIdByIris.get(row.irisBuildingId.trim())!,
    })),
  };
}

export async function publishRateCardImport(
  jobId: string,
  actor: SessionUser,
): Promise<PublicationResult> {
  return getDb().transaction(async (tx) => {
    for (const identity of publicationLockIdentities("rate_card")) {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${identity}, 0))`,
      );
    }

    const [job] = await tx.select({
      state: importJobs.state,
      dataType: importJobs.dataType,
      templateVersion: importJobs.templateVersion,
      checksum: importJobs.checksum,
      normalizedPayload: importJobs.normalizedPayload,
      uploadedBy: importJobs.uploadedBy,
      createdAt: importJobs.createdAt,
    }).from(importJobs)
      .where(eq(importJobs.id, jobId))
      .limit(1)
      .for("update");
    if (!job) throw new RateCardPublicationError("IMPORT_JOB_NOT_FOUND", 404);
    if (job.dataType !== "rate_card") {
      throw new RateCardPublicationError("IMPORT_CHANGE_INVALID", 400);
    }
    await assertCurrentRateCardPermission(tx, actor);

    if (job.state === "published") {
      return { jobId, state: "published", publishedChanges: 0 };
    }
    if (job.state !== "draft") {
      throw new RateCardPublicationError("IMPORT_JOB_NOT_READY", 409);
    }
    if (job.templateVersion !== TEMPLATE_VERSION_V2) {
      throw new RateCardPublicationError("IMPORT_CHANGE_INVALID", 400);
    }

    const input = parseStagedRateCardImport(job.normalizedPayload);
    const [duplicatePublishedJob] = await tx.select({ id: importJobs.id })
      .from(importJobs)
      .where(and(
        eq(importJobs.dataType, "rate_card"),
        eq(importJobs.state, "published"),
        eq(importJobs.checksum, job.checksum),
      ))
      .limit(1);
    if (duplicatePublishedJob && duplicatePublishedJob.id !== jobId) {
      throw new RateCardPublicationError("IMPORT_DUPLICATE_PUBLISHED", 409);
    }

    const [current] = await tx.select({ id: rateCardVersions.id })
      .from(rateCardVersions)
      .where(eq(rateCardVersions.status, "current"))
      .limit(1)
      .for("update");
    assertRateCardPublicationBaseline(
      input.basedOnVersionId,
      current?.id ?? null,
    );

    const irisIds = [...new Set([
      ...input.buildingPrices.map((row) => row.irisBuildingId.trim()),
      ...input.packageMemberships.map((row) => row.irisBuildingId.trim()),
    ])].sort();
    const packageCodes = [...new Set([
      ...input.packagePrices.map((row) => row.packageCode.trim()),
      ...input.packageMemberships.map((row) => row.packageCode.trim()),
    ])].sort();
    const lockedBuildings = irisIds.length === 0
      ? []
      : await tx.select({
        id: buildings.id,
        irisBuildingId: buildings.irisBuildingId,
        status: buildings.status,
      }).from(buildings)
        .where(inArray(buildings.irisBuildingId, irisIds))
        .orderBy(asc(buildings.irisBuildingId))
        .for("update");
    const lockedPackages = packageCodes.length === 0
      ? []
      : await tx.select({
        id: salesPackages.id,
        packageCode: salesPackages.packageCode,
        status: salesPackages.status,
      }).from(salesPackages)
        .where(inArray(salesPackages.packageCode, packageCodes))
        .orderBy(asc(salesPackages.packageCode))
        .for("update");
    const resolved = assertRateCardPublicationSnapshot(
      input,
      lockedBuildings.map((row) => ({
        ...row,
        status: row.status as "active" | "inactive",
      })),
      lockedPackages.map((row) => ({
        ...row,
        status: row.status as "active" | "inactive",
      })),
    );

    const now = new Date();
    const versionCode = createRateCardVersionCode(now, jobId);
    if (current) {
      const [demoted] = await tx.update(rateCardVersions)
        .set({ status: "historical" })
        .where(and(
          eq(rateCardVersions.id, current.id),
          eq(rateCardVersions.status, "current"),
        ))
        .returning({ id: rateCardVersions.id });
      if (!demoted) {
        throw new RateCardPublicationError("IMPORT_CHANGE_STALE", 409);
      }
    }

    const [version] = await tx.insert(rateCardVersions).values({
      versionCode,
      currency: "IDR",
      status: "current",
      importJobId: jobId,
      uploadedBy: job.uploadedBy,
      uploadedAt: job.createdAt,
      publishedBy: null,
      publishedAt: null,
      updatedAt: now,
    }).returning({ id: rateCardVersions.id });

    if (input.buildingPrices.length > 0) {
      await tx.insert(rateCardBuildingPrices).values(
        input.buildingPrices.map((row) => ({
          rateCardVersionId: version.id,
          buildingId: resolved.buildingIdByIris.get(row.irisBuildingId.trim())!,
          priceIdr: row.priceIdr,
        })),
      );
    }
    if (input.packagePrices.length > 0) {
      await tx.insert(rateCardPackageConfigs).values(
        input.packagePrices.map((row) => ({
          rateCardVersionId: version.id,
          packageId: resolved.packageIdByCode.get(row.packageCode.trim())!,
          priceIdr: row.priceIdr,
        })),
      );
    }
    if (input.packageMemberships.length > 0) {
      await tx.insert(rateCardPackageBuildings).values(
        input.packageMemberships.map((row) => ({
          rateCardVersionId: version.id,
          packageId: resolved.packageIdByCode.get(row.packageCode.trim())!,
          buildingId: resolved.buildingIdByIris.get(row.irisBuildingId.trim())!,
        })),
      );
    }

    const [finalizedVersion] = await tx.update(rateCardVersions).set({
      publishedBy: actor.id,
      publishedAt: now,
      updatedAt: now,
    }).where(and(
      eq(rateCardVersions.id, version.id),
      eq(rateCardVersions.status, "current"),
      isNull(rateCardVersions.publishedAt),
    )).returning({ id: rateCardVersions.id });
    if (!finalizedVersion) {
      throw new RateCardPublicationError("IMPORT_JOB_NOT_READY", 409);
    }

    const [published] = await tx.update(importJobs).set({
      state: "published",
      publishedBy: actor.id,
      publishedAt: now,
      updatedAt: now,
    }).where(and(
      eq(importJobs.id, jobId),
      eq(importJobs.state, "draft"),
    )).returning({ id: importJobs.id });
    if (!published) {
      throw new RateCardPublicationError("IMPORT_JOB_NOT_READY", 409);
    }

    const versionMetadata = rateCardAuditMetadata(input, resolved, versionCode);
    await tx.insert(auditEvents).values([
      ...(current ? [{
        actorUserId: actor.id,
        action: "import.rate_card.historical",
        entityType: "rate_card_version",
        entityId: current.id,
        importJobId: jobId,
        source: "import",
        beforeMetadata: { status: "current" },
        afterMetadata: { status: "historical" },
        createdAt: now,
      }] : []),
      {
        actorUserId: actor.id,
        action: "import.rate_card.published",
        entityType: "rate_card_version",
        entityId: version.id,
        importJobId: jobId,
        source: "import",
        afterMetadata: { ...versionMetadata, status: "current" },
        createdAt: now,
      },
      {
        actorUserId: actor.id,
        action: "import.job.published",
        entityType: "import_job",
        entityId: jobId,
        importJobId: jobId,
        source: "import",
        beforeMetadata: { state: "draft" },
        afterMetadata: {
          state: "published",
          rateCardVersionId: version.id,
          versionCode,
        },
        createdAt: now,
      },
    ]);

    return {
      jobId,
      state: "published",
      publishedChanges: input.buildingPrices.length
        + input.packagePrices.length
        + input.packageMemberships.length
        + 1,
    };
  });
}

type PublicationTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];

async function assertCurrentRateCardPermission(
  tx: PublicationTransaction,
  actor: SessionUser,
): Promise<void> {
  const [authorized] = await tx.select({ id: users.id }).from(users)
    .innerJoin(
      userPermissions,
      and(
        eq(userPermissions.userId, users.id),
        eq(userPermissions.permissionKey, "rate_card.publish"),
      ),
    )
    .where(and(eq(users.id, actor.id), eq(users.status, "active")))
    .limit(1);
  if (!authorized) {
    throw new RateCardPublicationError("PERMISSION_DENIED", 403);
  }
}

export function parseStagedRateCardImport(value: unknown): StagedRateCardImport {
  if (!isRecord(value)) invalidChange();
  if (
    value.templateVersion !== TEMPLATE_VERSION_V2
    || value.currency !== "IDR"
    || (
      value.basedOnVersionId !== null
      && !isUuid(value.basedOnVersionId)
    )
    || !Array.isArray(value.buildingPrices)
    || !Array.isArray(value.packagePrices)
    || !Array.isArray(value.packageMemberships)
  ) {
    invalidChange();
  }

  const parsed: StagedRateCardImport = {
    templateVersion: TEMPLATE_VERSION_V2,
    currency: "IDR",
    basedOnVersionId: value.basedOnVersionId as string | null,
    buildingPrices: value.buildingPrices as StagedRateCardImport["buildingPrices"],
    packagePrices: value.packagePrices as StagedRateCardImport["packagePrices"],
    packageMemberships: value.packageMemberships as StagedRateCardImport["packageMemberships"],
  };
  assertRateCardRows(parsed);
  return parsed;
}

function assertRateCardRows(input: StagedRateCardImport): void {
  const canonicalIdr = /^(?:0|[1-9]\d*)$/u;
  if (
    input.buildingPrices.some((row) =>
      !isRecord(row)
      || !Number.isInteger(row.rowNumber)
      || (row.rowNumber as number) < 1
      || typeof row.irisBuildingId !== "string"
      || row.irisBuildingId.trim().length === 0
      || typeof row.priceIdr !== "string"
      || !canonicalIdr.test(row.priceIdr))
    || input.packagePrices.some((row) =>
      !isRecord(row)
      || !Number.isInteger(row.rowNumber)
      || (row.rowNumber as number) < 1
      || typeof row.packageCode !== "string"
      || row.packageCode.trim().length === 0
      || typeof row.priceIdr !== "string"
      || !canonicalIdr.test(row.priceIdr))
    || input.packageMemberships.some((row) =>
      !isRecord(row)
      || !Number.isInteger(row.rowNumber)
      || (row.rowNumber as number) < 1
      || typeof row.packageCode !== "string"
      || row.packageCode.trim().length === 0
      || typeof row.irisBuildingId !== "string"
      || row.irisBuildingId.trim().length === 0)
  ) {
    invalidChange();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function invalidChange(): never {
  throw new RateCardPublicationError("IMPORT_CHANGE_INVALID", 400);
}
