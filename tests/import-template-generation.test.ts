import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";

import { generateImportTemplate } from "@/lib/imports/generate-template";
import { parseImportFiles } from "@/lib/imports/normalize";
import {
  BUILDING_HEADERS,
  PACKAGE_HEADERS,
  RATE_CARD_BUILDING_PRICE_HEADERS,
  RATE_CARD_PACKAGE_MEMBERSHIP_HEADERS,
  RATE_CARD_PACKAGE_PRICE_HEADERS,
  TEMPLATE_VERSION_V2,
} from "@/lib/imports/template-v2";

const SERVER_TEMPLATE_ROOT = join(process.cwd(), "server-assets", "templates", "v2");
const PUBLIC_TEMPLATE_ROOT = join(process.cwd(), "public", "templates", "v2");
const FORMULA_ERROR_TOKENS = new Set(["#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A"]);
const execFileAsync = promisify(execFile);

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
  test("the asset builder regenerates an exact v2 Rate Card workbook accepted by the parser", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "tmn-template-assets-"));
    const temporaryRenderRoot = join(temporaryRoot, "renders");
    try {
      await mkdir(join(temporaryRoot, "lib", "imports"), { recursive: true });
      await copyFile(
        join(process.cwd(), "lib", "imports", "template-v2.ts"),
        join(temporaryRoot, "lib", "imports", "template-v2.ts"),
      );
      await execFileAsync(process.execPath, [
        "--import",
        "tsx",
        join(process.cwd(), "scripts", "build-import-template-assets.mjs"),
        temporaryRoot,
        temporaryRenderRoot,
      ], { cwd: process.cwd(), timeout: 60_000 });

      const buffer = await readFile(join(
        temporaryRoot,
        "server-assets",
        "templates",
        "v2",
        "04_Rate_Card_Template.xlsx",
      ));
      const workbook = readWorkbook(buffer);
      expect(workbook.SheetNames).toEqual([
        "Instructions",
        "Metadata",
        "Building Prices",
        "Package Prices",
        "Package Membership",
      ]);
      expect(rows(buffer, "Metadata")).toEqual([
        ["Template Version", TEMPLATE_VERSION_V2],
        ["Currency", "IDR"],
      ]);
      expect(rows(buffer, "Building Prices")[0]).toEqual([...RATE_CARD_BUILDING_PRICE_HEADERS]);
      expect(rows(buffer, "Package Prices")[0]).toEqual([...RATE_CARD_PACKAGE_PRICE_HEADERS]);
      expect(rows(buffer, "Package Membership")[0]).toEqual([...RATE_CARD_PACKAGE_MEMBERSHIP_HEADERS]);

      await expect(parseImportFiles("rate_card", [{
        filename: "04_Rate_Card_Template.xlsx",
        body: new Uint8Array(buffer),
      }])).resolves.toMatchObject({
        templateVersion: TEMPLATE_VERSION_V2,
        currency: "IDR",
        buildingPrices: [{ irisBuildingId: "B003004", priceIdr: "1000000" }],
        packagePrices: [{ packageCode: "PKG-01", priceIdr: "1500000" }],
        packageMemberships: [{ packageCode: "PKG-01", irisBuildingId: "B003004" }],
      });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);

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
      [
        ["Template Version", TEMPLATE_VERSION_V2],
        ["Currency", "IDR"],
      ],
    );
    expect(rows(buffer, "Building Prices")[0]).toEqual([...RATE_CARD_BUILDING_PRICE_HEADERS]);
    expect(rows(buffer, "Package Prices")[0]).toEqual([...RATE_CARD_PACKAGE_PRICE_HEADERS]);
    expect(rows(buffer, "Package Membership")[0]).toEqual([...RATE_CARD_PACKAGE_MEMBERSHIP_HEADERS]);

    const buildingPrice = rows(buffer, "Building Prices")[1]?.[1];
    const packagePrice = rows(buffer, "Package Prices")[1]?.[1];
    expect(Number.isInteger(buildingPrice)).toBe(true);
    expect(Number.isInteger(packagePrice)).toBe(true);
    expect(buildingPrice).toBeGreaterThan(0);
    expect(packagePrice).toBeGreaterThan(0);
  });

  test("sales-package template uses its exact schema and sample values", async () => {
    const buffer = await generateImportTemplate("package", TEMPLATE_VERSION_V2);

    expect(rows(buffer, "Sales Packages")).toEqual([
      [...PACKAGE_HEADERS],
      ["PKG-01", "Jakarta Prime", "active"],
    ]);
    expect(rows(buffer, "Instructions")).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["Template Version", TEMPLATE_VERSION_V2]),
      ]),
    );
  });

  test("instructions are English-first bilingual and explain permanent IRIS IDs", async () => {
    for (const dataType of ["building", "package", "rate_card"] as const) {
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
      "03_Sales_Packages_Template.xlsx",
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

    const packages = readWorkbook(
      await readFile(join(SERVER_TEMPLATE_ROOT, "03_Sales_Packages_Template.xlsx")),
    );
    expect(packages.SheetNames).toEqual(["Instructions", "Sales Packages"]);
    expect(XLSX.utils.sheet_to_json(packages.Sheets["Sales Packages"], {
      header: 1,
      raw: true,
      defval: null,
    })[0]).toEqual([...PACKAGE_HEADERS]);
    expectNoFormulasOrErrors(packages);

    const rateCard = readWorkbook(
      await readFile(join(SERVER_TEMPLATE_ROOT, "04_Rate_Card_Template.xlsx")),
    );
    expect(rateCard.SheetNames).toEqual([
      "Instructions",
      "Metadata",
      "Building Prices",
      "Package Prices",
      "Package Membership",
    ]);
    expect(rateCard.Sheets.Metadata.B1?.v).toBe(TEMPLATE_VERSION_V2);
    expect(rateCard.Sheets.Metadata.B2?.v).toBe("IDR");
    expect(rateCard.Sheets.Metadata.A3).toBeUndefined();
    expect(XLSX.utils.sheet_to_json(rateCard.Sheets["Building Prices"], {
      header: 1, raw: true, defval: null,
    })[0]).toEqual([...RATE_CARD_BUILDING_PRICE_HEADERS]);
    expect(XLSX.utils.sheet_to_json(rateCard.Sheets["Package Prices"], {
      header: 1, raw: true, defval: null,
    })[0]).toEqual([...RATE_CARD_PACKAGE_PRICE_HEADERS]);
    expect(XLSX.utils.sheet_to_json(rateCard.Sheets["Package Membership"], {
      header: 1, raw: true, defval: null,
    })[0]).toEqual([...RATE_CARD_PACKAGE_MEMBERSHIP_HEADERS]);
    for (const address of ["B2"] as const) {
      const buildingPrice = rateCard.Sheets["Building Prices"][address]?.v;
      const packagePrice = rateCard.Sheets["Package Prices"][address]?.v;
      expect(Number.isInteger(buildingPrice)).toBe(true);
      expect(Number.isInteger(packagePrice)).toBe(true);
    }
    expectNoFormulasOrErrors(rateCard);
  });
});
