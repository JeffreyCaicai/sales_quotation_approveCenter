import { describe, expect, test } from "vitest";

import type { ImportErrorItem } from "@/lib/imports/admin-contracts";
import { renderImportErrorsCsv } from "@/lib/imports/render-error-report";

function error(overrides: Partial<ImportErrorItem> = {}): ImportErrorItem {
  return {
    id: "error-1",
    file: "buildings.csv",
    sheet: "Data",
    row: 2,
    column: "Building Name",
    errorKey: "import.error.missing_column",
    parameters: { column: "Building Name" },
    createdAt: "2026-07-18T08:00:00.000Z",
    ...overrides,
  };
}

describe("import error CSV", () => {
  test("uses the exact support columns and canonical recursively sorted parameters", () => {
    const csv = renderImportErrorsCsv([
      error({ parameters: { z: 1, a: { y: 2, x: [3, { b: 1, a: 2 }] } } }),
    ], "en");

    expect(csv.split("\r\n")[0]).toBe("File,Sheet,Row,Column,Error Key,Message,Parameters");
    expect(csv).toContain('"{""a"":{""x"":[3,{""a"":2,""b"":1}],""y"":2},""z"":1}"');
    expect(csv.startsWith("\uFEFF")).toBe(false);
  });

  test("escapes commas, quotes, CR, and LF without changing the stable error key", () => {
    const csv = renderImportErrorsCsv([
      error({
        file: 'building,"north".csv',
        sheet: "Data\r\nNorth",
        column: "Name, legal",
        errorKey: "import.error.value_invalid",
      }),
    ], "en");

    expect(csv).toContain('"building,""north"".csv"');
    expect(csv).toContain('"Data\r\nNorth"');
    expect(csv).toContain('"Name, legal"');
    expect(csv).toContain("import.error.value_invalid");
  });

  test("localizes only Message for English and Simplified Chinese", () => {
    const item = error();
    const english = renderImportErrorsCsv([item], "en");
    const chinese = renderImportErrorsCsv([item], "zh-CN");

    expect(english).toContain('Required column ""Building Name"" is missing.');
    expect(chinese).toContain("缺少必填列“Building Name”。");
    expect(english).toContain(item.errorKey);
    expect(chinese).toContain(item.errorKey);
    expect(english).not.toBe(chinese);
  });

  test("uses a safe localized fallback for unknown keys", () => {
    const unknown = error({ errorKey: "import.error.future_rule", parameters: {} });

    expect(renderImportErrorsCsv([unknown], "en")).toContain("An import validation error occurred.");
    expect(renderImportErrorsCsv([unknown], "zh-CN")).toContain("发生导入验证错误。");
    expect(renderImportErrorsCsv([unknown], "en")).toContain("import.error.future_rule");
  });

  test("preserves the honest job-level upload-set label in the downloaded CSV", () => {
    const csv = renderImportErrorsCsv([
      error({
        file: "Original upload set",
        sheet: "Metadata",
        row: 0,
        column: "",
        errorKey: "import.error.rate_card_empty",
        parameters: {},
      }),
    ], "en");

    expect(csv).toContain("Original upload set,Metadata,0,,import.error.rate_card_empty");
    expect(csv).not.toContain("metadata.csv");
  });

  test.each([
    "import.error.address_required",
    "import.error.building_controlled_values_unavailable",
    "import.error.building_inactive",
    "import.error.building_name_required",
    "import.error.building_not_found",
    "import.error.building_reactivation_requires_admin_workflow",
    "import.error.building_type_invalid",
    "import.error.data_source_invalid",
    "import.error.erp_building_id_conflict",
    "import.error.erp_building_id_duplicate",
    "import.error.grade_resource_invalid",
    "import.error.iris_building_id_duplicate",
    "import.error.iris_building_id_required",
    "import.error.operational_status_invalid",
    "import.error.operational_status_required",
    "import.error.package_code_duplicate",
    "import.error.package_inactive",
    "import.error.package_membership_missing_price",
    "import.error.package_name_duplicate",
    "import.error.package_name_immutable",
    "import.error.package_name_required",
    "import.error.package_not_found",
    "import.error.package_price_missing_membership",
    "import.error.rate_card_building_duplicate",
    "import.error.rate_card_empty",
    "import.error.rate_card_membership_duplicate",
    "import.error.rate_card_package_duplicate",
    "import.error.template_version",
    "import.error.value_invalid",
  ])("provides corrective English and Chinese messages for real validator key %s", (errorKey) => {
    const item = error({
      errorKey,
      parameters: {
        irisBuildingId: "B-001",
        erpBuildingId: "ERP-001",
        packageCode: "PKG-001",
        packageName: "Metro",
      },
    });
    const english = renderImportErrorsCsv([item], "en");
    const chinese = renderImportErrorsCsv([item], "zh-CN");

    expect(english).not.toContain("An import validation error occurred.");
    expect(chinese).not.toContain("发生导入验证错误。");
    expect(english).not.toBe(chinese);
  });

  test("renders specific corrective messages for representative business validation failures", () => {
    expect(renderImportErrorsCsv([
      error({ errorKey: "import.error.building_name_required", parameters: {} }),
    ], "en")).toContain("Building Name is required.");
    expect(renderImportErrorsCsv([
      error({ errorKey: "import.error.building_inactive", parameters: { irisBuildingId: "B-001" } }),
    ], "zh-CN")).toContain("建筑 B-001 已停用，不能用于价目表。");
    expect(renderImportErrorsCsv([
      error({ errorKey: "import.error.package_price_missing_membership", parameters: { packageCode: "PKG-001" } }),
    ], "en")).toContain("Package PKG-001 has a price but no building membership.");
    expect(renderImportErrorsCsv([
      error({ errorKey: "import.error.rate_card_membership_duplicate", parameters: { packageCode: "PKG-001", irisBuildingId: "B-001" } }),
    ], "zh-CN")).toContain("套餐 PKG-001 与建筑 B-001 的成员关系重复。");
  });

  test.each(["=cmd", "+SUM(A1)", "-1+2", "@IMPORT"])(
    "neutralizes formula-like textual cells beginning with %s",
    (prefix) => {
      const csv = renderImportErrorsCsv([
        error({ file: prefix, sheet: prefix, column: prefix }),
      ], "en");
      const row = csv.split("\r\n")[1];

      expect(row).not.toContain(`,${prefix},`);
      expect(row).toContain(`'${prefix}`);
    },
  );
});
