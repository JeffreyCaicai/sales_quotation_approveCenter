import { describe, expect, test } from "vitest";

import type {
  ImportChange,
  NormalizedBuilding,
  NormalizedCurrentBuilding,
} from "@/lib/imports/diff";
import { assertBuildingChangePublishable, orderBuildingChangesForLocking } from "@/lib/imports/publish";

function building(
  overrides: Partial<NormalizedBuilding> = {},
): NormalizedBuilding {
  return {
    irisBuildingId: "B003004",
    erpBuildingId: "ERP-01",
    buildingName: "Apartment 19th Avenue",
    buildingType: "Apartment",
    gradeResource: "A",
    area: "West",
    city: "Tangerang",
    cbdArea: "CBD",
    subDistrict: "Pinang",
    address: "Jl. Boulevard 19",
    operationalStatus: "active",
    dataSource: "building_team",
    ...overrides,
  };
}

function current(
  overrides: Partial<NormalizedCurrentBuilding> = {},
): NormalizedCurrentBuilding {
  return { id: "00000000-0000-4000-8000-000000000001", ...building(), ...overrides };
}

function modified(before = current()): ImportChange {
  return {
    type: "modified",
    entityKey: before.irisBuildingId,
    before,
    after: { ...before, buildingName: "Renamed Tower" },
  };
}

describe("building publication preflight", () => {
  test("orders building row locks deterministically by IRIS ID", () => {
    const first = current({ irisBuildingId: "B002" });
    const second = current({ id: "00000000-0000-4000-8000-000000000002", irisBuildingId: "B001" });
    expect(orderBuildingChangesForLocking([modified(first), modified(second)]).map((change) => change.entityKey))
      .toEqual(["B001", "B002"]);
  });

  test("rejects inactive-to-active publication even when every descriptor changes", () => {
    const before = current({ operationalStatus: "inactive", buildingName: "Former Tower" });
    expect(() => assertBuildingChangePublishable({
      type: "modified",
      entityKey: before.irisBuildingId,
      before,
      after: building({ operationalStatus: "active", buildingName: "Replacement Tower", address: "New address" }),
    }, before)).toThrowError(expect.objectContaining({
      key: "IMPORT_BUILDING_REACTIVATION_REQUIRES_ADMIN_WORKFLOW",
    }));
  });

  test.each([
    ["id", { id: "00000000-0000-4000-8000-000000000002" }],
    ["IRIS Building ID", { irisBuildingId: "B-OTHER" }],
    ["ERP Building ID", { erpBuildingId: "ERP-OTHER" }],
    ["building name", { buildingName: "Live Rename" }],
    ["building type", { buildingType: "Office" }],
    ["grade resource", { gradeResource: "B" }],
    ["area", { area: "East" }],
    ["city", { city: "Jakarta" }],
    ["CBD area", { cbdArea: null }],
    ["sub-district", { subDistrict: "Cipondoh" }],
    ["address", { address: "Live Address" }],
    ["operational status", { operationalStatus: "inactive" }],
    ["data source", { dataSource: "erp" }],
  ] satisfies [string, Partial<NormalizedCurrentBuilding>][]) (
    "rejects a stale %s before snapshot",
    (_label, liveOverride) => {
      expect(() => assertBuildingChangePublishable(
        modified(),
        current(liveOverride),
      )).toThrowError(expect.objectContaining({ key: "IMPORT_CHANGE_STALE" }));
    },
  );

  test("accepts each correctly labeled discriminator", () => {
    const before = current();
    expect(() => assertBuildingChangePublishable({
      type: "added",
      entityKey: "B-NEW",
      before: null,
      after: building({ irisBuildingId: "B-NEW" }),
    }, null)).not.toThrow();
    expect(() => assertBuildingChangePublishable({
      type: "unchanged",
      entityKey: before.irisBuildingId,
      before,
      after: building(),
    }, before)).not.toThrow();
    expect(() => assertBuildingChangePublishable(modified(before), before)).not.toThrow();
    expect(() => assertBuildingChangePublishable({
      type: "deactivated",
      entityKey: before.irisBuildingId,
      before,
      after: building({ operationalStatus: "inactive" }),
    }, before)).not.toThrow();
  });

  test("rejects added when the IRIS identity already exists", () => {
    expect(() => assertBuildingChangePublishable({
      type: "added",
      entityKey: "B003004",
      before: null,
      after: building(),
    }, current())).toThrowError(expect.objectContaining({
      key: "IMPORT_CHANGE_STALE",
    }));
  });

  test("rejects unchanged when before and after differ", () => {
    const before = current();
    expect(() => assertBuildingChangePublishable({
      type: "unchanged",
      entityKey: before.irisBuildingId,
      before,
      after: building({ city: "Jakarta" }),
    }, before)).toThrowError(expect.objectContaining({
      key: "IMPORT_CHANGE_TYPE_INVALID",
    }));
  });

  test("rejects deactivated without an active-to-inactive transition", () => {
    const before = current({ operationalStatus: "inactive" });
    expect(() => assertBuildingChangePublishable({
      type: "deactivated",
      entityKey: before.irisBuildingId,
      before,
      after: building({ operationalStatus: "inactive", buildingName: "Changed" }),
    }, before)).toThrowError(expect.objectContaining({
      key: "IMPORT_CHANGE_TYPE_INVALID",
    }));
  });

  test.each([
    ["equal payloads", building()],
    ["active-to-inactive transition", building({ operationalStatus: "inactive" })],
  ])("rejects modified for %s", (_label, after) => {
    const before = current();
    expect(() => assertBuildingChangePublishable({
      type: "modified",
      entityKey: before.irisBuildingId,
      before,
      after,
    }, before)).toThrowError(expect.objectContaining({
      key: "IMPORT_CHANGE_TYPE_INVALID",
    }));
  });
});
