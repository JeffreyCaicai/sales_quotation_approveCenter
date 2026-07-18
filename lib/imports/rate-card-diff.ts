import type { StagedRateCardImport } from "@/lib/imports/template-v2";

export interface RateCardDiffSnapshot {
  versionId: string | null;
  buildingPrices: Map<string, string>;
  packagePrices: Map<string, string>;
  packageMemberships: Set<string>;
}

export type RateCardChangeValue =
  | { kind: "building_price"; irisBuildingId: string; priceIdr: string }
  | { kind: "package_price"; packageCode: string; priceIdr: string }
  | { kind: "package_membership"; packageCode: string; irisBuildingId: string };

export interface RateCardChange {
  entityKey: string;
  changeType: "added" | "modified" | "removed" | "unchanged";
  before: RateCardChangeValue | null;
  after: RateCardChangeValue | null;
}

function classifiedChange(
  entityKey: string,
  before: RateCardChangeValue | null,
  after: RateCardChangeValue | null,
): RateCardChange {
  const changeType = before === null
    ? "added"
    : after === null
      ? "removed"
      : JSON.stringify(before) === JSON.stringify(after)
        ? "unchanged"
        : "modified";
  return { entityKey, changeType, before, after };
}

export function calculateRateCardDiff(
  staged: StagedRateCardImport,
  snapshot: RateCardDiffSnapshot,
): RateCardChange[] {
  const current = new Map<string, RateCardChangeValue>();
  const candidate = new Map<string, RateCardChangeValue>();

  for (const [irisBuildingId, priceIdr] of snapshot.buildingPrices) {
    current.set(`building:${irisBuildingId}`, { kind: "building_price", irisBuildingId, priceIdr });
  }
  for (const [packageCode, priceIdr] of snapshot.packagePrices) {
    current.set(`package:${packageCode}`, { kind: "package_price", packageCode, priceIdr });
  }
  for (const identity of snapshot.packageMemberships) {
    const separator = identity.indexOf(":");
    const packageCode = identity.slice(0, separator);
    const irisBuildingId = identity.slice(separator + 1);
    current.set(`membership:${packageCode}:${irisBuildingId}`, {
      kind: "package_membership", packageCode, irisBuildingId,
    });
  }

  for (const row of staged.buildingPrices) {
    const irisBuildingId = row.irisBuildingId.trim();
    candidate.set(`building:${irisBuildingId}`, {
      kind: "building_price", irisBuildingId, priceIdr: row.priceIdr,
    });
  }
  for (const row of staged.packagePrices) {
    const packageCode = row.packageCode.trim();
    candidate.set(`package:${packageCode}`, {
      kind: "package_price", packageCode, priceIdr: row.priceIdr,
    });
  }
  for (const row of staged.packageMemberships) {
    const packageCode = row.packageCode.trim();
    const irisBuildingId = row.irisBuildingId.trim();
    candidate.set(`membership:${packageCode}:${irisBuildingId}`, {
      kind: "package_membership", packageCode, irisBuildingId,
    });
  }

  return [...new Set([...current.keys(), ...candidate.keys()])]
    .sort()
    .map((entityKey) => classifiedChange(
      entityKey,
      current.get(entityKey) ?? null,
      candidate.get(entityKey) ?? null,
    ));
}
