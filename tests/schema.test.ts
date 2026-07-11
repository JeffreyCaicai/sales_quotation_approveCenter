import { describe, expect, test } from "vitest";
import * as schema from "@/db/schema";
import {
  deriveErpLinkStatus,
  normalizeExternalId,
} from "@/lib/buildings/identity";

describe("stage 2 schema", () => {
  test.each([
    "users",
    "userPermissions",
    "customers",
    "brands",
    "salesAssignments",
    "buildings",
    "salesPackages",
    "rateCardVersions",
    "rateCardBuildingPrices",
    "rateCardPackageConfigs",
    "rateCardPackageBuildings",
    "importJobs",
    "importFiles",
    "importErrors",
    "importChanges",
    "auditEvents",
  ])("exports %s", (name) => expect(schema).toHaveProperty(name));
});

describe("building identity schema", () => {
  test("exports the IRIS and ERP identity fields", () => {
    expect(schema.buildings).toHaveProperty("irisBuildingId");
    expect(schema.buildings).toHaveProperty("erpBuildingId");
    expect(schema.buildings).toHaveProperty("erpLinkStatus");
    expect(schema.buildings).toHaveProperty("buildingType");
    expect(schema.buildings).toHaveProperty("gradeResource");
    expect(schema.buildings).toHaveProperty("city");
    expect(schema.buildings).toHaveProperty("cbdArea");
    expect(schema.buildings).toHaveProperty("subDistrict");
    expect(schema.buildings).toHaveProperty("address");
    expect(schema.buildings).toHaveProperty("dataSource");
  });

  test.each([null, undefined, "", "   "])(
    "derives a manual-only link for a blank ERP ID (%s)",
    (erpBuildingId) => {
      expect(normalizeExternalId(erpBuildingId)).toBeNull();
      expect(deriveErpLinkStatus(erpBuildingId)).toBe("manual_only");
    },
  );

  test("derives an ERP link for a nonblank normalized ERP ID", () => {
    expect(normalizeExternalId("  ERP-01  ")).toBe("ERP-01");
    expect(deriveErpLinkStatus("  ERP-01  ")).toBe("erp_linked");
  });
});
