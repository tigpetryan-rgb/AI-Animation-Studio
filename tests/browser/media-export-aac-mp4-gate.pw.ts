import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import * as ts from "typescript";

const source = readFileSync(
  new URL("../../packages/media-export/src/fragmented-aac-mp4-core.ts", import.meta.url),
  "utf8",
);
const standaloneSource = source
  .replace(
    /import \{[\s\S]*?\} from "\.\/mp4-core\.js";/,
    `const AV_MP4_VIDEO_CODEC = "avc1.42001E" as const;
const AV_MP4_VIDEO_TIMESCALE = 90_000 as const;
class Mp4ExportError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "Mp4ExportError";
    this.code = code;
  }
}`,
  )
  .replace(
    /import type \{[\s\S]*?\} from "\.\/fragmented-mp4-core\.js";/,
    `interface FragmentedMp4ByteSink { write(bytes: Uint8Array): void | Promise<void>; }`,
  );
const browserModule = ts.transpileModule(
  `${standaloneSource}\n(globalThis as any).__m48AacMp4Export = { exportAvcAacFragmentedMp4, hasAvcAacFragmentedMp4Header };`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;

test("native AAC MP4 path plays when the active Chromium exposes AAC AudioEncoder", async ({ page }) => {
  await page.goto("/");
  await page.addScriptTag({ type: "module", content: browserModule });

  const result = await page.evaluate(async () => {
    type AacApi = {
      exportAvcAacFragmentedMp4(options: Record<string, unknown>): Promise<{
        mimeType: string;
        encodedVideoChunks: number;
        encodedAudioChunks: number;
        fragmentsWritten: number;
      }>;
      hasAvcAacFragmentedMp4Header(bytes: Uint8Array): boolean;
    };
    const api = (globalThis as typeof globalThis & { __m48AacMp4Export?: AacApi }).__m48AacMp4Export;
    if (api === undefined) throw new Error("AAC MP4 test module did not load.");
    if (
      typeof VideoEncoder === "undefined"
      || typeof VideoFrame === "undefined"
      || typeof AudioEncoder === "undefined"
      || typeof AudioData === "undefined"
      || typeof OffscreenCanvas === "undefined"
    ) {
      return { webCodecs: false, aacSupported: false } as const;
    }

    const width = 160;
    const height = 90;
    const frameRate = 12;
    const sampleRate = 48_000;
    const videoSupport = await VideoEncoder.isConfigSupported({
      codec: "avc1.42001E",
      width,
      height,
      framerate: frameRate,
      bitrate: 300_000,
      latencyMode: "realtime",
      avc: { format: "avc" },
    });
    const audioSupport = await AudioEncoder.isConfigSupported({
      codec: "mp4a.40.2",
      sampleRate,
      numberOfChannels: 1,
      bitrate: 96_000,
    });
    if (videoSupport.supported !== true || audioSupport.supported !== true) {
      return {
        webCodecs: true,
        videoSupported: videoSupport.supported === true,
        aacSupported: audioSupport.supported === true,
      } as const;
    }

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("2D canvas unavailable.");
    const parts: Uint8Array[] = [];
    let totalBytes = 0;
    const exported = await api.exportAvcAacFragmentedMp4({
      width,
      height,
      frameRate,
      frameCount: frameRate,
      videoBitrate: 300_000,
      sampleRate,
      numberOfChannels: 1,
      totalAudioFrames: sampleRate,
      audioChunkFrames: 1024,
      audioBitrate: 96_000,
      fragmentDurationSeconds: 1,
      sink: {
        write(bytes: Uint8Array) {
          const copy = bytes.slice();
          parts.push(copy);
          totalBytes += copy.byteLength;
        },
      },
      createFrame(index: number, timestampUs: number, durationUs: number) {
        context.fillStyle = index % 2 === 0 ? "rgb(32, 74, 120)" : "rgb(126, 56, 32)";
        context.fillRect(0, 0, width, height);
        context.fillStyle = "white";
        context.fillRect((index * 9) % 120, 25, 28, 28);
        return new VideoFrame(canvas, { timestamp: timestampUs, duration: durationUs });
      },
      createAudioData(startFrame: number, frameCount: number, timestampUs: number) {
        const samples = new Float32Array(frameCount);
        for (let frame = 0; frame < frameCount; frame += 1) {
          const absoluteFrame = startFrame + frame;
          samples[frame] = Math.sin((2 * Math.PI * 440 * absoluteFrame) / sampleRate) * 0.15;
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

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    const ascii = new TextDecoder("latin1").decode(bytes);
    const url = URL.createObjectURL(new Blob([bytes], { type: exported.mimeType }));
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    document.body.append(video);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("AAC fragmented MP4 metadata timed out.")), 10_000);
        video.addEventListener("loadedmetadata", () => {
          window.clearTimeout(timer);
          resolve();
        }, { once: true });
        video.addEventListener("error", () => {
          window.clearTimeout(timer);
          reject(new Error(video.error?.message ?? "AAC fragmented MP4 playback failed."));
        }, { once: true });
      });
      await video.play();
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error("AAC MP4 decoded frame timed out.")), 8_000);
        video.requestVideoFrameCallback(() => {
          window.clearTimeout(timer);
          resolve();
        });
      });
      return {
        webCodecs: true,
        videoSupported: true,
        aacSupported: true,
        header: api.hasAvcAacFragmentedMp4Header(bytes),
        bytes: bytes.byteLength,
        mp4a: ascii.includes("mp4a"),
        esds: ascii.includes("esds"),
        fragments: exported.fragmentsWritten,
        encodedVideoChunks: exported.encodedVideoChunks,
        encodedAudioChunks: exported.encodedAudioChunks,
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
        canPlay: video.canPlayType('video/mp4;codecs="avc1.42001E,mp4a.40.2"'),
      } as const;
    } finally {
      video.pause();
      video.remove();
      URL.revokeObjectURL(url);
    }
  });

  expect(result.webCodecs).toBe(true);
  if (!result.aacSupported || !("header" in result)) {
    expect(result.aacSupported).toBe(false);
    return;
  }

  expect(result.videoSupported).toBe(true);
  expect(result.header).toBe(true);
  expect(result.bytes).toBeGreaterThan(500);
  expect(result.mp4a).toBe(true);
  expect(result.esds).toBe(true);
  expect(result.fragments).toBeGreaterThanOrEqual(2);
  expect(result.encodedVideoChunks).toBeGreaterThan(0);
  expect(result.encodedAudioChunks).toBeGreaterThan(0);
  expect(result.width).toBe(160);
  expect(result.height).toBe(90);
  expect(result.duration).toBeGreaterThan(0.8);
  expect(result.duration).toBeLessThan(1.4);
  expect(result.canPlay).not.toBe("");
});
