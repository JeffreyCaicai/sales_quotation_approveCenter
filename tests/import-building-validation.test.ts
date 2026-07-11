import { describe, expect, test } from "vitest";

import type { BuildingRow, RateCardImport } from "@/lib/imports/template-v2";
import {
  validateBuildingRows,
  validateRateCardBuildings,
  type BuildingValidationSnapshot,
} from "@/lib/imports/validate";

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

function snapshot(
  buildings: BuildingValidationSnapshot["buildings"] = [],
): BuildingValidationSnapshot {
  return { buildings };
}

function rateCard(overrides: Partial<RateCardImport> = {}): RateCardImport {
  return {
    templateVersion: "TMN-IMPORT-2",
    versionCode: "RC-2026-07",
    effectiveDate: "2026-07-15",
    currency: "IDR",
    buildingPrices: [],
    packagePrices: [],
    packageBuildings: [],
    ...overrides,
  };
}

describe("building identity validation", () => {
  test("accepts a minimal identity and status snapshot", () => {
    expect(validateBuildingRows([
      building({ irisBuildingId: "B000006", erpBuildingId: "ERP-01" }),
    ], snapshot([
      { id: "uuid-a", irisBuildingId: "B000006", erpBuildingId: "ERP-01", status: "active" },
    ]))).toEqual([]);
  });

  test("accepts a manual-only active building", () => {
    expect(validateBuildingRows([building()], snapshot())).toEqual([]);
  });

  test("rejects blank and duplicate trimmed IRIS IDs at physical rows", () => {
    const errors = validateBuildingRows([
      building({ rowNumber: 9, irisBuildingId: " " }),
      building({ rowNumber: 12, irisBuildingId: " B003004 " }),
      building({ rowNumber: 17, irisBuildingId: "B003004" }),
    ], snapshot());

    expect(errors).toEqual([
      { sheet: "Data", rowNumber: 9, column: "IRIS Building ID", key: "import.error.iris_building_id_required", params: {} },
      { sheet: "Data", rowNumber: 12, column: "IRIS Building ID", key: "import.error.iris_building_id_duplicate", params: { irisBuildingId: "B003004" } },
      { sheet: "Data", rowNumber: 17, column: "IRIS Building ID", key: "import.error.iris_building_id_duplicate", params: { irisBuildingId: "B003004" } },
    ]);
  });

  test("rejects duplicate nonblank ERP IDs but accepts blank ERP IDs", () => {
    const errors = validateBuildingRows([
      building({ rowNumber: 3, irisBuildingId: "B000003", erpBuildingId: " ERP-01 " }),
      building({ rowNumber: 4, irisBuildingId: "B000004", erpBuildingId: "ERP-01" }),
      building({ rowNumber: 5, irisBuildingId: "B000005", erpBuildingId: " " }),
      building({ rowNumber: 6, irisBuildingId: "B000006", erpBuildingId: null }),
    ], snapshot());

    expect(errors).toEqual([
      { sheet: "Data", rowNumber: 3, column: "ERP Building ID", key: "import.error.erp_building_id_duplicate", params: { erpBuildingId: "ERP-01" } },
      { sheet: "Data", rowNumber: 4, column: "ERP Building ID", key: "import.error.erp_building_id_duplicate", params: { erpBuildingId: "ERP-01" } },
    ]);
  });

  test("rejects an ERP ID already linked to another IRIS building", () => {
    const errors = validateBuildingRows([
      building({ irisBuildingId: "B000007", erpBuildingId: "ERP-01" }),
    ], snapshot([
      { id: "uuid-a", irisBuildingId: "B000006", erpBuildingId: "ERP-01", status: "active" },
    ]));

    expect(errors[0]).toMatchObject({
      sheet: "Data",
      rowNumber: 2,
      column: "ERP Building ID",
      key: "import.error.erp_building_id_conflict",
      params: { erpBuildingId: "ERP-01", irisBuildingId: "B000006" },
    });
  });

  test("allows an existing building to retain its own ERP ID after trimming", () => {
    expect(validateBuildingRows([
      building({ irisBuildingId: " B000006 ", erpBuildingId: " ERP-01 " }),
    ], snapshot([
      { id: "uuid-a", irisBuildingId: "B000006", erpBuildingId: "ERP-01", status: "active" },
    ]))).toEqual([]);
  });
});

describe("Rate Card building validation", () => {
  test("rejects missing and inactive IRIS buildings in both reference sheets", () => {
    const errors = validateRateCardBuildings(rateCard({
      buildingPrices: [
        { rowNumber: 8, irisBuildingId: " B-MISSING ", priceIdr: "100" },
        { rowNumber: 4, irisBuildingId: "B-INACTIVE", priceIdr: "200" },
      ],
      packageBuildings: [
        { rowNumber: 6, packageCode: "PKG-01", irisBuildingId: "B-MISSING" },
        { rowNumber: 3, packageCode: "PKG-02", irisBuildingId: "B-ACTIVE" },
      ],
    }), snapshot([
      { id: "uuid-a", irisBuildingId: "B-ACTIVE", erpBuildingId: null, status: "active" },
      { id: "uuid-i", irisBuildingId: "B-INACTIVE", erpBuildingId: null, status: "inactive" },
    ]));

    expect(errors).toEqual([
      { sheet: "Building Prices", rowNumber: 4, column: "IRIS Building ID", key: "import.error.building_inactive", params: { irisBuildingId: "B-INACTIVE" } },
      { sheet: "Building Prices", rowNumber: 8, column: "IRIS Building ID", key: "import.error.building_not_found", params: { irisBuildingId: "B-MISSING" } },
      { sheet: "Package Buildings", rowNumber: 6, column: "IRIS Building ID", key: "import.error.building_not_found", params: { irisBuildingId: "B-MISSING" } },
    ]);
  });
});
