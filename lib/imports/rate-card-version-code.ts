export function createRateCardVersionCode(
  publishedAt: Date,
  jobId: string,
): string {
  const timestamp = publishedAt
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
  const suffix = jobId.replace(/-/gu, "").slice(0, 8).toUpperCase();
  return `RC-${timestamp}-${suffix}`;
}
