import { createHash } from "node:crypto";

import { describe, expect, test, vi } from "vitest";
import * as XLSX from "xlsx";

import type { SessionUser } from "@/lib/auth/session";
import {
  ImportError,
  type ImportJobRepository,
  type UploadedJobRecord,
} from "@/lib/imports/contracts";
import { createImportJob } from "@/lib/imports/create-job";
import { submitNormalizedImport } from "@/lib/imports/ingestion-service";
import { normalizedChecksum } from "@/lib/imports/canonical-json";
import { reconcilePendingObjects } from "@/lib/imports/reconcile-pending-objects";
import type { ObjectStore, PendingObject } from "@/lib/storage/object-store";
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
): { filename: string; mimeType: string; body: Uint8Array } {
  return { filename: name, mimeType: type, body: bytes };
}

function workbookBytes(bookType: "xlsx" | "xlsm" = "xlsx"): Uint8Array {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["code"], ["B-1"]]), "Data");
  return new Uint8Array(XLSX.write(workbook, { type: "buffer", bookType }));
}

const xlsxBytes = workbookBytes();
const xlsmBytes = workbookBytes("xlsm");

class FakeStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  readonly cleaned: string[] = [];
  readonly committed: string[] = [];
  readonly pending = new Map<string, PendingObject>();
  failPutAt?: number;
  failCleanupAttempts = 0;
  cleanupAttempts = 0;
  private puts = 0;

  async readImmutable(key: string): Promise<Uint8Array> {
    const body = this.objects.get(key);
    if (!body) throw new Error("missing");
    return body;
  }

  async putImmutable(
    key: string,
    body: Uint8Array,
    _contentType: string,
    _sha256: string,
    attemptId: string,
  ): Promise<PendingObject> {
    this.puts += 1;
    if (this.puts === this.failPutAt) throw new Error("put failed");
    if (this.objects.has(key)) throw new Error("immutable collision");
    this.objects.set(key, body);
    const pending = { key, attemptId, versionId: `version-${this.puts}` };
    this.pending.set(key, pending);
    return pending;
  }

  async cleanupPending(object: PendingObject): Promise<"deleted" | "not_owned"> {
    this.cleanupAttempts += 1;
    if (this.cleanupAttempts <= this.failCleanupAttempts) throw new Error("delete failed");
    const owned = this.pending.get(object.key);
    if (!owned || owned.attemptId !== object.attemptId) return "not_owned";
    this.cleaned.push(object.key);
    this.objects.delete(object.key);
    this.pending.delete(object.key);
    return "deleted";
  }

  async commitPending(object: PendingObject): Promise<void> { this.committed.push(object.key); this.pending.delete(object.key); }
  async listPendingObjects(): Promise<PendingObject[]> { return [...this.pending.values()]; }

  async getSignedDownloadUrl(key: string, expiresSeconds: number) {
    return `https://objects.test/${key}?expires=${expiresSeconds}`;
  }
}

class FakeRepository implements ImportJobRepository {
  readonly jobs: UploadedJobRecord[] = [];
  duplicates = new Set<string>();
  failCreate = false;
  atomicDuplicate = false;
  private reservations = new Map<string, import("@/lib/imports/contracts").UploadReservationRecord>();

  async hasPublishedChecksum(dataType: string, checksum: string) {
    return this.duplicates.has(`${dataType}:${checksum}`);
  }

  async createUploadedJob(record: UploadedJobRecord): Promise<void | "duplicate"> {
    if (this.failCreate) throw new Error("database failed");
    if (this.atomicDuplicate) return "duplicate";
    this.jobs.push(structuredClone(record));
  }

  async reserveUpload(record: import("@/lib/imports/contracts").UploadReservationRecord) {
    if (this.atomicDuplicate || this.duplicates.has(`${record.dataType}:${record.checksum}`)) return "duplicate" as const;
    this.reservations.set(record.attemptId, record);
    return "reserved" as const;
  }

  async finalizeUpload(
    input: import("@/lib/imports/contracts").FinalizeUploadInput,
  ) {
    if (this.failCreate) throw new Error("database failed");
    const reservation = this.reservations.get(input.attemptId);
    if (!reservation) return "stale" as const;
    this.jobs.push({
      id: reservation.id, dataType: reservation.dataType,
      templateVersion: reservation.templateVersion, checksum: reservation.checksum,
      state: "uploaded", sourceType: reservation.sourceType, normalizedPayload: null,
      uploadedBy: reservation.uploadedBy, createdAt: reservation.createdAt.toISOString(),
      files: structuredClone(input.files),
    });
    return "uploaded" as const;
  }

  async cleanupUploadAttempt(_attemptId: string, _summary: string, cleanup: () => Promise<void>) {
    await cleanup();
    return "failed" as const;
  }
  async recordStorageSyncWarning() {}

  async listExpiredUploadAttemptIds() { return [] as string[]; }
  async listStorageSyncWarningAttemptIds() { return [] as string[]; }
  async reconcileUploadAttempt(
    _attemptId: string,
    _now: Date,
    _objects: readonly PendingObject[],
    operations: import("@/lib/imports/contracts").UploadReconciliationOperations,
  ) { await operations.cleanup(); return "failed" as const; }
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
  test("rejects a caller-selected template version before reserving storage", async () => {
    const deps = dependencies();
    await expect(createImportJob(
      { dataType: "building", templateVersion: "TMN-IMPORT-1", files: [upload("building.csv", "text/csv", new TextEncoder().encode("x"))] },
      actor(["data.import.building"]),
      deps,
    )).rejects.toMatchObject({ status: 400, key: "IMPORT_TEMPLATE_VERSION_INVALID" });
    expect(deps.objectStore.objects.size).toBe(0);
  });

  test("preserves the TMN-IMPORT-1 upload contract for customer_brand", async () => {
    const deps = dependencies();
    await expect(createImportJob(
      { dataType: "customer_brand", templateVersion: "TMN-IMPORT-1", files: [upload("customer_brand.csv", "text/csv", new TextEncoder().encode("header\nvalue"))] },
      actor(["data.import.customer_brand"]),
      deps,
    )).resolves.toMatchObject({ state: "uploaded" });
    expect(deps.repository.jobs[0].templateVersion).toBe("TMN-IMPORT-1");
    await expect(createImportJob(
      { dataType: "customer_brand", templateVersion: "TMN-IMPORT-2", files: [upload("customer_brand.csv", "text/csv", new TextEncoder().encode("header\nother"))] },
      actor(["data.import.customer_brand"]),
      dependencies(),
    )).rejects.toMatchObject({ key: "IMPORT_TEMPLATE_VERSION_INVALID" });
  });

  test("uses the TMN-IMPORT-2 upload contract for package", async () => {
    const deps = dependencies();
    await expect(createImportJob(
      { dataType: "package", templateVersion: "TMN-IMPORT-2", files: [upload("package.csv", "text/csv", new TextEncoder().encode("header\nvalue"))] },
      actor(["data.import.package"]),
      deps,
    )).resolves.toMatchObject({ state: "uploaded" });
    expect(deps.repository.jobs[0].templateVersion).toBe("TMN-IMPORT-2");
    await expect(createImportJob(
      { dataType: "package", templateVersion: "TMN-IMPORT-1", files: [upload("package.csv", "text/csv", new TextEncoder().encode("header\nother"))] },
      actor(["data.import.package"]),
      dependencies(),
    )).rejects.toMatchObject({ key: "IMPORT_TEMPLATE_VERSION_INVALID" });
  });

  test.each([
    ["macro.xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12", xlsmBytes, "IMPORT_FILE_TYPE_INVALID"],
    ["../building.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsxBytes, "IMPORT_FILENAME_INVALID"],
    ["building.xlsx", "text/csv", xlsxBytes, "IMPORT_FILE_TYPE_INVALID"],
    ["building.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", new Uint8Array([1, 2, 3]), "IMPORT_FILE_SIGNATURE_INVALID"],
    ["building.csv", "text/csv", xlsxBytes, "IMPORT_FILE_SIGNATURE_INVALID"],
    ["building.csv", "text/csv", new Uint8Array(), "IMPORT_FILE_EMPTY"],
  ])("rejects invalid file %s with a stable key", async (name, type, bytes, key) => {
    await expect(
      createImportJob(
        { dataType: "building", templateVersion: "TMN-IMPORT-2", files: [upload(name, type, bytes)] },
        actor(["data.import.building"]),
        dependencies(),
      ),
    ).rejects.toMatchObject({ status: 400, key });
  });

  test("rejects callers without the exact data-type permission", async () => {
    await expect(
      createImportJob(
        { dataType: "building", templateVersion: "TMN-IMPORT-2", files: [upload("building.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsxBytes)] },
        actor(["data.import.package"]),
        dependencies(),
      ),
    ).rejects.toEqual(new ImportError(403, "PERMISSION_DENIED"));
  });

  test("fails closed for an unknown data type", async () => {
    await expect(
      createImportJob(
        { dataType: "unknown" as "building", templateVersion: "TMN-IMPORT-2", files: [upload("building.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsxBytes)] },
        actor(["data.import.building"]),
        dependencies(),
      ),
    ).rejects.toMatchObject({ status: 400, key: "IMPORT_DATA_TYPE_INVALID" });
  });

  test("stores a valid xlsx under a server-generated key with its content SHA-256", async () => {
    const deps = dependencies();
    const result = await createImportJob(
      { dataType: "building", templateVersion: "TMN-IMPORT-2", files: [upload("My Building.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsxBytes)] },
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
        { dataType: "building", templateVersion: "TMN-IMPORT-2", files: [upload("building.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xlsxBytes)] },
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
        { dataType: "building", templateVersion: "TMN-IMPORT-2", files: [upload("building.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes)] },
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
        { dataType: "rate_card", templateVersion: "TMN-IMPORT-2", files: csvFiles().slice(0, 3) },
        actor(["rate_card.upload"]),
        dependencies(),
      ),
    ).rejects.toMatchObject({ status: 400, key: "IMPORT_RATE_CARD_FILES_INVALID" });
  });

  test("derives the batch checksum from a filename-sorted file manifest", async () => {
    const deps = dependencies();
    await createImportJob(
      { dataType: "rate_card", templateVersion: "TMN-IMPORT-2", files: csvFiles().reverse() },
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
        { dataType: "rate_card", templateVersion: "TMN-IMPORT-2", files: csvFiles() },
        actor(["rate_card.upload"]),
        deps,
      ),
    ).rejects.toMatchObject({ status: 500, key: "IMPORT_CREATE_FAILED" });
    expect(store.objects.size).toBe(0);
    expect(store.cleaned).toHaveLength(failure === "object storage" ? 2 : 4);
    expect(store.committed).toHaveLength(0);
  });

  test("rejects an atomic reservation duplicate before writing pending objects", async () => {
    const repository = new FakeRepository();
    repository.atomicDuplicate = true;
    const deps = dependencies(repository);
    await expect(createImportJob(
      { dataType: "rate_card", templateVersion: "TMN-IMPORT-2", files: csvFiles() },
      actor(["rate_card.upload"]),
      deps,
    )).rejects.toMatchObject({ status: 409, key: "IMPORT_DUPLICATE_PUBLISHED" });
    expect(deps.objectStore.objects.size).toBe(0);
    expect(deps.objectStore.cleaned).toHaveLength(0);
  });

  test("leaves a durable pending signal when cleanup retries fail and reconciliation later recovers", async () => {
    const repository = new FakeRepository();
    repository.failCreate = true;
    const store = new FakeStore();
    store.failCleanupAttempts = 3;
    await expect(createImportJob(
      { dataType: "building", templateVersion: "TMN-IMPORT-2", files: [upload("building.csv", "text/csv", new TextEncoder().encode("code\nB-1"))] },
      actor(["data.import.building"]),
      dependencies(repository, store),
    )).rejects.toMatchObject({ status: 500, key: "IMPORT_CLEANUP_PENDING" });
    expect(store.pending.size).toBe(1);
    await expect(reconcilePendingObjects(store, repository)).resolves.toEqual({ committed: 0, deleted: 1, failed: 1, skipped: 0 });
    expect(store.pending.size).toBe(0);
  });
});

describe("normalized manual/CRM ingestion boundary", () => {
  test("uses identical staging shapes and keeps source type as the only difference", async () => {
    const repository = new FakeRepository();
    const deps = dependencies(repository);
    const payload = { rows: [{ customerCode: "C-1", name: "Customer" }] };
    const normalized = {
      dataType: "customer_brand" as const,
      templateVersion: "v1",
      checksum: normalizedChecksum({ dataType: "customer_brand", templateVersion: "v1", payload }),
      payload,
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
    const payload = { rows: [] };
    const normalized = { dataType: "building" as const, templateVersion: "v1", checksum: normalizedChecksum({ dataType: "building", templateVersion: "v1", payload }), payload };
    await expect(submitNormalizedImport(normalized, "api" as "crm", actor(["data.import.building"]), dependencies())).rejects.toMatchObject({ status: 400, key: "IMPORT_SOURCE_INVALID" });
    await expect(submitNormalizedImport(normalized, "crm", actor([]), dependencies())).rejects.toMatchObject({ status: 403, key: "PERMISSION_DENIED" });
  });

  test("returns a stable error when normalized staging persistence fails", async () => {
    const repository = new FakeRepository();
    repository.failCreate = true;
    await expect(
      submitNormalizedImport(
        { dataType: "package", templateVersion: "v1", checksum: normalizedChecksum({ dataType: "package", templateVersion: "v1", payload: { rows: [] } }), payload: { rows: [] } },
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
    await store.putImmutable("imports/key", new Uint8Array([1]), "text/csv", "f".repeat(64), "attempt-1");
    await expect(store.getSignedDownloadUrl("imports/key", 301)).resolves.toBe("https://signed.test/object");
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: "imports", Key: "imports/key", IfNoneMatch: "*", ChecksumSHA256: expect.any(String), Metadata: { sha256: "f".repeat(64), state: "pending", attemptid: "attempt-1" }, Tagging: expect.stringContaining("state=pending") });
    expect(presign).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ input: { Bucket: "imports", Key: "imports/key" } }), { expiresIn: 301 });
    await expect(store.getSignedDownloadUrl("imports/key", 0)).rejects.toMatchObject({ key: "STORAGE_EXPIRY_INVALID" });
    expect(() => S3ObjectStore.fromEnv({})).toThrowError(expect.objectContaining({ key: "STORAGE_CONFIGURATION_ERROR" }));
  });

  test("never deletes a conditional-put collision and probes ambiguous ownership", async () => {
    const calls: string[] = [];
    const send = vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      calls.push(command.constructor.name);
      if (command.constructor.name === "PutObjectCommand") throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      if (command.constructor.name === "HeadObjectCommand") return { VersionId: "v-owned", Metadata: { state: "pending", attemptid: "attempt-owned" } };
      if (command.constructor.name === "GetObjectTaggingCommand") return { TagSet: [{ Key: "state", Value: "pending" }, { Key: "attemptId", Value: "attempt-owned" }] };
      return {};
    });
    const store = new S3ObjectStore(
      { endpoint: "http://minio:9000", region: "us-east-1", bucket: "imports", accessKeyId: "access", secretAccessKey: "secret" },
      { send } as never,
      vi.fn(),
    );
    await expect(store.putImmutable("imports/key", new Uint8Array([1]), "text/csv", "f".repeat(64), "attempt-owned")).resolves.toEqual({ key: "imports/key", attemptId: "attempt-owned", versionId: "v-owned" });
    expect(calls).toEqual(["PutObjectCommand", "HeadObjectCommand", "GetObjectTaggingCommand"]);

    send.mockImplementationOnce(async () => { throw Object.assign(new Error("collision"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } }); });
    await expect(store.putImmutable("imports/collision", new Uint8Array([2]), "text/csv", "e".repeat(64), "attempt-new")).rejects.toMatchObject({ key: "STORAGE_OBJECT_COLLISION" });
    expect(calls.filter((name) => name === "DeleteObjectCommand")).toHaveLength(0);

    await expect(store.cleanupPending({ key: "imports/key", attemptId: "foreign", versionId: "v-foreign" })).resolves.toBe("not_owned");
    expect(calls.filter((name) => name === "DeleteObjectCommand")).toHaveLength(0);
  });

  test.each([
    ["Head transient", "head-timeout"],
    ["GetTag transient", "tag-timeout"],
    ["missing", "missing"],
    ["not owned", "foreign"],
    ["pending tag failure", "put-tag-failure"],
  ])("fails storage sync for %s instead of treating it as absent", async (_label, scenario) => {
    const send = vi.fn(async (command: { constructor: { name: string } }) => {
      const name = command.constructor.name;
      if (name === "HeadObjectCommand") {
        if (scenario === "head-timeout") throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
        if (scenario === "missing") throw Object.assign(new Error("missing"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
        return { VersionId: "v1", Metadata: { state: "pending", attemptid: "attempt" } };
      }
      if (name === "GetObjectTaggingCommand") {
        if (scenario === "tag-timeout") throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
        return { TagSet: [{ Key: "state", Value: "pending" }, { Key: "attemptId", Value: scenario === "foreign" ? "other" : "attempt" }] };
      }
      if (name === "PutObjectTaggingCommand" && scenario === "put-tag-failure") throw new Error("tag failed");
      return {};
    });
    const store = new S3ObjectStore(
      { endpoint: "http://minio:9000", region: "us-east-1", bucket: "imports", accessKeyId: "access", secretAccessKey: "secret" },
      { send } as never,
      vi.fn(),
    );
    await expect(store.commitPending({ key: "imports/key", attemptId: "attempt", versionId: "v1" })).rejects.toMatchObject({ key: "STORAGE_SYNC_FAILED" });
    expect(send.mock.calls.filter(([command]) => command.constructor.name === "DeleteObjectCommand")).toHaveLength(0);
  });

  test("treats already committed ownership as idempotent and never deletes it", async () => {
    const send = vi.fn(async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === "HeadObjectCommand") return { VersionId: "v1", Metadata: { state: "committed", attemptid: "attempt" } };
      if (command.constructor.name === "GetObjectTaggingCommand") return { TagSet: [{ Key: "state", Value: "committed" }, { Key: "attemptId", Value: "attempt" }] };
      return {};
    });
    const store = new S3ObjectStore(
      { endpoint: "http://minio:9000", region: "us-east-1", bucket: "imports", accessKeyId: "access", secretAccessKey: "secret" },
      { send } as never,
      vi.fn(),
    );
    const object = { key: "imports/key", attemptId: "attempt", versionId: "v1" };
    await expect(store.commitPending(object)).resolves.toBeUndefined();
    await expect(store.cleanupPending(object)).resolves.toBe("not_owned");
    expect(send.mock.calls.some(([command]) => command.constructor.name === "PutObjectTaggingCommand")).toBe(false);
    expect(send.mock.calls.some(([command]) => command.constructor.name === "DeleteObjectCommand")).toBe(false);
  });

  test("fails reconciliation discovery when a listed object's ownership probe is unknown", async () => {
    const send = vi.fn(async (command: { constructor: { name: string } }) => {
      if (command.constructor.name === "ListObjectsV2Command") return { Contents: [{ Key: "imports/key" }], IsTruncated: false };
      if (command.constructor.name === "HeadObjectCommand") throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
      return {};
    });
    const store = new S3ObjectStore(
      { endpoint: "http://minio:9000", region: "us-east-1", bucket: "imports", accessKeyId: "access", secretAccessKey: "secret" },
      { send } as never,
      vi.fn(),
    );
    await expect(store.listPendingObjects()).rejects.toMatchObject({ key: "STORAGE_SYNC_FAILED" });
  });
});
