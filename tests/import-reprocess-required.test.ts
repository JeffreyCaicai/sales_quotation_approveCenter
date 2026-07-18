import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  updates: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/db", () => ({ getDb: mocks.getDb }));

import {
  attachStalePublicationToken,
  markImportReprocessRequired,
  stalePublicationToken,
  type ImportPreviewToken,
} from "@/lib/imports/reprocess-required";

const previewToken: ImportPreviewToken = {
  state: "draft",
  revision: "101",
};

function database(
  state: string,
  revision = previewToken.revision,
  updateRows: unknown[] = [{ id: "job-1" }],
) {
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => ({
            for: async () => [{ state, revision }],
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.updates.push(values);
        return {
          where: () => ({
            returning: async () => updateRows,
          }),
        };
      },
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        mocks.audits.push(values);
      },
    }),
  };
  return { transaction: <T>(work: (value: typeof tx) => Promise<T>) => work(tx) };
}

describe("durable stale preview marker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updates.length = 0;
    mocks.audits.length = 0;
  });

  test.each(["ready_to_publish", "draft"] as const)("marks %s as reprocess-required with an audit", async (state) => {
    mocks.getDb.mockReturnValue(database(state));
    const token: ImportPreviewToken = { ...previewToken, state };

    await expect(markImportReprocessRequired("job-1", "actor-1", token)).resolves.toBe(true);

    expect(mocks.updates).toEqual([expect.objectContaining({
      state: "reprocess_required",
      failureSummary: "IMPORT_REPROCESS_REQUIRED",
    })]);
    expect(mocks.audits).toEqual([expect.objectContaining({
      action: "import.job.reprocess_required",
      actorUserId: "actor-1",
      beforeMetadata: { state },
      afterMetadata: { state: "reprocess_required" },
    })]);
  });

  test("is idempotent once the job is already reprocess-required", async () => {
    mocks.getDb.mockReturnValue(database("reprocess_required"));

    await expect(markImportReprocessRequired("job-1", "actor-1", previewToken)).resolves.toBe(false);

    expect(mocks.updates).toEqual([]);
    expect(mocks.audits).toEqual([]);
  });

  test("does not audit when a concurrent state transition wins the compare-and-set", async () => {
    mocks.getDb.mockReturnValue(database("draft", previewToken.revision, []));

    await expect(markImportReprocessRequired("job-1", "actor-1", previewToken)).resolves.toBe(false);

    expect(mocks.audits).toEqual([]);
  });

  test("does not overwrite a fresh preview completed after the publisher observed its token", async () => {
    mocks.getDb.mockReturnValue(database(
      "draft",
      "102",
    ));

    await expect(markImportReprocessRequired("job-1", "actor-1", previewToken)).resolves.toBe(false);

    expect(mocks.updates).toEqual([]);
    expect(mocks.audits).toEqual([]);
  });

  test("carries an internal publisher-observed token only on a stale error", () => {
    const stale = { key: "IMPORT_CHANGE_STALE" };
    attachStalePublicationToken(stale, previewToken);

    expect(stalePublicationToken(stale)).toEqual(previewToken);
    expect(stalePublicationToken({ key: "IMPORT_JOB_NOT_READY", previewToken })).toBeNull();
  });
});
