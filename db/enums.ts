export const importDataTypes = [
  "customer_brand",
  "building",
  "package",
  "rate_card",
] as const;

export const importStates = [
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
] as const;
export const filePurposes = [
  "original",
  "validation_report",
  "difference_report",
] as const;

export type ImportDataType = (typeof importDataTypes)[number];
export type ImportState = (typeof importStates)[number];
export type ImportSourceType = (typeof importSourceTypes)[number];
