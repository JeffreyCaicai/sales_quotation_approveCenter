import { describe, expect, test } from "vitest";

import type { PackageChange, PackageSnapshot } from "@/lib/imports/package-diff";
import { publicationLockIdentities } from "@/lib/imports/publication-locks";
import { PublicationError } from "@/lib/imports/publish";
import { assertPackageChangePublishable, assertPackageNamesAvailable, orderPackageChangesForLocking, rethrowPackageInsertError } from "@/lib/imports/publish-package";

const before: PackageSnapshot = {
  packageCode: "PKG-A",
  packageName: "Package A",
  status: "inactive",
};

function change(overrides: Partial<PackageChange> = {}): PackageChange {
  return {
    rowNumber: 2,
    entityKey: "PKG-A",
    changeType: "modified",
    before,
    after: { ...before, status: "active" },
    ...overrides,
  };
}

describe("Sales Package Master publication preflight", () => {
  test("uses deterministic package reference locks", () => {
    expect(publicationLockIdentities("package")).toEqual([
      "import-publish-building-references-v1",
      "import-publish-data-type-v1:package",
    ]);
    expect(orderPackageChangesForLocking([
      change({ entityKey: "PKG-Z", after: { ...before, packageCode: "PKG-Z" } }),
      change({ entityKey: "PKG-A" }),
    ]).map((item) => item.entityKey)).toEqual(["PKG-A", "PKG-Z"]);
  });

  test.each([
    ["code", { packageCode: "PKG-OTHER" }],
    ["name", { packageName: "Live Rename" }],
    ["status", { status: "active" }],
  ] satisfies [string, Partial<PackageSnapshot>][]) (
    "rejects a stale stored-before %s snapshot",
    (_label, override) => {
      expect(() => assertPackageChangePublishable(change(), { ...before, ...override }))
        .toThrowError(expect.objectContaining({ key: "IMPORT_CHANGE_STALE" }));
    },
  );

  test("accepts only correctly labeled stable-identity transitions", () => {
    expect(() => assertPackageChangePublishable(change(), before)).not.toThrow();
    expect(() => assertPackageChangePublishable(change({
      changeType: "deactivated",
      before: { ...before, status: "active" },
      after: { ...before, status: "inactive" },
    }), { ...before, status: "active" })).not.toThrow();
    expect(() => assertPackageChangePublishable(change({
      changeType: "unchanged",
      after: before,
    }), before)).not.toThrow();
    expect(() => assertPackageChangePublishable(change({
      entityKey: "row:5",
      rowNumber: 5,
      changeType: "added",
      before: null,
      after: { packageCode: null, packageName: "Generated", status: "active" },
    }), null)).not.toThrow();
  });

  test("rejects staged code/name mutation and reused added identities", () => {
    expect(() => assertPackageChangePublishable(change({
      after: { ...before, packageName: "Renamed", status: "active" },
    }), before)).toThrowError(expect.objectContaining({ key: "IMPORT_CHANGE_TYPE_INVALID" }));
    expect(() => assertPackageChangePublishable(change({
      changeType: "added",
      before: null,
      after: { packageCode: "PKG-A", packageName: "Package A", status: "active" },
    }), before)).toThrowError(expect.objectContaining({ key: "IMPORT_CHANGE_STALE" }));
  });

  test("rejects a new blank-code row that reuses an existing stable name", () => {
    const publish = () => assertPackageNamesAvailable([change({
      rowNumber: 5,
      entityKey: "row:5",
      changeType: "added",
      before: null,
      after: { packageCode: null, packageName: " package a ", status: "active" },
    })], [before]);
    expect(publish).toThrowError(expect.objectContaining({ key: "IMPORT_CHANGE_STALE" }));
    expect(publish).toThrowError(PublicationError);
  });

  test("maps only a package-code unique race to a stale publication error", () => {
    const collision = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "sales_packages_package_code_unique",
    });
    expect(() => rethrowPackageInsertError(collision)).toThrowError(expect.objectContaining({
      key: "IMPORT_CHANGE_STALE",
      status: 409,
    }));
    expect(() => rethrowPackageInsertError(collision)).toThrowError(PublicationError);

    const otherUnique = Object.assign(new Error("different unique constraint"), {
      code: "23505",
      constraint: "sales_packages_name_unique",
    });
    let otherUniqueCaught: unknown;
    try {
      rethrowPackageInsertError(otherUnique);
    } catch (error) {
      otherUniqueCaught = error;
    }
    expect(otherUniqueCaught).toBe(otherUnique);

    const databaseFailure = Object.assign(new Error("connection lost"), { code: "08006" });
    let databaseFailureCaught: unknown;
    try {
      rethrowPackageInsertError(databaseFailure);
    } catch (error) {
      databaseFailureCaught = error;
    }
    expect(databaseFailureCaught).toBe(databaseFailure);
  });
});
