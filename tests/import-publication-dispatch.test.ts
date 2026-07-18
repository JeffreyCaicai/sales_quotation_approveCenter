import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  publishRateCardImport: vi.fn(),
}));

vi.mock("@/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/imports/publish-rate-card", () => ({
  publishRateCardImport: mocks.publishRateCardImport,
}));

import type { SessionUser } from "@/lib/auth/session";
import { publishImport } from "@/lib/imports/publish";

const actor: SessionUser = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "publisher@example.com",
  displayName: "Publisher",
  status: "active",
  permissions: ["data.import.building"],
};

function chainFor(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "innerJoin", "where", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function queuedDatabase(...responses: unknown[][]) {
  const queue = [...responses];
  return {
    select: vi.fn(() => chainFor(queue.shift() ?? [])),
  };
}

describe("publication dispatch authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("requires a current database publication permission before revealing job existence", async () => {
    const db = queuedDatabase([]);
    mocks.getDb.mockReturnValue(db);

    await expect(publishImport("missing-job", actor)).rejects.toMatchObject({
      key: "PERMISSION_DENIED",
      status: 403,
    });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  test("rejects an unsupported data type instead of falling through to Building publication", async () => {
    const db = queuedDatabase(
      [{ permissionKey: "data.import.building" }],
      [{ dataType: "customer_brand" }],
    );
    mocks.getDb.mockReturnValue(db);

    await expect(publishImport("unsupported-job", actor)).rejects.toMatchObject({
      key: "IMPORT_DATA_TYPE_UNSUPPORTED",
      status: 400,
    });
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  test("requires the exact live publication permission before dispatch", async () => {
    const db = queuedDatabase(
      [{ permissionKey: "data.import.building" }],
      [{ dataType: "rate_card" }],
    );
    mocks.getDb.mockReturnValue(db);

    await expect(publishImport("rate-card-job", actor)).rejects.toMatchObject({
      key: "PERMISSION_DENIED",
      status: 403,
    });
    expect(mocks.publishRateCardImport).not.toHaveBeenCalled();
  });
});
