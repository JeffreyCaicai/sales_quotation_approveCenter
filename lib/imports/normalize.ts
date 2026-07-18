import {
  BUILDING_HEADERS,
  ImportParseError,
  PACKAGE_HEADERS,
  RATE_CARD_BUILDING_PRICE_HEADERS,
  RATE_CARD_HEADERS,
  RATE_CARD_PACKAGE_MEMBERSHIP_HEADERS,
  RATE_CARD_PACKAGE_PRICE_HEADERS,
  TEMPLATE_VERSION_V2,
  type BuildingImport,
  type BuildingRow,
  type PackageImport,
  type PackageRow,
  type RateCardImport,
  type SourceRow,
} from "@/lib/imports/template-v2";
import { parseCsv } from "@/lib/imports/parse-csv";
import { parseWorkbook, type ParsedSheet } from "@/lib/imports/parse-workbook";

export interface ImportSourceFile {
  filename: string;
  body: Uint8Array;
}

const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 10_000;
const RATE_CARD_CSV_FILE_TO_SHEET = new Map([
  ["building-prices.csv", "Building Prices"],
  ["metadata.csv", "Metadata"],
  ["package-buildings.csv", "Package Membership"],
  ["package-prices.csv", "Package Prices"],
] as const);
function extension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function nullable(value: unknown): string | null {
  return text(value) || null;
}

function exactText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function headerText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function nonBlankRows(rows: SourceRow[]): SourceRow[] {
  return rows.filter((row) => row.cells.some((value) => text(value) !== ""));
}

function assertHeaders(sheet: string, rows: SourceRow[], expected: readonly string[]): Map<string, number> {
  const actual = (rows[0]?.cells ?? []).map(headerText);
  for (const header of actual) {
    if (!expected.includes(header)) {
      throw new ImportParseError("import.error.unknown_column", { sheet, column: header });
    }
  }
  for (const header of expected) {
    if (!actual.includes(header)) {
      throw new ImportParseError("import.error.missing_column", { sheet, column: header });
    }
  }
  if (actual.length !== expected.length || new Set(actual).size !== actual.length) {
    throw new ImportParseError("import.error.unknown_column", { sheet });
  }
  return new Map(actual.map((header, index) => [header, index]));
}

function value(row: SourceRow, columns: Map<string, number>, header: string): unknown {
  return row.cells[columns.get(header)!];
}

function assertRowLimit(rows: SourceRow[]): void {
  if (rows.length - 1 > MAX_ROWS) throw new ImportParseError("import.error.row_limit_exceeded");
}

function assertBuildingTemplateVersion(sheets: Map<string, ParsedSheet>): void {
  const rows = requiredSheet(sheets, "Instructions");
  const versionRow = rows.find((row) => headerText(row.cells[0]) === "Template Version");
  if (!versionRow || headerText(versionRow.cells[1]) !== TEMPLATE_VERSION_V2) {
    throw new ImportParseError("import.error.template_version");
  }
}

function normalizeBuildings(rows: SourceRow[]): BuildingImport {
  rows = nonBlankRows(rows);
  assertRowLimit(rows);
  const columns = assertHeaders("Data", rows, BUILDING_HEADERS);
  const normalized: BuildingRow[] = rows.slice(1).map((row) => {
    const operationalStatus = text(value(row, columns, "Operational Status"));
    const dataSource = text(value(row, columns, "Data Source"));
    if (operationalStatus !== "active" && operationalStatus !== "inactive") {
      throw new ImportParseError("import.error.value_invalid", { sheet: "Data", rowNumber: row.rowNumber, column: "Operational Status" });
    }
    if (dataSource !== "building_team" && dataSource !== "erp") {
      throw new ImportParseError("import.error.value_invalid", { sheet: "Data", rowNumber: row.rowNumber, column: "Data Source" });
    }
    return {
      rowNumber: row.rowNumber,
      irisBuildingId: text(value(row, columns, "IRIS Building ID")),
      erpBuildingId: nullable(value(row, columns, "ERP Building ID")),
      buildingName: text(value(row, columns, "Building Name")),
      buildingType: nullable(value(row, columns, "Building Type")),
      gradeResource: nullable(value(row, columns, "Grade Resource")),
      area: nullable(value(row, columns, "Area")),
      city: nullable(value(row, columns, "City")),
      cbdArea: nullable(value(row, columns, "CBD Area")),
      subDistrict: nullable(value(row, columns, "Sub-District")),
      address: text(value(row, columns, "Address")),
      operationalStatus,
      dataSource,
    };
  });
  return { templateVersion: TEMPLATE_VERSION_V2, rows: normalized };
}

function normalizePackages(rows: SourceRow[]): PackageImport {
  rows = nonBlankRows(rows);
  assertRowLimit(rows);
  const columns = assertHeaders("Sales Packages", rows, PACKAGE_HEADERS);
  const normalized: PackageRow[] = rows.slice(1).map((row) => {
    const operationalStatus = text(value(row, columns, "Operational Status"));
    if (operationalStatus !== "active" && operationalStatus !== "inactive") {
      throw new ImportParseError("import.error.value_invalid", {
        sheet: "Sales Packages",
        rowNumber: row.rowNumber,
        column: "Operational Status",
      });
    }
    return {
      rowNumber: row.rowNumber,
      packageCode: nullable(value(row, columns, "Package Code")),
      packageName: text(value(row, columns, "Package Name")),
      operationalStatus,
    };
  });
  return { templateVersion: TEMPLATE_VERSION_V2, rows: normalized };
}

function requiredSheet(sheets: Map<string, ParsedSheet>, name: string): SourceRow[] {
  const sheet = sheets.get(name);
  if (!sheet) throw new ImportParseError("import.error.missing_sheet", { sheet: name });
  return nonBlankRows(sheet.rows);
}

function assertAllowedSheets(sheets: Map<string, ParsedSheet>, allowed: readonly string[]): void {
  for (const name of sheets.keys()) {
    if (!allowed.includes(name)) {
      throw new ImportParseError("import.error.unknown_sheet", { sheet: name });
    }
  }
}

function metadata(rows: SourceRow[]): Map<string, unknown> {
  return new Map(rows.map((row) => [text(row.cells[0]), row.cells[1]]));
}

function normalizeRateCard(sheets: Map<string, ParsedSheet>): RateCardImport {
  assertAllowedSheets(sheets, ["Instructions", "Metadata", "Building Prices", "Package Prices", "Package Membership"]);
  requiredSheet(sheets, "Instructions");
  const metadataRows = requiredSheet(sheets, "Metadata");
  if (metadataRows.length !== 2
    || text(metadataRows[0]?.cells[0]) !== "Template Version"
    || text(metadataRows[1]?.cells[0]) !== "Currency") {
    throw new ImportParseError("import.error.value_invalid", { sheet: "Metadata" });
  }
  const fields = metadata(metadataRows);
  if (text(fields.get("Template Version")) !== TEMPLATE_VERSION_V2) {
    throw new ImportParseError("import.error.template_version");
  }
  if (text(fields.get("Currency")) !== "IDR") {
    throw new ImportParseError("import.error.value_invalid", { sheet: "Metadata", column: "Currency" });
  }

  const buildingRows = requiredSheet(sheets, "Building Prices");
  const packagePriceRows = requiredSheet(sheets, "Package Prices");
  const packageMembershipRows = requiredSheet(sheets, "Package Membership");
  for (const rows of [buildingRows, packagePriceRows, packageMembershipRows]) assertRowLimit(rows);
  const buildingColumns = assertHeaders("Building Prices", buildingRows, RATE_CARD_BUILDING_PRICE_HEADERS);
  const packagePriceColumns = assertHeaders("Package Prices", packagePriceRows, RATE_CARD_PACKAGE_PRICE_HEADERS);
  const packageMembershipColumns = assertHeaders("Package Membership", packageMembershipRows, RATE_CARD_PACKAGE_MEMBERSHIP_HEADERS);

  return {
    templateVersion: TEMPLATE_VERSION_V2,
    currency: "IDR",
    buildingPrices: buildingRows.slice(1).map((row) => ({
      rowNumber: row.rowNumber,
      irisBuildingId: text(value(row, buildingColumns, "IRIS Building ID")),
      priceIdr: exactText(value(row, buildingColumns, "Price IDR")),
    })),
    packagePrices: packagePriceRows.slice(1).map((row) => ({
      rowNumber: row.rowNumber,
      packageCode: text(value(row, packagePriceColumns, "Package Code")),
      priceIdr: exactText(value(row, packagePriceColumns, "Price IDR")),
    })),
    packageMemberships: packageMembershipRows.slice(1).map((row) => ({
      rowNumber: row.rowNumber,
      packageCode: text(value(row, packageMembershipColumns, "Package Code")),
      irisBuildingId: text(value(row, packageMembershipColumns, "IRIS Building ID")),
    })),
  };
}

function invalidRateCardCsvCell(row: SourceRow, column: string): never {
  throw new ImportParseError("import.error.value_invalid", {
    sheet: "Rate Card",
    rowNumber: row.rowNumber,
    column,
  });
}

function normalizeRateCardCsv(rows: SourceRow[]): RateCardImport {
  rows = nonBlankRows(rows);
  assertRowLimit(rows);
  const columns = assertHeaders("Rate Card", rows, RATE_CARD_HEADERS);
  const result: RateCardImport = {
    templateVersion: TEMPLATE_VERSION_V2,
    currency: "IDR",
    buildingPrices: [],
    packagePrices: [],
    packageMemberships: [],
  };

  for (const row of rows.slice(1)) {
    const recordType = text(value(row, columns, "Record Type"));
    const irisBuildingId = text(value(row, columns, "IRIS Building ID"));
    const packageCode = text(value(row, columns, "Package Code"));
    const priceIdr = exactText(value(row, columns, "Price IDR"));
    if (recordType === "BUILDING_PRICE") {
      if (packageCode !== "") invalidRateCardCsvCell(row, "Package Code");
      result.buildingPrices.push({ rowNumber: row.rowNumber, irisBuildingId, priceIdr });
    } else if (recordType === "PACKAGE_PRICE") {
      if (irisBuildingId !== "") invalidRateCardCsvCell(row, "IRIS Building ID");
      result.packagePrices.push({ rowNumber: row.rowNumber, packageCode, priceIdr });
    } else if (recordType === "PACKAGE_MEMBER") {
      if (priceIdr !== "") invalidRateCardCsvCell(row, "Price IDR");
      result.packageMemberships.push({ rowNumber: row.rowNumber, packageCode, irisBuildingId });
    } else {
      invalidRateCardCsvCell(row, "Record Type");
    }
  }
  return result;
}

function normalizeRateCardCsvSet(files: readonly ImportSourceFile[]): RateCardImport {
  const filenames = files.map((file) => file.filename).sort();
  const expected = [...RATE_CARD_CSV_FILE_TO_SHEET.keys()].sort();
  if (
    filenames.length !== expected.length
    || filenames.some((filename, index) => filename !== expected[index])
  ) {
    throw new ImportParseError("import.error.file_set_invalid");
  }

  const sheets = new Map<string, ParsedSheet>([
    ["Instructions", {
      name: "Instructions",
      rows: [{ rowNumber: 1, cells: ["Rate Card CSV set"] }],
    }],
  ]);
  for (const file of files) {
    const sheetName = (RATE_CARD_CSV_FILE_TO_SHEET as ReadonlyMap<string, string>)
      .get(file.filename);
    if (!sheetName) throw new ImportParseError("import.error.file_set_invalid");
    sheets.set(sheetName, { name: sheetName, rows: parseCsv(file.body) });
  }
  return normalizeRateCard(sheets);
}

function assertFiles(files: readonly ImportSourceFile[]): void {
  if (files.length === 0 || files.some((file) => file.body.byteLength === 0)) {
    throw new ImportParseError("import.error.file_set_invalid");
  }
  if (files.reduce((total, file) => total + file.body.byteLength, 0) > MAX_TOTAL_BYTES) {
    throw new ImportParseError("import.error.file_set_invalid");
  }
}

export async function parseImportFiles(dataType: "building", files: readonly ImportSourceFile[]): Promise<BuildingImport>;
export async function parseImportFiles(dataType: "package", files: readonly ImportSourceFile[]): Promise<PackageImport>;
export async function parseImportFiles(dataType: "rate_card", files: readonly ImportSourceFile[]): Promise<RateCardImport>;
export async function parseImportFiles(dataType: "building" | "package" | "rate_card", files: readonly ImportSourceFile[]): Promise<BuildingImport | PackageImport | RateCardImport> {
  assertFiles(files);
  if (dataType === "building") {
    if (files.length !== 1) throw new ImportParseError("import.error.file_set_invalid");
    const file = files[0];
    if (extension(file.filename) === ".xlsx") {
      const sheets = await parseWorkbook(file.body);
      assertAllowedSheets(sheets, ["Instructions", "Data"]);
      assertBuildingTemplateVersion(sheets);
      return normalizeBuildings(requiredSheet(sheets, "Data"));
    }
    if (extension(file.filename) === ".csv") return normalizeBuildings(parseCsv(file.body));
    throw new ImportParseError("import.error.file_set_invalid");
  }

  if (dataType === "package") {
    if (files.length !== 1) throw new ImportParseError("import.error.file_set_invalid");
    const file = files[0];
    if (extension(file.filename) === ".xlsx") {
      const sheets = await parseWorkbook(file.body);
      assertAllowedSheets(sheets, ["Instructions", "Sales Packages"]);
      assertBuildingTemplateVersion(sheets);
      return normalizePackages(requiredSheet(sheets, "Sales Packages"));
    }
    if (extension(file.filename) === ".csv") return normalizePackages(parseCsv(file.body));
    throw new ImportParseError("import.error.file_set_invalid");
  }

  if (files.length === 1 && extension(files[0].filename) === ".xlsx") {
    return normalizeRateCard(await parseWorkbook(files[0].body));
  }
  if (files.length === 1 && extension(files[0].filename) === ".csv") {
    return normalizeRateCardCsv(parseCsv(files[0].body));
  }
  if (files.length === RATE_CARD_CSV_FILE_TO_SHEET.size) {
    return normalizeRateCardCsvSet(files);
  }
  throw new ImportParseError("import.error.file_set_invalid");
}
