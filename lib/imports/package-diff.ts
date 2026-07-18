import type { PackageRow } from "@/lib/imports/template-v2";

export interface PackageSnapshot {
  packageCode: string;
  packageName: string;
  status: "active" | "inactive";
}

export interface PackageChange {
  rowNumber: number;
  entityKey: string;
  changeType: "added" | "modified" | "deactivated" | "unchanged";
  before: PackageSnapshot | null;
  after: Omit<PackageSnapshot, "packageCode"> & { packageCode: string | null };
}

export function calculatePackageDiff(
  candidate: readonly PackageRow[],
  existing: readonly PackageSnapshot[],
): PackageChange[] {
  const currentByCode = new Map(existing.map((item) => [item.packageCode, item]));

  return candidate.map((row) => {
    const packageCode = row.packageCode?.trim() || null;
    const after = {
      packageCode,
      packageName: row.packageName.trim(),
      status: row.operationalStatus,
    };
    if (packageCode === null) {
      return {
        rowNumber: row.rowNumber,
        entityKey: `row:${row.rowNumber}`,
        changeType: "added",
        before: null,
        after,
      };
    }

    const before = currentByCode.get(packageCode) ?? null;
    if (before === null) {
      return {
        rowNumber: row.rowNumber,
        entityKey: packageCode,
        changeType: "added",
        before: null,
        after,
      };
    }

    const changeType = before.status === after.status
      ? "unchanged"
      : after.status === "inactive"
        ? "deactivated"
        : "modified";
    return {
      rowNumber: row.rowNumber,
      entityKey: packageCode,
      changeType,
      before,
      after,
    };
  });
}
