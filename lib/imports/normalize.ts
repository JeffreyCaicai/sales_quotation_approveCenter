import {
  BUILDING_HEADERS,
  ImportParseError,
  RATE_CARD_HEADERS,
  TEMPLATE_VERSION_V2,
  type BuildingImport,
  type BuildingRow,
  type RateCardImport,
  type SourceRow,
} from "@/lib/imports/template-v2";
import { parseCsv } from "@/lib/imports/parse-csv";
import { parseWorkbook, type ParsedSheet } from "@/lib/imports/parse-workbook";
import * as XLSX from "xlsx";

export interface ImportSourceFile {
  filename: string;
  body: Uint8Array;
}

const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 10_000;
const RATE_CARD_CSV_FILES = [
  "building-prices.csv",
  "metadata.csv",
  "package-buildings.csv",
  "package-prices.csv",
] as const;

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

function dateText(value: unknown): string {
  if (typeof value !== "number") return text(value);
  const parsed = XLSX.SSF.parse_date_code(value);
  if (!parsed) return text(value);
  return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
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
  assertAllowedSheets(sheets, ["Instructions", "Metadata", "Building Prices", "Package Prices", "Package Buildings"]);
  const fields = metadata(requiredSheet(sheets, "Metadata"));
  if (text(fields.get("Template Version")) !== TEMPLATE_VERSION_V2) {
    throw new ImportParseError("import.error.template_version");
  }
  if (text(fields.get("Currency")) !== "IDR") {
    throw new ImportParseError("import.error.value_invalid", { sheet: "Metadata", column: "Currency" });
  }

  const buildingRows = requiredSheet(sheets, "Building Prices");
  const packagePriceRows = requiredSheet(sheets, "Package Prices");
  const packageBuildingRows = requiredSheet(sheets, "Package Buildings");
  for (const rows of [buildingRows, packagePriceRows, packageBuildingRows]) assertRowLimit(rows);
  const buildingColumns = assertHeaders("Building Prices", buildingRows, RATE_CARD_HEADERS["Building Prices"]);
  const packagePriceColumns = assertHeaders("Package Prices", packagePriceRows, RATE_CARD_HEADERS["Package Prices"]);
  const packageBuildingColumns = assertHeaders("Package Buildings", packageBuildingRows, RATE_CARD_HEADERS["Package Buildings"]);

  return {
    templateVersion: TEMPLATE_VERSION_V2,
    versionCode: text(fields.get("Version Code")),
    effectiveDate: dateText(fields.get("Effective Date")),
    currency: "IDR",
    buildingPrices: buildingRows.slice(1).map((row) => ({
      rowNumber: row.rowNumber,
      irisBuildingId: text(value(row, buildingColumns, "IRIS Building ID")),
      priceIdr: text(value(row, buildingColumns, "Price IDR")),
    })),
    packagePrices: packagePriceRows.slice(1).map((row) => ({
      rowNumber: row.rowNumber,
      packageCode: text(value(row, packagePriceColumns, "Package Code")),
      priceIdr: text(value(row, packagePriceColumns, "Price IDR")),
    })),
    packageBuildings: packageBuildingRows.slice(1).map((row) => ({
      rowNumber: row.rowNumber,
      packageCode: text(value(row, packageBuildingColumns, "Package Code")),
      irisBuildingId: text(value(row, packageBuildingColumns, "IRIS Building ID")),
    })),
  };
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
export async function parseImportFiles(dataType: "rate_card", files: readonly ImportSourceFile[]): Promise<RateCardImport>;
export async function parseImportFiles(dataType: "building" | "rate_card", files: readonly ImportSourceFile[]): Promise<BuildingImport | RateCardImport> {
  assertFiles(files);
  if (dataType === "building") {
    if (files.length !== 1) throw new ImportParseError("import.error.file_set_invalid");
    const file = files[0];
    if (extension(file.filename) === ".xlsx") {
      const sheets = await parseWorkbook(file.body);
      assertAllowedSheets(sheets, ["Instructions", "Data"]);
      return normalizeBuildings(requiredSheet(sheets, "Data"));
    }
    if (extension(file.filename) === ".csv") return normalizeBuildings(parseCsv(file.body));
    throw new ImportParseError("import.error.file_set_invalid");
  }

  if (files.length === 1 && extension(files[0].filename) === ".xlsx") {
    return normalizeRateCard(await parseWorkbook(files[0].body));
  }
  const names = files.map((file) => file.filename).sort();
  if (names.length !== RATE_CARD_CSV_FILES.length || names.some((name, index) => name !== RATE_CARD_CSV_FILES[index])) {
    throw new ImportParseError("import.error.file_set_invalid");
  }
  const byName = new Map(files.map((file) => [file.filename, file]));
  return normalizeRateCard(new Map([
    ["Metadata", { name: "Metadata", rows: parseCsv(byName.get("metadata.csv")!.body) }],
    ["Building Prices", { name: "Building Prices", rows: parseCsv(byName.get("building-prices.csv")!.body) }],
    ["Package Prices", { name: "Package Prices", rows: parseCsv(byName.get("package-prices.csv")!.body) }],
    ["Package Buildings", { name: "Package Buildings", rows: parseCsv(byName.get("package-buildings.csv")!.body) }],
  ]));
}
