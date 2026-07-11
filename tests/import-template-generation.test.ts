import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";

import { generateImportTemplate } from "@/lib/imports/generate-template";
import {
  BUILDING_HEADERS,
  RATE_CARD_HEADERS,
  TEMPLATE_VERSION_V2,
} from "@/lib/imports/template-v2";

const SERVER_TEMPLATE_ROOT = join(process.cwd(), "server-assets", "templates", "v2");
const PUBLIC_TEMPLATE_ROOT = join(process.cwd(), "public", "templates", "v2");
const FORMULA_ERROR_TOKENS = new Set(["#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A"]);

function readWorkbook(buffer: Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: "buffer", cellFormula: true, cellDates: false });
}

function rows(buffer: Buffer, sheetName: string): unknown[][] {
  const workbook = readWorkbook(buffer);
  const sheet = workbook.Sheets[sheetName];
  expect(sheet, `missing ${sheetName} worksheet`).toBeDefined();
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
}

function expectNoFormulasOrErrors(workbook: XLSX.WorkBook): void {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith("!")) continue;
      expect(cell.f, `${sheetName}!${address} contains a formula`).toBeUndefined();
      expect(cell.t, `${sheetName}!${address} is an Excel error cell`).not.toBe("e");
      if (typeof cell.v === "string") {
        expect(FORMULA_ERROR_TOKENS.has(cell.v), `${sheetName}!${address} contains ${cell.v}`).toBe(false);
      }
    }
  }
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

  test("keeps protected templates out of the directly served public directory", async () => {
    for (const filename of [
      "02_Buildings_Template.xlsx",
      "04_Rate_Card_Template.xlsx",
    ]) {
      await expect(access(join(PUBLIC_TEMPLATE_ROOT, filename))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(access(join(SERVER_TEMPLATE_ROOT, filename))).resolves.toBeUndefined();
    }
  });

  test("committed server-only workbooks retain their exact schema and safe cell types", async () => {
    const building = readWorkbook(
      await readFile(join(SERVER_TEMPLATE_ROOT, "02_Buildings_Template.xlsx")),
    );
    expect(building.SheetNames).toEqual(["Instructions", "Data"]);
    expect(XLSX.utils.sheet_to_json(building.Sheets.Data, {
      header: 1,
      raw: true,
      defval: null,
    })[0]).toEqual([...BUILDING_HEADERS]);
    expect(building.Sheets.Data.B2).toBeUndefined();
    expectNoFormulasOrErrors(building);

    const rateCard = readWorkbook(
      await readFile(join(SERVER_TEMPLATE_ROOT, "04_Rate_Card_Template.xlsx")),
    );
    expect(rateCard.SheetNames).toEqual([
      "Instructions",
      "Metadata",
      "Building Prices",
      "Package Prices",
      "Package Buildings",
    ]);
    expect(rateCard.Sheets.Metadata.B1?.v).toBe(TEMPLATE_VERSION_V2);
    expect(["n", "d"]).toContain(rateCard.Sheets.Metadata.B3?.t);
    expect(rateCard.Sheets.Metadata.B3?.t).not.toBe("s");
    for (const [sheetName, headers] of Object.entries(RATE_CARD_HEADERS)) {
      expect(XLSX.utils.sheet_to_json(rateCard.Sheets[sheetName], {
        header: 1,
        raw: true,
        defval: null,
      })[0]).toEqual([...headers]);
    }
    for (const address of ["B2"] as const) {
      const buildingPrice = rateCard.Sheets["Building Prices"][address]?.v;
      const packagePrice = rateCard.Sheets["Package Prices"][address]?.v;
      expect(Number.isInteger(buildingPrice)).toBe(true);
      expect(Number.isInteger(packagePrice)).toBe(true);
    }
    expectNoFormulasOrErrors(rateCard);
  });
});
