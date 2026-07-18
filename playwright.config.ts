import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const uiOnly = process.env.PLAYWRIGHT_UI_ONLY === "1";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL, trace: "retain-on-failure" },
  webServer: uiOnly ? undefined : {
    command: "npm run start:e2e",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
