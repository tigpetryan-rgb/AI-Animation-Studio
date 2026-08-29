import { describe, expect, it } from "vitest";
import {
  MediaExportError,
  hasWebMHeader,
  muxVp8WebM,
  type Vp8MuxChunk,
} from "./index.js";

function occurrences(bytes: Uint8Array, needle: readonly number[]): number {
  let count = 0;
  for (let offset = 0; offset <= bytes.length - needle.length; offset += 1) {
    let match = true;
    for (let index = 0; index < needle.length; index += 1) {
      if (bytes[offset + index] !== needle[index]) {
        match = false;
        break;
      }
    }
    if (match) count += 1;
  }
  return count;
}

function chunk(timestampUs: number, key: boolean, value: number): Vp8MuxChunk {
  return {
    timestampUs,
    durationUs: 33_333,
    key,
    data: new Uint8Array([value, value + 1, value + 2, value + 3]),
  };
}

describe("VP8 WebM muxer", () => {
  it("writes EBML/WebM metadata, VP8 track metadata and SimpleBlocks", () => {
    const bytes = muxVp8WebM(320, 180, 30, [
      chunk(0, true, 1),
      chunk(33_333, false, 5),
      chunk(66_666, false, 9),
    ]);

    expect(hasWebMHeader(bytes)).toBe(true);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("webm");
    expect(text).toContain("V_VP8");
    expect(text).toContain("AI Animation Studio");
    expect(occurrences(bytes, [0x1f, 0x43, 0xb6, 0x75])).toBe(1);
    expect(occurrences(bytes, [0xa3])).toBeGreaterThanOrEqual(3);
  });

  it("starts a new Cluster before SimpleBlock signed timecode range is exhausted", () => {
    const bytes = muxVp8WebM(160, 90, 30, [
      chunk(0, true, 1),
      chunk(31_000_000, true, 5),
    ]);
    expect(occurrences(bytes, [0x1f, 0x43, 0xb6, 0x75])).toBe(2);
  });

  it("rejects empty encoded data and invalid video configuration", () => {
    expect(() => muxVp8WebM(320, 180, 30, [{
      timestampUs: 0,
      durationUs: 33_333,
      key: true,
      data: new Uint8Array(),
    }])).toThrowError(MediaExportError);

    expect(() => muxVp8WebM(0, 180, 30, [chunk(0, true, 1)])).toThrowError(MediaExportError);
  });
});
