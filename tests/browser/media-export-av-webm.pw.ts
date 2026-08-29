import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as ts from "typescript";

const source = readFileSync(new URL("../../packages/media-export/src/av-core.ts", import.meta.url), "utf8");
const browserModule = ts.transpileModule(
  `${source}\n(globalThis as any).__m31AvExport = { exportVp8OpusWebM, hasVp8OpusWebMHeader };`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;

test("real WebCodecs VP8 + Opus export produces one playable synchronized WebM", async ({ page }) => {
  await page.goto("/");
  await page.addScriptTag({ type: "module", content: browserModule });

  const result = await page.evaluate(async () => {
    type AvApi = {
      exportVp8OpusWebM(options: {
        width: number;
        height: number;
        frameRate: number;
        frameCount: number;
        videoBitrate: number;
        numberOfChannels: 1;
        totalAudioFrames: number;
        audioChunkFrames: number;
        audioBitrate: number;
        createFrame: (index: number, timestampUs: number, durationUs: number) => VideoFrame;
        createAudioData: (startFrame: number, frameCount: number, timestampUs: number) => AudioData;
      }): Promise<{
        bytes: Uint8Array;
        mimeType: string;
        encodedVideoChunks: number;
        encodedAudioChunks: number;
        durationUs: number;
      }>;
      hasVp8OpusWebMHeader(bytes: Uint8Array): boolean;
    };

    const api = (globalThis as typeof globalThis & { __m31AvExport?: AvApi }).__m31AvExport;
    if (api === undefined) throw new Error("M31 A/V export module did not load.");
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
    const frameCount = 12;
    const sampleRate = 48_000;
    const totalAudioFrames = sampleRate;
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("2D canvas context unavailable.");

    const exported = await api.exportVp8OpusWebM({
      width,
      height,
      frameRate,
      frameCount,
      videoBitrate: 300_000,
      numberOfChannels: 1,
      totalAudioFrames,
      audioChunkFrames: 960,
      audioBitrate: 64_000,
      createFrame: (index, timestampUs, durationUs) => {
        context.fillStyle = index % 2 === 0 ? "rgb(20, 60, 120)" : "rgb(120, 40, 30)";
        context.fillRect(0, 0, width, height);
        context.fillStyle = "white";
        context.fillRect((index * 11) % 120, 24, 32, 32);
        return new VideoFrame(canvas, { timestamp: timestampUs, duration: durationUs });
      },
      createAudioData: (startFrame, frameCountForChunk, timestampUs) => {
        const samples = new Float32Array(frameCountForChunk);
        for (let frame = 0; frame < frameCountForChunk; frame += 1) {
          const absoluteFrame = startFrame + frame;
          samples[frame] = Math.sin((2 * Math.PI * 440 * absoluteFrame) / sampleRate) * 0.2;
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
        const timer = window.setTimeout(
          () => reject(new Error("Timed out loading VP8 + Opus WebM metadata.")),
          8_000,
        );
        video.addEventListener("loadedmetadata", () => {
          window.clearTimeout(timer);
          resolve();
        }, { once: true });
        video.addEventListener("error", () => {
          window.clearTimeout(timer);
          reject(new Error(video.error?.message ?? "VP8 + Opus WebM playback error."));
        }, { once: true });
      });

      await video.play();

      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(
          () => reject(new Error("Timed out waiting for decoded A/V video frame.")),
          8_000,
        );
        video.requestVideoFrameCallback(() => {
          window.clearTimeout(timer);
          resolve();
        });
      });

      await new Promise<void>((resolve, reject) => {
        const deadline = performance.now() + 8_000;
        const check = (): void => {
          if (video.currentTime > 0.05 || video.ended) {
            resolve();
            return;
          }
          if (performance.now() > deadline) {
            reject(new Error("Timed out waiting for A/V WebM playback progress."));
            return;
          }
          window.setTimeout(check, 25);
        };
        check();
      });

      const captureStream = (video as HTMLVideoElement & {
        captureStream?: () => MediaStream;
      }).captureStream;
      if (captureStream === undefined) {
        throw new Error("HTMLMediaElement.captureStream unavailable in Chromium gate.");
      }
      const stream = captureStream.call(video);

      return {
        header: api.hasVp8OpusWebMHeader(exported.bytes),
        bytes: exported.bytes.byteLength,
        encodedVideoChunks: exported.encodedVideoChunks,
        encodedAudioChunks: exported.encodedAudioChunks,
        exportedDurationUs: exported.durationUs,
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
        currentTime: video.currentTime,
        videoTracks: stream.getVideoTracks().length,
        audioTracks: stream.getAudioTracks().length,
        canPlay: video.canPlayType("video/webm;codecs=vp8,opus"),
      };
    } finally {
      video.pause();
      video.remove();
      URL.revokeObjectURL(url);
    }
  });

  expect(result.header).toBe(true);
  expect(result.bytes).toBeGreaterThan(500);
  expect(result.encodedVideoChunks).toBeGreaterThan(0);
  expect(result.encodedAudioChunks).toBeGreaterThan(0);
  expect(result.exportedDurationUs).toBe(1_000_000);
  expect(result.videoWidth).toBe(160);
  expect(result.videoHeight).toBe(90);
  expect(result.duration).toBeGreaterThan(0.8);
  expect(result.duration).toBeLessThan(1.2);
  expect(result.readyState).toBeGreaterThanOrEqual(2);
  expect(result.currentTime).toBeGreaterThan(0.05);
  expect(result.videoTracks).toBe(1);
  expect(result.audioTracks).toBe(1);
  expect(result.canPlay).not.toBe("");
});
