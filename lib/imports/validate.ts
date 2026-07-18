import { normalizeExternalId } from "@/lib/buildings/identity";
import {
  sortImportValidationErrors,
  type ImportValidationError,
} from "@/lib/imports/errors";
import type { BuildingCandidateRow, PackageCandidateRow, RateCardImport } from "@/lib/imports/template-v2";

export interface BuildingValidationSnapshotItem {
  id: string;
  irisBuildingId: string;
  erpBuildingId: string | null;
  status: "active" | "inactive";
}

export interface BuildingValidationSnapshot {
  buildings: BuildingValidationSnapshotItem[];
  controlledValues?: BuildingControlledValuesSnapshot;
}

export interface BuildingControlledValuesSnapshot {
  buildingTypes: readonly string[];
  gradeResources: readonly string[];
}

export interface PackageValidationSnapshotItem {
  packageCode: string;
  packageName: string;
  status: "active" | "inactive";
}

export interface PackageValidationSnapshot {
  packages: PackageValidationSnapshotItem[];
}

export function validateBuildingRows(
  rows: BuildingCandidateRow[],
  snapshot: BuildingValidationSnapshot,
): ImportValidationError[] {
  const errors: ImportValidationError[] = [];
  const buildingTypeSupplied = rows.some((row) => row.buildingType !== null);
  const gradeResourceSupplied = rows.some((row) => row.gradeResource !== null);
  if (
    (buildingTypeSupplied && (!snapshot.controlledValues || snapshot.controlledValues.buildingTypes.length === 0))
    || (gradeResourceSupplied && (!snapshot.controlledValues || snapshot.controlledValues.gradeResources.length === 0))
  ) {
    errors.push(error(
      0,
      "Building Type / Grade Resource",
      "import.error.building_controlled_values_unavailable",
    ));
  }
  const rowsByIrisId = groupRows(rows, (row) => row.irisBuildingId.trim());
  const rowsByErpId = groupRows(rows, (row) => normalizeExternalId(row.erpBuildingId));
  const currentByErpId = new Map<string, BuildingValidationSnapshotItem>();
  const currentByIrisId = new Map(
    snapshot.buildings.map((item) => [item.irisBuildingId.trim(), item]),
  );
  const buildingTypes = new Set(snapshot.controlledValues?.buildingTypes ?? []);
  const gradeResources = new Set(snapshot.controlledValues?.gradeResources ?? []);

  for (const item of snapshot.buildings) {
    const erpBuildingId = normalizeExternalId(item.erpBuildingId);
    if (erpBuildingId !== null) currentByErpId.set(erpBuildingId, item);
  }

  for (const row of rows) {
    const irisBuildingId = row.irisBuildingId.trim();
    const erpBuildingId = normalizeExternalId(row.erpBuildingId);

    if (row.buildingName.trim().length === 0) {
      errors.push(error(row.rowNumber, "Building Name", "import.error.building_name_required"));
    }
    if (row.buildingType !== null && buildingTypes.size > 0 && !buildingTypes.has(row.buildingType.trim())) {
      errors.push(error(row.rowNumber, "Building Type", "import.error.building_type_invalid"));
    }
    if (row.gradeResource !== null && gradeResources.size > 0 && !gradeResources.has(row.gradeResource.trim())) {
      errors.push(error(row.rowNumber, "Grade Resource", "import.error.grade_resource_invalid"));
    }
    if (row.operationalStatus.length === 0) {
      errors.push(error(row.rowNumber, "Operational Status", "import.error.operational_status_required"));
    } else if (row.operationalStatus !== "active" && row.operationalStatus !== "inactive") {
      errors.push(error(row.rowNumber, "Operational Status", "import.error.operational_status_invalid"));
    }
    if (row.dataSource !== null && row.dataSource !== "building_team" && row.dataSource !== "erp") {
      errors.push(error(row.rowNumber, "Data Source", "import.error.data_source_invalid"));
    }

    if (irisBuildingId.length === 0) {
      errors.push(error(row.rowNumber, "IRIS Building ID", "import.error.iris_building_id_required"));
    } else if ((rowsByIrisId.get(irisBuildingId)?.length ?? 0) > 1) {
      errors.push(error(
        row.rowNumber,
        "IRIS Building ID",
        "import.error.iris_building_id_duplicate",
        { irisBuildingId },
      ));
    }

    if (
      currentByIrisId.get(irisBuildingId)?.status === "inactive"
      && row.operationalStatus === "active"
    ) {
      errors.push(error(
        row.rowNumber,
        "Operational Status",
        "import.error.building_reactivation_requires_admin_workflow",
        { irisBuildingId },
      ));
    }

    if (erpBuildingId === null) continue;

    if ((rowsByErpId.get(erpBuildingId)?.length ?? 0) > 1) {
      errors.push(error(
        row.rowNumber,
        "ERP Building ID",
        "import.error.erp_building_id_duplicate",
        { erpBuildingId },
      ));
    }

    const linkedBuilding = currentByErpId.get(erpBuildingId);
    if (linkedBuilding && linkedBuilding.irisBuildingId.trim() !== irisBuildingId) {
      errors.push(error(
        row.rowNumber,
        "ERP Building ID",
        "import.error.erp_building_id_conflict",
        {
          erpBuildingId,
          irisBuildingId: linkedBuilding.irisBuildingId.trim(),
        },
      ));
    }
  }

  return sortImportValidationErrors(errors);
}

export function validatePackageRows(
  rows: PackageCandidateRow[],
  snapshot: PackageValidationSnapshot,
): ImportValidationError[] {
  const errors: ImportValidationError[] = [];
  const rowsByCode = groupPackageRows(rows, (row) => row.packageCode?.trim() || null);
  const rowsByName = groupPackageRows(rows, (row) => normalizePackageName(row.packageName));
  const currentByCode = new Map(
    snapshot.packages.map((item) => [item.packageCode.trim(), item]),
  );

  for (const row of rows) {
    const packageCode = row.packageCode?.trim() || null;
    const normalizedName = normalizePackageName(row.packageName);
    const operationalStatus = row.operationalStatus as string;
    if (normalizedName.length === 0) {
      errors.push(packageError(row.rowNumber, "Package Name", "import.error.package_name_required"));
    } else if ((rowsByName.get(normalizedName)?.length ?? 0) > 1) {
      errors.push(packageError(
        row.rowNumber,
        "Package Name",
        "import.error.package_name_duplicate",
        { packageName: normalizedName },
      ));
    }
    if (operationalStatus === "") {
      errors.push(packageError(row.rowNumber, "Operational Status", "import.error.operational_status_required"));
    } else if (operationalStatus !== "active" && operationalStatus !== "inactive") {
      errors.push(packageError(row.rowNumber, "Operational Status", "import.error.operational_status_invalid"));
    }
    if (packageCode !== null && (rowsByCode.get(packageCode)?.length ?? 0) > 1) {
      errors.push(packageError(
        row.rowNumber,
        "Package Code",
        "import.error.package_code_duplicate",
        { packageCode },
      ));
    }
    const current = packageCode === null ? undefined : currentByCode.get(packageCode);
    if (current && packageCode !== null && current.packageName.trim() !== row.packageName.trim()) {
      errors.push(packageError(
        row.rowNumber,
        "Package Name",
        "import.error.package_name_immutable",
        { packageCode },
      ));
    }
  }

  return sortImportValidationErrors(errors);
}

export function validateRateCardBuildings(
  input: Pick<RateCardImport, "buildingPrices" | "packageMemberships">,
  snapshot: BuildingValidationSnapshot,
): ImportValidationError[] {
  const errors: ImportValidationError[] = [];
  const currentByIrisId = new Map(
    snapshot.buildings.map((item) => [item.irisBuildingId.trim(), item]),
  );
  const references = [
    ...input.buildingPrices.map((row) => ({ sheet: "Building Prices", ...row })),
    ...input.packageMemberships.map((row) => ({ sheet: "Package Membership", ...row })),
  ];

  for (const reference of references) {
    const irisBuildingId = reference.irisBuildingId.trim();
    const building = currentByIrisId.get(irisBuildingId);
    if (!building) {
      errors.push({
        sheet: reference.sheet,
        rowNumber: reference.rowNumber,
        column: "IRIS Building ID",
        key: "import.error.building_not_found",
        params: { irisBuildingId },
      });
    } else if (building.status !== "active") {
      errors.push({
        sheet: reference.sheet,
        rowNumber: reference.rowNumber,
        column: "IRIS Building ID",
        key: "import.error.building_inactive",
        params: { irisBuildingId },
      });
    }
  }

  return sortImportValidationErrors(errors);
}

function groupRows(
  rows: BuildingCandidateRow[],
  keyFor: (row: BuildingCandidateRow) => string | null,
) {
  const grouped = new Map<string, BuildingCandidateRow[]>();
  for (const row of rows) {
    const key = keyFor(row);
    if (key === null || key.length === 0) continue;
    const matching = grouped.get(key) ?? [];
    matching.push(row);
    grouped.set(key, matching);
  }
  return grouped;
}

function normalizePackageName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function groupPackageRows(
  rows: PackageCandidateRow[],
  keyFor: (row: PackageCandidateRow) => string | null,
) {
  const grouped = new Map<string, PackageCandidateRow[]>();
  for (const row of rows) {
    const key = keyFor(row);
    if (key === null || key.length === 0) continue;
    const matching = grouped.get(key) ?? [];
    matching.push(row);
    grouped.set(key, matching);
  }
  return grouped;
}

function error(
  rowNumber: number,
  column: string,
  key: `import.error.${string}`,
  params: Record<string, string | number> = {},
): ImportValidationError {
  return { sheet: "Data", rowNumber, column, key, params };
}

function packageError(
  rowNumber: number,
  column: string,
  key: `import.error.${string}`,
  params: Record<string, string | number> = {},
): ImportValidationError {
  return { sheet: "Sales Packages", rowNumber, column, key, params };
}

export type { ImportValidationError } from "@/lib/imports/errors";
