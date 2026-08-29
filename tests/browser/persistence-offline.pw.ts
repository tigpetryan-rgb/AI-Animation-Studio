import { expect, test } from "@playwright/test";

test("canonical StudioProject survives reload and offline reload", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) throw new Error("Service Worker unavailable in browser test.");
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Run persistence stress" }).click();
  const persisted = page.locator('[data-persistence-summary="PERSISTED"]');
  await expect(persisted).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-persistence-project-id="project_m26_persistence_stress"]')).toBeVisible();
  await expect(page.locator('[data-persistence-check-id="opfs-digest"] strong')).toHaveText("PASS");
  await expect(page.locator('[data-persistence-check-id="canonical-deserialize"] strong')).toHaveText("PASS");
  await expect(page.locator('[data-persistence-check-id="idb-commit-pointer"] strong')).toHaveText("PASS");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Verify persisted project" }).click();
  await expect(page.locator('[data-persistence-summary="VERIFIED"]')).toBeVisible({ timeout: 15_000 });

  // Playwright's context offline mode controls actual network transport. navigator.onLine is
  // intentionally not used as evidence because Chromium can keep that advisory hint set to true.
  await context.setOffline(true);
  try {
    const networkBlocked = await page.evaluate(async () => {
      try {
        await fetch(`/__m26_network_probe__?nonce=${Date.now()}`, { cache: "no-store" });
        return false;
      } catch {
        return true;
      }
    });
    expect(networkBlocked).toBe(true);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("AI Animation Studio", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Verify persisted project" }).click();
    const offlineVerified = page.locator('[data-persistence-summary="VERIFIED"]');
    await expect(offlineVerified).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-persistence-project-id="project_m26_persistence_stress"]')).toBeVisible();
    await expect(page.locator('[data-persistence-check-id="opfs-digest"] strong')).toHaveText("PASS");
    await expect(page.locator('[data-persistence-check-id="canonical-deserialize"] strong')).toHaveText("PASS");
    await expect(page.locator('[data-persistence-check-id="idb-commit-pointer"] strong')).toHaveText("PASS");
  } finally {
    await context.setOffline(false);
  }
});
