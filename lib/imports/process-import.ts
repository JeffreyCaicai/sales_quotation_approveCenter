import { randomUUID } from "node:crypto";

import type { SessionUser } from "@/lib/auth/session";
import type { ImportDataType, ImportState } from "@/db/enums";
import type { BuildingDiffSnapshot, ImportChange } from "@/lib/imports/diff";
import { calculateBuildingDiff } from "@/lib/imports/diff";
import { calculatePackageDiff, type PackageChange, type PackageSnapshot } from "@/lib/imports/package-diff";
import { calculateRateCardDiff, type RateCardChange, type RateCardDiffSnapshot } from "@/lib/imports/rate-card-diff";
import type { ImportValidationError } from "@/lib/imports/errors";
import { sortImportValidationErrors } from "@/lib/imports/errors";
import { parseImportFiles, toValidatedBuildingImport, toValidatedPackageImport } from "@/lib/imports/normalize";
import { PostgresImportProcessingRepository } from "@/lib/imports/processing-repository";
import { ImportParseError, type BuildingImport, type PackageCandidateImport, type PackageImport, type RateCardImport, type StagedRateCardImport } from "@/lib/imports/template-v2";
import { isValidIdrPrice } from "@/lib/imports/idr-price";
import { validateBuildingRows, validatePackageRows, validateRateCardBuildings, type BuildingValidationSnapshot, type PackageValidationSnapshot } from "@/lib/imports/validate";
import { S3ObjectStore } from "@/lib/storage/s3-object-store";
import { TEMPLATE_VERSION_V2 } from "@/lib/imports/template-v2";
import { ImportProcessingError } from "@/lib/imports/processing-errors";
import { ImportError } from "@/lib/imports/contracts";

export { ImportProcessingError } from "@/lib/imports/processing-errors";

export interface ProcessingJob {
  id: string;
  dataType: Extract<ImportDataType, "building" | "package" | "rate_card">;
  templateVersion: string;
  claimToken: string;
  files: Array<{ objectStorageKey: string; originalFilename: string; checksum: string }>;
}

export interface RateCardProcessingSnapshot extends BuildingValidationSnapshot, RateCardDiffSnapshot {
  packages: Array<{ packageCode: string; status: "active" | "inactive" }>;
}

export interface PackageProcessingSnapshot extends PackageValidationSnapshot {
  packages: PackageSnapshot[];
}

export interface ImportProcessingRepository {
  claim(jobId: string, actor: SessionUser, now: Date): Promise<
    | { kind: "claimed"; job: ProcessingJob }
    | { kind: "terminal"; state: ImportState }
    | { kind: "unsupported"; dataType: Exclude<ImportDataType, "building" | "package" | "rate_card"> }
  >;
  buildingSnapshot(): Promise<BuildingValidationSnapshot & BuildingDiffSnapshot>;
  packageSnapshot(): Promise<PackageProcessingSnapshot>;
  loadRateCardSnapshot(): Promise<RateCardProcessingSnapshot>;
  completeBuilding(jobId: string, claimToken: string, normalized: BuildingImport, changes: ImportChange[]): Promise<void>;
  completePackage(jobId: string, claimToken: string, normalized: PackageImport, changes: PackageChange[]): Promise<void>;
  completeRateCard(jobId: string, claimToken: string, normalized: StagedRateCardImport, changes: RateCardChange[]): Promise<void>;
  fail(jobId: string, claimToken: string, errors: ImportValidationError[]): Promise<void>;
  processingFailure(
    jobId: string,
    claimToken: string,
    actorId: string,
    failure: ProcessingFailure,
  ): Promise<void>;
}

export interface ReprocessingImportRepository extends ImportProcessingRepository {
  claimReprocess(jobId: string, actor: SessionUser, now: Date): ReturnType<ImportProcessingRepository["claim"]>;
}

export interface ProcessingFailure {
  code: "IMPORT_PROCESSING_RETRYABLE" | "IMPORT_PROCESSING_TERMINAL";
  incidentId: string;
  retryable: boolean;
}

export interface ProcessingFailureLogEntry {
  incidentId: string;
  jobId: string;
  error: unknown;
}

interface ProcessingObjectStore {
  readImmutable(key: string, sha256: string): Promise<Uint8Array>;
}

export interface ProcessImportDependencies {
  repository: ImportProcessingRepository;
  objectStore: ProcessingObjectStore;
  now?: () => Date;
  randomUUID?: () => string;
  logError?: (entry: ProcessingFailureLogEntry) => void;
}

export interface ReprocessImportDependencies extends Omit<ProcessImportDependencies, "repository"> {
  repository: ReprocessingImportRepository;
}

export type ProcessImportResult =
  | { jobId: string; state: "ready_to_publish" | "draft" | "validation_failed" }
  | { jobId: string; state: "processing_failed"; failure: ProcessingFailure };

export async function processImport(
  jobId: string,
  actor: SessionUser,
  dependencies: ProcessImportDependencies = {
    repository: new PostgresImportProcessingRepository(),
    objectStore: S3ObjectStore.fromEnv(),
  },
): Promise<ProcessImportResult> {
  const claimed = await dependencies.repository.claim(jobId, actor, dependencies.now?.() ?? new Date());
  return processClaim(jobId, actor, claimed, dependencies);
}

export async function reprocessImport(
  jobId: string,
  actor: SessionUser,
  dependencies: ReprocessImportDependencies = {
    repository: new PostgresImportProcessingRepository(),
    objectStore: S3ObjectStore.fromEnv(),
  },
): Promise<ProcessImportResult> {
  const claimed = await dependencies.repository.claimReprocess(jobId, actor, dependencies.now?.() ?? new Date());
  if (claimed.kind !== "claimed") {
    if (claimed.kind === "terminal" && claimed.state === "validating") {
      throw new ImportProcessingError("IMPORT_JOB_PROCESSING", 409);
    }
    throw new ImportProcessingError("IMPORT_JOB_NOT_PROCESSABLE", 409);
  }
  return processClaim(jobId, actor, claimed, dependencies);
}

async function processClaim(
  jobId: string,
  actor: SessionUser,
  claimed: Awaited<ReturnType<ImportProcessingRepository["claim"]>>,
  dependencies: ProcessImportDependencies,
): Promise<ProcessImportResult> {
  if (claimed.kind === "unsupported") {
    throw new ImportProcessingError("IMPORT_PROCESSOR_NOT_IMPLEMENTED", 501);
  }
  if (claimed.kind === "terminal") {
    if (claimed.state === "ready_to_publish" || claimed.state === "draft" || claimed.state === "validation_failed") {
      return { jobId, state: claimed.state };
    }
    if (claimed.state === "validating") throw new ImportProcessingError("IMPORT_JOB_PROCESSING", 409);
    throw new ImportProcessingError("IMPORT_JOB_NOT_PROCESSABLE", 409);
  }

  const { job } = claimed;
  if (job.templateVersion !== TEMPLATE_VERSION_V2) {
    return fail(jobId, job.claimToken, [{
      sheet: "File", rowNumber: 0, column: "Template Version",
      key: "import.error.template_version", params: {},
    }], dependencies.repository);
  }
  try {
    const files = await Promise.all(job.files.map(async (file) => ({
      filename: file.originalFilename,
      body: await dependencies.objectStore.readImmutable(file.objectStorageKey, file.checksum),
    })));
    if (job.dataType === "building") {
      const candidate = await parseImportFiles("building", files);
      const snapshot = await dependencies.repository.buildingSnapshot();
      const errors = validateBuildingRows(candidate.rows, snapshot);
      if (errors.length > 0) return fail(jobId, job.claimToken, errors, dependencies.repository);
      const normalized = toValidatedBuildingImport(candidate);
      const changes = calculateBuildingDiff(normalized.rows, snapshot);
      await dependencies.repository.completeBuilding(jobId, job.claimToken, normalized, changes);
      return { jobId, state: "ready_to_publish" };
    }

    if (job.dataType === "package") {
      const candidate = await parseImportFiles("package", files);
      const snapshot = await dependencies.repository.packageSnapshot();
      const errors = [
        ...validatePackageRows(candidate.rows, snapshot),
        ...validatePackageMasterNameIdentity(candidate, snapshot),
      ];
      if (errors.length > 0) return fail(jobId, job.claimToken, errors, dependencies.repository);
      const normalized = toValidatedPackageImport(candidate);
      const changes = calculatePackageDiff(normalized.rows, snapshot.packages);
      await dependencies.repository.completePackage(jobId, job.claimToken, normalized, changes);
      return { jobId, state: "ready_to_publish" };
    }

    const normalized = await parseImportFiles("rate_card", files);
    const snapshot = await dependencies.repository.loadRateCardSnapshot();
    const errors = validateRateCardForProcessing(normalized, snapshot);
    if (errors.length > 0) return fail(jobId, job.claimToken, errors, dependencies.repository);
    const staged: StagedRateCardImport = { ...normalized, basedOnVersionId: snapshot.versionId };
    const changes = calculateRateCardDiff(staged, snapshot);
    await dependencies.repository.completeRateCard(jobId, job.claimToken, staged, changes);
    return { jobId, state: "draft" };
  } catch (error) {
    const errors = processingErrors(error);
    if (errors) return fail(jobId, job.claimToken, errors, dependencies.repository);
    const retryable = isRetryableProcessingFailure(error);
    const incidentId = (dependencies.randomUUID ?? randomUUID)();
    const failure: ProcessingFailure = {
      code: retryable ? "IMPORT_PROCESSING_RETRYABLE" : "IMPORT_PROCESSING_TERMINAL",
      incidentId,
      retryable,
    };
    (dependencies.logError ?? logProcessingFailure)({ incidentId, jobId, error });
    await dependencies.repository.processingFailure(jobId, job.claimToken, actor.id, failure);
    return { jobId, state: "processing_failed", failure };
  }
}

export function isRetryableProcessingFailure(error: unknown): boolean {
  if (error instanceof ImportError) {
    if (error.key !== "STORAGE_SYNC_FAILED") return false;
    const cause = (error as ImportError & { cause?: unknown }).cause;
    return cause !== undefined && isRetryableInfrastructureCause(cause, new Set(), 0);
  }
  return isRetryableInfrastructureCause(error, new Set(), 0);
}

function isRetryableInfrastructureCause(
  error: unknown,
  seen: Set<object>,
  depth: number,
): boolean {
  if (typeof error !== "object" || error === null || depth > 5 || seen.has(error)) return false;
  seen.add(error);
  const candidate = error as {
    code?: unknown;
    name?: unknown;
    $retryable?: unknown;
    $metadata?: { httpStatusCode?: unknown };
    cause?: unknown;
  };
  if (candidate.$retryable === true) return true;
  const status = candidate.$metadata?.httpStatusCode;
  if (typeof status === "number") return status === 429 || status >= 500;
  if (typeof candidate.code === "string" && (
    candidate.code.startsWith("08")
    || ["40001", "40P01", "53300", "57P03", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(candidate.code)
  )) return true;
  if (candidate.name === "TimeoutError") return true;
  return candidate.cause !== undefined
    && isRetryableInfrastructureCause(candidate.cause, seen, depth + 1);
}

function logProcessingFailure(entry: ProcessingFailureLogEntry): void {
  console.error(`Import processing incident ${entry.incidentId} for job ${entry.jobId}`, entry.error);
}

function validatePackageMasterNameIdentity(
  input: PackageCandidateImport,
  snapshot: PackageProcessingSnapshot,
): ImportValidationError[] {
  const codesByName = new Map<string, Set<string>>();
  for (const item of snapshot.packages) {
    const name = normalizePackageName(item.packageName);
    const codes = codesByName.get(name) ?? new Set<string>();
    codes.add(item.packageCode.trim());
    codesByName.set(name, codes);
  }
  return input.rows.flatMap((row) => {
    const name = normalizePackageName(row.packageName);
    const packageCode = row.packageCode?.trim() || null;
    const owners = codesByName.get(name);
    if (!owners || (packageCode !== null && owners.size === 1 && owners.has(packageCode))) return [];
    return [{
      sheet: "Sales Packages",
      rowNumber: row.rowNumber,
      column: "Package Name",
      key: "import.error.package_name_duplicate" as const,
      params: { packageName: name },
    }];
  });
}

function normalizePackageName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

async function fail(
  jobId: string,
  claimToken: string,
  errors: ImportValidationError[],
  repository: ImportProcessingRepository,
): Promise<{ jobId: string; state: "validation_failed" }> {
  await repository.fail(jobId, claimToken, sortImportValidationErrors(errors));
  return { jobId, state: "validation_failed" };
}

function processingErrors(error: unknown): ImportValidationError[] | null {
  if (error instanceof ImportParseError) {
    const filename = typeof error.details.filename === "string" ? error.details.filename : undefined;
    return [{
      ...(filename === undefined ? {} : { filename }),
      sheet: String(error.details.sheet ?? "File"),
      rowNumber: Number(error.details.rowNumber ?? 0),
      column: String(error.details.column ?? ""),
      key: error.key,
      params: Object.fromEntries(Object.entries(error.details).filter(([key, value]) =>
        key !== "filename" && key !== "sheet" && key !== "rowNumber" && key !== "column"
        && (typeof value === "string" || typeof value === "number"))) as Record<string, string | number>,
    }];
  }
  return null;
}

export function validateRateCardForProcessing(
  input: RateCardImport,
  snapshot: RateCardProcessingSnapshot,
): ImportValidationError[] {
  const errors: ImportValidationError[] = [];
  if (input.buildingPrices.length + input.packagePrices.length + input.packageMemberships.length === 0) {
    errors.push({ sheet: "Metadata", rowNumber: 0, column: "", key: "import.error.rate_card_empty", params: {} });
  }
  errors.push(...validateRateCardBuildings(input, snapshot));
  const activePackages = new Set(snapshot.packages.filter((item) => item.status === "active").map((item) => item.packageCode));
  const knownPackages = new Set(snapshot.packages.map((item) => item.packageCode));
  for (const row of [...input.packagePrices, ...input.packageMemberships]) {
    const sheet = "priceIdr" in row ? "Package Prices" : "Package Membership";
    if (!knownPackages.has(row.packageCode)) {
      errors.push({ sheet, rowNumber: row.rowNumber, column: "Package Code", key: "import.error.package_not_found", params: { packageCode: row.packageCode } });
    } else if (!activePackages.has(row.packageCode)) {
      errors.push({ sheet, rowNumber: row.rowNumber, column: "Package Code", key: "import.error.package_inactive", params: { packageCode: row.packageCode } });
    }
  }
  const pricedPackages = new Set(input.packagePrices.map((row) => row.packageCode.trim()));
  const memberPackages = new Set(input.packageMemberships.map((row) => row.packageCode.trim()));
  for (const row of input.packagePrices) {
    if (!memberPackages.has(row.packageCode.trim())) errors.push({ sheet: "Package Prices", rowNumber: row.rowNumber, column: "Package Code", key: "import.error.package_price_missing_membership", params: { packageCode: row.packageCode.trim() } });
  }
  for (const row of input.packageMemberships) {
    if (!pricedPackages.has(row.packageCode.trim())) errors.push({ sheet: "Package Membership", rowNumber: row.rowNumber, column: "Package Code", key: "import.error.package_membership_missing_price", params: { packageCode: row.packageCode.trim() } });
  }
  for (const row of [...input.buildingPrices, ...input.packagePrices]) {
    if (!isValidIdrPrice(row.priceIdr)) {
      errors.push({ sheet: "priceIdr" in row && "irisBuildingId" in row ? "Building Prices" : "Package Prices", rowNumber: row.rowNumber, column: "Price IDR", key: "import.error.value_invalid", params: {} });
    }
  }
  errors.push(...duplicateRateCardErrors(input));
  return sortImportValidationErrors(errors);
}

function duplicateRateCardErrors(input: RateCardImport): ImportValidationError[] {
  const errors: ImportValidationError[] = [];
  const duplicates = <T>(rows: T[], keyFor: (row: T) => string) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = keyFor(row);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const buildingCounts = duplicates(input.buildingPrices, (row) => row.irisBuildingId.trim());
  const packageCounts = duplicates(input.packagePrices, (row) => row.packageCode.trim());
  const membershipCounts = duplicates(input.packageMemberships, (row) => JSON.stringify([
    row.packageCode.trim(),
    row.irisBuildingId.trim(),
  ]));
  for (const row of input.buildingPrices) {
    const irisBuildingId = row.irisBuildingId.trim();
    if ((buildingCounts.get(irisBuildingId) ?? 0) > 1) errors.push({
      sheet: "Building Prices", rowNumber: row.rowNumber, column: "IRIS Building ID",
      key: "import.error.rate_card_building_duplicate", params: { irisBuildingId },
    });
  }
  for (const row of input.packagePrices) {
    const packageCode = row.packageCode.trim();
    if ((packageCounts.get(packageCode) ?? 0) > 1) errors.push({
      sheet: "Package Prices", rowNumber: row.rowNumber, column: "Package Code",
      key: "import.error.rate_card_package_duplicate", params: { packageCode },
    });
  }
  for (const row of input.packageMemberships) {
    const packageCode = row.packageCode.trim();
    const irisBuildingId = row.irisBuildingId.trim();
    if ((membershipCounts.get(JSON.stringify([packageCode, irisBuildingId])) ?? 0) > 1) errors.push({
      sheet: "Package Membership", rowNumber: row.rowNumber, column: "Package Code / IRIS Building ID",
      key: "import.error.rate_card_membership_duplicate", params: { packageCode, irisBuildingId },
    });
  }
  return errors;
}
