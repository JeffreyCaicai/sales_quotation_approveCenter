import { describe, expect, test } from "vitest";

import type { PackageRow } from "@/lib/imports/template-v2";
import {
  validatePackageRows,
  type PackageValidationSnapshot,
} from "@/lib/imports/validate";

function packageRow(overrides: Partial<PackageRow> = {}): PackageRow {
  return {
    rowNumber: 2,
    packageCode: "PKG-A",
    packageName: "Regional A",
    operationalStatus: "active",
    ...overrides,
  };
}

function snapshot(
  packages: PackageValidationSnapshot["packages"] = [],
): PackageValidationSnapshot {
  return { packages };
}

describe("Sales Package Master validation", () => {
  test("requires Package Name and Operational Status", () => {
    const errors = validatePackageRows([
      packageRow({ packageName: " ", operationalStatus: "" as "active" }),
    ], snapshot());

    expect(errors).toEqual([
      { sheet: "Sales Packages", rowNumber: 2, column: "Operational Status", key: "import.error.operational_status_required", params: {} },
      { sheet: "Sales Packages", rowNumber: 2, column: "Package Name", key: "import.error.package_name_required", params: {} },
    ]);
  });

  test("rejects duplicate supplied codes and normalized Package Names", () => {
    const errors = validatePackageRows([
      packageRow({ rowNumber: 3, packageCode: " PKG-A ", packageName: "Regional A" }),
      packageRow({ rowNumber: 7, packageCode: "PKG-A", packageName: " regional a " }),
    ], snapshot());

    expect(errors).toEqual([
      { sheet: "Sales Packages", rowNumber: 3, column: "Package Code", key: "import.error.package_code_duplicate", params: { packageCode: "PKG-A" } },
      { sheet: "Sales Packages", rowNumber: 3, column: "Package Name", key: "import.error.package_name_duplicate", params: { packageName: "regional a" } },
      { sheet: "Sales Packages", rowNumber: 7, column: "Package Code", key: "import.error.package_code_duplicate", params: { packageCode: "PKG-A" } },
      { sheet: "Sales Packages", rowNumber: 7, column: "Package Name", key: "import.error.package_name_duplicate", params: { packageName: "regional a" } },
    ]);
  });

  test("does not allow an existing code to change its stable name", () => {
    const errors = validatePackageRows([
      packageRow({ packageName: "Renamed Regional" }),
    ], snapshot([
      { packageCode: "PKG-A", packageName: "Regional A", status: "active" },
    ]));

    expect(errors).toEqual([
      { sheet: "Sales Packages", rowNumber: 2, column: "Package Name", key: "import.error.package_name_immutable", params: { packageCode: "PKG-A" } },
    ]);
  });

  test("keeps two blank-code new rows distinguishable by physical row number", () => {
    const errors = validatePackageRows([
      packageRow({ rowNumber: 5, packageCode: null, packageName: "Metro One" }),
      packageRow({ rowNumber: 9, packageCode: null, packageName: "Metro Two" }),
    ], snapshot());

    expect(errors).toEqual([]);
  });
});
