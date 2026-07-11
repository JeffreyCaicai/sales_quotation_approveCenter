import { describe, expect, test } from "vitest";

import {
  RateCardBuildingResolutionError,
  resolveRateCardBuildingReferences,
} from "@/lib/imports/resolve-rate-card-building-references";
import type { RateCardImport } from "@/lib/imports/template-v2";
import type { BuildingValidationSnapshot } from "@/lib/imports/validate";

function rateCard(overrides: Partial<RateCardImport> = {}): RateCardImport {
  return {
    templateVersion: "TMN-IMPORT-2",
    versionCode: "RC-RESOLVE",
    effectiveDate: "2026-08-01",
    currency: "IDR",
    buildingPrices: [],
    packagePrices: [],
    packageBuildings: [],
    ...overrides,
  };
}

const snapshot: BuildingValidationSnapshot = {
  buildings: [
    { id: "uuid-active-a", irisBuildingId: "B000001", erpBuildingId: null, status: "active" },
    { id: "uuid-active-b", irisBuildingId: "B000002", erpBuildingId: "ERP-2", status: "active" },
    { id: "uuid-inactive", irisBuildingId: "B000003", erpBuildingId: null, status: "inactive" },
  ],
};

describe("Rate Card IRIS reference resolution", () => {
  test("maps building prices and package memberships to internal building UUIDs", () => {
    expect(resolveRateCardBuildingReferences(rateCard({
      buildingPrices: [
        { rowNumber: 2, irisBuildingId: " B000001 ", priceIdr: "1000000" },
        { rowNumber: 3, irisBuildingId: "B000002", priceIdr: "2000000" },
      ],
      packageBuildings: [
        { rowNumber: 2, packageCode: "PKG-A", irisBuildingId: "B000002" },
        { rowNumber: 3, packageCode: "PKG-B", irisBuildingId: " B000001 " },
      ],
    }), snapshot)).toEqual({
      buildingPrices: [
        { rowNumber: 2, buildingId: "uuid-active-a", priceIdr: "1000000" },
        { rowNumber: 3, buildingId: "uuid-active-b", priceIdr: "2000000" },
      ],
      packageBuildings: [
        { rowNumber: 2, packageCode: "PKG-A", buildingId: "uuid-active-b" },
        { rowNumber: 3, packageCode: "PKG-B", buildingId: "uuid-active-a" },
      ],
    });
  });

  test("rejects missing and inactive references before UUID resolution", () => {
    expect(() => resolveRateCardBuildingReferences(rateCard({
      buildingPrices: [
        { rowNumber: 5, irisBuildingId: "B-MISSING", priceIdr: "100" },
        { rowNumber: 4, irisBuildingId: "B000003", priceIdr: "200" },
      ],
      packageBuildings: [
        { rowNumber: 7, packageCode: "PKG-A", irisBuildingId: "B000003" },
      ],
    }), snapshot)).toThrow(RateCardBuildingResolutionError);

    try {
      resolveRateCardBuildingReferences(rateCard({
        buildingPrices: [
          { rowNumber: 5, irisBuildingId: "B-MISSING", priceIdr: "100" },
          { rowNumber: 4, irisBuildingId: "B000003", priceIdr: "200" },
        ],
        packageBuildings: [
          { rowNumber: 7, packageCode: "PKG-A", irisBuildingId: "B000003" },
        ],
      }), snapshot);
      throw new Error("expected resolution to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(RateCardBuildingResolutionError);
      expect((error as RateCardBuildingResolutionError).errors.map((item) => item.key)).toEqual([
        "import.error.building_inactive",
        "import.error.building_not_found",
        "import.error.building_inactive",
      ]);
    }
  });

  test("rejects duplicate prices and duplicate package memberships", () => {
    try {
      resolveRateCardBuildingReferences(rateCard({
        buildingPrices: [
          { rowNumber: 2, irisBuildingId: "B000001", priceIdr: "100" },
          { rowNumber: 8, irisBuildingId: " B000001 ", priceIdr: "200" },
        ],
        packageBuildings: [
          { rowNumber: 3, packageCode: "PKG-A", irisBuildingId: "B000002" },
          { rowNumber: 9, packageCode: "PKG-A", irisBuildingId: " B000002 " },
          { rowNumber: 10, packageCode: "PKG-B", irisBuildingId: "B000002" },
        ],
      }), snapshot);
      throw new Error("expected resolution to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(RateCardBuildingResolutionError);
      expect((error as RateCardBuildingResolutionError).errors).toEqual([
        { sheet: "Building Prices", rowNumber: 2, column: "IRIS Building ID", key: "import.error.rate_card_building_duplicate", params: { irisBuildingId: "B000001" } },
        { sheet: "Building Prices", rowNumber: 8, column: "IRIS Building ID", key: "import.error.rate_card_building_duplicate", params: { irisBuildingId: "B000001" } },
        { sheet: "Package Buildings", rowNumber: 3, column: "IRIS Building ID", key: "import.error.package_building_duplicate", params: { irisBuildingId: "B000002", packageCode: "PKG-A" } },
        { sheet: "Package Buildings", rowNumber: 9, column: "IRIS Building ID", key: "import.error.package_building_duplicate", params: { irisBuildingId: "B000002", packageCode: "PKG-A" } },
      ]);
    }
  });
});
