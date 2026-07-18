import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";

import type { SessionUser } from "@/lib/auth/session";
import { processImport, validateRateCardForProcessing, type ImportProcessingRepository, type RateCardProcessingSnapshot } from "@/lib/imports/process-import";
import type { PackageImport, RateCardImport } from "@/lib/imports/template-v2";
import type { BuildingDiffSnapshot } from "@/lib/imports/diff";
import type { PackageChange, PackageSnapshot } from "@/lib/imports/package-diff";
import type { BuildingValidationSnapshot, PackageValidationSnapshot } from "@/lib/imports/validate";
import { PROCESSING_STALE_AFTER_MS, assertPreliminaryDataType, processingClaimIsStale } from "@/lib/imports/processing-repository";

const actor: SessionUser = {
  id: "actor-1", email: "actor@example.test", displayName: "Actor", status: "active",
  permissions: ["data.import.building", "rate_card.upload"],
};

function workbook(sheets: Record<string, unknown[][]>): Uint8Array {
  const value = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(value, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return new Uint8Array(XLSX.write(value, { type: "buffer", bookType: "xlsx" }));
}

const buildingBody = workbook({
  Instructions: [["Template Version", "TMN-IMPORT-2"]],
  Data: [
    ["IRIS Building ID", "ERP Building ID", "Building Name", "Building Type", "Grade Resource", "Area", "City", "CBD Area", "Sub-District", "Address", "Operational Status", "Data Source"],
    ["B001", "", "Tower", "Office", "Grade A", "", "Jakarta", "", "", "Address", "active", "building_team"],
  ],
});

const packageBody = workbook({
  Instructions: [["Template Version", "TMN-IMPORT-2"]],
  "Sales Packages": [
    ["Package Code", "Package Name", "Operational Status"],
    ["PKG-A", "Regional A", "active"],
    ["", "Metro New", "inactive"],
  ],
});

const reusedPackageNameBody = workbook({
  Instructions: [["Template Version", "TMN-IMPORT-2"]],
  "Sales Packages": [
    ["Package Code", "Package Name", "Operational Status"],
    ["", "Regional A", "active"],
  ],
});

const rateCardBody = workbook({
  Instructions: [["English"], ["Bahasa Indonesia"]],
  Metadata: [["Template Version", "TMN-IMPORT-2"], ["Currency", "IDR"]],
  "Building Prices": [["IRIS Building ID", "Price IDR"], ["B001", "0"]],
  "Package Prices": [["Package Code", "Price IDR"], ["PKG-A", "250"]],
  "Package Membership": [["Package Code", "IRIS Building ID"], ["PKG-A", "B001"]],
});

class Repository implements ImportProcessingRepository {
  state: "uploaded" | "validating" | "ready_to_publish" | "draft" | "validation_failed" | "published" = "uploaded";
  errors: unknown[] = [];
  changes: unknown[] = [];
  normalized: unknown = null;
  retries = 0;
  templateVersion = "TMN-IMPORT-2";
  claimToken = "2026-07-12T00:00:00.000Z";
  unsupported = false;
  stale = false;
  dataType: "building" | "package" | "rate_card" = "building";
  packages: PackageSnapshot[] = [];
  rateCard: RateCardProcessingSnapshot = {
    buildings: [{ id: "building-1", irisBuildingId: "B001", erpBuildingId: null, status: "active" }],
    packages: [{ packageCode: "PKG-A", status: "active" }],
    versionId: "current-version",
    buildingPrices: new Map([["B001", "100"]]),
    packagePrices: new Map([["PKG-A", "250"]]),
    packageMemberships: new Set(["PKG-A:B001"]),
  };

  async claim() {
    if (this.unsupported) return { kind: "unsupported" as const, dataType: "customer_brand" as const };
    if (this.state !== "uploaded" && !(this.state === "validating" && this.stale)) return { kind: "terminal" as const, state: this.state };
    this.state = "validating";
    return {
      kind: "claimed" as const,
      job: {
        id: "job-1", dataType: this.dataType, templateVersion: this.templateVersion,
        claimToken: this.claimToken,
        files: [{ objectStorageKey: "key", originalFilename: "buildings.xlsx", checksum: "a".repeat(64) }],
      },
    };
  }
  async buildingSnapshot(): Promise<BuildingValidationSnapshot & BuildingDiffSnapshot> {
    return { buildings: [], controlledValues: { buildingTypes: ["Office"], gradeResources: ["Grade A"] } };
  }
  async loadRateCardSnapshot() { return this.rateCard; }
  async packageSnapshot(): Promise<PackageValidationSnapshot> { return { packages: this.packages }; }
  async completeBuilding(_jobId: string, _claimToken: string, normalized: unknown, changes: unknown[]) {
    this.normalized = normalized; this.changes = changes; this.state = "ready_to_publish";
  }
  async completeRateCard(_jobId: string, _claimToken: string, normalized: unknown, changes: unknown[]) {
    void _jobId; void _claimToken;
    this.normalized = normalized; this.changes = changes; this.state = "draft";
  }
  async completePackage(_jobId: string, _claimToken: string, normalized: PackageImport, changes: PackageChange[]) {
    void _jobId; void _claimToken;
    this.normalized = normalized; this.changes = changes; this.state = "ready_to_publish";
  }
  async fail(_jobId: string, _claimToken: string, errors: unknown[]) { this.errors = errors; this.state = "validation_failed"; }
  async retry(_jobId: string, _claimToken: string) {
    void _jobId; void _claimToken;
    this.retries += 1; this.state = "uploaded";
  }
}

describe("production import processing", () => {
  test("reads an immutable uploaded file and stages the complete building difference", async () => {
    const repository = new Repository();
    const result = await processImport("job-1", actor, {
      repository,
      objectStore: { readImmutable: async (key, checksum) => {
        expect([key, checksum]).toEqual(["key", "a".repeat(64)]);
        return buildingBody;
      } },
    });

    expect(result).toEqual({ jobId: "job-1", state: "ready_to_publish" });
    expect(repository.changes).toEqual([expect.objectContaining({ type: "added", entityKey: "B001" })]);
  });

  test("persists stable errors and no staged changes for a rejected full batch", async () => {
    const repository = new Repository();
    repository.buildingSnapshot = async () => ({ buildings: [], controlledValues: undefined });
    await expect(processImport("job-1", actor, {
      repository,
      objectStore: { readImmutable: async () => buildingBody },
    })).resolves.toEqual({ jobId: "job-1", state: "validation_failed" });
    expect(repository.errors).toEqual([expect.objectContaining({
      key: "import.error.building_controlled_values_unavailable",
    })]);
    expect(repository.changes).toEqual([]);
  });

  test("passes the canonical existing package snapshot into validation and stages package differences", async () => {
    const repository = new Repository();
    repository.dataType = "package";
    repository.packages = [{ packageCode: "PKG-A", packageName: "Regional A", status: "inactive" }];

    await expect(processImport("job-1", actor, {
      repository,
      objectStore: { readImmutable: async () => packageBody },
    })).resolves.toEqual({ jobId: "job-1", state: "ready_to_publish" });
    expect(repository.changes).toEqual([
      expect.objectContaining({ entityKey: "PKG-A", changeType: "modified" }),
      expect.objectContaining({ entityKey: "row:3", changeType: "added" }),
    ]);

    repository.state = "uploaded";
    repository.packages = [{ packageCode: "PKG-A", packageName: "Immutable Name", status: "inactive" }];
    await expect(processImport("job-1", actor, {
      repository,
      objectStore: { readImmutable: async () => packageBody },
    })).resolves.toEqual({ jobId: "job-1", state: "validation_failed" });
    expect(repository.errors).toContainEqual(expect.objectContaining({
      key: "import.error.package_name_immutable",
    }));
  });

  test("rejects a blank-code package that reuses an existing stable Package Name", async () => {
    const repository = new Repository();
    repository.dataType = "package";
    repository.packages = [{ packageCode: "PKG-A", packageName: "Regional A", status: "active" }];

    await expect(processImport("job-1", actor, {
      repository,
      objectStore: { readImmutable: async () => reusedPackageNameBody },
    })).resolves.toEqual({ jobId: "job-1", state: "validation_failed" });
    expect(repository.errors).toContainEqual(expect.objectContaining({
      key: "import.error.package_name_duplicate",
      params: { packageName: "regional a" },
    }));
  });

  test("is retry-safe after a terminal processing transition", async () => {
    const repository = new Repository();
    repository.state = "ready_to_publish";
    const result = await processImport("job-1", actor, {
      repository,
      objectStore: { readImmutable: async () => { throw new Error("must not read"); } },
    });
    expect(result.state).toBe("ready_to_publish");
  });

  test("probes a published terminal state without reading or mutating the job", async () => {
    const repository = new Repository();
    repository.state = "published";
    await expect(processImport("job-1", actor, {
      repository,
      objectStore: { readImmutable: async () => { throw new Error("must not read"); } },
    })).rejects.toMatchObject({ key: "IMPORT_JOB_NOT_PROCESSABLE", status: 409 });
    expect(repository.state).toBe("published");
  });

  test("rejects a persisted noncanonical template before reading immutable bytes", async () => {
    const repository = new Repository();
    repository.templateVersion = "TMN-IMPORT-1";
    let reads = 0;
    await expect(processImport("job-1", actor, {
      repository,
      objectStore: { readImmutable: async () => { reads += 1; return buildingBody; } },
    })).resolves.toEqual({ jobId: "job-1", state: "validation_failed" });
    expect(reads).toBe(0);
    expect(repository.errors).toEqual([expect.objectContaining({ key: "import.error.template_version" })]);
  });

  test("returns transient storage failures to uploaded so a retry can succeed", async () => {
    const repository = new Repository();
    let attempts = 0;
    const objectStore = { readImmutable: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary S3 outage");
      return buildingBody;
    } };
    await expect(processImport("job-1", actor, { repository, objectStore }))
      .resolves.toEqual({ jobId: "job-1", state: "uploaded" });
    expect(repository.retries).toBe(1);
    await expect(processImport("job-1", actor, { repository, objectStore }))
      .resolves.toEqual({ jobId: "job-1", state: "ready_to_publish" });
  });

  test("returns a safe not-implemented error without processing unsupported jobs", async () => {
    const repository = new Repository();
    repository.unsupported = true;
    await expect(processImport("job-1", actor, {
      repository,
      objectStore: { readImmutable: async () => { throw new Error("must not read"); } },
    })).rejects.toMatchObject({ key: "IMPORT_PROCESSOR_NOT_IMPLEMENTED", status: 501 });
    expect(repository.state).toBe("uploaded");
  });

  test("stages a full Current-based Rate Card difference preview as draft", async () => {
    const repository = new Repository();
    repository.dataType = "rate_card";
    repository.rateCard.buildingPrices.set("B-REMOVED", "99");

    await expect(processImport("job-1", actor, {
      repository,
      objectStore: { readImmutable: async () => rateCardBody },
    })).resolves.toEqual({ jobId: "job-1", state: "draft" });

    expect(repository.normalized).toEqual(expect.objectContaining({
      basedOnVersionId: "current-version",
      currency: "IDR",
      packageMemberships: [{ rowNumber: 2, packageCode: "PKG-A", irisBuildingId: "B001" }],
    }));
    expect(repository.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityKey: "building:B001", changeType: "modified" }),
      expect.objectContaining({ entityKey: "building:B-REMOVED", changeType: "removed" }),
      expect.objectContaining({ entityKey: "package:PKG-A", changeType: "unchanged" }),
      expect.objectContaining({ entityKey: "membership:PKG-A:B001", changeType: "unchanged" }),
    ]));
  });

  test("reclaims only claims older than the bounded stale interval", () => {
    const now = new Date("2026-07-12T12:00:00.000Z");
    expect(processingClaimIsStale(new Date(now.getTime() - PROCESSING_STALE_AFTER_MS), now)).toBe(true);
    expect(processingClaimIsStale(new Date(now.getTime() - PROCESSING_STALE_AFTER_MS + 1), now)).toBe(false);
  });

  test("reclaims a stale validating job left by a crashed worker", async () => {
    const repository = new Repository();
    repository.state = "validating";
    repository.stale = true;
    await expect(processImport("job-1", actor, {
      repository,
      objectStore: { readImmutable: async () => buildingBody },
    })).resolves.toEqual({ jobId: "job-1", state: "ready_to_publish" });
  });

  test("rejects empty, duplicate, invalid-reference, and cross-sheet-incomplete Rate Cards", () => {
    const base: RateCardImport = {
      templateVersion: "TMN-IMPORT-2", currency: "IDR",
      buildingPrices: [], packagePrices: [], packageMemberships: [],
    };
    const snapshot: RateCardProcessingSnapshot = {
      buildings: [
        { id: "b1", irisBuildingId: "B1", erpBuildingId: null, status: "active" },
        { id: "b2", irisBuildingId: "B2", erpBuildingId: null, status: "inactive" },
      ],
      packages: [
        { packageCode: "P1", status: "active" },
        { packageCode: "P2", status: "inactive" },
      ],
      versionId: null,
      buildingPrices: new Map(),
      packagePrices: new Map(),
      packageMemberships: new Set(),
    };
    expect(validateRateCardForProcessing(base, snapshot).map((error) => error.key)).toContain("import.error.rate_card_empty");
    expect(validateRateCardForProcessing({
      ...base,
      packagePrices: [{ rowNumber: 2, packageCode: "P1", priceIdr: "100" }],
    }, snapshot).map((error) => error.key)).toContain("import.error.package_price_missing_membership");
    expect(validateRateCardForProcessing({
      ...base,
      packageMemberships: [{ rowNumber: 2, packageCode: "P1", irisBuildingId: "B1" }],
    }, snapshot).map((error) => error.key)).toContain("import.error.package_membership_missing_price");
    expect(validateRateCardForProcessing({
      ...base,
      buildingPrices: [
        { rowNumber: 2, irisBuildingId: "B2", priceIdr: "0" },
        { rowNumber: 3, irisBuildingId: "MISSING", priceIdr: "10" },
        { rowNumber: 4, irisBuildingId: "B1", priceIdr: "20" },
        { rowNumber: 5, irisBuildingId: "B1", priceIdr: "30" },
      ],
      packagePrices: [{ rowNumber: 2, packageCode: "P2", priceIdr: "100" }],
      packageMemberships: [{ rowNumber: 2, packageCode: "P2", irisBuildingId: "B1" }],
    }, snapshot).map((error) => error.key)).toEqual(expect.arrayContaining([
      "import.error.building_inactive",
      "import.error.building_not_found",
      "import.error.rate_card_building_duplicate",
      "import.error.package_inactive",
    ]));
  });

  test.each(["-1", "1.0", "1e3", "+1", "1,000", " 1", "1 "])(
    "rejects non-canonical IDR integer text %j while accepting zero",
    (priceIdr) => {
      const snapshot: RateCardProcessingSnapshot = {
        buildings: [{ id: "b1", irisBuildingId: "B1", erpBuildingId: null, status: "active" }],
        packages: [], versionId: null,
        buildingPrices: new Map(), packagePrices: new Map(), packageMemberships: new Set(),
      };
      const input = (value: string): RateCardImport => ({
        templateVersion: "TMN-IMPORT-2", currency: "IDR",
        buildingPrices: [{ rowNumber: 2, irisBuildingId: "B1", priceIdr: value }],
        packagePrices: [], packageMemberships: [],
      });
      expect(validateRateCardForProcessing(input(priceIdr), snapshot))
        .toContainEqual(expect.objectContaining({ column: "Price IDR", key: "import.error.value_invalid" }));
      expect(validateRateCardForProcessing(input("0"), snapshot)).toEqual([]);
    },
  );

  test("rejects a locked job whose data type changed after preliminary authorization", () => {
    expect(() => assertPreliminaryDataType("building", "rate_card"))
      .toThrowError(expect.objectContaining({ key: "IMPORT_JOB_NOT_PROCESSABLE" }));
  });
});
