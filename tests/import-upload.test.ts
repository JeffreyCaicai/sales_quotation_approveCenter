import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import {
  ImportError,
  type ImportJobRepository,
  type UploadedJobRecord,
} from "@/lib/imports/contracts";
import { createImportJob } from "@/lib/imports/create-job";
import { submitNormalizedImport } from "@/lib/imports/ingestion-service";
import type { ObjectStore } from "@/lib/storage/object-store";
import { S3ObjectStore } from "@/lib/storage/s3-object-store";

const actorId = "12e7130a-8321-4d8f-a6ea-312950722854";

function actor(permissions: SessionUser["permissions"]): SessionUser {
  return {
    id: actorId,
    email: "uploader@example.com",
    displayName: "Uploader",
    status: "active",
    permissions,
  };
}

function upload(
  name: string,
  type: string,
  bytes: Uint8Array,
): File {
  return new File([bytes.slice().buffer as ArrayBuffer], name, { type });
}

const xlsxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]);

class FakeStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  readonly cleaned: string[] = [];
  failPutAt?: number;
  private puts = 0;

  async putImmutable(
    key: string,
    body: Uint8Array,
  ): Promise<void> {
    this.puts += 1;
    if (this.puts === this.failPutAt) throw new Error("put failed");
    if (this.objects.has(key)) throw new Error("immutable collision");
    this.objects.set(key, body);
  }

  async deleteUncommitted(key: string): Promise<void> {
    this.cleaned.push(key);
    this.objects.delete(key);
  }

  async getSignedDownloadUrl(key: string, expiresSeconds: number) {
    return `https://objects.test/${key}?expires=${expiresSeconds}`;
  }
}

class FakeRepository implements ImportJobRepository {
  readonly jobs: UploadedJobRecord[] = [];
  duplicates = new Set<string>();
  failCreate = false;

  async hasPublishedChecksum(dataType: string, checksum: string) {
    return this.duplicates.has(`${dataType}:${checksum}`);
  }

  async createUploadedJob(record: UploadedJobRecord): Promise<void> {
    if (this.failCreate) throw new Error("database failed");
    this.jobs.push(structuredClone(record));
  }
}

function dependencies(repository = new FakeRepository(), store = new FakeStore()) {
  let id = 0;
  return {
    repository,
    objectStore: store,
    now: () => new Date("2026-07-11T03:00:00Z"),
    randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
  };
}

describe("manual import upload contract", () => {
  test.each([
    ["macro.xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12", xlsxBytes, "IMPORT_FILE_TYPE_INVALID"],
    ["../building.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsxBytes, "IMPORT_FILENAME_INVALID"],
    ["building.xlsx", "text/csv", xlsxBytes, "IMPORT_FILE_TYPE_INVALID"],
    ["building.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", new Uint8Array([1, 2, 3]), "IMPORT_FILE_SIGNATURE_INVALID"],
    ["building.csv", "text/csv", xlsxBytes, "IMPORT_FILE_SIGNATURE_INVALID"],
    ["building.csv", "text/csv", new Uint8Array(), "IMPORT_FILE_EMPTY"],
  ])("rejects invalid file %s with a stable key", async (name, type, bytes, key) => {
    await expect(
      createImportJob(
        { dataType: "building", templateVersion: "v1", files: [upload(name, type, bytes)] },
        actor(["data.import.building"]),
        dependencies(),
      ),
    ).rejects.toMatchObject({ status: 400, key });
  });

  test("rejects callers without the exact data-type permission", async () => {
    await expect(
      createImportJob(
        { dataType: "building", templateVersion: "v1", files: [upload("building.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsxBytes)] },
        actor(["data.import.package"]),
        dependencies(),
      ),
    ).rejects.toEqual(new ImportError(403, "PERMISSION_DENIED"));
  });

  test("fails closed for an unknown data type", async () => {
    await expect(
      createImportJob(
        { dataType: "unknown" as "building", templateVersion: "v1", files: [upload("building.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsxBytes)] },
        actor(["data.import.building"]),
        dependencies(),
      ),
    ).rejects.toMatchObject({ status: 400, key: "IMPORT_DATA_TYPE_INVALID" });
  });

  test("stores a valid xlsx under a server-generated key with its content SHA-256", async () => {
    const deps = dependencies();
    const result = await createImportJob(
      { dataType: "building", templateVersion: "v1", files: [upload("My Building.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsxBytes)] },
      actor(["data.import.building"]),
      deps,
    );

    const checksum = createHash("sha256").update(xlsxBytes).digest("hex");
    expect(result).toEqual({ jobId: "00000000-0000-4000-8000-000000000001", state: "uploaded" });
    expect(deps.repository.jobs[0]).toMatchObject({
      id: result.jobId,
      dataType: "building",
      sourceType: "manual",
      checksum,
      state: "uploaded",
      uploadedBy: actorId,
      files: [{ originalFilename: "My Building.xlsx", checksum }],
    });
    const key = deps.repository.jobs[0].files[0].objectStorageKey;
    expect(key).toMatch(/^imports\/2026\/07\/[0-9a-f-]+\/original\/[0-9a-f-]+$/);
    expect(key).not.toContain("My Building.xlsx");
    expect(deps.objectStore.objects.get(key)).toEqual(xlsxBytes);
  });

  test("rejects a checksum already used by a published lifecycle state", async () => {
    const deps = dependencies();
    const checksum = createHash("sha256").update(xlsxBytes).digest("hex");
    deps.repository.duplicates.add(`building:${checksum}`);
    await expect(
      createImportJob(
        { dataType: "building", templateVersion: "v1", files: [upload("building.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsxBytes)] },
        actor(["data.import.building"]),
        deps,
      ),
    ).rejects.toMatchObject({ status: 409, key: "IMPORT_DUPLICATE_PUBLISHED" });
    expect(deps.objectStore.objects.size).toBe(0);
  });

  test("enforces the 25 MiB total while buffering streams", async () => {
    const bytes = new Uint8Array(25 * 1024 * 1024 + 1);
    bytes.set([0x50, 0x4b, 0x03, 0x04]);
    await expect(
      createImportJob(
        { dataType: "building", templateVersion: "v1", files: [upload("building.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes)] },
        actor(["data.import.building"]),
        dependencies(),
      ),
    ).rejects.toMatchObject({ status: 413, key: "IMPORT_TOTAL_SIZE_EXCEEDED" });
  });
});

describe("rate-card batches and compensation", () => {
  const csvNames = ["metadata.csv", "building-prices.csv", "package-prices.csv", "package-buildings.csv"];
  const csvFiles = () => csvNames.map((name) => upload(name, "text/csv", new TextEncoder().encode(`${name}\nvalue`)));

  test("requires either one xlsx or the exact four CSV filenames", async () => {
    await expect(
      createImportJob(
        { dataType: "rate_card", templateVersion: "v1", files: csvFiles().slice(0, 3) },
        actor(["rate_card.upload"]),
        dependencies(),
      ),
    ).rejects.toMatchObject({ status: 400, key: "IMPORT_RATE_CARD_FILES_INVALID" });
  });

  test("derives the batch checksum from a filename-sorted file manifest", async () => {
    const deps = dependencies();
    await createImportJob(
      { dataType: "rate_card", templateVersion: "v1", files: csvFiles().reverse() },
      actor(["rate_card.upload"]),
      deps,
    );
    const manifest = deps.repository.jobs[0].files
      .map(({ originalFilename, sizeBytes, checksum }) => ({ filename: originalFilename, size: sizeBytes, sha256: checksum }))
      .sort((a, b) => a.filename.localeCompare(b.filename));
    expect(deps.repository.jobs[0].checksum).toBe(
      createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
    );
  });

  test.each(["object storage", "database transaction"])("cleans only this attempt's uncommitted objects after a %s failure", async (failure) => {
    const store = new FakeStore();
    const repository = new FakeRepository();
    const deps = dependencies(repository, store);
    if (failure === "object storage") store.failPutAt = 3;
    else repository.failCreate = true;

    await expect(
      createImportJob(
        { dataType: "rate_card", templateVersion: "v1", files: csvFiles() },
        actor(["rate_card.upload"]),
        deps,
      ),
    ).rejects.toMatchObject({ status: 500, key: "IMPORT_CREATE_FAILED" });
    expect(store.objects.size).toBe(0);
    expect(store.cleaned).toHaveLength(failure === "object storage" ? 3 : 4);
  });
});

describe("normalized manual/CRM ingestion boundary", () => {
  test("uses identical staging shapes and keeps source type as the only difference", async () => {
    const repository = new FakeRepository();
    const deps = dependencies(repository);
    const normalized = {
      dataType: "customer_brand" as const,
      templateVersion: "v1",
      checksum: "a".repeat(64),
      payload: { rows: [{ customerCode: "C-1", name: "Customer" }] },
    };
    await submitNormalizedImport(normalized, "manual", actor(["data.import.customer_brand"]), deps);
    await submitNormalizedImport(normalized, "crm", actor(["data.import.customer_brand"]), deps);
    const [manual, crm] = repository.jobs;
    expect({ ...manual, id: "same", sourceType: "same", createdAt: "same" }).toEqual({
      ...crm,
      id: "same",
      sourceType: "same",
      createdAt: "same",
    });
    expect([manual.sourceType, crm.sourceType]).toEqual(["manual", "crm"]);
    expect(manual.normalizedPayload).toEqual(normalized);
    expect(manual.files).toEqual([]);
  });

  test("rejects invalid source values and missing permissions", async () => {
    const normalized = { dataType: "building" as const, templateVersion: "v1", checksum: "b".repeat(64), payload: { rows: [] } };
    await expect(submitNormalizedImport(normalized, "api" as "crm", actor(["data.import.building"]), dependencies())).rejects.toMatchObject({ status: 400, key: "IMPORT_SOURCE_INVALID" });
    await expect(submitNormalizedImport(normalized, "crm", actor([]), dependencies())).rejects.toMatchObject({ status: 403, key: "PERMISSION_DENIED" });
  });

  test("returns a stable error when normalized staging persistence fails", async () => {
    const repository = new FakeRepository();
    repository.failCreate = true;
    await expect(
      submitNormalizedImport(
        { dataType: "package", templateVersion: "v1", checksum: "c".repeat(64), payload: { rows: [] } },
        "crm",
        actor(["data.import.package"]),
        dependencies(repository),
      ),
    ).rejects.toMatchObject({ status: 500, key: "IMPORT_CREATE_FAILED" });
  });
});

describe("S3 immutable adapter contract", () => {
  test("uses conditional put, checksum metadata, bounded presigning, and fail-closed config", async () => {
    const send = vi.fn().mockResolvedValue({});
    const presign = vi.fn().mockResolvedValue("https://signed.test/object");
    const store = new S3ObjectStore(
      { endpoint: "http://minio:9000", region: "us-east-1", bucket: "imports", accessKeyId: "access", secretAccessKey: "secret" },
      { send } as never,
      presign,
    );
    await store.putImmutable("imports/key", new Uint8Array([1]), "text/csv", "f".repeat(64));
    await expect(store.getSignedDownloadUrl("imports/key", 301)).resolves.toBe("https://signed.test/object");
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: "imports", Key: "imports/key", IfNoneMatch: "*", ChecksumSHA256: expect.any(String) });
    expect(presign).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ input: { Bucket: "imports", Key: "imports/key" } }), { expiresIn: 301 });
    await expect(store.getSignedDownloadUrl("imports/key", 0)).rejects.toMatchObject({ key: "STORAGE_EXPIRY_INVALID" });
    expect(() => S3ObjectStore.fromEnv({})).toThrowError(expect.objectContaining({ key: "STORAGE_CONFIGURATION_ERROR" }));
  });
});
