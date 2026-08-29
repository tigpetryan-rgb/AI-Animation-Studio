import { expect, test } from "@playwright/test";

test("Studio runs a real browser performance benchmark without hard speed thresholds", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Run performance benchmark" }).click();

  const summary = page.locator("[data-performance-summary]");
  await expect(summary).toBeVisible({ timeout: 30_000 });
  const value = await summary.getAttribute("data-performance-summary");
  expect(["COMPLETE", "PARTIAL"]).toContain(value);

  await expect(page.locator('[data-benchmark-id="frame-pacing"] strong')).toHaveText("PASS");
  await expect(page.locator('[data-benchmark-id="opfs-throughput"] strong')).toHaveText("PASS");
  await expect(page.locator('[data-benchmark-id="cpu-baseline"] strong')).toHaveText("PASS");

  const webGpuStatus = await page.locator('[data-benchmark-id="webgpu-compute"] strong').textContent();
  expect(["PASS", "UNAVAILABLE"]).toContain(webGpuStatus);

  const codecStatus = await page.locator('[data-benchmark-id="webcodecs-query"] strong').textContent();
  expect(["PASS", "UNAVAILABLE"]).toContain(codecStatus);

  await expect(page.getByRole("button", { name: "Download performance report" })).toBeVisible();
});
