export type PublicationDataType = "building" | "package" | "rate_card";

const BUILDING_REFERENCE_LOCK = "import-publish-building-references-v1";
const TYPE_LOCK_PREFIX = "import-publish-data-type-v1";

export function publicationLockIdentities(dataType: PublicationDataType): readonly [string, string] {
  return [BUILDING_REFERENCE_LOCK, `${TYPE_LOCK_PREFIX}:${dataType}`];
}
