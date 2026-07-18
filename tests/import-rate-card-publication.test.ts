import { describe, expect, test } from "vitest";

import {
  assertRateCardPublicationBaseline,
  assertRateCardPublicationSnapshot,
  parseStagedRateCardImport,
  rateCardAuditMetadata,
} from "@/lib/imports/publish-rate-card";
import { publicationLockIdentities } from "@/lib/imports/publication-locks";
import type { StagedRateCardImport } from "@/lib/imports/template-v2";

const input: StagedRateCardImport = {
  templateVersion: "TMN-IMPORT-2",
  currency: "IDR",
  basedOnVersionId: "00000000-0000-4000-8000-000000000001",
  buildingPrices: [{ rowNumber: 2, irisBuildingId: "B1", priceIdr: "100" }],
  packagePrices: [{ rowNumber: 2, packageCode: "P1", priceIdr: "200" }],
  packageMemberships: [{ rowNumber: 2, packageCode: "P1", irisBuildingId: "B1" }],
};

describe("Rate Card publication transaction preflight", () => {
  test("parses the Task 4 staged payload without trusting file publication metadata", () => {
    const staged = {
      ...input,
      versionCode: "FILE-SUPPLIED",
      effectiveDate: "2026-08-01",
    };

    expect(parseStagedRateCardImport(staged)).toEqual(input);
  });

  test.each([
    [null, "00000000-0000-4000-8000-000000000001"],
    ["00000000-0000-4000-8000-000000000001", null],
    [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ],
  ])("rejects stale baseline %s when Current is %s", (basedOnVersionId, currentVersionId) => {
    expect(() => assertRateCardPublicationBaseline(basedOnVersionId, currentVersionId))
      .toThrowError(expect.objectContaining({ key: "IMPORT_CHANGE_STALE", status: 409 }));
  });

  test.each([
    [null, null],
    [
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000001",
    ],
  ])("accepts matching staged and Current baselines", (basedOnVersionId, currentVersionId) => {
    expect(() => assertRateCardPublicationBaseline(basedOnVersionId, currentVersionId)).not.toThrow();
  });

  test("resolves only locked active building and package rows", () => {
    expect(assertRateCardPublicationSnapshot(input,
      [{ id: "building-uuid", irisBuildingId: "B1", status: "active" }],
      [{ id: "package-uuid", packageCode: "P1", status: "active" }],
    )).toEqual({
      buildingIdByIris: new Map([["B1", "building-uuid"]]),
      packageIdByCode: new Map([["P1", "package-uuid"]]),
    });
  });

  test.each([
    [[], [{ id: "package-uuid", packageCode: "P1", status: "active" }], "IMPORT_RATE_CARD_BUILDING_REFERENCE_INVALID"],
    [[{ id: "building-uuid", irisBuildingId: "B1", status: "inactive" }], [{ id: "package-uuid", packageCode: "P1", status: "active" }], "IMPORT_RATE_CARD_BUILDING_REFERENCE_INVALID"],
    [[{ id: "building-uuid", irisBuildingId: "B1", status: "active" }], [], "IMPORT_RATE_CARD_PACKAGE_REFERENCE_INVALID"],
    [[{ id: "building-uuid", irisBuildingId: "B1", status: "active" }], [{ id: "package-uuid", packageCode: "P1", status: "inactive" }], "IMPORT_RATE_CARD_PACKAGE_REFERENCE_INVALID"],
  ] as const)("rejects missing or inactive locked references", (buildings, packages, key) => {
    expect(() => assertRateCardPublicationSnapshot(input, [...buildings], [...packages]))
      .toThrowError(expect.objectContaining({ key }));
  });

  test("rejects duplicate file-level references before inserts", () => {
    expect(() => assertRateCardPublicationSnapshot({
      ...input,
      buildingPrices: [...input.buildingPrices, { ...input.buildingPrices[0], rowNumber: 3 }],
    }, [{ id: "building-uuid", irisBuildingId: "B1", status: "active" }], [{ id: "package-uuid", packageCode: "P1", status: "active" }]))
      .toThrowError(expect.objectContaining({ key: "IMPORT_RATE_CARD_BUILDING_REFERENCE_INVALID" }));
  });

  test("rejects malformed staged identifiers at the stable publication boundary", () => {
    expect(() => assertRateCardPublicationSnapshot({
      ...input,
      buildingPrices: [{ rowNumber: 2, irisBuildingId: undefined as unknown as string, priceIdr: "100" }],
    }, [], []))
      .toThrowError(expect.objectContaining({ key: "IMPORT_CHANGE_INVALID" }));
  });

  test("rejects a completely empty Rate Card", () => {
    expect(() => assertRateCardPublicationSnapshot({
      ...input, buildingPrices: [], packagePrices: [], packageMemberships: [],
    }, [], [])).toThrowError(expect.objectContaining({ key: "IMPORT_CHANGE_INVALID" }));
  });

  test.each([
    [{ ...input, packageMemberships: [] }, "price without membership"],
    [{ ...input, packagePrices: [] }, "membership without price"],
  ])("rejects package cross-sheet incompleteness: %s", (incomplete, _label) => {
    void _label;
    expect(() => assertRateCardPublicationSnapshot(incomplete,
      [{ id: "building-uuid", irisBuildingId: "B1", status: "active" }],
      [{ id: "package-uuid", packageCode: "P1", status: "active" }],
    )).toThrowError(expect.objectContaining({ key: "IMPORT_RATE_CARD_PACKAGE_REFERENCE_INVALID" }));
  });

  test("audits the system version code and exact resolved UUID payloads", () => {
    expect(rateCardAuditMetadata(input, {
      buildingIdByIris: new Map([["B1", "building-uuid"]]),
      packageIdByCode: new Map([["P1", "package-uuid"]]),
    }, "RC-20260718T030405Z-12345678")).toEqual({
      versionCode: "RC-20260718T030405Z-12345678",
      currency: "IDR",
      basedOnVersionId: input.basedOnVersionId,
      buildingPrices: [{ irisBuildingId: "B1", buildingId: "building-uuid", priceIdr: "100" }],
      packageConfigs: [{ packageCode: "P1", packageId: "package-uuid", priceIdr: "200" }],
      packageMemberships: [{ packageCode: "P1", packageId: "package-uuid", irisBuildingId: "B1", buildingId: "building-uuid" }],
    });
  });

  test("uses the shared building-reference lock before the Rate Card lock", () => {
    expect(publicationLockIdentities("rate_card")).toEqual([
      "import-publish-building-references-v1",
      "import-publish-data-type-v1:rate_card",
    ]);
  });
});
