import type { ImportDataType, ImportSourceType } from "@/db/enums";
import type { Permission } from "@/lib/auth/permissions";
import type { ObjectStore } from "@/lib/storage/object-store";

export type ImportErrorStatus = 400 | 403 | 409 | 413 | 500;

export type ImportErrorKey =
  | "IMPORT_DATA_TYPE_INVALID"
  | "IMPORT_SOURCE_INVALID"
  | "IMPORT_FILES_INVALID"
  | "IMPORT_RATE_CARD_FILES_INVALID"
  | "IMPORT_FILENAME_INVALID"
  | "IMPORT_FILE_TYPE_INVALID"
  | "IMPORT_FILE_SIGNATURE_INVALID"
  | "IMPORT_FILE_EMPTY"
  | "IMPORT_TOTAL_SIZE_EXCEEDED"
  | "IMPORT_DUPLICATE_PUBLISHED"
  | "IMPORT_CHECKSUM_INVALID"
  | "IMPORT_ENVELOPE_INVALID"
  | "IMPORT_TEMPLATE_VERSION_INVALID"
  | "IMPORT_CLEANUP_PENDING"
  | "IMPORT_CREATE_FAILED"
  | "PERMISSION_DENIED"
  | "STORAGE_CONFIGURATION_ERROR"
  | "STORAGE_OBJECT_COLLISION"
  | "STORAGE_WRITE_FAILED"
  | "STORAGE_SYNC_FAILED"
  | "STORAGE_EXPIRY_INVALID";

export class ImportError extends Error {
  constructor(
    public readonly status: ImportErrorStatus,
    public readonly key: ImportErrorKey,
  ) {
    super(key);
    this.name = "ImportError";
  }
}

export interface NormalizedImport {
  dataType: ImportDataType;
  templateVersion: string;
  checksum: string;
  payload: unknown;
}

export interface CreateImportJobInput {
  dataType: ImportDataType;
  templateVersion: ImportTemplateVersion;
  files: readonly PreparedUploadFile[];
}

export const TEMPLATE_VERSION_V1 = "TMN-IMPORT-1" as const;
export const CANONICAL_IMPORT_TEMPLATE_VERSION = "TMN-IMPORT-2" as const;
export type ImportTemplateVersion = typeof TEMPLATE_VERSION_V1 | typeof CANONICAL_IMPORT_TEMPLATE_VERSION;

export function canonicalTemplateVersionForDataType(dataType: ImportDataType): ImportTemplateVersion {
  return dataType === "building" || dataType === "rate_card"
    ? CANONICAL_IMPORT_TEMPLATE_VERSION
    : TEMPLATE_VERSION_V1;
}

export function parseImportTemplateVersion(value: string): ImportTemplateVersion {
  if (value !== TEMPLATE_VERSION_V1 && value !== CANONICAL_IMPORT_TEMPLATE_VERSION) {
    throw new ImportError(400, "IMPORT_TEMPLATE_VERSION_INVALID");
  }
  return value;
}

export interface PreparedUploadFile {
  filename: string;
  mimeType: string;
  body: Uint8Array;
}

export interface ImportFileRecord {
  objectStorageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  purpose: "original";
}

export interface UploadedJobRecord {
  id: string;
  dataType: ImportDataType;
  templateVersion: string;
  checksum: string;
  state: "uploaded";
  sourceType: ImportSourceType;
  normalizedPayload: NormalizedImport | null;
  uploadedBy: string;
  createdAt: string;
  files: ImportFileRecord[];
}

export interface ImportJobRepository {
  hasPublishedChecksum(dataType: string, checksum: string): Promise<boolean>;
  createUploadedJob(record: UploadedJobRecord): Promise<void | "duplicate">;
  reserveUpload(record: UploadReservationRecord): Promise<"reserved" | "duplicate">;
  finalizeUpload(
    input: FinalizeUploadInput,
  ): Promise<"uploaded" | "stale">;
  recordStorageSyncWarning(attemptId: string, warning: string): Promise<void>;
  cleanupUploadAttempt(
    attemptId: string,
    failureSummary: string,
    cleanup: () => Promise<void>,
  ): Promise<"failed" | "referenced" | "missing">;
  listExpiredUploadAttemptIds(now: Date): Promise<string[]>;
  listStorageSyncWarningAttemptIds(): Promise<string[]>;
  reconcileUploadAttempt(
    attemptId: string,
    now: Date,
    objects: readonly import("@/lib/storage/object-store").PendingObject[],
    operations: UploadReconciliationOperations,
  ): Promise<"skipped" | "committed" | "failed" | "missing">;
}

export interface UploadReservationRecord {
  id: string;
  dataType: ImportDataType;
  templateVersion: string;
  checksum: string;
  sourceType: ImportSourceType;
  uploadedBy: string;
  attemptId: string;
  leaseExpiresAt: Date;
  createdAt: Date;
}

export interface FinalizeUploadInput {
  attemptId: string;
  now: Date;
  files: ImportFileRecord[];
}

export interface UploadReconciliationOperations {
  commit: () => Promise<void>;
  commitReferencedKeys: (keys: readonly string[]) => Promise<void>;
  cleanup: () => Promise<void>;
}

export interface ImportJobDependencies {
  repository: ImportJobRepository;
  objectStore: ObjectStore;
  now: () => Date;
  randomUUID: () => string;
}

const permissionByDataType = {
  customer_brand: "data.import.customer_brand",
  building: "data.import.building",
  package: "data.import.package",
  rate_card: "rate_card.upload",
} as const satisfies Record<ImportDataType, Permission>;

export function permissionForDataType(value: unknown): Permission {
  if (typeof value !== "string" || !(value in permissionByDataType)) {
    throw new ImportError(400, "IMPORT_DATA_TYPE_INVALID");
  }
  return permissionByDataType[value as ImportDataType];
}
