import { describe, expect, it } from "vitest";

import { createRateCardVersionCode } from "@/lib/imports/rate-card-version-code";

describe("createRateCardVersionCode", () => {
  it("combines UTC publication time with a stable job suffix", () => {
    expect(
      createRateCardVersionCode(
        new Date("2026-07-18T03:04:05.000Z"),
        "12345678-abcd-4000-8000-123456789abc",
      ),
    ).toBe("RC-20260718T030405Z-12345678");
  });
});
