import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as ts from "typescript";

const source = readFileSync(new URL("../../packages/media-export/src/index.ts", import.meta.url), "utf8");
const browserModule = ts.transpileModule(
  `${source}\n(globalThis as any).__m29MediaExport = { exportVp8WebM, hasWebMHeader };`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;

test("real WebCodecs VP8 export produces a playable WebM", async ({ page }) => {
  await page.goto("/");
  await page.addScriptTag({ type: "module", content: browserModule });

  const result = await page.evaluate(async () => {
    type MediaApi = {
      exportVp8WebM(options: {
        width: number;
        height: number;
        frameRate: number;
        frameCount: number;
        bitrate: number;
        createFrame: (index: number, timestampUs: number, durationUs: number) => VideoFrame;
      }): Promise<{
        bytes: Uint8Array;
        mimeType: string;
        encodedChunks: number;
      }>;
      hasWebMHeader(bytes: Uint8Array): boolean;
    };

    const api = (globalThis as typeof globalThis & { __m29MediaExport?: MediaApi }).__m29MediaExport;
    if (api === undefined) throw new Error("M29 media export module did not load.");
    if (typeof OffscreenCanvas === "undefined") throw new Error("OffscreenCanvas unavailable.");

    const width = 160;
    const height = 90;
    const frameRate = 12;
    const frameCount = 12;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("2D canvas context unavailable.");

    const exported = await api.exportVp8WebM({
      width,
      height,
      frameRate,
      frameCount,
      bitrate: 300_000,
      createFrame: (index, timestampUs, durationUs) => {
        context.fillStyle = index % 2 === 0 ? "rgb(20, 60, 120)" : "rgb(120, 40, 30)";
        context.fillRect(0, 0, width, height);
        context.fillStyle = "white";
        context.fillRect((index * 11) % 120, 24, 32, 32);
        return new VideoFrame(canvas, { timestamp: timestampUs, duration: durationUs });
      },
    });

    const blob = new Blob([exported.bytes], { type: exported.mimeType });
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = url;
    document.body.append(video);

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Timed out loading WebM metadata.")), 8_000);
        video.addEventListener("loadedmetadata", () => {
          window.clearTimeout(timer);
          resolve();
        }, { once: true });
        video.addEventListener("error", () => {
          window.clearTimeout(timer);
          reject(new Error(video.error?.message ?? "WebM playback error."));
        }, { once: true });
      });

      await video.play();
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Timed out waiting for decoded video frame.")), 8_000);
        video.requestVideoFrameCallback(() => {
          window.clearTimeout(timer);
          resolve();
        });
      });

      return {
        header: api.hasWebMHeader(exported.bytes),
        bytes: exported.bytes.byteLength,
        encodedChunks: exported.encodedChunks,
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
        currentTime: video.currentTime,
      };
    } finally {
      video.pause();
      video.remove();
      URL.revokeObjectURL(url);
    }
  });

  expect(result.header).toBe(true);
  expect(result.bytes).toBeGreaterThan(200);
  expect(result.encodedChunks).toBeGreaterThan(0);
  expect(result.videoWidth).toBe(160);
  expect(result.videoHeight).toBe(90);
  expect(result.duration).toBeGreaterThan(0.8);
  expect(result.duration).toBeLessThan(1.2);
  expect(result.readyState).toBeGreaterThanOrEqual(2);
  expect(result.currentTime).toBeGreaterThanOrEqual(0);
});
