export function createPackageCode(jobId: string, rowNumber: number): string {
  const job = jobId.replace(/-/gu, "").slice(0, 8).toUpperCase();
  return `PKG-${job}-${String(rowNumber).padStart(4, "0")}`;
}
