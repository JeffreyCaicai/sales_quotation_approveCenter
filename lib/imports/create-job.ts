import { createHash, randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";

import type { ImportDataType } from "@/db/enums";
import type { SessionUser } from "@/lib/auth/session";
import {
  ImportError,
  permissionForDataType,
  type CreateImportJobInput,
  type ImportFileRecord,
  type ImportJobDependencies,
  type PreparedUploadFile,
} from "@/lib/imports/contracts";
import { PostgresImportJobRepository } from "@/lib/imports/repository";
import { cleanupPendingWithRetry } from "@/lib/imports/reconcile-pending-objects";
import { inspectXlsxContainer } from "@/lib/imports/xlsx-container";
import { S3ObjectStore } from "@/lib/storage/s3-object-store";
import type { PendingObject } from "@/lib/storage/object-store";

const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const RATE_CARD_CSV_NAMES = [
  "building-prices.csv",
  "metadata.csv",
  "package-buildings.csv",
  "package-prices.csv",
] as const;

function defaultDependencies(): ImportJobDependencies {
  return {
    repository: new PostgresImportJobRepository(),
    objectStore: S3ObjectStore.fromEnv(),
    now: () => new Date(),
    randomUUID,
  };
}

function assertPermission(dataType: unknown, actor: SessionUser): ImportDataType {
  const permission = permissionForDataType(dataType);
  if (!actor.permissions.includes(permission)) {
    throw new ImportError(403, "PERMISSION_DENIED");
  }
  return dataType as ImportDataType;
}

function extension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot).toLowerCase();
}

function validateFilename(filename: string): void {
  if (
    filename.length === 0 ||
    filename.includes("/") ||
    filename.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(filename)
  ) {
    throw new ImportError(400, "IMPORT_FILENAME_INVALID");
  }
}

function validateFileSet(dataType: ImportDataType, files: readonly PreparedUploadFile[]): void {
  if (dataType !== "rate_card") {
    if (files.length !== 1) {
      throw new ImportError(400, "IMPORT_FILES_INVALID");
    }
    return;
  }
  if (files.length === 1 && extension(files[0].filename) === ".xlsx") return;
  const names = files.map((file) => file.filename).sort();
  if (
    names.length !== RATE_CARD_CSV_NAMES.length ||
    names.some((name, index) => name !== RATE_CARD_CSV_NAMES[index])
  ) {
    throw new ImportError(400, "IMPORT_RATE_CARD_FILES_INVALID");
  }
}

async function validateTypeAndSignature(
  file: PreparedUploadFile,
  body: Uint8Array,
): Promise<void> {
  const ext = extension(file.filename);
  if (ext === ".xlsx") {
    if (file.mimeType !== XLSX_MIME) {
      throw new ImportError(400, "IMPORT_FILE_TYPE_INVALID");
    }
    const zipSignature =
      body.length >= 4 &&
      body[0] === 0x50 &&
      body[1] === 0x4b &&
      ((body[2] === 0x03 && body[3] === 0x04) ||
        (body[2] === 0x05 && body[3] === 0x06) ||
        (body[2] === 0x07 && body[3] === 0x08));
    if (!zipSignature) throw new ImportError(400, "IMPORT_FILE_SIGNATURE_INVALID");
    await inspectXlsxContainer(body);
    return;
  }
  if (ext === ".csv") {
    if (file.mimeType !== "text/csv") {
      throw new ImportError(400, "IMPORT_FILE_TYPE_INVALID");
    }
    try {
      if (await fileTypeFromBuffer(body)) {
        throw new ImportError(400, "IMPORT_FILE_SIGNATURE_INVALID");
      }
      new TextDecoder("utf-8", { fatal: true }).decode(body);
    } catch (error) {
      if (error instanceof ImportError) throw error;
      throw new ImportError(400, "IMPORT_FILE_SIGNATURE_INVALID");
    }
    if (body.includes(0)) throw new ImportError(400, "IMPORT_FILE_SIGNATURE_INVALID");
    return;
  }
  throw new ImportError(400, "IMPORT_FILE_TYPE_INVALID");
}

function batchChecksum(files: readonly ImportFileRecord[]): string {
  if (files.length === 1) return files[0].checksum;
  const manifest = files
    .map(({ originalFilename, sizeBytes, checksum }) => ({
      filename: originalFilename,
      size: sizeBytes,
      sha256: checksum,
    }))
    .sort((a, b) => a.filename.localeCompare(b.filename));
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}

export async function createImportJob(
  input: CreateImportJobInput,
  actor: SessionUser,
  dependencies?: ImportJobDependencies,
): Promise<{ jobId: string; state: "uploaded" }> {
  const dataType = assertPermission(input.dataType, actor);
  for (const file of input.files) validateFilename(file.filename);
  validateFileSet(dataType, input.files);

  let totalBytes = 0;
  const prepared: Array<{ file: PreparedUploadFile; body: Uint8Array; checksum: string }> = [];
  for (const file of input.files) {
    const body = file.body;
    totalBytes += body.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) throw new ImportError(413, "IMPORT_TOTAL_SIZE_EXCEEDED");
    if (body.byteLength === 0) throw new ImportError(400, "IMPORT_FILE_EMPTY");
    await validateTypeAndSignature(file, body);
    prepared.push({
      file,
      body,
      checksum: createHash("sha256").update(body).digest("hex"),
    });
  }

  const deps = dependencies ?? defaultDependencies();
  const jobId = deps.randomUUID();
  const attemptId = deps.randomUUID();
  const date = deps.now();
  const files: ImportFileRecord[] = prepared.map(({ file, body, checksum }) => ({
    objectStorageKey: `imports/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${jobId}/original/${deps.randomUUID()}`,
    originalFilename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: body.byteLength,
    checksum,
    purpose: "original",
  }));
  const checksum = batchChecksum(files);
  if (await deps.repository.hasPublishedChecksum(dataType, checksum)) {
    throw new ImportError(409, "IMPORT_DUPLICATE_PUBLISHED");
  }

  const reserveResult = await deps.repository.reserveUpload({
    id: jobId,
    dataType,
    templateVersion: input.templateVersion,
    checksum,
    sourceType: "manual",
    uploadedBy: actor.id,
    attemptId,
    leaseExpiresAt: new Date(date.getTime() + 15 * 60 * 1000),
    createdAt: date,
  });
  if (reserveResult === "duplicate") {
    throw new ImportError(409, "IMPORT_DUPLICATE_PUBLISHED");
  }

  const pendingObjects: PendingObject[] = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const pending = await deps.objectStore.putImmutable(
        file.objectStorageKey,
        prepared[index].body,
        file.mimeType,
        file.checksum,
        attemptId,
      );
      pendingObjects.push(pending);
    }
    const finalizeResult = await deps.repository.finalizeUpload({
      attemptId,
      now: deps.now(),
      files,
    }, async () => {
      for (const pending of pendingObjects) {
        await deps.objectStore.commitPending(pending);
      }
    });
    if (finalizeResult !== "uploaded") {
      throw new ImportError(500, "IMPORT_CREATE_FAILED");
    }
  } catch (error) {
    await deps.repository.cleanupUploadAttempt(
      attemptId,
      error instanceof ImportError ? error.key : "IMPORT_CREATE_FAILED",
      async () => {
        for (const pending of pendingObjects) {
          await cleanupPendingWithRetry(deps.objectStore, pending);
        }
      },
    );
    if (error instanceof ImportError) throw error;
    throw new ImportError(500, "IMPORT_CREATE_FAILED");
  }
  return { jobId, state: "uploaded" };
}
