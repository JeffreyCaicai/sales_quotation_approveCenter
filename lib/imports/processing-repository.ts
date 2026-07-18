import { and, eq, lte } from "drizzle-orm";

import { getDb } from "@/db";
import { buildingControlledValues, buildings, importChanges, importErrors, importFiles, importJobs, rateCardBuildingPrices, rateCardPackageBuildings, rateCardPackageConfigs, rateCardVersions, salesPackages, userPermissions, users } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import type { ImportChange } from "@/lib/imports/diff";
import type { PackageChange, PackageSnapshot } from "@/lib/imports/package-diff";
import type { RateCardChange } from "@/lib/imports/rate-card-diff";
import type { ImportValidationError } from "@/lib/imports/errors";
import type { ImportProcessingRepository } from "@/lib/imports/process-import";
import type { BuildingImport, PackageImport, StagedRateCardImport } from "@/lib/imports/template-v2";
import { ImportProcessingError } from "@/lib/imports/processing-errors";

export const PROCESSING_STALE_AFTER_MS = 15 * 60 * 1000;

export function processingClaimIsStale(updatedAt: Date, now: Date): boolean {
  return updatedAt.getTime() <= now.getTime() - PROCESSING_STALE_AFTER_MS;
}

export function assertPreliminaryDataType(preliminary: string, locked: string): void {
  if (preliminary !== locked) throw new ImportProcessingError("IMPORT_JOB_NOT_PROCESSABLE", 409);
}

const processingPermission = {
  customer_brand: "data.import.customer_brand",
  building: "data.import.building",
  package: "data.import.package",
  rate_card: "rate_card.upload",
} as const;

export class PostgresImportProcessingRepository implements ImportProcessingRepository {
  async claim(jobId: string, actor: SessionUser, now: Date) {
    return getDb().transaction(async (tx) => {
      const [candidate] = await tx.select({ dataType: importJobs.dataType })
        .from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
      if (!candidate) {
        const [activeActor] = await tx.select({ id: users.id }).from(users)
          .where(and(eq(users.id, actor.id), eq(users.status, "active"))).limit(1);
        if (!activeActor) throw new ImportProcessingError("PERMISSION_DENIED", 403);
        throw new ImportProcessingError("IMPORT_JOB_NOT_FOUND", 404);
      }
      const permission = processingPermission[candidate.dataType];
      const [authorized] = await tx.select({ id: users.id }).from(users)
        .innerJoin(userPermissions, and(eq(userPermissions.userId, users.id), eq(userPermissions.permissionKey, permission)))
        .where(and(eq(users.id, actor.id), eq(users.status, "active"))).limit(1);
      if (!authorized) throw new ImportProcessingError("PERMISSION_DENIED", 403);
      if (candidate.dataType !== "building" && candidate.dataType !== "package" && candidate.dataType !== "rate_card") {
        return { kind: "unsupported" as const, dataType: candidate.dataType };
      }

      const [job] = await tx.select({ id: importJobs.id, dataType: importJobs.dataType, templateVersion: importJobs.templateVersion, state: importJobs.state, updatedAt: importJobs.updatedAt })
        .from(importJobs).where(eq(importJobs.id, jobId)).limit(1).for("update");
      if (!job) throw new ImportProcessingError("IMPORT_JOB_NOT_FOUND", 404);
      assertPreliminaryDataType(candidate.dataType, job.dataType);
      const reclaiming = job.state === "validating" && processingClaimIsStale(job.updatedAt, now);
      if (job.state !== "uploaded" && !reclaiming) return { kind: "terminal" as const, state: job.state };

      const staleBefore = new Date(now.getTime() - PROCESSING_STALE_AFTER_MS);
      const stateCondition = reclaiming
        ? and(eq(importJobs.state, "validating"), lte(importJobs.updatedAt, staleBefore))
        : eq(importJobs.state, "uploaded");
      const [claimed] = await tx.update(importJobs).set({ state: "validating", updatedAt: now })
        .where(and(eq(importJobs.id, jobId), stateCondition)).returning({ id: importJobs.id });
      if (!claimed) throw new ImportProcessingError("IMPORT_JOB_PROCESSING", 409);
      const files = await tx.select({ objectStorageKey: importFiles.objectStorageKey, originalFilename: importFiles.originalFilename, checksum: importFiles.checksum })
        .from(importFiles).where(eq(importFiles.importJobId, jobId));
      return { kind: "claimed" as const, job: { id: job.id, dataType: job.dataType as "building" | "package" | "rate_card", templateVersion: job.templateVersion, claimToken: now.toISOString(), files } };
    });
  }

  async buildingSnapshot() {
    const [rows, controls] = await Promise.all([
      getDb().select({ id: buildings.id, irisBuildingId: buildings.irisBuildingId, erpBuildingId: buildings.erpBuildingId, buildingName: buildings.name, buildingType: buildings.buildingType, gradeResource: buildings.gradeResource, area: buildings.area, city: buildings.city, cbdArea: buildings.cbdArea, subDistrict: buildings.subDistrict, address: buildings.address, status: buildings.status, dataSource: buildings.dataSource }).from(buildings),
      getDb().select({ field: buildingControlledValues.field, value: buildingControlledValues.value }).from(buildingControlledValues).where(eq(buildingControlledValues.status, "active")),
    ]);
    return {
      buildings: rows.map((row) => ({ ...row, status: row.status as "active" | "inactive", dataSource: row.dataSource as "building_team" | "erp" })),
      controlledValues: {
        buildingTypes: controls.filter((item) => item.field === "building_type").map((item) => item.value),
        gradeResources: controls.filter((item) => item.field === "grade_resource").map((item) => item.value),
      },
    };
  }

  async loadRateCardSnapshot() {
    const [buildingSnapshot, packages, currentVersions] = await Promise.all([
      this.buildingSnapshot(),
      getDb().select({ packageCode: salesPackages.packageCode, status: salesPackages.status }).from(salesPackages),
      getDb().select({ id: rateCardVersions.id }).from(rateCardVersions)
        .where(eq(rateCardVersions.status, "current"))
        .limit(1),
    ]);
    const currentVersion = currentVersions[0];
    if (!currentVersion) {
      return {
        ...buildingSnapshot,
        packages: packages.map((item) => ({ ...item, status: item.status as "active" | "inactive" })),
        versionId: null,
        buildingPrices: new Map<string, string>(),
        packagePrices: new Map<string, string>(),
        packageMemberships: new Set<string>(),
      };
    }

    const [buildingPrices, packagePrices, packageMemberships] = await Promise.all([
      getDb().select({
        irisBuildingId: buildings.irisBuildingId,
        priceIdr: rateCardBuildingPrices.priceIdr,
      }).from(rateCardBuildingPrices)
        .innerJoin(buildings, eq(rateCardBuildingPrices.buildingId, buildings.id))
        .where(eq(rateCardBuildingPrices.rateCardVersionId, currentVersion.id)),
      getDb().select({
        packageCode: salesPackages.packageCode,
        priceIdr: rateCardPackageConfigs.priceIdr,
      }).from(rateCardPackageConfigs)
        .innerJoin(salesPackages, eq(rateCardPackageConfigs.packageId, salesPackages.id))
        .where(eq(rateCardPackageConfigs.rateCardVersionId, currentVersion.id)),
      getDb().select({
        packageCode: salesPackages.packageCode,
        irisBuildingId: buildings.irisBuildingId,
      }).from(rateCardPackageBuildings)
        .innerJoin(salesPackages, eq(rateCardPackageBuildings.packageId, salesPackages.id))
        .innerJoin(buildings, eq(rateCardPackageBuildings.buildingId, buildings.id))
        .where(eq(rateCardPackageBuildings.rateCardVersionId, currentVersion.id)),
    ]);
    return {
      ...buildingSnapshot,
      packages: packages.map((item) => ({ ...item, status: item.status as "active" | "inactive" })),
      versionId: currentVersion.id,
      buildingPrices: new Map(buildingPrices.map((item) => [item.irisBuildingId, String(item.priceIdr)])),
      packagePrices: new Map(packagePrices.map((item) => [item.packageCode, String(item.priceIdr)])),
      packageMemberships: new Set(packageMemberships.map((item) => `${item.packageCode}:${item.irisBuildingId}`)),
    };
  }

  async packageSnapshot() {
    const packages = await getDb().select({
      packageCode: salesPackages.packageCode,
      packageName: salesPackages.name,
      status: salesPackages.status,
    }).from(salesPackages);
    return {
      packages: packages.map((item): PackageSnapshot => ({
        packageCode: item.packageCode.trim(),
        packageName: item.packageName.trim(),
        status: item.status as "active" | "inactive",
      })),
    };
  }

  async completeBuilding(jobId: string, claimToken: string, normalized: BuildingImport, changes: ImportChange[]) {
    await getDb().transaction(async (tx) => {
      const [updated] = await tx.update(importJobs).set({ state: "ready_to_publish", normalizedPayload: normalized, totalRows: normalized.rows.length, validRows: normalized.rows.length, invalidRows: 0, failureSummary: null, updatedAt: new Date() })
        .where(and(eq(importJobs.id, jobId), eq(importJobs.state, "validating"), eq(importJobs.updatedAt, new Date(claimToken)))).returning({ id: importJobs.id });
      if (!updated) throw new ImportProcessingError("IMPORT_JOB_PROCESSING", 409);
      await tx.delete(importErrors).where(eq(importErrors.importJobId, jobId));
      await tx.delete(importChanges).where(eq(importChanges.importJobId, jobId));
      if (changes.length) await tx.insert(importChanges).values(changes.map((change) => ({ importJobId: jobId, entityType: "building", entityId: change.before?.id ?? null, changeType: change.type, beforeValue: change.before, afterValue: change.after })));
    });
  }

  async completePackage(jobId: string, claimToken: string, normalized: PackageImport, changes: PackageChange[]) {
    await getDb().transaction(async (tx) => {
      const [updated] = await tx.update(importJobs).set({ state: "ready_to_publish", normalizedPayload: normalized, totalRows: normalized.rows.length, validRows: normalized.rows.length, invalidRows: 0, failureSummary: null, updatedAt: new Date() })
        .where(and(eq(importJobs.id, jobId), eq(importJobs.state, "validating"), eq(importJobs.updatedAt, new Date(claimToken)))).returning({ id: importJobs.id });
      if (!updated) throw new ImportProcessingError("IMPORT_JOB_PROCESSING", 409);
      await tx.delete(importErrors).where(eq(importErrors.importJobId, jobId));
      await tx.delete(importChanges).where(eq(importChanges.importJobId, jobId));
      if (changes.length) await tx.insert(importChanges).values(changes.map((change) => ({
        importJobId: jobId,
        entityType: "package",
        changeType: change.changeType,
        beforeValue: change.before,
        afterValue: { rowNumber: change.rowNumber, ...change.after },
      })));
    });
  }

  async completeRateCard(jobId: string, claimToken: string, normalized: StagedRateCardImport, changes: RateCardChange[]) {
    await getDb().transaction(async (tx) => {
      const totalRows = normalized.buildingPrices.length + normalized.packagePrices.length + normalized.packageMemberships.length;
      const [updated] = await tx.update(importJobs).set({ state: "draft", normalizedPayload: normalized, totalRows, validRows: totalRows, invalidRows: 0, failureSummary: null, updatedAt: new Date() })
        .where(and(eq(importJobs.id, jobId), eq(importJobs.state, "validating"), eq(importJobs.updatedAt, new Date(claimToken)))).returning({ id: importJobs.id });
      if (!updated) throw new ImportProcessingError("IMPORT_JOB_PROCESSING", 409);
      await tx.delete(importErrors).where(eq(importErrors.importJobId, jobId));
      await tx.delete(importChanges).where(eq(importChanges.importJobId, jobId));
      if (changes.length) await tx.insert(importChanges).values(changes.map((change) => ({
        importJobId: jobId,
        entityType: "rate_card",
        changeType: change.changeType,
        beforeValue: change.before === null ? null : { entityKey: change.entityKey, ...change.before },
        afterValue: change.after === null ? null : { entityKey: change.entityKey, ...change.after },
      })));
    });
  }

  async fail(jobId: string, claimToken: string, errors: ImportValidationError[]) {
    await getDb().transaction(async (tx) => {
      const [updated] = await tx.update(importJobs).set({ state: "validation_failed", invalidRows: new Set(errors.map((error) => error.rowNumber).filter(Boolean)).size, validRows: 0, failureSummary: errors[0]?.key ?? "import.error.file_invalid", updatedAt: new Date() })
        .where(and(eq(importJobs.id, jobId), eq(importJobs.state, "validating"), eq(importJobs.updatedAt, new Date(claimToken)))).returning({ id: importJobs.id });
      if (!updated) throw new ImportProcessingError("IMPORT_JOB_PROCESSING", 409);
      await tx.delete(importChanges).where(eq(importChanges.importJobId, jobId));
      await tx.delete(importErrors).where(eq(importErrors.importJobId, jobId));
      if (errors.length) await tx.insert(importErrors).values(errors.map((error) => ({ importJobId: jobId, sheetName: error.sheet, rowNumber: error.rowNumber, columnName: error.column, errorKey: error.key, localizedParameters: error.params })));
    });
  }

  async retry(jobId: string, claimToken: string, failureSummary: string) {
    const [updated] = await getDb().update(importJobs).set({
      state: "uploaded",
      failureSummary: `IMPORT_PROCESSING_RETRYABLE:${failureSummary}`,
      updatedAt: new Date(),
    }).where(and(
      eq(importJobs.id, jobId),
      eq(importJobs.state, "validating"),
      eq(importJobs.updatedAt, new Date(claimToken)),
    )).returning({ id: importJobs.id });
    if (!updated) throw new ImportProcessingError("IMPORT_JOB_PROCESSING", 409);
  }
}
