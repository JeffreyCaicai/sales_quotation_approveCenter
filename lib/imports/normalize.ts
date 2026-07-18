import {
  BUILDING_HEADERS,
  BUILDING_REQUIRED_HEADERS,
  ImportParseError,
  PACKAGE_HEADERS,
  RATE_CARD_BUILDING_PRICE_HEADERS,
  RATE_CARD_PACKAGE_MEMBERSHIP_HEADERS,
  RATE_CARD_PACKAGE_PRICE_HEADERS,
  TEMPLATE_VERSION_V2,
  type BuildingCandidateImport,
  type BuildingCandidateRow,
  type BuildingImport,
  type PackageCandidateImport,
  type PackageCandidateRow,
  type PackageImport,
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

function assertHeaders(
  sheet: string,
  rows: SourceRow[],
  expected: readonly string[],
  required: readonly string[] = expected,
): Map<string, number> {
  const actual = (rows[0]?.cells ?? []).map(headerText);
  for (const header of actual) {
    if (!expected.includes(header)) {
      throw new ImportParseError("import.error.unknown_column", { sheet, column: header });
    }
  }
  for (const header of required) {
    if (!actual.includes(header)) {
      throw new ImportParseError("import.error.missing_column", { sheet, column: header });
    }
  }
  if (new Set(actual).size !== actual.length) {
    throw new ImportParseError("import.error.unknown_column", { sheet });
  }
  return new Map(actual.map((header, index) => [header, index]));
}

function value(row: SourceRow, columns: Map<string, number>, header: string): unknown {
  const index = columns.get(header);
  return index === undefined ? undefined : row.cells[index];
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

function normalizeBuildings(rows: SourceRow[]): BuildingCandidateImport {
  rows = nonBlankRows(rows);
  assertRowLimit(rows);
  const columns = assertHeaders("Data", rows, BUILDING_HEADERS, BUILDING_REQUIRED_HEADERS);
  const normalized: BuildingCandidateRow[] = rows.slice(1).map((row) => {
    const operationalStatus = text(value(row, columns, "Operational Status"));
    const dataSource = nullable(value(row, columns, "Data Source"));
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
      address: nullable(value(row, columns, "Address")),
      operationalStatus,
      dataSource,
    };
  });
  return { templateVersion: TEMPLATE_VERSION_V2, rows: normalized };
}

function normalizePackages(rows: SourceRow[]): PackageCandidateImport {
  rows = nonBlankRows(rows);
  assertRowLimit(rows);
  const columns = assertHeaders("Sales Packages", rows, PACKAGE_HEADERS);
  const normalized: PackageCandidateRow[] = rows.slice(1).map((row) => {
    const operationalStatus = text(value(row, columns, "Operational Status"));
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
    try {
      sheets.set(sheetName, { name: sheetName, rows: parseCsv(file.body) });
    } catch (error) {
      if (error instanceof ImportParseError) {
        throw new ImportParseError(error.key, {
          ...error.details,
          filename: file.filename,
          sheet: sheetName,
        });
      }
      throw error;
    }
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

export async function parseImportFiles(dataType: "building", files: readonly ImportSourceFile[]): Promise<BuildingCandidateImport>;
export async function parseImportFiles(dataType: "package", files: readonly ImportSourceFile[]): Promise<PackageCandidateImport>;
export async function parseImportFiles(dataType: "rate_card", files: readonly ImportSourceFile[]): Promise<RateCardImport>;
export async function parseImportFiles(dataType: "building" | "package" | "rate_card", files: readonly ImportSourceFile[]): Promise<BuildingCandidateImport | PackageCandidateImport | RateCardImport> {
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
  if (files.length === RATE_CARD_CSV_FILE_TO_SHEET.size) {
    return normalizeRateCardCsvSet(files);
  }
  throw new ImportParseError("import.error.file_set_invalid");
}

export function toValidatedBuildingImport(input: BuildingCandidateImport): BuildingImport {
  return {
    templateVersion: input.templateVersion,
    rows: input.rows.map((row) => {
      if (row.operationalStatus !== "active" && row.operationalStatus !== "inactive") {
        throw new ImportParseError("import.error.value_invalid", { sheet: "Data", rowNumber: row.rowNumber, column: "Operational Status" });
      }
      if (row.dataSource !== null && row.dataSource !== "building_team" && row.dataSource !== "erp") {
        throw new ImportParseError("import.error.value_invalid", { sheet: "Data", rowNumber: row.rowNumber, column: "Data Source" });
      }
      return {
        ...row,
        operationalStatus: row.operationalStatus,
        dataSource: row.dataSource ?? "building_team",
      };
    }),
  };
}

export function toValidatedPackageImport(input: PackageCandidateImport): PackageImport {
  return {
    templateVersion: input.templateVersion,
    rows: input.rows.map((row) => {
      if (row.operationalStatus !== "active" && row.operationalStatus !== "inactive") {
        throw new ImportParseError("import.error.value_invalid", { sheet: "Sales Packages", rowNumber: row.rowNumber, column: "Operational Status" });
      }
      return { ...row, operationalStatus: row.operationalStatus };
    }),
  };
}
