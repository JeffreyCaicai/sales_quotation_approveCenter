export type ImportProcessingErrorKey =
  | "IMPORT_JOB_NOT_FOUND"
  | "IMPORT_JOB_NOT_PROCESSABLE"
  | "IMPORT_JOB_PROCESSING"
  | "IMPORT_PROCESSOR_NOT_IMPLEMENTED"
  | "PERMISSION_DENIED";

export class ImportProcessingError extends Error {
  constructor(public readonly key: ImportProcessingErrorKey, public readonly status: 403 | 404 | 409 | 501) {
    super(key);
    this.name = "ImportProcessingError";
  }
}
