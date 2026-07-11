import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db", () => ({ getDb: mocks.getDb }));

import type { UploadedJobRecord } from "@/lib/imports/contracts";
import { PostgresImportJobRepository } from "@/lib/imports/repository";

const record: UploadedJobRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  dataType: "building",
  templateVersion: "v1",
  checksum: "a".repeat(64),
  state: "uploaded",
  sourceType: "manual",
  normalizedPayload: null,
  uploadedBy: "00000000-0000-4000-8000-000000000002",
  createdAt: "2026-07-11T00:00:00.000Z",
  files: [],
};

function database(duplicate: boolean) {
  const events: string[] = [];
  const tx = {
    execute: vi.fn(async () => { events.push("lock"); }),
    select: vi.fn(() => ({
      from: () => ({ where: () => ({ limit: async () => {
        events.push("recheck");
        return duplicate ? [{ id: "published" }] : [];
      } }) }),
    })),
    insert: vi.fn(() => ({ values: async () => { events.push("insert"); } })),
  };
  return {
    events,
    db: { transaction: async (operation: (transaction: typeof tx) => Promise<unknown>) => operation(tx) },
  };
}

describe("Postgres atomic duplicate gate", () => {
  beforeEach(() => vi.clearAllMocks());

  test("orders advisory xact lock, published-state recheck, then insert", async () => {
    const fake = database(false);
    mocks.getDb.mockReturnValue(fake.db);
    await expect(new PostgresImportJobRepository().createUploadedJob(record)).resolves.toBeUndefined();
    expect(fake.events).toEqual(["lock", "recheck", "insert"]);
  });

  test("returns duplicate under the lock without inserting", async () => {
    const fake = database(true);
    mocks.getDb.mockReturnValue(fake.db);
    await expect(new PostgresImportJobRepository().createUploadedJob(record)).resolves.toBe("duplicate");
    expect(fake.events).toEqual(["lock", "recheck"]);
  });
});
