import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";

import { parseImportFiles } from "@/lib/imports/normalize";
import { PACKAGE_HEADERS } from "@/lib/imports/template-v2";

const FIXTURES = join(process.cwd(), "tests", "fixtures", "imports", "v2");

async function fixture(filename: string) {
  return {
    filename,
    body: new Uint8Array(await readFile(join(FIXTURES, filename))),
  };
}

function workbookFile(filename: string, sheets: Record<string, unknown[][]>) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return {
    filename,
    body: new Uint8Array(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })),
  };
}

describe("TMN-IMPORT-2 parser", () => {
  test("defines the exact Sales Package Master headers", () => {
    expect(PACKAGE_HEADERS).toEqual([
      "Package Code",
      "Package Name",
      "Operational Status",
    ]);
  });

  test.each([
    ["XLSX", () => workbookFile("sales-packages.xlsx", {
      Instructions: [["Template Version", "TMN-IMPORT-2"]],
      "Sales Packages": [
        ["Package Code", "Package Name", "Operational Status"],
        [" PKG-A ", " Regional A ", "active"],
        ["", " New Metro ", "inactive"],
      ],
    })],
    ["CSV", () => ({
      filename: "sales-packages.csv",
      body: new TextEncoder().encode(
        "Package Code,Package Name,Operational Status\n PKG-A , Regional A ,active\n, New Metro ,inactive\n",
      ),
    })],
  ])("parses Sales Packages from %s", async (_format, createFile) => {
    await expect(parseImportFiles("package", [createFile()])).resolves.toEqual({
      templateVersion: "TMN-IMPORT-2",
      rows: [
        { rowNumber: 2, packageCode: "PKG-A", packageName: "Regional A", operationalStatus: "active" },
        { rowNumber: 3, packageCode: null, packageName: "New Metro", operationalStatus: "inactive" },
      ],
    });
  });

  test.each([undefined, "TMN-IMPORT-1"])(
    "rejects a Building workbook whose Instructions version cell is %s",
    async (version) => {
      const instructions = version === undefined
        ? [["Workbook", "Buildings Import Template"]]
        : [["Template Version", version]];
      const file = workbookFile("building-version.xlsx", {
        Instructions: instructions,
        Data: [
          ["IRIS Building ID", "ERP Building ID", "Building Name", "Building Type", "Grade Resource", "Area", "City", "CBD Area", "Sub-District", "Address", "Operational Status", "Data Source"],
          ["B003004", "", "Building", "Apartment", "Grade A", "", "", "", "", "Address", "active", "building_team"],
        ],
      });

      await expect(parseImportFiles("building", [file])).rejects.toMatchObject({
        key: "import.error.template_version",
      });
    },
  );

  test("parses active buildings without ERP IDs", async () => {
    const result = await parseImportFiles("building", [workbookFile("buildings-valid.xlsx", {
      Instructions: [["Template Version", "TMN-IMPORT-2"]],
      Data: [
        ["IRIS Building ID", "ERP Building ID", "Building Name", "Building Type", "Grade Resource", "Area", "City", "CBD Area", "Sub-District", "Address", "Operational Status", "Data Source"],
        [" B003004 ", " ", " Apartment 19th Avenue ", "Apartment", "Grade A", "West Jakarta", "Jakarta", "", "Cengkareng", "Jl. Daan Mogot", "active", "building_team"],
      ],
    })]);

    expect(result).toMatchObject({
      templateVersion: "TMN-IMPORT-2",
      rows: [{
        irisBuildingId: "B003004",
        erpBuildingId: null,
        buildingName: "Apartment 19th Avenue",
        operationalStatus: "active",
      }],
    });
  });

  test("parses a UTF-8 building CSV and trims values without changing identifier case", async () => {
    const result = await parseImportFiles("building", [await fixture("buildings-valid.csv")]);

    expect(result.rows[0]).toEqual({
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
    });
  });

  test("rejects a structurally complete legacy single-CSV Rate Card", async () => {
    const body = new TextEncoder().encode([
      "Record Type,IRIS Building ID,Package Code,Price IDR",
      "BUILDING_PRICE,B003004,,0",
      "PACKAGE_PRICE,,PKG-01,1500000",
      "PACKAGE_MEMBER,B003004,PKG-01,",
      "",
    ].join("\n"));

    await expect(parseImportFiles("rate_card", [{ filename: "rate-card.csv", body }]))
      .rejects.toMatchObject({ key: "import.error.file_set_invalid" });
  });

  test("parses the exact atomic four-CSV Rate Card set", async () => {
    const directory = join(FIXTURES, "rate-card-valid");
    const filenames = [
      "building-prices.csv",
      "metadata.csv",
      "package-buildings.csv",
      "package-prices.csv",
    ];
    const files = await Promise.all(filenames.map(async (filename) => ({
      filename,
      body: new Uint8Array(await readFile(join(directory, filename))),
    })));

    await expect(parseImportFiles("rate_card", files)).resolves.toEqual({
      templateVersion: "TMN-IMPORT-2",
      currency: "IDR",
      buildingPrices: [{ rowNumber: 2, irisBuildingId: "B003004", priceIdr: "1000000" }],
      packagePrices: [{ rowNumber: 2, packageCode: "PKG-ACCEPTANCE", priceIdr: "1500000" }],
      packageMemberships: [{ rowNumber: 2, packageCode: "PKG-ACCEPTANCE", irisBuildingId: "B003004" }],
    });
  });

  test("parses the three exact Rate Card data sheets and minimal metadata", async () => {
    const file = workbookFile("rate-card.xlsx", {
      Instructions: [["English"], ["Bahasa Indonesia"]],
      Metadata: [
        ["Template Version", "TMN-IMPORT-2"],
        ["Currency", "IDR"],
      ],
      "Building Prices": [["IRIS Building ID", "Price IDR"], [" B003004 ", "0"]],
      "Package Prices": [["Package Code", "Price IDR"], ["PKG-01", "1500000"]],
      "Package Membership": [["Package Code", "IRIS Building ID"], ["PKG-01", "B003004"]],
    });

    await expect(parseImportFiles("rate_card", [file])).resolves.toEqual({
      templateVersion: "TMN-IMPORT-2",
      currency: "IDR",
      buildingPrices: [{ rowNumber: 2, irisBuildingId: "B003004", priceIdr: "0" }],
      packagePrices: [{ rowNumber: 2, packageCode: "PKG-01", priceIdr: "1500000" }],
      packageMemberships: [{ rowNumber: 2, packageCode: "PKG-01", irisBuildingId: "B003004" }],
    });
  });

  test.each([
    ["missing data sheet", {
      Instructions: [["English"]],
      Metadata: [["Template Version", "TMN-IMPORT-2"], ["Currency", "IDR"]],
      "Building Prices": [["IRIS Building ID", "Price IDR"]],
      "Package Prices": [["Package Code", "Price IDR"]],
    }, "import.error.missing_sheet"],
    ["unexpected data sheet", {
      Instructions: [["English"]],
      Metadata: [["Template Version", "TMN-IMPORT-2"], ["Currency", "IDR"]],
      "Building Prices": [["IRIS Building ID", "Price IDR"]],
      "Package Prices": [["Package Code", "Price IDR"]],
      "Package Membership": [["Package Code", "IRIS Building ID"]],
      Surprise: [["No"]],
    }, "import.error.unknown_sheet"],
  ])("rejects a Rate Card workbook with a %s", async (_label, sheets, key) => {
    await expect(parseImportFiles("rate_card", [workbookFile("invalid-rate-card.xlsx", sheets)]))
      .rejects.toMatchObject({ key });
  });

  test("retains duplicate IRIS IDs for the validation stage", async () => {
    const headers = ["IRIS Building ID", "ERP Building ID", "Building Name", "Building Type", "Grade Resource", "Area", "City", "CBD Area", "Sub-District", "Address", "Operational Status", "Data Source"];
    const result = await parseImportFiles("building", [workbookFile("buildings-duplicate-iris.xlsx", {
      Instructions: [["Template Version", "TMN-IMPORT-2"]],
      Data: [headers,
        ["B003004", "", "First", "Apartment", "Grade A", "", "", "", "", "Address", "active", "building_team"],
        ["B003004", "", "Second", "Apartment", "Grade A", "", "", "", "", "Address", "active", "building_team"],
      ],
    })]);

    expect(result.rows.map((row) => row.irisBuildingId)).toEqual(["B003004", "B003004"]);
  });

  test("rejects a legacy Building Code Rate Card header", async () => {
    const file = workbookFile("legacy-rate-card.xlsx", {
      Instructions: [["English"]],
      Metadata: [
        ["Template Version", "TMN-IMPORT-2"],
        ["Currency", "IDR"],
      ],
      "Building Prices": [["Building Code", "Price IDR"], ["B003004", "1000000"]],
      "Package Prices": [["Package Code", "Price IDR"], ["PKG-01", "1500000"]],
      "Package Membership": [["Package Code", "IRIS Building ID"], ["PKG-01", "B003004"]],
    });

    await expect(parseImportFiles("rate_card", [file])).rejects.toMatchObject({
      key: "import.error.unknown_column",
    });
  });

  test("rejects formulas without evaluating cached values", async () => {
    const file = workbookFile("formula.xlsx", {
      Data: [
        ["IRIS Building ID", "ERP Building ID", "Building Name", "Building Type", "Grade Resource", "Area", "City", "CBD Area", "Sub-District", "Address", "Operational Status", "Data Source"],
        ["B003004", "", "Apartment 19th Avenue", "Apartment", "Grade A", "West Jakarta", "Jakarta", "", "Cengkareng", "Jl. Daan Mogot", "active", "building_team"],
      ],
    });
    const workbook = XLSX.read(file.body, { type: "array", cellFormula: true });
    workbook.Sheets.Data.C2 = { t: "n", f: "1+1", v: 2 };
    file.body = new Uint8Array(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));

    await expect(parseImportFiles("building", [file])).rejects.toMatchObject({
      key: "file.formula_not_allowed",
    });
  });

  test("enforces the 10,000-row ceiling", async () => {
    const headers = ["IRIS Building ID", "ERP Building ID", "Building Name", "Building Type", "Grade Resource", "Area", "City", "CBD Area", "Sub-District", "Address", "Operational Status", "Data Source"];
    const rows = Array.from({ length: 10_001 }, (_, index) => [
      `B${String(index).padStart(6, "0")}`, "", `Building ${index}`, "", "", "", "", "", "", "Address", "active", "building_team",
    ]);

    await expect(parseImportFiles("building", [workbookFile("too-many.xlsx", {
      Instructions: [["Template Version", "TMN-IMPORT-2"]],
      Data: [headers, ...rows],
    })]))
      .rejects.toMatchObject({ key: "import.error.row_limit_exceeded" });
  });

  test("rejects workbook sheets other than Data and Instructions", async () => {
    const headers = ["IRIS Building ID", "ERP Building ID", "Building Name", "Building Type", "Grade Resource", "Area", "City", "CBD Area", "Sub-District", "Address", "Operational Status", "Data Source"];
    const file = workbookFile("unknown-sheet.xlsx", {
      Instructions: [["Template Version", "TMN-IMPORT-2"]],
      Data: [headers, ["B003004", "", "Building", "", "", "", "", "", "", "Address", "active", "building_team"]],
      Surprise: [["not allowed"]],
    });

    await expect(parseImportFiles("building", [file])).rejects.toMatchObject({
      key: "import.error.unknown_sheet",
    });
  });

  test("requires exact header spelling without trimming headers", async () => {
    const csv = " IRIS Building ID,ERP Building ID,Building Name,Building Type,Grade Resource,Area,City,CBD Area,Sub-District,Address,Operational Status,Data Source\nB003004,,Building,,,,,,,Address,active,building_team\n";

    await expect(parseImportFiles("building", [{
      filename: "wrong-header.csv",
      body: new TextEncoder().encode(csv),
    }])).rejects.toMatchObject({ key: "import.error.unknown_column" });
  });

  test("retains physical XLSX row numbers across leading and internal blank rows", async () => {
    const headers = ["IRIS Building ID", "ERP Building ID", "Building Name", "Building Type", "Grade Resource", "Area", "City", "CBD Area", "Sub-District", "Address", "Operational Status", "Data Source"];
    const file = workbookFile("blank-rows.xlsx", {
      Instructions: [["Template Version", "TMN-IMPORT-2"]],
      Data: [
        [],
        [],
        headers,
        ["B003004", "", "First", "", "", "", "", "", "", "Address", "active", "building_team"],
        [],
        ["B003005", "", "Second", "", "", "", "", "", "", "Address", "inactive", "erp"],
      ],
    });

    const result = await parseImportFiles("building", [file]);
    expect(result.rows.map((row) => row.rowNumber)).toEqual([4, 6]);
  });

  test("retains physical CSV row numbers and reports invalid values at their source row", async () => {
    const headers = "IRIS Building ID,ERP Building ID,Building Name,Building Type,Grade Resource,Area,City,CBD Area,Sub-District,Address,Operational Status,Data Source";
    const valid = "B003004,,First,,,,,,,Address,active,building_team";
    const invalid = "B003005,,Second,,,,,,,Address,retired,erp";
    const body = new TextEncoder().encode(`\n\n${headers}\n${valid}\n\n${invalid}\n`);

    await expect(parseImportFiles("building", [{ filename: "blank-rows.csv", body }]))
      .rejects.toMatchObject({
        key: "import.error.value_invalid",
        details: { rowNumber: 6, column: "Operational Status" },
      });
  });

  test("uses the starting row for a valid quoted multiline CSV record", async () => {
    const headers = "IRIS Building ID,ERP Building ID,Building Name,Building Type,Grade Resource,Area,City,CBD Area,Sub-District,Address,Operational Status,Data Source";
    const multiline = "B003004,,\"First\\nTower\",,,,,,,Address,active,building_team".replace("\\n", "\n");
    const body = new TextEncoder().encode(`${headers}\n\n${multiline}\n`);

    const result = await parseImportFiles("building", [{ filename: "multiline.csv", body }]);
    expect(result.rows[0]).toMatchObject({ rowNumber: 3, buildingName: "First\nTower" });
  });

  test("reports an invalid quoted multiline CSV record at its starting row", async () => {
    const headers = "IRIS Building ID,ERP Building ID,Building Name,Building Type,Grade Resource,Area,City,CBD Area,Sub-District,Address,Operational Status,Data Source";
    const multiline = "B003005,,\"Retired\\nTower\",,,,,,,Address,retired,erp".replace("\\n", "\n");
    const body = new TextEncoder().encode(`\n${headers}\n\n${multiline}\n`);

    await expect(parseImportFiles("building", [{ filename: "multiline-invalid.csv", body }]))
      .rejects.toMatchObject({
        key: "import.error.value_invalid",
        details: { rowNumber: 4, column: "Operational Status" },
      });
  });

  test("retains physical Rate Card section row numbers", async () => {
    const file = workbookFile("rate-card-blank-rows.xlsx", {
      Instructions: [["English"]],
      Metadata: [
        ["Template Version", "TMN-IMPORT-2"],
        ["Currency", "IDR"],
      ],
      "Building Prices": [[], ["IRIS Building ID", "Price IDR"], [], ["B003004", "1000000"]],
      "Package Prices": [[], [], ["Package Code", "Price IDR"], ["PKG-01", "1500000"]],
      "Package Membership": [["Package Code", "IRIS Building ID"], [], [], ["PKG-01", "B003004"]],
    });

    const result = await parseImportFiles("rate_card", [file]);
    expect(result.buildingPrices[0].rowNumber).toBe(4);
    expect(result.packagePrices[0].rowNumber).toBe(4);
    expect(result.packageMemberships[0].rowNumber).toBe(4);
  });
});
