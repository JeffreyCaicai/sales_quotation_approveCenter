import { describe, expect, expectTypeOf, test } from "vitest";

import type { BuildingRow } from "@/lib/imports/template-v2";
import {
  BuildingReactivationError,
  buildingIdentityKey,
  calculateBuildingDiff,
  type BuildingDiffSnapshot,
} from "@/lib/imports/diff";
import type { BuildingValidationSnapshot } from "@/lib/imports/validate";

function building(overrides: Partial<BuildingRow> = {}): BuildingRow {
  return {
    rowNumber: 2,
    irisBuildingId: "B003004",
    erpBuildingId: null,
    buildingName: "Apartment 19th Avenue",
    buildingType: "Apartment",
    gradeResource: "Grade A",
    area: "West Jakarta",
    city: "Jakarta",
    cbdArea: null,
    subDistrict: "Cengkareng",
    address: "Jl. Daan Mogot",
    operationalStatus: "active",
    dataSource: "building_team",
    ...overrides,
  };
}

function current(
  overrides: Partial<BuildingDiffSnapshot["buildings"][number]> = {},
): BuildingDiffSnapshot["buildings"][number] {
  return {
    id: "uuid-a",
    irisBuildingId: "B003004",
    erpBuildingId: null,
    buildingName: "Apartment 19th Avenue",
    buildingType: "Apartment",
    gradeResource: "Grade A",
    area: "West Jakarta",
    city: "Jakarta",
    cbdArea: null,
    subDistrict: "Cengkareng",
    address: "Jl. Daan Mogot",
    status: "active",
    dataSource: "building_team",
    ...overrides,
  };
}

describe("IRIS-keyed building differences", () => {
  test("does not disguise an inactive-to-active takeover as a modified descriptor", () => {
    expect(() => calculateBuildingDiff([
      building({ buildingName: "Replacement Tower", operationalStatus: "active" }),
    ], { buildings: [current({ status: "inactive", buildingName: "Former Tower" })] }))
      .toThrow(BuildingReactivationError);
  });

  test("uses the exact trimmed IRIS ID as the identity key", () => {
    expect(buildingIdentityKey(building({ irisBuildingId: " B003004 " }))).toBe("B003004");
  });

  test("classifies a changed name under a stable IRIS ID as modified", () => {
    const [change] = calculateBuildingDiff([
      building({ irisBuildingId: " B003004 ", buildingName: "Renamed Tower" }),
    ], { buildings: [current()] });

    expect(change).toMatchObject({
      type: "modified",
      entityKey: "B003004",
      before: { id: "uuid-a", buildingName: "Apartment 19th Avenue" },
      after: { irisBuildingId: "B003004", buildingName: "Renamed Tower" },
    });
  });

  test("does not match a new IRIS ID by mutable name or address", () => {
    const [change] = calculateBuildingDiff([
      building({ irisBuildingId: "B-NEW" }),
    ], { buildings: [current()] });

    expect(change).toMatchObject({ type: "added", entityKey: "B-NEW", before: null });
  });

  test("ignores source row coordinates when comparing unchanged data", () => {
    const [change] = calculateBuildingDiff([
      building({ rowNumber: 99, erpBuildingId: " " }),
    ], { buildings: [current()] });

    expect(change).toEqual({
      type: "unchanged",
      entityKey: "B003004",
      before: {
        id: "uuid-a",
        irisBuildingId: "B003004",
        erpBuildingId: null,
        buildingName: "Apartment 19th Avenue",
        buildingType: "Apartment",
        gradeResource: "Grade A",
        area: "West Jakarta",
        city: "Jakarta",
        cbdArea: null,
        subDistrict: "Cengkareng",
        address: "Jl. Daan Mogot",
        operationalStatus: "active",
        dataSource: "building_team",
      },
      after: {
        irisBuildingId: "B003004",
        erpBuildingId: null,
        buildingName: "Apartment 19th Avenue",
        buildingType: "Apartment",
        gradeResource: "Grade A",
        area: "West Jakarta",
        city: "Jakarta",
        cbdArea: null,
        subDistrict: "Cengkareng",
        address: "Jl. Daan Mogot",
        operationalStatus: "active",
        dataSource: "building_team",
      },
    });
  });

  test("classifies clearing a nullable current field as modified", () => {
    const [change] = calculateBuildingDiff([
      building({ gradeResource: null }),
    ], { buildings: [current({ gradeResource: "Grade A" })] });

    expect(change).toMatchObject({
      type: "modified",
      before: { gradeResource: "Grade A" },
      after: { gradeResource: null },
    });
  });

  test("does not invent defaults while comparing complete nullable values", () => {
    const [change] = calculateBuildingDiff([
      building({
        buildingType: null,
        gradeResource: null,
        area: null,
        city: null,
        cbdArea: null,
        subDistrict: null,
        dataSource: "erp",
      }),
    ], {
      buildings: [current({
        buildingType: null,
        gradeResource: null,
        area: null,
        city: null,
        cbdArea: null,
        subDistrict: null,
        dataSource: "erp",
      })],
    });

    expect(change.type).toBe("unchanged");
  });

  test("requires a fuller snapshot contract than identity validation", () => {
    expectTypeOf<BuildingValidationSnapshot>().not.toMatchTypeOf<BuildingDiffSnapshot>();
  });

  test("classifies an explicit active-to-inactive transition as deactivated", () => {
    const [change] = calculateBuildingDiff([
      building({ operationalStatus: "inactive" }),
    ], { buildings: [current()] });

    expect(change.type).toBe("deactivated");
  });

  test("does not infer deactivation from an absent import row", () => {
    expect(calculateBuildingDiff([], { buildings: [current()] })).toEqual([]);
  });
});
