export const TEMPLATE_VERSION_V2 = "TMN-IMPORT-2" as const;

export const BUILDING_HEADERS = [
  "IRIS Building ID",
  "ERP Building ID",
  "Building Name",
  "Building Type",
  "Grade Resource",
  "Area",
  "City",
  "CBD Area",
  "Sub-District",
  "Address",
  "Operational Status",
  "Data Source",
] as const;

export const PACKAGE_HEADERS = [
  "Package Code",
  "Package Name",
  "Operational Status",
] as const;

export const RATE_CARD_BUILDING_PRICE_HEADERS = ["IRIS Building ID", "Price IDR"] as const;
export const RATE_CARD_PACKAGE_PRICE_HEADERS = ["Package Code", "Price IDR"] as const;
export const RATE_CARD_PACKAGE_MEMBERSHIP_HEADERS = ["Package Code", "IRIS Building ID"] as const;

export interface SourceRow {
  rowNumber: number;
  cells: unknown[];
}

export interface BuildingRow {
  rowNumber: number;
  irisBuildingId: string;
  erpBuildingId: string | null;
  buildingName: string;
  buildingType: string | null;
  gradeResource: string | null;
  area: string | null;
  city: string | null;
  cbdArea: string | null;
  subDistrict: string | null;
  address: string | null;
  operationalStatus: "active" | "inactive";
  dataSource: "building_team" | "erp";
}

export interface BuildingCandidateRow extends Omit<BuildingRow, "operationalStatus" | "dataSource"> {
  operationalStatus: string;
  dataSource: string | null;
}

export interface BuildingImport {
  templateVersion: typeof TEMPLATE_VERSION_V2;
  rows: BuildingRow[];
}

export interface BuildingCandidateImport {
  templateVersion: typeof TEMPLATE_VERSION_V2;
  rows: BuildingCandidateRow[];
}

export interface PackageRow {
  rowNumber: number;
  packageCode: string | null;
  packageName: string;
  operationalStatus: "active" | "inactive";
}

export interface PackageCandidateRow extends Omit<PackageRow, "operationalStatus"> {
  operationalStatus: string;
}

export interface PackageImport {
  templateVersion: typeof TEMPLATE_VERSION_V2;
  rows: PackageRow[];
}

export interface PackageCandidateImport {
  templateVersion: typeof TEMPLATE_VERSION_V2;
  rows: PackageCandidateRow[];
}

export interface RateCardImport {
  templateVersion: typeof TEMPLATE_VERSION_V2;
  currency: "IDR";
  buildingPrices: Array<{
    rowNumber: number;
    irisBuildingId: string;
    priceIdr: string;
  }>;
  packagePrices: Array<{
    rowNumber: number;
    packageCode: string;
    priceIdr: string;
  }>;
  packageMemberships: Array<{
    rowNumber: number;
    packageCode: string;
    irisBuildingId: string;
  }>;
}

export interface StagedRateCardImport extends RateCardImport {
  basedOnVersionId: string | null;
}

export type NormalizedImport = BuildingImport | PackageImport | RateCardImport;

export type ImportParseErrorKey =
  | "file.formula_not_allowed"
  | "import.error.file_invalid"
  | "import.error.file_set_invalid"
  | "import.error.missing_column"
  | "import.error.missing_sheet"
  | "import.error.row_limit_exceeded"
  | "import.error.template_version"
  | "import.error.unknown_column"
  | "import.error.unknown_sheet"
  | "import.error.value_invalid";

export class ImportParseError extends Error {
  constructor(
    public readonly key: ImportParseErrorKey,
    public readonly details: Record<string, string | number> = {},
  ) {
    super(key);
    this.name = "ImportParseError";
  }
}
