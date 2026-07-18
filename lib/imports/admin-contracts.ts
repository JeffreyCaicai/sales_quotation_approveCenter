import {
  importDataTypes,
  importSourceTypes,
  importStates,
  type ImportDataType,
  type ImportSourceType,
  type ImportState,
  type RateCardVersionStatus,
} from "@/db/enums";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ImportAdminUserItem {
  id: string;
  email: string;
  displayName: string;
}

export interface ImportJobListItem {
  id: string;
  dataType: ImportDataType;
  templateVersion: string;
  state: ImportState;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  sourceType: ImportSourceType;
  failureSummary: string | null;
  uploadedBy: ImportAdminUserItem;
  publishedBy: ImportAdminUserItem | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface ImportErrorItem {
  id: string;
  file: string;
  sheet: string;
  row: number;
  column: string;
  errorKey: string;
  parameters: JsonValue;
  createdAt: string;
}

export interface ImportChangeItem {
  id: string;
  entityType: string;
  entityId: string | null;
  changeType: "added" | "modified" | "deactivated" | "unchanged" | "removed";
  beforeValue: JsonValue;
  afterValue: JsonValue;
  createdAt: string;
}

export interface ImportFileItem {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  purpose: "original" | "validation_report" | "difference_report";
  createdAt: string;
}

export interface ImportAuditItem {
  id: string;
  actor: ImportAdminUserItem;
  action: string;
  entityType: string;
  entityId: string | null;
  source: string;
  reason: string | null;
  beforeMetadata: JsonValue;
  afterMetadata: JsonValue;
  createdAt: string;
}

export interface ImportJobDetail extends ImportJobListItem {
  errors: ImportErrorItem[];
  changes: ImportChangeItem[];
  files: ImportFileItem[];
  auditEvents: ImportAuditItem[];
}

export interface ImportAdminSummary {
  currentRateCard: null | { versionCode: string; publishedAt: string };
  buildings: { active: number; inactive: number };
  packages: { active: number; inactive: number };
  jobs: { validating: number; ready: number; failed: number };
  recentPublications: ImportJobListItem[];
}

export interface ImportJobFilters {
  dataType?: ImportDataType;
  state?: ImportState;
  limit: number;
  offset: number;
}

export interface RateCardVersionListItem {
  id: string;
  versionCode: string;
  currency: "IDR";
  status: RateCardVersionStatus;
  importJobId: string;
  uploadedBy: ImportAdminUserItem;
  publishedBy: ImportAdminUserItem | null;
  uploadedAt: string;
  publishedAt: string | null;
}

export const IMPORT_JOB_LIST_DEFAULT_LIMIT = 50;
export const IMPORT_JOB_LIST_MAX_LIMIT = 100;
export const IMPORT_JOB_LIST_MAX_OFFSET = 10_000;

const allowedFilterKeys = new Set(["dataType", "state", "limit", "offset"]);

export function parseImportJobFilters(searchParams: URLSearchParams): ImportJobFilters | null {
  if ([...searchParams.keys()].some((key) => !allowedFilterKeys.has(key))) return null;
  if ([...allowedFilterKeys].some((key) => searchParams.getAll(key).length > 1)) return null;

  const dataType = optionalEnum(searchParams.get("dataType"), importDataTypes);
  const state = optionalEnum(searchParams.get("state"), importStates);
  const limit = boundedInteger(
    searchParams.get("limit"),
    IMPORT_JOB_LIST_DEFAULT_LIMIT,
    1,
    IMPORT_JOB_LIST_MAX_LIMIT,
  );
  const offset = boundedInteger(
    searchParams.get("offset"),
    0,
    0,
    IMPORT_JOB_LIST_MAX_OFFSET,
  );
  if (dataType === false || state === false || limit === null || offset === null) return null;
  return {
    ...(dataType === undefined ? {} : { dataType }),
    ...(state === undefined ? {} : { state }),
    limit,
    offset,
  };
}

export function importJobFiltersAreBounded(filters: ImportJobFilters): boolean {
  return (
    Number.isInteger(filters.limit)
    && filters.limit >= 1
    && filters.limit <= IMPORT_JOB_LIST_MAX_LIMIT
    && Number.isInteger(filters.offset)
    && filters.offset >= 0
    && filters.offset <= IMPORT_JOB_LIST_MAX_OFFSET
    && (filters.dataType === undefined || importDataTypes.includes(filters.dataType))
    && (filters.state === undefined || importStates.includes(filters.state))
  );
}

function optionalEnum<const T extends readonly string[]>(
  value: string | null,
  allowed: T,
): T[number] | undefined | false {
  if (value === null) return undefined;
  return allowed.includes(value as T[number]) ? value as T[number] : false;
}

function boundedInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

export function isImportSourceType(value: string): value is ImportSourceType {
  return importSourceTypes.includes(value as ImportSourceType);
}
