import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as ts from "typescript";

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
};

const mp4Source = readFileSync(new URL("../../packages/media-export/src/mp4-core.ts", import.meta.url), "utf8");
const mp4BrowserModule = ts.transpileModule(mp4Source, { compilerOptions }).outputText;
const mp4DataUrl = `data:text/javascript;base64,${Buffer.from(mp4BrowserModule).toString("base64")}`;

const fragmentedSource = readFileSync(
  new URL("../../packages/media-export/src/fragmented-mp4-core.ts", import.meta.url),
  "utf8",
).replace('"./mp4-core.js"', `"${mp4DataUrl}"`);
const fragmentedBrowserModule = ts.transpileModule(
  `${fragmentedSource}\n(globalThis as any).__fragmentedStressExport = { exportAvcOpusFragmentedMp4 };`,
  { compilerOptions },
).outputText;

test("real 60-second WebCodecs export streams bounded fragmented MP4 writes", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.addScriptTag({ type: "module", content: fragmentedBrowserModule });

  const result = await page.evaluate(async () => {
    type StressApi = {
      exportAvcOpusFragmentedMp4(options: {
        width: number;
        height: number;
        frameRate: number;
        frameCount: number;
        videoBitrate: number;
        fragmentDurationSeconds: number;
        numberOfChannels: 1;
        totalAudioFrames: number;
        audioChunkFrames: number;
        audioBitrate: number;
        createFrame: (index: number, timestampUs: number, durationUs: number) => VideoFrame;
        createAudioData: (startFrame: number, frameCount: number, timestampUs: number) => AudioData;
        sink: { write(bytes: Uint8Array): void };
      }): Promise<{
        durationUs: number;
        encodedVideoChunks: number;
        encodedAudioChunks: number;
        fragmentsWritten: number;
        bytesWritten: number;
      }>;
    };

    const api = (globalThis as typeof globalThis & { __fragmentedStressExport?: StressApi }).__fragmentedStressExport;
    if (api === undefined) throw new Error("Fragmented MP4 stress module did not load.");
    if (
      typeof VideoEncoder === "undefined"
      || typeof VideoFrame === "undefined"
      || typeof AudioEncoder === "undefined"
      || typeof AudioData === "undefined"
      || typeof OffscreenCanvas === "undefined"
    ) {
      throw new Error("Required WebCodecs primitives are unavailable.");
    }

    const width = 160;
    const height = 90;
    const frameRate = 12;
    const durationSeconds = 60;
    const frameCount = frameRate * durationSeconds;
    const sampleRate = 48_000;
    const totalAudioFrames = sampleRate * durationSeconds;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("2D canvas context unavailable.");

    let writes = 0;
    let sinkBytes = 0;
    let maxWriteBytes = 0;
    const started = performance.now();
    const exported = await api.exportAvcOpusFragmentedMp4({
      width,
      height,
      frameRate,
      frameCount,
      videoBitrate: 300_000,
      fragmentDurationSeconds: 1,
      numberOfChannels: 1,
      totalAudioFrames,
      audioChunkFrames: 960,
      audioBitrate: 64_000,
      createFrame: (index, timestampUs, durationUs) => {
        context.fillStyle = index % 2 === 0 ? "rgb(18, 62, 112)" : "rgb(118, 46, 30)";
        context.fillRect(0, 0, width, height);
        context.fillStyle = "white";
        context.fillRect((index * 7) % 128, 28, 24, 24);
        return new VideoFrame(canvas, { timestamp: timestampUs, duration: durationUs });
      },
      createAudioData: (startFrame, frameCountForChunk, timestampUs) => {
        const samples = new Float32Array(frameCountForChunk);
        for (let frame = 0; frame < frameCountForChunk; frame += 1) {
          const absoluteFrame = startFrame + frame;
          samples[frame] = Math.sin((2 * Math.PI * 330 * absoluteFrame) / sampleRate) * 0.15;
        }
        return new AudioData({
          format: "f32",
          sampleRate,
          numberOfFrames: frameCountForChunk,
          numberOfChannels: 1,
          timestamp: timestampUs,
          data: samples,
        });
      },
      sink: {
        write(bytes) {
          writes += 1;
          sinkBytes += bytes.byteLength;
          maxWriteBytes = Math.max(maxWriteBytes, bytes.byteLength);
        },
      },
    });

    return {
      ...exported,
      writes,
      sinkBytes,
      maxWriteBytes,
      elapsedMs: performance.now() - started,
    };
  });

  expect(result.durationUs).toBe(60_000_000);
  expect(result.encodedVideoChunks).toBeGreaterThanOrEqual(720);
  expect(result.encodedAudioChunks).toBeGreaterThan(2_000);
  expect(result.fragmentsWritten).toBeGreaterThanOrEqual(100);
  expect(result.writes).toBe(result.fragmentsWritten + 1);
  expect(result.sinkBytes).toBe(result.bytesWritten);
  expect(result.bytesWritten).toBeGreaterThan(500_000);
  expect(result.bytesWritten).toBeGreaterThan(result.maxWriteBytes * 10);
  expect(result.maxWriteBytes).toBeLessThan(2 * 1024 * 1024);
  expect(result.elapsedMs).toBeGreaterThan(0);
});
