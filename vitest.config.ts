import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      ".worktrees/**",
      "exports/**",
      "test-results/**",
      "**/*.integration.test.ts",
      "tests/quotation.test.ts",
      "tests/localization.test.ts",
      "tests/rendered-html.test.mjs",
      "tests/smoke.spec.ts",
      "tests/admin-imports-smoke.spec.ts",
    ],
  },
});
