import { normalizeExternalId } from "@/lib/buildings/identity";
import type { BuildingRow } from "@/lib/imports/template-v2";

export interface BuildingDiffSnapshotItem {
  id: string;
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
  status: "active" | "inactive";
  dataSource: "building_team" | "erp";
}

export interface BuildingDiffSnapshot {
  buildings: BuildingDiffSnapshotItem[];
}

export interface NormalizedBuilding {
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

export interface NormalizedCurrentBuilding extends NormalizedBuilding {
  id: string;
}

interface BaseImportChange {
  entityKey: string;
  after: NormalizedBuilding;
}

export type ImportChange =
  | BaseImportChange & { type: "added"; before: null }
  | BaseImportChange & {
    type: "modified" | "deactivated" | "unchanged";
    before: NormalizedCurrentBuilding;
  };

export function buildingIdentityKey(
  row: Pick<BuildingRow, "irisBuildingId">,
) {
  return row.irisBuildingId.trim();
}

export function calculateBuildingDiff(
  rows: BuildingRow[],
  snapshot: BuildingDiffSnapshot,
): ImportChange[] {
  const currentByIrisId = new Map(
    snapshot.buildings.map((item) => [item.irisBuildingId.trim(), item]),
  );

  return rows.map((row) => {
    const entityKey = buildingIdentityKey(row);
    const current = currentByIrisId.get(entityKey);
    const after = normalizeRow(row);

    if (!current) {
      return { type: "added", entityKey, before: null, after };
    }

    const before = normalizeSnapshotBuilding(current);
    if (deepEqual(before, after)) {
      return { type: "unchanged", entityKey, before, after };
    }

    const type = after.operationalStatus === "inactive" && before.operationalStatus === "active"
      ? "deactivated"
      : "modified";
    return { type, entityKey, before, after };
  });
}

function normalizeRow(row: BuildingRow): NormalizedBuilding {
  return {
    irisBuildingId: buildingIdentityKey(row),
    erpBuildingId: normalizeExternalId(row.erpBuildingId),
    buildingName: row.buildingName,
    buildingType: row.buildingType,
    gradeResource: row.gradeResource,
    area: row.area,
    city: row.city,
    cbdArea: row.cbdArea,
    subDistrict: row.subDistrict,
    address: row.address,
    operationalStatus: row.operationalStatus,
    dataSource: row.dataSource,
  };
}

function normalizeSnapshotBuilding(
  item: BuildingDiffSnapshotItem,
): NormalizedCurrentBuilding {
  return {
    id: item.id,
    irisBuildingId: item.irisBuildingId.trim(),
    erpBuildingId: normalizeExternalId(item.erpBuildingId),
    buildingName: item.buildingName,
    buildingType: item.buildingType,
    gradeResource: item.gradeResource,
    area: item.area,
    city: item.city,
    cbdArea: item.cbdArea,
    subDistrict: item.subDistrict,
    address: item.address,
    operationalStatus: item.status,
    dataSource: item.dataSource,
  };
}

function deepEqual(left: NormalizedCurrentBuilding, right: NormalizedBuilding) {
  const { id, ...leftWithoutId } = left;
  void id;
  return JSON.stringify(leftWithoutId) === JSON.stringify(right);
}
