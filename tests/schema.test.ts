import { describe, expect, test } from "vitest";
import * as schema from "@/db/schema";

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
