import { readFileSync } from "node:fs";
import { test, expect } from "vitest";

test("production runtime is Node standalone without Cloudflare bindings", () => {
  const nextConfig = readFileSync("next.config.ts", "utf8");
  const db = readFileSync("db/index.ts", "utf8");
  expect(nextConfig).toContain('output: "standalone"');
  expect(db).toContain("DATABASE_URL");
  expect(db).not.toContain("cloudflare:workers");
});
