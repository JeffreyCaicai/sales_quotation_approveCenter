import {
  sortImportValidationErrors,
  type ImportValidationError,
} from "@/lib/imports/errors";
import type { RateCardImport } from "@/lib/imports/template-v2";
import {
  validateRateCardBuildings,
  type BuildingValidationSnapshot,
} from "@/lib/imports/validate";

export interface ResolvedRateCardBuildingReferences {
  buildingPrices: Array<{
    rowNumber: number;
    buildingId: string;
    priceIdr: string;
  }>;
  packageMemberships: Array<{
    rowNumber: number;
    packageCode: string;
    buildingId: string;
  }>;
}

export class RateCardBuildingResolutionError extends Error {
  constructor(public readonly errors: ImportValidationError[]) {
    super("RATE_CARD_BUILDING_REFERENCE_INVALID");
    this.name = "RateCardBuildingResolutionError";
  }
}

/**
 * Publication-boundary resolver for a future Rate Card publisher. It converts
 * parsed business identifiers to immutable database references only after all
 * building references have passed active/missing and duplicate validation.
 */
export function resolveRateCardBuildingReferences(
  input: Pick<RateCardImport, "buildingPrices" | "packageMemberships">,
  snapshot: BuildingValidationSnapshot,
): ResolvedRateCardBuildingReferences {
  const errors = [
    ...validateRateCardBuildings(input, snapshot),
    ...duplicateErrors(input),
  ];
  if (errors.length > 0) {
    throw new RateCardBuildingResolutionError(
      sortImportValidationErrors(errors),
    );
  }

  const activeIdByIrisId = new Map(
    snapshot.buildings
      .filter((building) => building.status === "active")
      .map((building) => [building.irisBuildingId.trim(), building.id]),
  );
  return {
    buildingPrices: input.buildingPrices.map((row) => ({
      rowNumber: row.rowNumber,
      buildingId: activeIdByIrisId.get(row.irisBuildingId.trim())!,
      priceIdr: row.priceIdr,
    })),
    packageMemberships: input.packageMemberships.map((row) => ({
      rowNumber: row.rowNumber,
      packageCode: row.packageCode,
      buildingId: activeIdByIrisId.get(row.irisBuildingId.trim())!,
    })),
  };
}

function duplicateErrors(
  input: Pick<RateCardImport, "buildingPrices" | "packageMemberships">,
): ImportValidationError[] {
  const errors: ImportValidationError[] = [];
  const priceCounts = countBy(input.buildingPrices, (row) =>
    row.irisBuildingId.trim());
  for (const row of input.buildingPrices) {
    const irisBuildingId = row.irisBuildingId.trim();
    if ((priceCounts.get(irisBuildingId) ?? 0) > 1) {
      errors.push({
        sheet: "Building Prices",
        rowNumber: row.rowNumber,
        column: "IRIS Building ID",
        key: "import.error.rate_card_building_duplicate",
        params: { irisBuildingId },
      });
    }
  }

  const membershipCounts = countBy(input.packageMemberships, (row) =>
    `${row.packageCode}\0${row.irisBuildingId.trim()}`);
  for (const row of input.packageMemberships) {
    const irisBuildingId = row.irisBuildingId.trim();
    if ((membershipCounts.get(`${row.packageCode}\0${irisBuildingId}`) ?? 0) > 1) {
      errors.push({
        sheet: "Package Membership",
        rowNumber: row.rowNumber,
        column: "IRIS Building ID",
        key: "import.error.rate_card_membership_duplicate",
        params: { irisBuildingId, packageCode: row.packageCode },
      });
    }
  }
  return errors;
}

function countBy<T>(items: readonly T[], keyFor: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFor(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
