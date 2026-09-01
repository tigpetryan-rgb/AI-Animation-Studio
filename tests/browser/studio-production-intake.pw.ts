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

const VALID_REFERENCE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFElEQVR4nGPkUbJggAEmBiSAwgEADy4AbIVoKpMAAAAASUVORK5CYII=",
  "base64",
);

test("chat validates the real reference, prepares deterministic scene blocking and advances to rehearsal", async ({ page }) => {
  await page.goto("/");
  await enableControlledAndroidRuntime(page);
  await page.locator("[data-runtime-file-input]").setInputFiles({
    name: "character-reference.png",
    mimeType: "image/png",
    buffer: VALID_REFERENCE_PNG,
  });
  await page.getByLabel("Message", { exact: true }).fill("Create a 10 second character scene at 1920x1080, 24 fps and export MP4");
  await page.getByLabel("Send message").click();

  const status = page.locator("[data-runtime-production-status]");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("data-status", "WAITING_VALIDATION");
  await expect(page.locator("[data-runtime-production-stage]")).toContainText("REHEARSED");
  await expect(page.locator("[data-runtime-production-step]").nth(3)).toHaveAttribute("data-complete", "true");
  await expect(page.locator("[data-runtime-production-plan]")).toContainText("4×3");
  await expect(page.locator("[data-runtime-production-plan]")).toContainText("1920×1080");
  await expect(page.locator("[data-runtime-production-plan]")).toContainText("24 fps");
  await expect(page.locator("[data-runtime-generation-status]")).toHaveCount(0);

  const persisted = await page.evaluate(() => localStorage.getItem("aistudio.runtime.production-intake.v1"));
  expect(persisted).not.toBeNull();
  const jobs = JSON.parse(persisted ?? "[]") as Array<{
    stage?: string;
    blocking?: { plan?: { placements?: unknown[]; paths?: unknown[] }; output?: { durationSeconds?: number } };
  }>;
  expect(jobs[0]?.stage).toBe("REHEARSED");
  expect(jobs[0]?.blocking?.plan?.placements).toHaveLength(1);
  expect(jobs[0]?.blocking?.plan?.paths).toHaveLength(1);
  expect(jobs[0]?.blocking?.output?.durationSeconds).toBe(10);
});

test("scene blocking fails closed instead of fabricating a character when no image reference is attached", async ({ page }) => {
  await page.goto("/");
  await enableControlledAndroidRuntime(page);
  await page.getByLabel("Message", { exact: true }).fill("Create a 10 second character scene");
  await page.getByLabel("Send message").click();

  const status = page.locator("[data-runtime-production-status]");
  await expect(status).toHaveAttribute("data-status", "BLOCKED");
  await expect(page.locator("[data-runtime-production-stage]")).toContainText("PLANNED");
  await expect(page.locator("[data-runtime-production-step]").nth(3)).toHaveAttribute("data-complete", "false");
  await expect(page.locator("[data-runtime-production-diagnostic]")).toContainText(/reference/i);
  await expect(page.locator("[data-runtime-production-plan]")).toHaveCount(0);
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
