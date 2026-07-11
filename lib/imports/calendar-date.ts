export class StrictCalendarDateError extends Error {
  readonly key = "import.error.value_invalid";

  constructor(public readonly value: unknown) {
    super("import.error.value_invalid");
    this.name = "StrictCalendarDateError";
  }
}

export function parseCalendarDateInJakarta(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new StrictCalendarDateError(value);
  }
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
    || `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` !== value
  ) {
    throw new StrictCalendarDateError(value);
  }
  return new Date(`${value}T00:00:00+07:00`);
}
