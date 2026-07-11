export type ErpLinkStatus = "manual_only" | "erp_linked";

export function normalizeExternalId(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length === 0 ? null : normalized;
}

export function deriveErpLinkStatus(
  erpBuildingId: string | null | undefined,
): ErpLinkStatus {
  return normalizeExternalId(erpBuildingId) === null
    ? "manual_only"
    : "erp_linked";
}
