import { describe, expect, test } from "vitest";

import { buildingPublicationDisposition, rethrowBuildingWriteError } from "@/lib/imports/publish";

describe("Building publication replay disposition", () => {
  test("treats an already-published job as an idempotent replay", () => {
    expect(buildingPublicationDisposition("published")).toBe("replay");
  });

  test("allows only a ready job to perform writes", () => {
    expect(buildingPublicationDisposition("ready_to_publish")).toBe("publish");
    expect(() => buildingPublicationDisposition("draft")).toThrowError(
      expect.objectContaining({ key: "IMPORT_JOB_NOT_READY", status: 409 }),
    );
  });

  test("keeps a refresh-safe stale job blocked until it is reprocessed", () => {
    expect(() => buildingPublicationDisposition("reprocess_required")).toThrowError(
      expect.objectContaining({ key: "IMPORT_CHANGE_STALE", status: 409 }),
    );
  });

  test.each([
    "buildings_iris_building_id_unique",
    "buildings_erp_building_id_unique",
  ])("maps a wrapped %s ownership conflict to a stale preview", (constraint) => {
    const error = Object.assign(new Error("Drizzle query failed"), {
      cause: { code: "23505", constraint },
    });

    expect(() => rethrowBuildingWriteError(error)).toThrowError(
      expect.objectContaining({ key: "IMPORT_CHANGE_STALE", status: 409 }),
    );
  });

  test("does not relabel an unrelated Building write failure", () => {
    const error = Object.assign(new Error("database unavailable"), { code: "08006" });
    expect(() => rethrowBuildingWriteError(error)).toThrow(error);
  });
});
