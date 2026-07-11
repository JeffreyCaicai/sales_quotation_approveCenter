import { describe, expect, test, vi } from "vitest";
import * as XLSX from "xlsx";

import type { SessionUser } from "@/lib/auth/session";
import { canonicalJson, normalizedChecksum } from "@/lib/imports/canonical-json";
import type { ImportJobRepository } from "@/lib/imports/contracts";
import { submitNormalizedImport } from "@/lib/imports/ingestion-service";
import { IMPORT_CHECKSUM_LOCK_NAME } from "@/lib/imports/import-lock";
import { reconcilePendingObjects } from "@/lib/imports/reconcile-pending-objects";
import { inspectXlsxContainer } from "@/lib/imports/xlsx-container";
import type { ObjectStore, PendingObject } from "@/lib/storage/object-store";

const actor: SessionUser = {
  id: "12e7130a-8321-4d8f-a6ea-312950722854",
  email: "uploader@example.com",
  displayName: "Uploader",
  status: "active",
  permissions: ["data.import.building"],
};

function workbookBytes(bookType: "xlsx" | "xlsm" = "xlsx") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["code"], ["B-1"]]), "Data");
  return new Uint8Array(XLSX.write(workbook, { type: "buffer", bookType }));
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function storedZip(entries: Array<[string, string]>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const u16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true);
  const u32 = (view: DataView, at: number, value: number) => view.setUint32(at, value, true);
  for (const [name, content] of entries) {
    const nameBytes = encoder.encode(name);
    const body = encoder.encode(content);
    const crc = crc32(body);
    const local = new Uint8Array(30 + nameBytes.length + body.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u32(lv, 14, crc); u32(lv, 18, body.length); u32(lv, 22, body.length); u16(lv, 26, nameBytes.length);
    local.set(nameBytes, 30); local.set(body, 30 + nameBytes.length); locals.push(local);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    u32(cv, 0, 0x02014b50); u16(cv, 4, 20); u16(cv, 6, 20); u32(cv, 16, crc); u32(cv, 20, body.length); u32(cv, 24, body.length); u16(cv, 28, nameBytes.length); u32(cv, 42, offset);
    central.set(nameBytes, 46); centrals.push(central); offset += local.length;
  }
  const centralSize = centrals.reduce((sum, value) => sum + value.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 8, entries.length); u16(ev, 10, entries.length); u32(ev, 12, centralSize); u32(ev, 16, offset);
  const output = new Uint8Array(offset + centralSize + end.length); let cursor = 0;
  for (const part of [...locals, ...centrals, end]) { output.set(part, cursor); cursor += part.length; }
  return output;
}

function excessiveCentralDirectory(): Uint8Array {
  const bytes = storedZip([
    ["[Content_Types].xml", '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'],
    ["xl/workbook.xml", "x"],
  ]);
  for (let index = 0; index < bytes.length - 4; index += 1) {
    const view = new DataView(bytes.buffer);
    if (view.getUint32(index, true) === 0x02014b50) {
      view.setUint32(index + 24, 101 * 1024 * 1024, true);
      break;
    }
  }
  return bytes;
}

describe("OOXML container inspection", () => {
  const contentTypes = '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>';
  const workbookXml = '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>';
  test("accepts a real normal XLSX", async () => {
    await expect(inspectXlsxContainer(workbookBytes())).resolves.toBeUndefined();
  });

  test.each([
    ["macro-enabled workbook", workbookBytes("xlsm")],
    ["arbitrary ZIP", storedZip([["hello.txt", "hello"]])],
    ["unsafe ZIP path", storedZip([["../xl/workbook.xml", "x"], ["[Content_Types].xml", "x"]])],
    ["VBA part with mixed case", storedZip([["[Content_Types].xml", '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>'], ["xl/workbook.xml", "x"], ["XL/VbaProject.BIN", "x"]])],
    ["malformed archive", workbookBytes().slice(0, 100)],
    ["excessive declared uncompressed total", excessiveCentralDirectory()],
    ["fake workbook XML behind a valid MIME string", storedZip([["[Content_Types].xml", contentTypes], ["xl/workbook.xml", "not xml workbook"]])],
    ["duplicate normalized critical entry", storedZip([["[Content_Types].xml", contentTypes], ["[content_types].xml", contentTypes], ["xl/workbook.xml", workbookXml]])],
    ["external workbook relationship", storedZip([["[Content_Types].xml", contentTypes], ["xl/workbook.xml", workbookXml], ["xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="https://evil.test/data" TargetMode="External"/></Relationships>']])],
    ["entry flood", storedZip([
      ["[Content_Types].xml", contentTypes],
      ["xl/workbook.xml", workbookXml],
      ...Array.from({ length: 2049 }, (_, index) => [`xl/dummy-${index}.xml`, "x"] as [string, string]),
    ])],
  ])("rejects %s", async (_label, bytes) => {
    await expect(inspectXlsxContainer(bytes)).rejects.toMatchObject({ key: "IMPORT_FILE_SIGNATURE_INVALID" });
  });
});

describe("canonical normalized envelope", () => {
  test("sorts object keys recursively while preserving array order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: [3, { b: 1, a: 2 }] } })).toBe('{"a":{"x":[3,{"a":2,"b":1}],"y":2},"z":1}');
    expect(normalizedChecksum({ dataType: "building", templateVersion: "v1", payload: { b: 2, a: 1 } })).toBe(
      normalizedChecksum({ dataType: "building", templateVersion: "v1", payload: { a: 1, b: 2 } }),
    );
  });

  test("rejects forged checksums and runtime-invalid envelopes", async () => {
    const repository = { hasPublishedChecksum: vi.fn(), createUploadedJob: vi.fn() } as unknown as ImportJobRepository;
    await expect(submitNormalizedImport({ dataType: "building", templateVersion: "v1", checksum: "a".repeat(64), payload: { rows: [] } }, "crm", actor, {
      repository, objectStore: {} as ObjectStore, now: () => new Date(), randomUUID: () => crypto.randomUUID(),
    })).rejects.toMatchObject({ status: 400, key: "IMPORT_CHECKSUM_INVALID" });
    await expect(submitNormalizedImport({ dataType: "unknown" as "building", templateVersion: "", checksum: "no", payload: undefined }, "crm", actor, {
      repository, objectStore: {} as ObjectStore, now: () => new Date(), randomUUID: () => crypto.randomUUID(),
    })).rejects.toMatchObject({ status: 400, key: "IMPORT_ENVELOPE_INVALID" });
  });

  test("throws duplicate when the fast check misses but the atomic recheck wins", async () => {
    const payload = { rows: [] };
    const checksum = normalizedChecksum({ dataType: "building", templateVersion: "v1", payload });
    const repository = {
      hasPublishedChecksum: vi.fn().mockResolvedValue(false),
      createUploadedJob: vi.fn().mockResolvedValue("duplicate"),
    } as unknown as ImportJobRepository;
    await expect(submitNormalizedImport(
      { dataType: "building", templateVersion: "v1", checksum, payload },
      "crm",
      actor,
      { repository, objectStore: {} as ObjectStore, now: () => new Date(), randomUUID: () => crypto.randomUUID() },
    )).rejects.toMatchObject({ status: 409, key: "IMPORT_DUPLICATE_PUBLISHED" });
  });
});

class OrderedRepository implements ImportJobRepository {
  readonly events: string[] = [];
  async hasPublishedChecksum() { this.events.push("fast-check"); return false; }
  async createUploadedJob() { this.events.push("lock", "recheck", "insert"); }
  async reserveUpload() { return "reserved" as const; }
  async finalizeUpload() { return "uploaded" as const; }
  async cleanupUploadAttempt() { return "failed" as const; }
  async listExpiredUploadAttemptIds() { return []; }
  async reconcileUploadAttempt() { return "skipped" as const; }
}

describe("atomic duplicate gate", () => {
  test("exports a stable shared lock name and preserves lock-recheck-insert ordering", async () => {
    expect(IMPORT_CHECKSUM_LOCK_NAME).toBe("import-data-type-checksum-v1");
    const repository = new OrderedRepository();
    const payload = { rows: [{ code: "B-1" }] };
    const checksum = normalizedChecksum({ dataType: "building", templateVersion: "v1", payload });
    await submitNormalizedImport({ dataType: "building", templateVersion: "v1", checksum, payload }, "crm", actor, {
      repository, objectStore: {} as ObjectStore, now: () => new Date("2026-07-11T00:00:00Z"), randomUUID: () => "00000000-0000-4000-8000-000000000001",
    });
    expect(repository.events).toEqual(["fast-check", "lock", "recheck", "insert"]);
  });
});

class ReconcileStore implements ObjectStore {
  pending: PendingObject[] = [];
  deletes = 0;
  commits = 0;
  failDeletes = 0;
  async putImmutable(): Promise<PendingObject> { throw new Error("unused"); }
  async getSignedDownloadUrl() { return ""; }
  async cleanupPending(object: PendingObject) { this.deletes += 1; if (this.deletes <= this.failDeletes) throw new Error("delete failed"); this.pending = this.pending.filter((item) => item.key !== object.key); return "deleted" as const; }
  async commitPending() { this.commits += 1; }
  async listPendingObjects() { return this.pending; }
}

describe("pending object reconciliation", () => {
  test("commits referenced objects and retries safe deletion of unreferenced pending objects", async () => {
    const store = new ReconcileStore();
    store.pending = [
      { key: "referenced", attemptId: "a", versionId: "v1" },
      { key: "orphan", attemptId: "b", versionId: "v2" },
    ];
    store.failDeletes = 3;
    const repository = {
      listExpiredUploadAttemptIds: vi.fn(async () => []),
      reconcileUploadAttempt: vi.fn(async (attemptId: string, _now: Date, _objects: PendingObject[], operations: import("@/lib/imports/contracts").UploadReconciliationOperations) => {
        if (attemptId === "a") { await operations.commit(); return "committed" as const; }
        await operations.cleanup(); return "failed" as const;
      }),
    };
    await expect(reconcilePendingObjects(store, repository, { maxAttempts: 2 })).rejects.toMatchObject({ key: "IMPORT_CLEANUP_PENDING" });
    expect(store.commits).toBe(1);
    await expect(reconcilePendingObjects(store, repository, { maxAttempts: 2 })).resolves.toEqual({ committed: 1, deleted: 1, failed: 1, skipped: 0 });
    expect(store.pending.map((item) => item.key)).toEqual(["referenced"]);
  });
});
