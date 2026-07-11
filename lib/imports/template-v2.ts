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

export const RATE_CARD_HEADERS = {
  "Building Prices": ["IRIS Building ID", "Price IDR"],
  "Package Prices": ["Package Code", "Price IDR"],
  "Package Buildings": ["Package Code", "IRIS Building ID"],
} as const;

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
  address: string;
  operationalStatus: "active" | "inactive";
  dataSource: "building_team" | "erp";
}

export interface BuildingImport {
  templateVersion: typeof TEMPLATE_VERSION_V2;
  rows: BuildingRow[];
}

export interface RateCardImport {
  templateVersion: typeof TEMPLATE_VERSION_V2;
  versionCode: string;
  effectiveDate: string;
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
  packageBuildings: Array<{
    rowNumber: number;
    packageCode: string;
    irisBuildingId: string;
  }>;
}

export type NormalizedImport = BuildingImport | RateCardImport;

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
