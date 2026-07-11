import { randomUUID } from "node:crypto";

import type { ImportSourceType } from "@/db/enums";
import type { SessionUser } from "@/lib/auth/session";
import {
  ImportError,
  permissionForDataType,
  type ImportJobDependencies,
  type NormalizedImport,
} from "@/lib/imports/contracts";
import { PostgresImportJobRepository } from "@/lib/imports/repository";
import { S3ObjectStore } from "@/lib/storage/s3-object-store";
import {
  normalizedChecksum,
  normalizedImportSchema,
} from "@/lib/imports/canonical-json";

function defaultDependencies(): ImportJobDependencies {
  return {
    repository: new PostgresImportJobRepository(),
    objectStore: S3ObjectStore.fromEnv(),
    now: () => new Date(),
    randomUUID,
  };
}

export async function submitNormalizedImport(
  input: NormalizedImport,
  source: ImportSourceType,
  actor: SessionUser,
  dependencies?: ImportJobDependencies,
): Promise<{ jobId: string }> {
  if (source !== "manual" && source !== "crm") {
    throw new ImportError(400, "IMPORT_SOURCE_INVALID");
  }
  const parsed = normalizedImportSchema.safeParse(input);
  if (!parsed.success) {
    throw new ImportError(400, "IMPORT_ENVELOPE_INVALID");
  }
  const normalized = parsed.data;
  const serverChecksum = normalizedChecksum({
    dataType: normalized.dataType,
    templateVersion: normalized.templateVersion,
    payload: normalized.payload,
  });
  if (normalized.checksum.toLowerCase() !== serverChecksum) {
    throw new ImportError(400, "IMPORT_CHECKSUM_INVALID");
  }
  const permission = permissionForDataType(normalized.dataType);
  if (!actor.permissions.includes(permission)) {
    throw new ImportError(403, "PERMISSION_DENIED");
  }
  const deps = dependencies ?? defaultDependencies();
  try {
    if (await deps.repository.hasPublishedChecksum(normalized.dataType, serverChecksum)) {
      throw new ImportError(409, "IMPORT_DUPLICATE_PUBLISHED");
    }
    const jobId = deps.randomUUID();
    const createdAt = deps.now().toISOString();
    await deps.repository.createUploadedJob({
      id: jobId,
      dataType: normalized.dataType,
      templateVersion: normalized.templateVersion,
      checksum: serverChecksum,
      state: "uploaded",
      sourceType: source,
      normalizedPayload: { ...normalized, checksum: serverChecksum },
      uploadedBy: actor.id,
      createdAt,
      files: [],
    });
    return { jobId };
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError(500, "IMPORT_CREATE_FAILED");
  }
}
