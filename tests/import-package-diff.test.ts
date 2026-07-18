import { describe, expect, test } from "vitest";

import { calculatePackageDiff, type PackageSnapshot } from "@/lib/imports/package-diff";
import type { PackageRow } from "@/lib/imports/template-v2";

describe("Sales Package Master differences", () => {
  test("stages added, modified, deactivated, and unchanged rows without deactivating absent packages", () => {
    const candidate: PackageRow[] = [
      { rowNumber: 2, packageCode: "PKG-A", packageName: "Package A", operationalStatus: "active" },
      { rowNumber: 3, packageCode: "PKG-B", packageName: "Package B", operationalStatus: "inactive" },
      { rowNumber: 4, packageCode: "PKG-C", packageName: "Package C", operationalStatus: "active" },
      { rowNumber: 5, packageCode: null, packageName: "Package New", operationalStatus: "active" },
    ];
    const existing: PackageSnapshot[] = [
      { packageCode: "PKG-A", packageName: "Package A", status: "inactive" },
      { packageCode: "PKG-B", packageName: "Package B", status: "active" },
      { packageCode: "PKG-C", packageName: "Package C", status: "active" },
      { packageCode: "PKG-ABSENT", packageName: "Not In File", status: "active" },
    ];

    expect(calculatePackageDiff(candidate, existing)).toMatchObject([
      { rowNumber: 2, entityKey: "PKG-A", changeType: "modified" },
      { rowNumber: 3, entityKey: "PKG-B", changeType: "deactivated" },
      { rowNumber: 4, entityKey: "PKG-C", changeType: "unchanged" },
      { rowNumber: 5, entityKey: "row:5", changeType: "added", after: { packageCode: null } },
    ]);
    expect(calculatePackageDiff(candidate, existing).some((change) => change.entityKey === "PKG-ABSENT")).toBe(false);
  });
});
