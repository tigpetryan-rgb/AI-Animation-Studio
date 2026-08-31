import { expect, test, type Page } from "@playwright/test";

async function enableControlledAndroidRuntime(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { AIStudioRuntime?: unknown }).AIStudioRuntime = {
      info: { platform: "android", model: "Automated Android Runtime" },
    };
    window.dispatchEvent(new CustomEvent("aistudio:runtime-ready"));
  });
  await expect(page.locator("html")).toHaveClass(/runtime-simple-ui/);
  await expect(page.locator("[data-runtime-chat-shell]")).toBeVisible();
}

test("chat submission starts the internal production runtime and never silently waits", async ({ page }) => {
  await page.goto("/");
  await enableControlledAndroidRuntime(page);
  await page.locator("[data-runtime-file-input]").setInputFiles({
    name: "character-reference.png",
    mimeType: "image/png",
    buffer: Buffer.from("character-reference-binary"),
  });
  await page.getByLabel("Message", { exact: true }).fill("Create a ten second character scene and export MP4");
  await page.getByLabel("Send message").click();

  const status = page.locator("[data-runtime-production-status]");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("data-status", "WAITING_VALIDATION");
  await expect(page.locator("[data-runtime-production-stage]")).toContainText("PLANNED");
  await expect(page.locator("[data-runtime-production-steps]")).toContainText(/Reference|Референс|Reference մեդիա/);
  await expect(page.locator("[data-runtime-production-message]")).not.toHaveText("");
  await expect(page.locator("[data-runtime-generation-status]")).toHaveCount(0);

  const persisted = await page.evaluate(() => localStorage.getItem("aistudio.runtime.production-intake.v1"));
  expect(persisted).not.toBeNull();
  expect(persisted).toContain("character");
  expect(persisted).toContain("WAITING_VALIDATION");
});

test("runtime shell follows a reduced visual viewport so the composer stays above a soft keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await enableControlledAndroidRuntime(page);

  await page.evaluate(() => {
    const viewport = (window as unknown as { AIStudioKeyboardViewport?: { apply: (height: number, offsetTop?: number) => void } }).AIStudioKeyboardViewport;
    if (viewport === undefined) throw new Error("Keyboard viewport bridge is unavailable.");
    viewport.apply(420, 0);
  });

  const shellBox = await page.locator("[data-runtime-chat-shell]").boundingBox();
  const composerBox = await page.locator("[data-runtime-composer]").boundingBox();
  expect(shellBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(Math.round(shellBox?.height ?? 0)).toBe(420);
  expect((composerBox?.y ?? 9999) + (composerBox?.height ?? 0)).toBeLessThanOrEqual(420);
});
