import { describe, expect, test } from "vitest";

import { calculateRateCardDiff } from "@/lib/imports/rate-card-diff";
import type { StagedRateCardImport } from "@/lib/imports/template-v2";

describe("Rate Card difference preview", () => {
  test("classifies every stable union key against only the Current baseline", () => {
    const staged: StagedRateCardImport = {
      templateVersion: "TMN-IMPORT-2",
      currency: "IDR",
      basedOnVersionId: "current-version",
      buildingPrices: [
        { rowNumber: 2, irisBuildingId: "B-KEEP", priceIdr: "100" },
        { rowNumber: 3, irisBuildingId: "B-CHANGE", priceIdr: "250" },
        { rowNumber: 4, irisBuildingId: "B-ADD", priceIdr: "0" },
      ],
      packagePrices: [
        { rowNumber: 2, packageCode: "PKG-KEEP", priceIdr: "500" },
        { rowNumber: 3, packageCode: "PKG-CHANGE", priceIdr: "750" },
        { rowNumber: 4, packageCode: "PKG-ADD", priceIdr: "900" },
      ],
      packageMemberships: [
        { rowNumber: 2, packageCode: "PKG-KEEP", irisBuildingId: "B-KEEP" },
        { rowNumber: 3, packageCode: "PKG-ADD", irisBuildingId: "B-ADD" },
      ],
    };

    expect(calculateRateCardDiff(staged, {
      versionId: "current-version",
      buildingPrices: new Map([
        ["B-KEEP", "100"],
        ["B-CHANGE", "200"],
        ["B-REMOVE", "300"],
      ]),
      packagePrices: new Map([
        ["PKG-KEEP", "500"],
        ["PKG-CHANGE", "700"],
        ["PKG-REMOVE", "800"],
      ]),
      packageMemberships: [
        { packageCode: "PKG-KEEP", irisBuildingId: "B-KEEP" },
        { packageCode: "PKG-REMOVE", irisBuildingId: "B-REMOVE" },
      ],
    })).toEqual([
      expect.objectContaining({ entityKey: "building:B-ADD", changeType: "added", before: null }),
      expect.objectContaining({ entityKey: "building:B-CHANGE", changeType: "modified" }),
      expect.objectContaining({ entityKey: "building:B-KEEP", changeType: "unchanged" }),
      expect.objectContaining({ entityKey: "building:B-REMOVE", changeType: "removed", after: null }),
      expect.objectContaining({ entityKey: "membership:PKG-ADD:B-ADD", changeType: "added", before: null }),
      expect.objectContaining({ entityKey: "membership:PKG-KEEP:B-KEEP", changeType: "unchanged" }),
      expect.objectContaining({ entityKey: "membership:PKG-REMOVE:B-REMOVE", changeType: "removed", after: null }),
      expect.objectContaining({ entityKey: "package:PKG-ADD", changeType: "added", before: null }),
      expect.objectContaining({ entityKey: "package:PKG-CHANGE", changeType: "modified" }),
      expect.objectContaining({ entityKey: "package:PKG-KEEP", changeType: "unchanged" }),
      expect.objectContaining({ entityKey: "package:PKG-REMOVE", changeType: "removed", after: null }),
    ]);
  });

  test("keeps colon-containing package membership tuples distinct without corrupting values", () => {
    const staged: StagedRateCardImport = {
      templateVersion: "TMN-IMPORT-2",
      currency: "IDR",
      basedOnVersionId: "current-version",
      buildingPrices: [],
      packagePrices: [],
      packageMemberships: [
        { rowNumber: 2, packageCode: "PKG:A", irisBuildingId: "B" },
        { rowNumber: 3, packageCode: "PKG", irisBuildingId: "A:B" },
      ],
    };

    expect(calculateRateCardDiff(staged, {
      versionId: "current-version",
      buildingPrices: new Map(),
      packagePrices: new Map(),
      packageMemberships: [
        { packageCode: "PKG:A", irisBuildingId: "B" },
        { packageCode: "PKG", irisBuildingId: "A:B" },
      ],
    })).toEqual([
      {
        entityKey: "membership:PKG%3AA:B",
        changeType: "unchanged",
        before: { kind: "package_membership", packageCode: "PKG:A", irisBuildingId: "B" },
        after: { kind: "package_membership", packageCode: "PKG:A", irisBuildingId: "B" },
      },
      {
        entityKey: "membership:PKG:A%3AB",
        changeType: "unchanged",
        before: { kind: "package_membership", packageCode: "PKG", irisBuildingId: "A:B" },
        after: { kind: "package_membership", packageCode: "PKG", irisBuildingId: "A:B" },
      },
    ]);
  });
});
