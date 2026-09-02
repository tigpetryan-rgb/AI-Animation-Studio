import { defineConfig, devices } from "@playwright/test";

// Legacy browser compatibility configuration. This is not a production release gate.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.pw.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run legacy:web:preview",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "legacy-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
