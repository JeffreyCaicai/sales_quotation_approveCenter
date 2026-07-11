import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";

import type { SessionUser } from "@/lib/auth/session";
import { processImport, type ImportProcessingRepository } from "@/lib/imports/process-import";
import type { BuildingDiffSnapshot } from "@/lib/imports/diff";
import type { BuildingValidationSnapshot } from "@/lib/imports/validate";

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

class Repository implements ImportProcessingRepository {
  state: "uploaded" | "validating" | "ready_to_publish" | "draft" | "validation_failed" = "uploaded";
  errors: unknown[] = [];
  changes: unknown[] = [];
  normalized: unknown = null;

  async claim() {
    if (this.state !== "uploaded") return { kind: "terminal" as const, state: this.state };
    this.state = "validating";
    return {
      kind: "claimed" as const,
      job: {
        id: "job-1", dataType: "building" as const, templateVersion: "TMN-IMPORT-2",
        files: [{ objectStorageKey: "key", originalFilename: "buildings.xlsx", checksum: "a".repeat(64) }],
      },
    };
  }
  async buildingSnapshot(): Promise<BuildingValidationSnapshot & BuildingDiffSnapshot> {
    return { buildings: [], controlledValues: { buildingTypes: ["Office"], gradeResources: ["Grade A"] } };
  }
  async rateCardSnapshot() { return { buildings: [], packages: [], versionCodes: [] }; }
  async completeBuilding(_jobId: string, normalized: unknown, changes: unknown[]) {
    this.normalized = normalized; this.changes = changes; this.state = "ready_to_publish";
  }
  async completeRateCard(_jobId: string, normalized: unknown) {
    this.normalized = normalized; this.state = "draft";
  }
  async fail(_jobId: string, errors: unknown[]) { this.errors = errors; this.state = "validation_failed"; }
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

  test("is retry-safe after a terminal processing transition", async () => {
    const repository = new Repository();
    repository.state = "ready_to_publish";
    const result = await processImport("job-1", actor, {
      repository,
      objectStore: { readImmutable: async () => { throw new Error("must not read"); } },
    });
    expect(result.state).toBe("ready_to_publish");
  });
});
