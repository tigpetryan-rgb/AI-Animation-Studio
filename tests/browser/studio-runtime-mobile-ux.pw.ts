import { expect, test, type Page } from "@playwright/test";

async function enableControlledAndroidRuntime(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { AIStudioRuntime?: unknown }).AIStudioRuntime = {
      info: {
        platform: "android",
        model: "Automated Android Runtime",
      },
    };
    window.dispatchEvent(new CustomEvent("aistudio:runtime-ready"));
  });
  await expect(page.locator("html")).toHaveClass(/runtime-simple-ui/);
}

test("mobile runtime locks scaling and follows the device locale", async ({ browser }) => {
  const context = await browser.newContext({ locale: "hy-AM" });
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await enableControlledAndroidRuntime(page);

  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /maximum-scale=1\.0/);
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /user-scalable=no/);
  await expect(page.locator("html")).toHaveAttribute("lang", "hy");
  await expect(page.getByText("Ի՞նչ եք ուզում ստեղծել", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Հաղորդագրություն", { exact: true })).toBeVisible();

  const launcher = await page.getByLabel("Բացել չատերի մենյուն", { exact: true }).boundingBox();
  expect(launcher).not.toBeNull();
  expect(launcher?.y ?? 0).toBeGreaterThanOrEqual(12);

  await context.close();
});

test("uploaded media gets a clear preview before and after chat submit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await enableControlledAndroidRuntime(page);

  await page.locator("[data-runtime-file-input]").setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: Buffer.from("synthetic-image"),
  });

  const pending = page.locator("[data-runtime-pending-item]");
  await expect(pending).toBeVisible();
  await expect(pending.locator("[data-runtime-rich-preview] img")).toHaveCount(1);
  await expect(pending.getByText(/Image ·/)).toBeVisible();

  await page.getByLabel("Message", { exact: true }).fill("Use this reference");
  await page.getByLabel("Send message", { exact: true }).click();

  const sentMedia = page.locator('[data-runtime-message="user"] [data-runtime-media-chip][data-runtime-richified="true"]');
  await expect(sentMedia).toBeVisible();
  await expect(sentMedia.locator("[data-runtime-rich-preview] img")).toHaveCount(1);
  await expect(sentMedia).toContainText("reference.png");
});
