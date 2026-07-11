export const permissions = [
  "data.import.customer_brand",
  "data.import.building",
  "data.import.package",
  "rate_card.upload",
  "rate_card.publish",
  "data.rollback",
  "data.audit.read",
  "data.file.download",
] as const;

export type Permission = (typeof permissions)[number];

export function hasPermission(
  owned: readonly string[],
  required: Permission,
): boolean {
  return owned.includes(required);
}
