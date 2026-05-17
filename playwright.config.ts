import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  reporter: "list",
  use: { baseURL: "http://localhost:3001", trace: "on-first-retry" },
  webServer: {
    command: "bun tests/e2e/server.ts",
    url: "http://localhost:3001/api/v1/health",
    timeout: 15_000,
    reuseExistingServer: !process.env.CI,
  },
});
