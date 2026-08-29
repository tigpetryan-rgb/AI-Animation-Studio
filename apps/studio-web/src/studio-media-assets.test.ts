import { describe, expect, it, vi } from "vitest";
import { createLocalDemoMovieSession } from "./studio-movie-session";
import {
  prepareMovieMedia,
  samplePreparedAudio,
  type PreparedAudioAsset,
  type PreparedVideoAsset,
} from "./studio-media-assets";

function fakeAudioBuffer(values: readonly number[] = [0, 0.5, -0.5, 1]): AudioBuffer {
  const data = Float32Array.from(values);
  return {
    sampleRate: data.length,
    numberOfChannels: 1,
    length: data.length,
    duration: 1,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

describe("Studio movie media assets", () => {
  it("fetches, decodes and releases image, video and audio timeline assets", async () => {
    const requested: string[] = [];
    const imageClose = vi.fn();
    const videoClose = vi.fn();
    const fetchAsset = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.endsWith(".svg")) {
        return new Response("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"9\"/>", {
          status: 200,
          headers: { "content-type": "image/svg+xml" },
        });
      }
      return new Response("AQID", { status: 200, headers: { "content-type": "text/plain" } });
    });
    const decodeImage = vi.fn(async () => ({ width: 16, height: 9, close: imageClose } as unknown as ImageBitmap));
    const decodeVideo = vi.fn(async (_blob, asset) => Object.freeze({
      element: {} as HTMLVideoElement,
      durationSeconds: 1,
      loop: asset.loop,
      close: videoClose,
    }) satisfies PreparedVideoAsset);
    const decodeAudio = vi.fn(async () => fakeAudioBuffer());

    const media = await prepareMovieMedia(createLocalDemoMovieSession(), {
      fetchAsset: fetchAsset as typeof fetch,
      decodeImage,
      decodeVideo,
      decodeAudio,
      baseUrl: "https://studio.test/app/",
    });

    expect(requested).toEqual([
      "https://studio.test/app/demo-media/action-shot.webm.b64",
      "https://studio.test/app/demo-media/opening-shot.svg",
      "https://studio.test/app/demo-media/action-tone.ogg.b64",
      "https://studio.test/app/demo-media/opening-tone.ogg.b64",
    ]);
    expect(decodeImage).toHaveBeenCalledTimes(1);
    expect(decodeVideo).toHaveBeenCalledTimes(1);
    expect(decodeAudio).toHaveBeenCalledTimes(2);
    expect(media.images.size).toBe(1);
    expect(media.videos.size).toBe(1);
    expect(media.audio.size).toBe(2);

    media.close();
    expect(imageClose).toHaveBeenCalledTimes(1);
    expect(videoClose).toHaveBeenCalledTimes(1);
  });

  it("samples decoded audio with gain, interpolation and looping", () => {
    const asset: PreparedAudioAsset = {
      buffer: fakeAudioBuffer(),
      gain: 0.5,
      loop: true,
    };
    expect(samplePreparedAudio(asset, 0.125)).toBeCloseTo(0.125, 5);
    expect(samplePreparedAudio(asset, 1.125)).toBeCloseTo(0.125, 5);
  });

  it("rejects an invalid identity media response and releases prior decoded video", async () => {
    const videoClose = vi.fn();
    const fetchAsset = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(".svg")) {
        return new Response("not an image", { status: 200, headers: { "content-type": "text/plain" } });
      }
      return new Response("AQID", { status: 200 });
    });
    const decodeVideo = vi.fn(async (_blob, asset) => Object.freeze({
      element: {} as HTMLVideoElement,
      durationSeconds: 1,
      loop: asset.loop,
      close: videoClose,
    }) satisfies PreparedVideoAsset);

    await expect(prepareMovieMedia(createLocalDemoMovieSession(), {
      fetchAsset: fetchAsset as typeof fetch,
      decodeImage: vi.fn(),
      decodeVideo,
      decodeAudio: vi.fn(async () => fakeAudioBuffer()),
      baseUrl: "https://studio.test/",
    })).rejects.toThrow("unsupported content type");
    expect(videoClose).toHaveBeenCalledTimes(1);
  });
});
