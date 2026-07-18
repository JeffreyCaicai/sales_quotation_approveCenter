import type { StagedRateCardImport } from "@/lib/imports/template-v2";

export interface RateCardDiffSnapshot {
  versionId: string | null;
  buildingPrices: Map<string, string>;
  packagePrices: Map<string, string>;
  packageMemberships: Array<{ packageCode: string; irisBuildingId: string }>;
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

function internalKey(value: RateCardChangeValue): string {
  switch (value.kind) {
    case "building_price":
      return JSON.stringify([value.kind, value.irisBuildingId]);
    case "package_price":
      return JSON.stringify([value.kind, value.packageCode]);
    case "package_membership":
      return JSON.stringify([value.kind, value.packageCode, value.irisBuildingId]);
  }
}

function entityKey(value: RateCardChangeValue): string {
  switch (value.kind) {
    case "building_price":
      return `building:${encodeURIComponent(value.irisBuildingId)}`;
    case "package_price":
      return `package:${encodeURIComponent(value.packageCode)}`;
    case "package_membership":
      return `membership:${encodeURIComponent(value.packageCode)}:${encodeURIComponent(value.irisBuildingId)}`;
  }
}

function setValue(map: Map<string, RateCardChangeValue>, value: RateCardChangeValue): void {
  map.set(internalKey(value), value);
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
    setValue(current, { kind: "building_price", irisBuildingId, priceIdr });
  }
  for (const [packageCode, priceIdr] of snapshot.packagePrices) {
    setValue(current, { kind: "package_price", packageCode, priceIdr });
  }
  for (const membership of snapshot.packageMemberships) {
    setValue(current, {
      kind: "package_membership",
      packageCode: membership.packageCode,
      irisBuildingId: membership.irisBuildingId,
    });
  }

  for (const row of staged.buildingPrices) {
    const irisBuildingId = row.irisBuildingId.trim();
    setValue(candidate, {
      kind: "building_price", irisBuildingId, priceIdr: row.priceIdr,
    });
  }
  for (const row of staged.packagePrices) {
    const packageCode = row.packageCode.trim();
    setValue(candidate, {
      kind: "package_price", packageCode, priceIdr: row.priceIdr,
    });
  }
  for (const row of staged.packageMemberships) {
    const packageCode = row.packageCode.trim();
    const irisBuildingId = row.irisBuildingId.trim();
    setValue(candidate, {
      kind: "package_membership", packageCode, irisBuildingId,
    });
  }

  return [...new Set([...current.keys(), ...candidate.keys()])]
    .map((key) => {
      const before = current.get(key) ?? null;
      const after = candidate.get(key) ?? null;
      const value = before ?? after;
      if (!value) throw new Error("Rate Card difference key has no value");
      return classifiedChange(entityKey(value), before, after);
    })
    .sort((left, right) => left.entityKey < right.entityKey ? -1 : left.entityKey > right.entityKey ? 1 : 0);
}
