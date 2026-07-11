import { normalizeExternalId } from "@/lib/buildings/identity";
import type { BuildingRow } from "@/lib/imports/template-v2";
import type { BuildingSnapshot, SnapshotBuilding } from "@/lib/imports/validate";

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

export interface ImportChange {
  type: "added" | "modified" | "deactivated" | "unchanged";
  entityKey: string;
  before: SnapshotBuilding | null;
  after: NormalizedBuilding;
}

export function buildingIdentityKey(
  row: Pick<BuildingRow, "irisBuildingId">,
) {
  return row.irisBuildingId.trim();
}

export function calculateBuildingDiff(
  rows: BuildingRow[],
  snapshot: BuildingSnapshot,
): ImportChange[] {
  const currentByIrisId = new Map(
    snapshot.buildings.map((item) => [item.irisBuildingId.trim(), item]),
  );

  return rows.map((row) => {
    const entityKey = buildingIdentityKey(row);
    const before = currentByIrisId.get(entityKey);
    const after = normalizeRow(row);

    if (!before) {
      return { type: "added", entityKey, before: null, after };
    }

    if (deepEqual(normalizeSnapshotBuilding(before), after)) {
      return { type: "unchanged", entityKey, before, after };
    }

    const type = after.operationalStatus === "inactive" && before.status === "active"
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

function normalizeSnapshotBuilding(item: SnapshotBuilding): NormalizedBuilding {
  return {
    irisBuildingId: item.irisBuildingId.trim(),
    erpBuildingId: normalizeExternalId(item.erpBuildingId),
    buildingName: item.buildingName ?? "",
    buildingType: item.buildingType ?? null,
    gradeResource: item.gradeResource ?? null,
    area: item.area ?? null,
    city: item.city ?? null,
    cbdArea: item.cbdArea ?? null,
    subDistrict: item.subDistrict ?? null,
    address: item.address ?? "",
    operationalStatus: item.status,
    dataSource: item.dataSource ?? "building_team",
  };
}

function deepEqual(left: NormalizedBuilding, right: NormalizedBuilding) {
  return JSON.stringify(left) === JSON.stringify(right);
}
