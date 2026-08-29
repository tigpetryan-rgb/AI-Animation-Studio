import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as ts from "typescript";

const source = readFileSync(new URL("../../packages/media-export/src/mp4-core.ts", import.meta.url), "utf8");
const browserModule = ts.transpileModule(
  `${source}\n(globalThis as any).__m32Mp4Export = { exportAvcOpusMp4, hasAvcOpusMp4Header };`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;

test("real WebCodecs H.264 + Opus export produces one playable MP4", async ({ page }) => {
  await page.goto("/");
  await page.addScriptTag({ type: "module", content: browserModule });

  const result = await page.evaluate(async () => {
    type Mp4Api = {
      exportAvcOpusMp4(options: {
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
      hasAvcOpusMp4Header(bytes: Uint8Array): boolean;
    };

    const api = (globalThis as typeof globalThis & { __m32Mp4Export?: Mp4Api }).__m32Mp4Export;
    if (api === undefined) throw new Error("M32 MP4 export module did not load.");
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

    const exported = await api.exportAvcOpusMp4({
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
        context.fillStyle = index % 2 === 0 ? "rgb(16, 72, 128)" : "rgb(132, 44, 28)";
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
          () => reject(new Error("Timed out loading H.264 + Opus MP4 metadata.")),
          8_000,
        );
        video.addEventListener("loadedmetadata", () => {
          window.clearTimeout(timer);
          resolve();
        }, { once: true });
        video.addEventListener("error", () => {
          window.clearTimeout(timer);
          reject(new Error(video.error?.message ?? "H.264 + Opus MP4 playback error."));
        }, { once: true });
      });

      await video.play();

      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(
          () => reject(new Error("Timed out waiting for decoded MP4 video frame.")),
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
            reject(new Error("Timed out waiting for MP4 playback progress."));
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
        header: api.hasAvcOpusMp4Header(exported.bytes),
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
        canPlay: video.canPlayType('video/mp4;codecs="avc1.42001E,opus"'),
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
  expect(result.duration).toBeLessThan(1.3);
  expect(result.readyState).toBeGreaterThanOrEqual(2);
  expect(result.currentTime).toBeGreaterThan(0.05);
  expect(result.videoTracks).toBe(1);
  expect(result.audioTracks).toBe(1);
  expect(result.canPlay).not.toBe("");
});
