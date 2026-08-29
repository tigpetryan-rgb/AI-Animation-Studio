import { describe, expect, it, vi } from "vitest";
import { createLocalDemoMovieSession } from "./studio-movie-session";
import { prepareMovieMedia } from "./studio-media-assets";

describe("Studio movie media assets", () => {
  it("fetches, decodes and releases every timeline image asset", async () => {
    const requested: string[] = [];
    const closed: Array<ReturnType<typeof vi.fn>> = [];
    const fetchAsset = vi.fn(async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"9\"/>", {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
      });
    });
    const decodeImage = vi.fn(async () => {
      const close = vi.fn();
      closed.push(close);
      return { width: 16, height: 9, close } as unknown as ImageBitmap;
    });

    const media = await prepareMovieMedia(createLocalDemoMovieSession(), {
      fetchAsset: fetchAsset as typeof fetch,
      decodeImage,
      baseUrl: "https://studio.test/app/",
    });

    expect(requested).toEqual([
      "https://studio.test/app/demo-media/action-shot.svg",
      "https://studio.test/app/demo-media/opening-shot.svg",
    ]);
    expect(decodeImage).toHaveBeenCalledTimes(2);
    expect(media.images.size).toBe(2);

    media.close();
    expect(closed).toHaveLength(2);
    expect(closed.every((close) => close.mock.calls.length === 1)).toBe(true);
  });

  it("rejects non-image responses before decode", async () => {
    const fetchAsset = vi.fn(async () => new Response("not an image", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }));
    const decodeImage = vi.fn();

    await expect(prepareMovieMedia(createLocalDemoMovieSession(), {
      fetchAsset: fetchAsset as typeof fetch,
      decodeImage,
      baseUrl: "https://studio.test/",
    })).rejects.toThrow("unsupported content type");
    expect(decodeImage).not.toHaveBeenCalled();
  });
});
