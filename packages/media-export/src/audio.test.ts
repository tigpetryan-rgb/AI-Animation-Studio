import { describe, expect, it } from "vitest";
import {
  AudioExportError,
  createOpusHead,
  hasOpusWebMHeader,
  muxOpusWebM,
  type OpusMuxChunk,
} from "./audio.js";

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

function chunk(timestampUs: number, value: number): OpusMuxChunk {
  return {
    timestampUs,
    durationUs: 20_000,
    data: new Uint8Array([value, value + 1, value + 2, value + 3]),
  };
}

describe("Opus WebM audio muxer", () => {
  it("writes WebM metadata, an Opus audio track, OpusHead and SimpleBlocks", () => {
    const bytes = muxOpusWebM(48_000, 1, [
      chunk(0, 1),
      chunk(20_000, 5),
      chunk(40_000, 9),
    ]);

    expect(hasOpusWebMHeader(bytes)).toBe(true);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("webm");
    expect(text).toContain("A_OPUS");
    expect(text).toContain("OpusHead");
    expect(text).toContain("AI Animation Studio");
    expect(occurrences(bytes, [0x1f, 0x43, 0xb6, 0x75])).toBe(1);
    expect(occurrences(bytes, [0xa3])).toBeGreaterThanOrEqual(3);
  });

  it("writes a standards-shaped OpusHead for mono and stereo", () => {
    const mono = createOpusHead(1);
    const stereo = createOpusHead(2);
    expect(new TextDecoder().decode(mono.subarray(0, 8))).toBe("OpusHead");
    expect(mono).toHaveLength(19);
    expect(mono[8]).toBe(1);
    expect(mono[9]).toBe(1);
    expect(stereo[9]).toBe(2);
    expect(new DataView(mono.buffer).getUint32(12, true)).toBe(48_000);
  });

  it("starts a new Cluster before SimpleBlock signed timecode range is exhausted", () => {
    const bytes = muxOpusWebM(48_000, 1, [
      chunk(0, 1),
      chunk(31_000_000, 5),
    ]);
    expect(occurrences(bytes, [0x1f, 0x43, 0xb6, 0x75])).toBe(2);
  });

  it("rejects unsupported PCM layouts, empty chunks and out-of-order timestamps", () => {
    expect(() => muxOpusWebM(44_100, 1, [chunk(0, 1)])).toThrowError(AudioExportError);
    expect(() => muxOpusWebM(48_000, 1, [{
      timestampUs: 0,
      durationUs: 20_000,
      data: new Uint8Array(),
    }])).toThrowError(AudioExportError);
    expect(() => muxOpusWebM(48_000, 1, [
      chunk(20_000, 1),
      chunk(0, 5),
    ])).toThrowError(AudioExportError);
  });
});
