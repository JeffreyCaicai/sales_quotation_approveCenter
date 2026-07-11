import { describe, expect, test } from "vitest";

import { StrictCalendarDateError, parseCalendarDateInJakarta } from "@/lib/imports/calendar-date";

describe("strict import calendar date", () => {
  test.each([
    ["2024-02-29", "2024-02-28T17:00:00.000Z"],
    ["2026-08-01", "2026-07-31T17:00:00.000Z"],
  ])("round-trips %s at Jakarta midnight", (value, iso) => {
    expect(parseCalendarDateInJakarta(value).toISOString()).toBe(iso);
  });

  test.each(["2026-02-30", "2025-02-29", "2026-13-01", "2026-00-01", "2026-01-00", "2026-1-01", " 2026-01-01 "])(
    "rejects impossible or noncanonical date %s",
    (value) => expect(() => parseCalendarDateInJakarta(value)).toThrow(StrictCalendarDateError),
  );
});
