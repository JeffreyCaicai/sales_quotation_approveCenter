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
  | "IMPORT_CREATE_FAILED"
  | "PERMISSION_DENIED"
  | "STORAGE_CONFIGURATION_ERROR"
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
  templateVersion: string;
  files: readonly File[];
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
  createUploadedJob(record: UploadedJobRecord): Promise<void>;
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
