import { expect, test, type Page } from "@playwright/test";

const VALID_REFERENCE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFElEQVR4nGPkUbJggAEmBiSAwgEADy4AbIVoKpMAAAAASUVORK5CYII=",
  "base64",
);

async function enableControlledAndroidRuntime(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { AIStudioRuntime?: unknown }).AIStudioRuntime = {
      info: { platform: "android", model: "Automated Android Runtime" },
    };
    window.dispatchEvent(new CustomEvent("aistudio:runtime-ready"));
  });
  await expect(page.locator("html")).toHaveClass(/runtime-simple-ui/);
}

test("deterministic acting and camera executors preserve exact source identity", async ({ page }) => {
  await page.goto("/");
  await enableControlledAndroidRuntime(page);
  await page.locator("[data-runtime-file-input]").setInputFiles({
    name: "character-reference.png",
    mimeType: "image/png",
    buffer: VALID_REFERENCE_PNG,
  });
  await page.getByLabel("Message", { exact: true }).fill("ACTOR SPEAK Hello from Studio");
  await page.getByLabel("Send message").click();

  const status = page.locator("[data-runtime-production-status]");
  await expect(status).toHaveAttribute("data-status", "WAITING_VALIDATION");
  await expect(status).toHaveAttribute("data-camera-ready", "true");
  await expect(page.locator("[data-runtime-production-stage]")).toContainText("READY_FOR_RENDER");
  await expect(page.locator("[data-runtime-production-step]").nth(4)).toHaveAttribute("data-complete", "true");
  await expect(page.locator("[data-runtime-production-step]").nth(5)).toHaveAttribute("data-complete", "true");
  await expect(page.locator("[data-runtime-performance-plan]")).toContainText("GESTURE");
  await expect(page.locator("[data-runtime-performance-plan]")).toContainText("keyframe tracks");
  await expect(page.locator("[data-runtime-camera-plan]")).toContainText("frustum samples");

  const identity = await page.locator("[data-runtime-performance-plan]").getAttribute("data-source-commit");
  expect(identity).toMatch(/^[0-9a-f]{40}$/);
  await expect(page.locator("[data-runtime-camera-plan]")).toHaveAttribute("data-source-commit", identity ?? "");

  const persisted = await page.evaluate(() => ({
    production: localStorage.getItem("aistudio.runtime.production-intake.v1"),
    camera: localStorage.getItem("aistudio.runtime.camera-execution.v1"),
  }));
  const jobs = JSON.parse(persisted.production ?? "[]") as Array<{
    stage?: string;
    rig?: { sourceCommit?: string; binding?: string; skeleton?: { bones?: unknown[] } };
    acting?: { sourceCommit?: string; intents?: Array<{ type?: string }>; payloads?: Array<{ keyframes?: unknown[] }> };
  }>;
  const cameras = JSON.parse(persisted.camera ?? "[]") as Array<{
    sourceCommit?: string;
    runtimeStage?: string;
    artifact?: { keyframes?: unknown[]; visibilitySamples?: Array<{ visible?: boolean }>; continuity?: { exactReferenceIdentity?: boolean } };
  }>;
  expect(jobs[0]?.stage).toBe("PERFORMANCE_VALID");
  expect(jobs[0]?.rig?.sourceCommit).toBe(identity);
  expect(jobs[0]?.acting?.sourceCommit).toBe(identity);
  expect(jobs[0]?.rig?.binding).toBe("REFERENCE_APPEARANCE_TO_CANONICAL_CONTROL_RIG");
  expect(jobs[0]?.rig?.skeleton?.bones?.length).toBeGreaterThanOrEqual(20);
  expect(jobs[0]?.acting?.intents?.map((item) => item.type)).toEqual(["GESTURE"]);
  expect(jobs[0]?.acting?.payloads?.length).toBeGreaterThanOrEqual(3);
  expect(jobs[0]?.acting?.payloads?.every((payload) => (payload.keyframes?.length ?? 0) === 3)).toBe(true);
  expect(cameras[0]?.runtimeStage).toBe("READY_FOR_RENDER");
  expect(cameras[0]?.sourceCommit).toBe(identity);
  expect(cameras[0]?.artifact?.keyframes?.length).toBe(3);
  expect(cameras[0]?.artifact?.visibilitySamples?.every((sample) => sample.visible === true)).toBe(true);
  expect(cameras[0]?.artifact?.continuity?.exactReferenceIdentity).toBe(true);
});
