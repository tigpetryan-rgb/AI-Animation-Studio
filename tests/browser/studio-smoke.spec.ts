import { expect, test } from "@playwright/test";

async function waitForServiceWorkerControl(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
    });
  });
}

test("Studio boots and accepts real UI interactions", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("AI Animation Studio");
  await expect(page.getByText("AI Animation Studio", { exact: true })).toBeVisible();
  await expect(page.getByText("Production viewport")).toBeVisible();

  await page.getByRole("button", { name: "QC", exact: true }).click();
  await expect(page.locator(".eyebrow")).toHaveText("QC");

  await page.getByRole("button", { name: "Open local demo" }).click();
  await expect(page.getByText("local-demo-project", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Project open" })).toBeDisabled();
});

test("Chromium executes Service Worker and OPFS read/write", async ({ page }) => {
  await page.goto("/");

  const runtime = await page.evaluate(() => ({
    secureContext: window.isSecureContext,
    serviceWorker: "serviceWorker" in navigator,
    opfs: typeof navigator.storage?.getDirectory === "function",
    indexedDb: "indexedDB" in window,
  }));

  expect(runtime.secureContext).toBe(true);
  expect(runtime.serviceWorker).toBe(true);
  expect(runtime.opfs).toBe(true);
  expect(runtime.indexedDb).toBe(true);

  await waitForServiceWorkerControl(page);

  const opfsResult = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("aistudio-smoke.txt", { create: true });
    const writable = await handle.createWritable();
    await writable.write("opfs-ok");
    await writable.close();

    const text = await (await handle.getFile()).text();
    await root.removeEntry("aistudio-smoke.txt");
    return text;
  });

  expect(opfsResult).toBe("opfs-ok");
});

test("installed shell reloads while Chromium is offline", async ({ page, context }) => {
  await page.goto("/");
  await waitForServiceWorkerControl(page);

  // Reload once while controlled so versioned Vite assets are captured by the same-origin cache.
  await page.reload();
  await expect(page.getByText("Production viewport")).toBeVisible();

  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("AI Animation Studio");
    await expect(page.getByText("Production viewport")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
