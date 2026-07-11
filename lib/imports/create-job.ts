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

function validateFileSet(dataType: ImportDataType, files: readonly File[]): void {
  if (dataType !== "rate_card") {
    if (files.length !== 1) {
      throw new ImportError(400, "IMPORT_FILES_INVALID");
    }
    return;
  }
  if (files.length === 1 && extension(files[0].name) === ".xlsx") return;
  const names = files.map((file) => file.name).sort();
  if (
    names.length !== RATE_CARD_CSV_NAMES.length ||
    names.some((name, index) => name !== RATE_CARD_CSV_NAMES[index])
  ) {
    throw new ImportError(400, "IMPORT_RATE_CARD_FILES_INVALID");
  }
}

async function validateTypeAndSignature(
  file: File,
  body: Uint8Array,
): Promise<void> {
  const ext = extension(file.name);
  if (ext === ".xlsx") {
    if (file.type !== XLSX_MIME) {
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
    if (file.type !== "text/csv") {
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

async function readBounded(file: File, usedBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = file.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      size += chunk.byteLength;
      if (usedBytes + size > MAX_TOTAL_BYTES) {
        await reader.cancel();
        throw new ImportError(413, "IMPORT_TOTAL_SIZE_EXCEEDED");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new ImportError(400, "IMPORT_FILE_EMPTY");
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
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
  for (const file of input.files) validateFilename(file.name);
  validateFileSet(dataType, input.files);

  let totalBytes = 0;
  const prepared: Array<{ file: File; body: Uint8Array; checksum: string }> = [];
  for (const file of input.files) {
    const body = await readBounded(file, totalBytes);
    totalBytes += body.byteLength;
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
    originalFilename: file.name,
    mimeType: file.type,
    sizeBytes: body.byteLength,
    checksum,
    purpose: "original",
  }));
  const checksum = batchChecksum(files);
  if (await deps.repository.hasPublishedChecksum(dataType, checksum)) {
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
    const createResult = await deps.repository.createUploadedJob({
      id: jobId,
      dataType,
      templateVersion: input.templateVersion,
      checksum,
      state: "uploaded",
      sourceType: "manual",
      normalizedPayload: null,
      uploadedBy: actor.id,
      createdAt: date.toISOString(),
      files,
    });
    if (createResult === "duplicate") {
      throw new ImportError(409, "IMPORT_DUPLICATE_PUBLISHED");
    }
  } catch (error) {
    for (const pending of pendingObjects) {
      await cleanupPendingWithRetry(deps.objectStore, pending);
    }
    if (error instanceof ImportError) throw error;
    throw new ImportError(500, "IMPORT_CREATE_FAILED");
  }
  for (const pending of pendingObjects) {
    try { await deps.objectStore.commitPending(pending); } catch { /* durable pending tag is reconciled */ }
  }
  return { jobId, state: "uploaded" };
}
