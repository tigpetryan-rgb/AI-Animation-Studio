import { expect, test } from "@playwright/test";

test("controlled Android Runtime streams the real MP4 export through the native bridge", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");

  await page.evaluate(() => {
    const capture = {
      beginRequest: null as null | { fileName?: string; mimeType?: string },
      bytesWritten: 0,
      appendCalls: 0,
      maxBase64ChunkChars: 0,
      finishCalls: 0,
      abortCalls: 0,
      inspectionCalls: 0,
      finalized: null as unknown,
    };

    window.StudioRuntimeAndroid = {
      getRuntimeInfoJson() {
        return JSON.stringify({ ok: false, message: "Synthetic browser bridge; identity install is intentionally bypassed." });
      },
      beginFileWrite(requestJson: string) {
        capture.beginRequest = JSON.parse(requestJson) as { fileName?: string; mimeType?: string };
        return JSON.stringify({ ok: true, sessionId: "browser-native-export", uri: "content://aistudio/pending" });
      },
      appendFileChunk(sessionId: string, base64Chunk: string) {
        if (sessionId !== "browser-native-export") return JSON.stringify({ ok: false, message: "wrong session" });
        capture.appendCalls += 1;
        capture.maxBase64ChunkChars = Math.max(capture.maxBase64ChunkChars, base64Chunk.length);
        capture.bytesWritten += atob(base64Chunk).length;
        return JSON.stringify({ ok: true, bytesWritten: capture.bytesWritten });
      },
      finishFileWrite(sessionId: string) {
        if (sessionId !== "browser-native-export") return JSON.stringify({ ok: false, message: "wrong session" });
        capture.finishCalls += 1;
        return JSON.stringify({
          ok: true,
          uri: "content://aistudio/export/local-demo-project-timeline.mp4",
          bytesWritten: capture.bytesWritten,
          sha256: "a".repeat(64),
        });
      },
      abortFileWrite() {
        capture.abortCalls += 1;
        return JSON.stringify({ ok: true });
      },
      inspectSavedMp4() {
        return JSON.stringify({ ok: false, message: "Client inspection stub should be used." });
      },
    };

    window.AIStudioRuntime = {
      info: {
        schemaVersion: 1,
        platform: "android",
      } as never,
      async saveBlob() {
        throw new Error("saveBlob is not expected for streaming export.");
      },
      inspectSavedMp4(uri: string) {
        capture.inspectionCalls += 1;
        if (!uri.endsWith("local-demo-project-timeline.mp4")) throw new Error("Unexpected native export URI.");
        return {
          videoTrackPresent: true,
          audioTrackPresent: true,
          durationMs: 4000,
          width: 320,
          height: 180,
          firstVideoFrameDecoded: true,
          deterministicPlaybackVerified: true,
          note: "Synthetic native decode verification for browser bridge integration coverage.",
        };
      },
    };

    window.addEventListener("aistudio:native-export-finalized", (event) => {
      capture.finalized = (event as CustomEvent).detail;
    }, { once: true });
    (window as unknown as { __runtimeNativeExportCapture?: typeof capture }).__runtimeNativeExportCapture = capture;
    window.dispatchEvent(new CustomEvent("aistudio:runtime-ready"));
  });

  // The Android product UI is chat-first. Production-engine validation enters its
  // internal technical surface by event so no runtime/debug controls leak into the user UI.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("aistudio:runtime-show-advanced")));
  await expect(page.locator("html")).toHaveClass(/runtime-advanced-ui/);

  await page.getByRole("button", { name: "Open local demo", exact: true }).click();
  const exportButton = page.locator("[data-export-mp4-button]");
  const exportStatus = page.locator("[data-export-mp4-status]");
  await expect(exportButton).toBeEnabled({ timeout: 15_000 });

  await exportButton.click();
  await expect(exportStatus).toHaveAttribute("data-export-phase", "SUCCESS", { timeout: 45_000 });

  const capture = await page.evaluate(() => {
    return (window as unknown as {
      __runtimeNativeExportCapture?: {
        beginRequest: { fileName?: string; mimeType?: string } | null;
        bytesWritten: number;
        appendCalls: number;
        maxBase64ChunkChars: number;
        finishCalls: number;
        abortCalls: number;
        inspectionCalls: number;
        finalized: {
          nativeSave?: { uri?: string; bytesWritten?: number; sha256?: string };
          nativeInspection?: { deterministicPlaybackVerified?: boolean; width?: number; height?: number };
        } | null;
      };
    }).__runtimeNativeExportCapture;
  });

  expect(capture).toBeTruthy();
  expect(capture?.beginRequest).toEqual({
    fileName: "local-demo-project-timeline.mp4",
    mimeType: "video/mp4",
  });
  expect(capture?.bytesWritten ?? 0).toBeGreaterThan(1_000);
  expect(capture?.appendCalls ?? 0).toBeGreaterThan(0);
  // The Java bridge rejects Base64 chunks above 1,500,000 characters. The Web side
  // deliberately streams 512 KiB binary chunks, keeping this contract comfortably below the limit.
  expect(capture?.maxBase64ChunkChars ?? Number.MAX_SAFE_INTEGER).toBeLessThanOrEqual(1_500_000);
  expect(capture?.finishCalls).toBe(1);
  expect(capture?.abortCalls).toBe(0);
  expect(capture?.inspectionCalls).toBe(1);
  expect(capture?.finalized?.nativeSave?.bytesWritten).toBe(capture?.bytesWritten);
  expect(capture?.finalized?.nativeSave?.sha256).toBe("a".repeat(64));
  expect(capture?.finalized?.nativeInspection).toMatchObject({
    deterministicPlaybackVerified: true,
    width: 320,
    height: 180,
  });
});
