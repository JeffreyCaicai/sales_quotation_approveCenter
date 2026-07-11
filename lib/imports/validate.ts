import { normalizeExternalId } from "@/lib/buildings/identity";
import {
  sortImportValidationErrors,
  type ImportValidationError,
} from "@/lib/imports/errors";
import type { BuildingRow, RateCardImport } from "@/lib/imports/template-v2";

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

export function validateBuildingRows(
  rows: BuildingRow[],
  snapshot: BuildingValidationSnapshot,
): ImportValidationError[] {
  if (
    !snapshot.controlledValues
    || snapshot.controlledValues.buildingTypes.length === 0
    || snapshot.controlledValues.gradeResources.length === 0
  ) {
    return [error(
      0,
      "Building Type / Grade Resource",
      "import.error.building_controlled_values_unavailable",
    )];
  }
  const errors: ImportValidationError[] = [];
  const rowsByIrisId = groupRows(rows, (row) => row.irisBuildingId.trim());
  const rowsByErpId = groupRows(rows, (row) => normalizeExternalId(row.erpBuildingId));
  const currentByErpId = new Map<string, BuildingValidationSnapshotItem>();
  const currentByIrisId = new Map(
    snapshot.buildings.map((item) => [item.irisBuildingId.trim(), item]),
  );
  const buildingTypes = new Set(snapshot.controlledValues.buildingTypes);
  const gradeResources = new Set(snapshot.controlledValues.gradeResources);

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
    if (row.address.trim().length === 0) {
      errors.push(error(row.rowNumber, "Address", "import.error.address_required"));
    }
    if (!row.buildingType || !buildingTypes.has(row.buildingType.trim())) {
      errors.push(error(row.rowNumber, "Building Type", "import.error.building_type_invalid"));
    }
    if (!row.gradeResource || !gradeResources.has(row.gradeResource.trim())) {
      errors.push(error(row.rowNumber, "Grade Resource", "import.error.grade_resource_invalid"));
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

export function validateRateCardBuildings(
  input: Pick<RateCardImport, "buildingPrices" | "packageBuildings">,
  snapshot: BuildingValidationSnapshot,
): ImportValidationError[] {
  const errors: ImportValidationError[] = [];
  const currentByIrisId = new Map(
    snapshot.buildings.map((item) => [item.irisBuildingId.trim(), item]),
  );
  const references = [
    ...input.buildingPrices.map((row) => ({ sheet: "Building Prices", ...row })),
    ...input.packageBuildings.map((row) => ({ sheet: "Package Buildings", ...row })),
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
  rows: BuildingRow[],
  keyFor: (row: BuildingRow) => string | null,
) {
  const grouped = new Map<string, BuildingRow[]>();
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

export type { ImportValidationError } from "@/lib/imports/errors";
