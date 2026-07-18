export const importDataTypes = [
  "customer_brand",
  "building",
  "package",
  "rate_card",
] as const;

export const importStates = [
  "uploading",
  "uploaded",
  "validating",
  "validation_failed",
  "ready_to_publish",
  "draft",
  "published",
  "active",
  "superseded",
  "rolled_back",
] as const;

export const importSourceTypes = ["manual", "crm"] as const;

export const entityStatuses = ["active", "inactive"] as const;
export const changeTypes = [
  "added",
  "modified",
  "deactivated",
  "unchanged",
  "removed",
] as const;
export const rateCardVersionStatuses = ["current", "historical"] as const;
export const filePurposes = [
  "original",
  "validation_report",
  "difference_report",
] as const;

export type ImportDataType = (typeof importDataTypes)[number];
export type ImportState = (typeof importStates)[number];
export type ImportSourceType = (typeof importSourceTypes)[number];
export type RateCardVersionStatus = (typeof rateCardVersionStatuses)[number];
