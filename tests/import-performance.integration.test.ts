import { performance } from "node:perf_hooks";

import { describe, expect, test } from "vitest";

import { calculateBuildingDiff } from "@/lib/imports/diff";
import { parseImportFiles } from "@/lib/imports/normalize";
import { validateBuildingRows } from "@/lib/imports/validate";

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
  return {
    filename: "buildings-5000.csv",
    body: new TextEncoder().encode([HEADER, ...rows].join("\n")),
  };
}

describe("representative building import performance", () => {
  test("parses, validates, and diffs 5,000 deterministic rows within 60 seconds", async () => {
    const startedAt = performance.now();
    const parsed = await parseImportFiles("building", [fixture()]);
    const parsedAt = performance.now();
    const errors = validateBuildingRows(parsed.rows, { buildings: [] });
    const validatedAt = performance.now();
    const changes = calculateBuildingDiff(parsed.rows, { buildings: [] });
    const finishedAt = performance.now();

    expect(parsed.rows).toHaveLength(ROW_COUNT);
    expect(parsed.rows[0]).toMatchObject({ irisBuildingId: "B000001", erpBuildingId: "ERP-000001" });
    expect(parsed.rows[2]).toMatchObject({ irisBuildingId: "B000003", erpBuildingId: null });
    expect(parsed.rows[4_999]).toMatchObject({ irisBuildingId: "B005000", erpBuildingId: "ERP-005000" });
    expect(parsed.rows.filter((row) => row.erpBuildingId === null)).toHaveLength(Math.floor(ROW_COUNT / 3));
    expect(errors).toEqual([]);
    expect(changes).toHaveLength(ROW_COUNT);
    expect(changes.every((change) => change.type === "added")).toBe(true);
    expect(finishedAt - startedAt).toBeLessThan(DEADLINE_MS);

    console.info(JSON.stringify({
      rows: ROW_COUNT,
      parseMs: Number((parsedAt - startedAt).toFixed(2)),
      validateMs: Number((validatedAt - parsedAt).toFixed(2)),
      diffMs: Number((finishedAt - validatedAt).toFixed(2)),
      totalMs: Number((finishedAt - startedAt).toFixed(2)),
    }));
  }, 70_000);
});
