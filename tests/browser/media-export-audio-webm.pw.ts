import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as ts from "typescript";

const source = readFileSync(new URL("../../packages/media-export/src/audio-core.ts", import.meta.url), "utf8");
const browserModule = ts.transpileModule(
  `${source}\n(globalThis as any).__m30AudioExport = { exportOpusWebM, hasOpusWebMHeader };`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;

test("real WebCodecs Opus export produces a playable audio WebM", async ({ page }) => {
  await page.goto("/");
  await page.addScriptTag({ type: "module", content: browserModule });

  const result = await page.evaluate(async () => {
    type AudioApi = {
      exportOpusWebM(options: {
        numberOfChannels: 1;
        totalFrames: number;
        chunkFrames: number;
        bitrate: number;
        createAudioData: (startFrame: number, frameCount: number, timestampUs: number) => AudioData;
      }): Promise<{
        bytes: Uint8Array;
        mimeType: string;
        encodedChunks: number;
        durationUs: number;
      }>;
      hasOpusWebMHeader(bytes: Uint8Array): boolean;
    };

    const api = (globalThis as typeof globalThis & { __m30AudioExport?: AudioApi }).__m30AudioExport;
    if (api === undefined) throw new Error("M30 audio export module did not load.");
    if (typeof AudioData === "undefined" || typeof AudioEncoder === "undefined") {
      throw new Error("WebCodecs audio primitives unavailable.");
    }

    const sampleRate = 48_000;
    const totalFrames = sampleRate;
    const chunkFrames = 960;
    const exported = await api.exportOpusWebM({
      numberOfChannels: 1,
      totalFrames,
      chunkFrames,
      bitrate: 64_000,
      createAudioData: (startFrame, frameCount, timestampUs) => {
        const samples = new Float32Array(frameCount);
        for (let frame = 0; frame < frameCount; frame += 1) {
          const absoluteFrame = startFrame + frame;
          samples[frame] = Math.sin((2 * Math.PI * 440 * absoluteFrame) / sampleRate) * 0.2;
        }
        return new AudioData({
          format: "f32",
          sampleRate,
          numberOfFrames: frameCount,
          numberOfChannels: 1,
          timestamp: timestampUs,
          data: samples,
        });
      },
    });

    const blob = new Blob([exported.bytes], { type: exported.mimeType });
    const url = URL.createObjectURL(blob);
    const audio = document.createElement("audio");
    audio.muted = true;
    audio.preload = "auto";
    audio.src = url;
    document.body.append(audio);

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("Timed out loading Opus WebM metadata.")), 8_000);
        audio.addEventListener("loadedmetadata", () => {
          window.clearTimeout(timer);
          resolve();
        }, { once: true });
        audio.addEventListener("error", () => {
          window.clearTimeout(timer);
          reject(new Error(audio.error?.message ?? "Opus WebM playback error."));
        }, { once: true });
      });

      await audio.play();
      await new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + 8_000;
        const check = (): void => {
          if (audio.currentTime > 0.05 || audio.ended) {
            resolve();
            return;
          }
          if (performance.now() > deadline) {
            reject(new Error("Timed out waiting for Opus WebM playback progress."));
            return;
          }
          window.setTimeout(check, 25);
        };
        check();
      });

      return {
        header: api.hasOpusWebMHeader(exported.bytes),
        bytes: exported.bytes.byteLength,
        encodedChunks: exported.encodedChunks,
        exportedDurationUs: exported.durationUs,
        duration: audio.duration,
        readyState: audio.readyState,
        currentTime: audio.currentTime,
        canPlay: audio.canPlayType("audio/webm;codecs=opus"),
      };
    } finally {
      audio.pause();
      audio.remove();
      URL.revokeObjectURL(url);
    }
  });

  expect(result.header).toBe(true);
  expect(result.bytes).toBeGreaterThan(200);
  expect(result.encodedChunks).toBeGreaterThan(0);
  expect(result.exportedDurationUs).toBe(1_000_000);
  expect(result.duration).toBeGreaterThan(0.8);
  expect(result.duration).toBeLessThan(1.2);
  expect(result.readyState).toBeGreaterThanOrEqual(2);
  expect(result.currentTime).toBeGreaterThan(0.05);
  expect(result.canPlay).not.toBe("");
});
