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
  const permission = permissionForDataType(input.dataType);
  if (!actor.permissions.includes(permission)) {
    throw new ImportError(403, "PERMISSION_DENIED");
  }
  const deps = dependencies ?? defaultDependencies();
  try {
    if (await deps.repository.hasPublishedChecksum(input.dataType, input.checksum)) {
      throw new ImportError(409, "IMPORT_DUPLICATE_PUBLISHED");
    }
    const jobId = deps.randomUUID();
    const createdAt = deps.now().toISOString();
    await deps.repository.createUploadedJob({
      id: jobId,
      dataType: input.dataType,
      templateVersion: input.templateVersion,
      checksum: input.checksum,
      state: "uploaded",
      sourceType: source,
      normalizedPayload: input,
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
