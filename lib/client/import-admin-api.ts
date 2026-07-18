import type { ImportDataType, ImportState } from "@/db/enums";
import type {
  ImportAdminSummary,
  ImportJobDetail,
  ImportJobListItem,
  RateCardVersionListItem,
} from "@/lib/imports/admin-contracts";
import type { AdminLocale, AdminTranslationKey } from "@/lib/admin-i18n";

export type OperationalImportDataType = Extract<ImportDataType, "building" | "package" | "rate_card">;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ImportHistoryFilters {
  dataType?: OperationalImportDataType;
  state?: ImportState;
  limit?: number;
  offset?: number;
}

export interface ImportUploadResult {
  jobId: string;
  state: "uploaded";
}

export interface ImportProcessResult {
  jobId: string;
  state: "uploaded" | "ready_to_publish" | "draft" | "validation_failed";
}

export interface ImportPublishResult {
  jobId: string;
  state: "published";
  publishedChanges: number;
  generatedIdentifiers?: Array<{ rowNumber: number; identifier: string }>;
}

export class ImportAdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly key: string,
  ) {
    super(key);
    this.name = "ImportAdminApiError";
  }
}

async function requestJson<T>(
  url: string,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<T> {
  const response = await fetcher(url, { credentials: "same-origin", ...init });
  const body = await response.json().catch(() => null) as { error?: unknown } | T | null;
  if (!response.ok) {
    const key = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : "IMPORT_ADMIN_REQUEST_FAILED";
    throw new ImportAdminApiError(response.status, key);
  }
  return body as T;
}

export function validateImportFile(file: File): AdminTranslationKey | null {
  const filename = file.name.toLowerCase();
  return filename.endsWith(".xlsx") || filename.endsWith(".csv")
    ? null
    : "upload.invalidType";
}

export function bootstrapLogin(
  email: string,
  password: string,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<{ ok: true }> {
  return requestJson("/api/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal,
  }, fetcher);
}

export function getImportSummary(signal?: AbortSignal, fetcher: Fetcher = fetch): Promise<ImportAdminSummary> {
  return requestJson("/api/admin/imports/summary", { method: "GET", signal }, fetcher);
}

export function listImportHistory(
  filters: ImportHistoryFilters = {},
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<ImportJobListItem[]> {
  const params = new URLSearchParams({
    limit: String(boundedInteger(filters.limit, 50, 1, 100)),
    offset: String(boundedInteger(filters.offset, 0, 0, 10_000)),
  });
  if (filters.dataType) params.set("dataType", filters.dataType);
  if (filters.state) params.set("state", filters.state);
  return requestJson(`/api/admin/imports?${params}`, { method: "GET", signal }, fetcher);
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

export function getImportJobDetail(
  jobId: string,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<ImportJobDetail> {
  return requestJson(`/api/admin/imports/${encodeURIComponent(jobId)}`, { method: "GET", signal }, fetcher);
}

export function listRateCardVersions(
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<RateCardVersionListItem[]> {
  return requestJson("/api/admin/rate-cards", { method: "GET", signal }, fetcher);
}

export function uploadImport(
  dataType: OperationalImportDataType,
  file: File,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<ImportUploadResult> {
  const errorKey = validateImportFile(file);
  if (errorKey) return Promise.reject(new ImportAdminApiError(400, errorKey));
  const form = new FormData();
  form.set("templateVersion", "TMN-IMPORT-2");
  form.append("files", file, file.name);
  return requestJson(`/api/imports?dataType=${dataType}`, {
    method: "POST",
    body: form,
    signal,
  }, fetcher);
}

export function processImportJob(
  jobId: string,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<ImportProcessResult> {
  return requestJson(`/api/imports/${encodeURIComponent(jobId)}/process`, { method: "POST", signal }, fetcher);
}

export function publishImportJob(
  jobId: string,
  signal?: AbortSignal,
  fetcher: Fetcher = fetch,
): Promise<ImportPublishResult> {
  return requestJson(`/api/imports/${encodeURIComponent(jobId)}/publish`, { method: "POST", signal }, fetcher);
}

export function templateDownloadUrl(dataType: OperationalImportDataType): string {
  return `/api/templates/${dataType}`;
}

export function errorReportDownloadUrl(jobId: string, locale: AdminLocale): string {
  return `/api/admin/imports/${encodeURIComponent(jobId)}/errors.csv?locale=${encodeURIComponent(locale)}`;
}

export function originalFileDownloadUrl(jobId: string, fileId: string): string {
  return `/api/admin/imports/${encodeURIComponent(jobId)}/files/${encodeURIComponent(fileId)}`;
}
