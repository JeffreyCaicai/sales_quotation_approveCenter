import { performance } from "node:perf_hooks";

import { describe, expect, test } from "vitest";

import type { SessionUser } from "@/lib/auth/session";
import {
  processImport,
  type ImportProcessingRepository,
  type ProcessImportDependencies,
} from "@/lib/imports/process-import";

const ROW_COUNT = 5_000;
const DEADLINE_MS = 60_000;
const HEADER = "IRIS Building ID,ERP Building ID,Building Name,Building Type,Grade Resource,Area,City,CBD Area,Sub-District,Address,Operational Status,Data Source";

function fixture() {
  const rows = Array.from({ length: ROW_COUNT }, (_, offset) => {
    const number = offset + 1;
    const padded = String(number).padStart(6, "0");
    const erpBuildingId = number % 3 === 0 ? "" : `ERP-${padded}`;
    return `B${padded},${erpBuildingId},Building ${padded},Office,Grade A,Jakarta,Jakarta,CBD,Setiabudi,Address ${padded},active,building_team`;
  });
  return new TextEncoder().encode([HEADER, ...rows].join("\n"));
}

describe("representative building import performance", () => {
  test("processes exactly 5,000 rows to ready-to-publish within 60 seconds", async () => {
    const body = fixture();
    let completedRows = 0;
    let completedChanges = 0;
    const repository: ImportProcessingRepository = {
      claim: async () => ({
        kind: "claimed",
        job: {
          id: "performance-job",
          dataType: "building",
          templateVersion: "TMN-IMPORT-2",
          claimToken: new Date().toISOString(),
          files: [{
            objectStorageKey: "imports/performance/buildings.csv",
            originalFilename: "buildings-5000.csv",
            checksum: "performance-checksum",
          }],
        },
      }),
      buildingSnapshot: async () => ({
        buildings: [],
        controlledValues: { buildingTypes: ["Office"], gradeResources: ["Grade A"] },
      }),
      packageSnapshot: async () => ({ packages: [] }),
      loadRateCardSnapshot: async () => ({
        buildings: [],
        controlledValues: { buildingTypes: [], gradeResources: [] },
        packages: [],
        versionId: null,
        buildingPrices: new Map(),
        packagePrices: new Map(),
        packageMemberships: [],
      }),
      completeBuilding: async (_jobId, _claimToken, normalized, changes) => {
        completedRows = normalized.rows.length;
        completedChanges = changes.length;
      },
      completePackage: async () => { throw new Error("unexpected package completion"); },
      completeRateCard: async () => { throw new Error("unexpected Rate Card completion"); },
      fail: async () => { throw new Error("unexpected validation failure"); },
      retry: async () => { throw new Error("unexpected retry"); },
    };
    const dependencies: ProcessImportDependencies = {
      repository,
      objectStore: { readImmutable: async () => body },
    };
    const actor: SessionUser = {
      id: "performance-user",
      email: "performance@example.test",
      displayName: "Performance User",
      status: "active",
      permissions: ["data.import.building"],
    };

    const startedAt = performance.now();
    const result = await processImport("performance-job", actor, dependencies);
    const elapsedMs = performance.now() - startedAt;

    expect(result).toEqual({ jobId: "performance-job", state: "ready_to_publish" });
    expect(completedRows).toBe(ROW_COUNT);
    expect(completedChanges).toBe(ROW_COUNT);
    expect(elapsedMs).toBeLessThan(DEADLINE_MS);
    console.info(JSON.stringify({
      rows: completedRows,
      state: result.state,
      totalMs: Number(elapsedMs.toFixed(2)),
    }));
  }, 70_000);
});
