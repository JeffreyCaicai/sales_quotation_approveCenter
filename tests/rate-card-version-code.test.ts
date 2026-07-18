import { describe, expect, it } from "vitest";

import { createRateCardVersionCode } from "@/lib/imports/rate-card-version-code";

describe("createRateCardVersionCode", () => {
  it("combines UTC publication time with a stable job suffix", () => {
    expect(
      createRateCardVersionCode(
        new Date("2026-07-18T03:04:05.000Z"),
        "12345678-abcd-4000-8000-123456789abc",
      ),
    ).toBe("RC-20260718T030405Z-12345678ABCD40008000123456789ABC");
  });

  it("cannot collide for jobs that share the same leading UUID segment", () => {
    const publishedAt = new Date("2026-07-18T03:04:05.000Z");
    expect(createRateCardVersionCode(
      publishedAt,
      "12345678-abcd-4000-8000-123456789abc",
    )).not.toBe(createRateCardVersionCode(
      publishedAt,
      "12345678-dcba-4000-8000-cba987654321",
    ));
  });
});
