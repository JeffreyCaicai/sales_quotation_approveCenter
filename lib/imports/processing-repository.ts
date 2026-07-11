import { and, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { buildingControlledValues, buildings, importChanges, importErrors, importFiles, importJobs, rateCardVersions, salesPackages, userPermissions, users } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import type { ImportChange } from "@/lib/imports/diff";
import type { ImportValidationError } from "@/lib/imports/errors";
import type { ImportProcessingRepository } from "@/lib/imports/process-import";
import type { BuildingImport, RateCardImport } from "@/lib/imports/template-v2";

export class PostgresImportProcessingRepository implements ImportProcessingRepository {
  async claim(jobId: string, actor: SessionUser) {
    return getDb().transaction(async (tx) => {
      const [candidate] = await tx.select({ dataType: importJobs.dataType, state: importJobs.state })
        .from(importJobs).where(eq(importJobs.id, jobId)).limit(1).for("update");
      if (!candidate) throw new Error("IMPORT_JOB_NOT_FOUND");
      if (candidate.state !== "uploaded") return { kind: "terminal" as const, state: candidate.state };
      if (candidate.dataType !== "building" && candidate.dataType !== "rate_card") throw new Error("IMPORT_DATA_TYPE_UNSUPPORTED");
      const permission = candidate.dataType === "building" ? "data.import.building" : "rate_card.upload";
      const [authorized] = await tx.select({ id: users.id }).from(users)
        .innerJoin(userPermissions, and(eq(userPermissions.userId, users.id), eq(userPermissions.permissionKey, permission)))
        .where(and(eq(users.id, actor.id), eq(users.status, "active"))).limit(1);
      if (!authorized) throw new Error("PERMISSION_DENIED");
      await tx.update(importJobs).set({ state: "validating", updatedAt: new Date() })
        .where(and(eq(importJobs.id, jobId), eq(importJobs.state, "uploaded")));
      const [job] = await tx.select({ id: importJobs.id, dataType: importJobs.dataType, templateVersion: importJobs.templateVersion })
        .from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
      const files = await tx.select({ objectStorageKey: importFiles.objectStorageKey, originalFilename: importFiles.originalFilename, checksum: importFiles.checksum })
        .from(importFiles).where(eq(importFiles.importJobId, jobId));
      return { kind: "claimed" as const, job: { ...job!, dataType: job!.dataType as "building" | "rate_card", files } };
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

  async rateCardSnapshot() {
    const [buildingSnapshot, packages, versions] = await Promise.all([
      this.buildingSnapshot(),
      getDb().select({ packageCode: salesPackages.packageCode, status: salesPackages.status }).from(salesPackages),
      getDb().select({ versionCode: rateCardVersions.versionCode }).from(rateCardVersions),
    ]);
    return { ...buildingSnapshot, packages: packages.map((item) => ({ ...item, status: item.status as "active" | "inactive" })), versionCodes: versions.map((item) => item.versionCode) };
  }

  async completeBuilding(jobId: string, normalized: BuildingImport, changes: ImportChange[]) {
    await getDb().transaction(async (tx) => {
      await tx.delete(importErrors).where(eq(importErrors.importJobId, jobId));
      await tx.delete(importChanges).where(eq(importChanges.importJobId, jobId));
      if (changes.length) await tx.insert(importChanges).values(changes.map((change) => ({ importJobId: jobId, entityType: "building", entityId: change.before?.id ?? null, changeType: change.type, beforeValue: change.before, afterValue: change.after })));
      const [updated] = await tx.update(importJobs).set({ state: "ready_to_publish", normalizedPayload: normalized, totalRows: normalized.rows.length, validRows: normalized.rows.length, invalidRows: 0, failureSummary: null, updatedAt: new Date() })
        .where(and(eq(importJobs.id, jobId), eq(importJobs.state, "validating"))).returning({ id: importJobs.id });
      if (!updated) throw new Error("IMPORT_JOB_NOT_PROCESSABLE");
    });
  }

  async completeRateCard(jobId: string, normalized: RateCardImport) {
    await getDb().transaction(async (tx) => {
      await tx.delete(importErrors).where(eq(importErrors.importJobId, jobId));
      await tx.delete(importChanges).where(eq(importChanges.importJobId, jobId));
      await tx.insert(importChanges).values({ importJobId: jobId, entityType: "rate_card", changeType: "added", beforeValue: null, afterValue: normalized });
      const totalRows = normalized.buildingPrices.length + normalized.packagePrices.length + normalized.packageBuildings.length;
      const [updated] = await tx.update(importJobs).set({ state: "draft", normalizedPayload: normalized, totalRows, validRows: totalRows, invalidRows: 0, failureSummary: null, updatedAt: new Date() })
        .where(and(eq(importJobs.id, jobId), eq(importJobs.state, "validating"))).returning({ id: importJobs.id });
      if (!updated) throw new Error("IMPORT_JOB_NOT_PROCESSABLE");
    });
  }

  async fail(jobId: string, errors: ImportValidationError[]) {
    await getDb().transaction(async (tx) => {
      await tx.delete(importChanges).where(eq(importChanges.importJobId, jobId));
      await tx.delete(importErrors).where(eq(importErrors.importJobId, jobId));
      if (errors.length) await tx.insert(importErrors).values(errors.map((error) => ({ importJobId: jobId, sheetName: error.sheet, rowNumber: error.rowNumber, columnName: error.column, errorKey: error.key, localizedParameters: error.params })));
      await tx.update(importJobs).set({ state: "validation_failed", invalidRows: new Set(errors.map((error) => error.rowNumber).filter(Boolean)).size, validRows: 0, failureSummary: errors[0]?.key ?? "import.error.file_invalid", updatedAt: new Date() })
        .where(and(eq(importJobs.id, jobId), eq(importJobs.state, "validating")));
    });
  }
}
