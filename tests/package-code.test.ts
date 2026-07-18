import { expect, it } from "vitest";

import { createPackageCode } from "@/lib/imports/package-code";

it("generates a deterministic code from job and row", () => {
  expect(createPackageCode("12345678-abcd-4000-8000-123456789abc", 23))
    .toBe("PKG-12345678-0023");
});
