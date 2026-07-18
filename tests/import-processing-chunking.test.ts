import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ImportValidationError } from "@/lib/imports/errors";
import type { RateCardChange } from "@/lib/imports/rate-card-diff";
import type { StagedRateCardImport } from "@/lib/imports/template-v2";

const mocks = vi.hoisted(() => ({
  insertedBatches: [] as unknown[][],
  getDb: vi.fn(),
}));

vi.mock("@/db", () => ({ getDb: mocks.getDb }));

import { PostgresImportProcessingRepository } from "@/lib/imports/processing-repository";

function fakeDatabase() {
  const tx = {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: vi.fn(async () => [{ id: "job-1" }]) })),
      })),
    })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: unknown[]) => {
        mocks.insertedBatches.push(values);
      }),
    })),
  };
  return {
    transaction: vi.fn(async (work: (transaction: typeof tx) => Promise<void>) => work(tx)),
  };
}

describe("durable processing insert chunking", () => {
  beforeEach(() => {
    mocks.insertedBatches.length = 0;
    mocks.getDb.mockReturnValue(fakeDatabase());
  });

  test("chunks the maximum 30,000 Rate Card changes inside one transaction", async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => index + 2);
    const normalized: StagedRateCardImport = {
      templateVersion: "TMN-IMPORT-2",
      currency: "IDR",
      basedOnVersionId: null,
      buildingPrices: rows.map((rowNumber) => ({ rowNumber, irisBuildingId: `B-${rowNumber}`, priceIdr: "0" })),
      packagePrices: rows.map((rowNumber) => ({ rowNumber, packageCode: `P-${rowNumber}`, priceIdr: "0" })),
      packageMemberships: rows.map((rowNumber) => ({ rowNumber, packageCode: `P-${rowNumber}`, irisBuildingId: `B-${rowNumber}` })),
    };
    const changes: RateCardChange[] = Array.from({ length: 30_000 }, (_, index) => ({
      entityKey: `building:B-${index}`,
      changeType: "added",
      before: null,
      after: { kind: "building_price", irisBuildingId: `B-${index}`, priceIdr: "0" },
    }));

    await new PostgresImportProcessingRepository().completeRateCard(
      "job-1",
      "2026-07-19T00:00:00.000Z",
      normalized,
      changes,
    );

    expect(mocks.insertedBatches.length).toBeGreaterThan(1);
    expect(mocks.insertedBatches.flat()).toHaveLength(30_000);
    expect(Math.max(...mocks.insertedBatches.map((batch) => batch.length))).toBeLessThanOrEqual(1_000);
  });

  test("chunks a complete 20,000-error report inside one transaction", async () => {
    const errors: ImportValidationError[] = Array.from({ length: 20_000 }, (_, index) => ({
      filename: "buildings.csv",
      sheet: "Data",
      rowNumber: (index % 10_000) + 2,
      column: index % 2 === 0 ? "Operational Status" : "Data Source",
      key: "import.error.value_invalid",
      params: {},
    }));

    await new PostgresImportProcessingRepository().fail(
      "job-1",
      "2026-07-19T00:00:00.000Z",
      errors,
    );

    expect(mocks.insertedBatches.length).toBeGreaterThan(1);
    expect(mocks.insertedBatches.flat()).toHaveLength(20_000);
    expect(Math.max(...mocks.insertedBatches.map((batch) => batch.length))).toBeLessThanOrEqual(1_000);
  });
});
