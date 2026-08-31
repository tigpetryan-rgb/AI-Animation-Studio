import { expect, test, type Page } from "@playwright/test";

const VALID_REFERENCE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFElEQVR4nGPkUbJggAEmBiSAwgEADy4AbIVoKpMAAAAASUVORK5CYII=",
  "base64",
);

async function enableNativeCaptureRuntime(page: Page): Promise<void> {
  await page.evaluate(() => {
    let bytesWritten = 0;
    const prefix: number[] = [];
    let inspectionCalls = 0;
    const decode = (base64: string): Uint8Array => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes;
    };
    (window as unknown as { __productionNativeCapture?: unknown }).__productionNativeCapture = {
      snapshot: () => ({ bytesWritten, prefix: [...prefix], inspectionCalls }),
    };
    (window as unknown as { StudioRuntimeAndroid?: unknown }).StudioRuntimeAndroid = {
      getRuntimeInfoJson: () => "{}",
      beginFileWrite: () => JSON.stringify({ ok: true, sessionId: "production-session" }),
      appendFileChunk: (_sessionId: string, base64Chunk: string) => {
        const bytes = decode(base64Chunk);
        bytesWritten += bytes.byteLength;
        for (let index = 0; index < bytes.length && prefix.length < 16; index += 1) prefix.push(bytes[index] ?? 0);
        return JSON.stringify({ ok: true });
      },
      finishFileWrite: () => JSON.stringify({
        ok: true,
        uri: "content://aistudio/production.mp4",
        bytesWritten,
        sha256: "a".repeat(64),
      }),
      abortFileWrite: () => JSON.stringify({ ok: true }),
      inspectSavedMp4: () => JSON.stringify({ ok: true }),
    };
    (window as unknown as { AIStudioRuntime?: unknown }).AIStudioRuntime = {
      info: { platform: "android", model: "Automated Android Runtime" },
      inspectSavedMp4: () => {
        inspectionCalls += 1;
        return {
          videoTrackPresent: true,
          audioTrackPresent: true,
          durationMs: 2000,
          width: 320,
          height: 240,
          firstVideoFrameDecoded: true,
          deterministicPlaybackVerified: true,
          note: "Automated native MP4 inspection passed.",
        };
      },
    };
    window.dispatchEvent(new CustomEvent("aistudio:runtime-ready"));
  });
  await expect(page.locator("html")).toHaveClass(/runtime-simple-ui/);
}

test("READY_FOR_RENDER produces temporally distinct source-bound frames and a native-verified H.264 Opus MP4", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await enableNativeCaptureRuntime(page);
  await page.locator("[data-runtime-file-input]").setInputFiles({
    name: "character-reference.png",
    mimeType: "image/png",
    buffer: VALID_REFERENCE_PNG,
  });
  await page.getByLabel("Message", { exact: true }).fill("ACTOR SPEAK Hello 2 seconds 320x240 12 fps");
  await page.getByLabel("Send message").click();

  const status = page.locator("[data-runtime-production-status]");
  await expect(status).toHaveAttribute("data-camera-ready", "true");
  await expect(status).toHaveAttribute("data-render-ready", "true");
  await expect(page.locator("[data-runtime-production-stage]")).toContainText("READY_FOR_RENDER");
  await expect(page.locator("[data-runtime-production-step]").nth(6)).toHaveAttribute("data-complete", "true");
  await expect(page.locator("[data-runtime-render-plan]")).toContainText("distinct checksums");

  const renderStateBefore = await page.evaluate(() => localStorage.getItem("aistudio.runtime.production-render.v1"));
  const before = JSON.parse(renderStateBefore ?? "[]") as Array<{
    sourceCommit?: string;
    status?: string;
    artifact?: { temporalEvidence?: Array<{ checksum?: string; sourceCoveragePixels?: number }> };
  }>;
  const evidence = before[0]?.artifact?.temporalEvidence ?? [];
  expect(before[0]?.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(before[0]?.status).toBe("RENDER_READY");
  expect(evidence).toHaveLength(3);
  expect(new Set(evidence.map((item) => item.checksum)).size).toBeGreaterThan(1);
  expect(evidence.every((item) => (item.sourceCoveragePixels ?? 0) > 0)).toBe(true);

  await page.locator("[data-runtime-production-export]").click();
  await expect(status).toHaveAttribute("data-mp4-ready", "true", { timeout: 75_000 });
  await expect(page.locator("[data-runtime-production-step]").nth(7)).toHaveAttribute("data-complete", "true");
  await expect(page.locator("[data-runtime-production-message]")).toContainText("native MP4 verification PASS");

  const result = await page.evaluate(() => {
    const raw = localStorage.getItem("aistudio.runtime.production-render.v1");
    const capture = (window as unknown as { __productionNativeCapture?: { snapshot: () => { bytesWritten: number; prefix: number[]; inspectionCalls: number } } }).__productionNativeCapture;
    return { raw, capture: capture?.snapshot() ?? null };
  });
  const records = JSON.parse(result.raw ?? "[]") as Array<{
    status?: string;
    mp4?: {
      mimeType?: string;
      videoCodec?: string;
      audioCodec?: string;
      bytesWritten?: number;
      encodedVideoChunks?: number;
      encodedAudioChunks?: number;
      nativeSha256?: string | null;
      nativeVerified?: boolean | null;
    };
  }>;
  expect(records[0]?.status).toBe("MP4_READY");
  expect(records[0]?.mp4?.mimeType).toContain("video/mp4");
  expect(records[0]?.mp4?.videoCodec).toContain("avc1");
  expect(records[0]?.mp4?.audioCodec?.toLowerCase()).toContain("opus");
  expect(records[0]?.mp4?.encodedVideoChunks).toBeGreaterThan(0);
  expect(records[0]?.mp4?.encodedAudioChunks).toBeGreaterThan(0);
  expect(records[0]?.mp4?.nativeSha256).toBe("a".repeat(64));
  expect(records[0]?.mp4?.nativeVerified).toBe(true);
  expect(result.capture?.bytesWritten).toBeGreaterThan(0);
  expect(result.capture?.inspectionCalls).toBe(1);
  expect(String.fromCharCode(...(result.capture?.prefix.slice(4, 8) ?? []))).toBe("ftyp");
});
