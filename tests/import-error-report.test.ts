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
