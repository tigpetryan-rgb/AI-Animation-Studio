import { expect, test } from "@playwright/test";

test("physical-device evidence rejects WebDriver automation", async ({ page }) => {
  await page.goto("/");

  const panel = page.locator("[data-physical-device-evidence-panel]");
  await expect(panel).toBeVisible();
  await expect(page.locator("[data-physical-result]")).toContainText(
    "WebDriver detected: this session cannot generate physical-device evidence.",
  );

  await page.locator("[data-physical-confirm]").check();
  await page.locator("[data-physical-platform]").fill("Android");
  await page.locator("[data-physical-model]").fill("Automation must not count");
  await page.locator("[data-physical-os-version]").fill("test");
  await page.locator("[data-physical-browser]").fill("Chromium");
  await page.locator("[data-physical-browser-version]").fill("Playwright");

  const download = page.waitForEvent("download", { timeout: 750 }).then(() => true).catch(() => false);
  await page.locator("[data-physical-generate-report]").click();

  await expect(page.locator("[data-physical-result]")).toContainText(
    "Automated/WebDriver sessions are rejected as physical-device evidence.",
  );
  await expect(download).resolves.toBe(false);
});
