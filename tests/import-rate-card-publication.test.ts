import { describe, expect, test } from "vitest";

import { assertRateCardPublicationSnapshot } from "@/lib/imports/publish-rate-card";
import type { RateCardImport } from "@/lib/imports/template-v2";

const input: RateCardImport = {
  templateVersion: "TMN-IMPORT-2", versionCode: "RC-1", effectiveDate: "2026-08-01", currency: "IDR",
  buildingPrices: [{ rowNumber: 2, irisBuildingId: "B1", priceIdr: "100" }],
  packagePrices: [{ rowNumber: 2, packageCode: "P1", priceIdr: "200" }],
  packageBuildings: [{ rowNumber: 2, packageCode: "P1", irisBuildingId: "B1" }],
};

describe("Rate Card publication transaction preflight", () => {
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
});
