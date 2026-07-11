import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";

import { generateImportTemplate } from "@/lib/imports/generate-template";
import {
  BUILDING_HEADERS,
  RATE_CARD_HEADERS,
  TEMPLATE_VERSION_V2,
} from "@/lib/imports/template-v2";

function rows(buffer: Buffer, sheetName: string): unknown[][] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellFormula: true });
  const sheet = workbook.Sheets[sheetName];
  expect(sheet, `missing ${sheetName} worksheet`).toBeDefined();
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
}

describe("formal TMN-IMPORT-2 templates", () => {
  test("building template protects exact v2 headers and keeps the ERP example blank", async () => {
    const buffer = await generateImportTemplate("building", TEMPLATE_VERSION_V2);
    const data = rows(buffer, "Data");

    expect(data[0]).toEqual([...BUILDING_HEADERS]);
    expect(data[1]?.[0]).toBe("B003004");
    expect(data[1]?.[1]).toBeNull();
    expect(rows(buffer, "Instructions")).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["Template Version", TEMPLATE_VERSION_V2]),
      ]),
    );
  });

  test("rate-card template uses IRIS IDs, v2 metadata, and integer IDR examples", async () => {
    const buffer = await generateImportTemplate("rate_card", TEMPLATE_VERSION_V2);

    expect(rows(buffer, "Metadata")).toEqual(
      expect.arrayContaining([
        ["Template Version", TEMPLATE_VERSION_V2],
        ["Currency", "IDR"],
      ]),
    );
    for (const [sheetName, headers] of Object.entries(RATE_CARD_HEADERS)) {
      expect(rows(buffer, sheetName)[0]).toEqual([...headers]);
    }

    const buildingPrice = rows(buffer, "Building Prices")[1]?.[1];
    const packagePrice = rows(buffer, "Package Prices")[1]?.[1];
    expect(Number.isInteger(buildingPrice)).toBe(true);
    expect(Number.isInteger(packagePrice)).toBe(true);
    expect(buildingPrice).toBeGreaterThan(0);
    expect(packagePrice).toBeGreaterThan(0);
  });

  test("instructions are English-first bilingual and explain permanent IRIS IDs", async () => {
    for (const dataType of ["building", "rate_card"] as const) {
      const text = rows(
        await generateImportTemplate(dataType, TEMPLATE_VERSION_V2),
        "Instructions",
      )
        .flat()
        .filter((value): value is string => typeof value === "string")
        .join("\n");

      expect(text).toMatch(/English/i);
      expect(text).toMatch(/Bahasa Indonesia/i);
      expect(text.indexOf("English")).toBeLessThan(text.indexOf("Bahasa Indonesia"));
      expect(text).toMatch(/IRIS IDs? (?:are|remain) permanent/i);
      expect(text).toMatch(/ERP IDs? may be blank/i);
    }
  });

  test("rejects unsupported template versions", async () => {
    await expect(
      generateImportTemplate("building", "TMN-IMPORT-1" as typeof TEMPLATE_VERSION_V2),
    ).rejects.toThrow(/unsupported template version/i);
  });
});
