import { defineConfig, devices } from "@playwright/test";

// Legacy browser compatibility matrix. Informational/non-production unless the canonical plan explicitly changes.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/studio-compatibility.pw.ts",
  timeout: 45_000,
  expect: { timeout: 15_000 },
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
    { name: "legacy-chromium-android-emulation", use: { ...devices["Pixel 7"] } },
    { name: "legacy-firefox-desktop", use: { ...devices["Desktop Firefox"] } },
    { name: "legacy-webkit-desktop", use: { ...devices["Desktop Safari"] } },
    { name: "legacy-webkit-ios-emulation", use: { ...devices["iPhone 13"] } },
  ],
});
