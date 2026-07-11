import type { SessionUser } from "@/lib/auth/session";
import type { ImportDataType, ImportState } from "@/db/enums";
import type { BuildingDiffSnapshot, ImportChange } from "@/lib/imports/diff";
import { calculateBuildingDiff } from "@/lib/imports/diff";
import type { ImportValidationError } from "@/lib/imports/errors";
import { sortImportValidationErrors } from "@/lib/imports/errors";
import { parseImportFiles } from "@/lib/imports/normalize";
import { PostgresImportProcessingRepository } from "@/lib/imports/processing-repository";
import { RateCardBuildingResolutionError, resolveRateCardBuildingReferences } from "@/lib/imports/resolve-rate-card-building-references";
import { ImportParseError, type BuildingImport, type RateCardImport } from "@/lib/imports/template-v2";
import { validateBuildingRows, type BuildingValidationSnapshot } from "@/lib/imports/validate";
import { S3ObjectStore } from "@/lib/storage/s3-object-store";

export interface ProcessingJob {
  id: string;
  dataType: Extract<ImportDataType, "building" | "rate_card">;
  templateVersion: string;
  files: Array<{ objectStorageKey: string; originalFilename: string; checksum: string }>;
}

export interface RateCardProcessingSnapshot extends BuildingValidationSnapshot {
  packages: Array<{ packageCode: string; status: "active" | "inactive" }>;
  versionCodes: string[];
}

export interface ImportProcessingRepository {
  claim(jobId: string, actor: SessionUser): Promise<
    | { kind: "claimed"; job: ProcessingJob }
    | { kind: "terminal"; state: ImportState }
  >;
  buildingSnapshot(): Promise<BuildingValidationSnapshot & BuildingDiffSnapshot>;
  rateCardSnapshot(): Promise<RateCardProcessingSnapshot>;
  completeBuilding(jobId: string, normalized: BuildingImport, changes: ImportChange[]): Promise<void>;
  completeRateCard(jobId: string, normalized: RateCardImport): Promise<void>;
  fail(jobId: string, errors: ImportValidationError[]): Promise<void>;
}

interface ProcessingObjectStore {
  readImmutable(key: string, sha256: string): Promise<Uint8Array>;
}

export interface ProcessImportDependencies {
  repository: ImportProcessingRepository;
  objectStore: ProcessingObjectStore;
}

export async function processImport(
  jobId: string,
  actor: SessionUser,
  dependencies: ProcessImportDependencies = {
    repository: new PostgresImportProcessingRepository(),
    objectStore: S3ObjectStore.fromEnv(),
  },
): Promise<{ jobId: string; state: "ready_to_publish" | "draft" | "validation_failed" }> {
  const claimed = await dependencies.repository.claim(jobId, actor);
  if (claimed.kind === "terminal") {
    if (claimed.state === "ready_to_publish" || claimed.state === "draft" || claimed.state === "validation_failed") {
      return { jobId, state: claimed.state };
    }
    throw new Error("IMPORT_JOB_NOT_PROCESSABLE");
  }

  const { job } = claimed;
  try {
    const files = await Promise.all(job.files.map(async (file) => ({
      filename: file.originalFilename,
      body: await dependencies.objectStore.readImmutable(file.objectStorageKey, file.checksum),
    })));
    if (job.dataType === "building") {
      const normalized = await parseImportFiles("building", files);
      const snapshot = await dependencies.repository.buildingSnapshot();
      const errors = validateBuildingRows(normalized.rows, snapshot);
      if (errors.length > 0) return fail(jobId, errors, dependencies.repository);
      const changes = calculateBuildingDiff(normalized.rows, snapshot);
      await dependencies.repository.completeBuilding(jobId, normalized, changes);
      return { jobId, state: "ready_to_publish" };
    }

    const normalized = await parseImportFiles("rate_card", files);
    const snapshot = await dependencies.repository.rateCardSnapshot();
    const errors = validateRateCard(normalized, snapshot);
    if (errors.length > 0) return fail(jobId, errors, dependencies.repository);
    await dependencies.repository.completeRateCard(jobId, normalized);
    return { jobId, state: "draft" };
  } catch (error) {
    const errors = processingErrors(error);
    await dependencies.repository.fail(jobId, errors);
    return { jobId, state: "validation_failed" };
  }
}

async function fail(
  jobId: string,
  errors: ImportValidationError[],
  repository: ImportProcessingRepository,
): Promise<{ jobId: string; state: "validation_failed" }> {
  await repository.fail(jobId, sortImportValidationErrors(errors));
  return { jobId, state: "validation_failed" };
}

function processingErrors(error: unknown): ImportValidationError[] {
  if (error instanceof RateCardBuildingResolutionError) return error.errors;
  if (error instanceof ImportParseError) {
    return [{
      sheet: String(error.details.sheet ?? "File"),
      rowNumber: Number(error.details.rowNumber ?? 0),
      column: String(error.details.column ?? ""),
      key: error.key,
      params: Object.fromEntries(Object.entries(error.details).filter(([, value]) =>
        typeof value === "string" || typeof value === "number")) as Record<string, string | number>,
    }];
  }
  return [{ sheet: "File", rowNumber: 0, column: "", key: "import.error.file_invalid", params: {} }];
}

function validateRateCard(
  input: RateCardImport,
  snapshot: RateCardProcessingSnapshot,
): ImportValidationError[] {
  const errors: ImportValidationError[] = [];
  try {
    resolveRateCardBuildingReferences(input, snapshot);
  } catch (error) {
    if (error instanceof RateCardBuildingResolutionError) errors.push(...error.errors);
    else throw error;
  }
  const activePackages = new Set(snapshot.packages.filter((item) => item.status === "active").map((item) => item.packageCode));
  const knownPackages = new Set(snapshot.packages.map((item) => item.packageCode));
  for (const row of [...input.packagePrices, ...input.packageBuildings]) {
    const sheet = "priceIdr" in row ? "Package Prices" : "Package Buildings";
    if (!knownPackages.has(row.packageCode)) {
      errors.push({ sheet, rowNumber: row.rowNumber, column: "Package Code", key: "import.error.package_not_found", params: { packageCode: row.packageCode } });
    } else if (!activePackages.has(row.packageCode)) {
      errors.push({ sheet, rowNumber: row.rowNumber, column: "Package Code", key: "import.error.package_inactive", params: { packageCode: row.packageCode } });
    }
  }
  if (!input.versionCode || snapshot.versionCodes.includes(input.versionCode)) {
    errors.push({ sheet: "Metadata", rowNumber: 2, column: "Version Code", key: "import.error.rate_card_version_invalid", params: { versionCode: input.versionCode } });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.effectiveDate)) {
    errors.push({ sheet: "Metadata", rowNumber: 3, column: "Effective Date", key: "import.error.value_invalid", params: {} });
  }
  for (const row of [...input.buildingPrices, ...input.packagePrices]) {
    if (!/^[1-9]\d*$/u.test(row.priceIdr)) {
      errors.push({ sheet: "priceIdr" in row && "irisBuildingId" in row ? "Building Prices" : "Package Prices", rowNumber: row.rowNumber, column: "Price IDR", key: "import.error.value_invalid", params: {} });
    }
  }
  return sortImportValidationErrors(errors);
}
