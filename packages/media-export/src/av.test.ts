import { describe, expect, it } from "vitest";
import {
  AvExportError,
  hasVp8OpusWebMHeader,
  muxVp8OpusWebM,
  type AvOpusMuxChunk,
  type AvVp8MuxChunk,
} from "./av.js";

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

function videoChunk(timestampUs: number, key: boolean, value: number): AvVp8MuxChunk {
  return {
    timestampUs,
    durationUs: 83_333,
    key,
    data: new Uint8Array([value, value + 1, value + 2, value + 3]),
  };
}

function audioChunk(timestampUs: number, value: number): AvOpusMuxChunk {
  return {
    timestampUs,
    durationUs: 20_000,
    data: new Uint8Array([value, value + 1, value + 2, value + 3]),
  };
}

describe("synchronized VP8 + Opus WebM muxer", () => {
  it("writes one WebM containing VP8 and Opus tracks with interleaved SimpleBlocks", () => {
    const bytes = muxVp8OpusWebM(
      160,
      90,
      1,
      [
        videoChunk(0, true, 10),
        videoChunk(83_333, false, 20),
        videoChunk(166_666, false, 30),
      ],
      [
        audioChunk(0, 40),
        audioChunk(20_000, 50),
        audioChunk(40_000, 60),
        audioChunk(60_000, 70),
        audioChunk(80_000, 80),
      ],
    );

    expect(hasVp8OpusWebMHeader(bytes)).toBe(true);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("webm");
    expect(text).toContain("V_VP8");
    expect(text).toContain("A_OPUS");
    expect(text).toContain("OpusHead");
    expect(text).toContain("AI Animation Studio");
    expect(occurrences(bytes, [0x1f, 0x43, 0xb6, 0x75])).toBe(1);
    expect(occurrences(bytes, [0xa3])).toBeGreaterThanOrEqual(8);
  });

  it("is deterministic for identical encoded inputs", () => {
    const video = [
      videoChunk(0, true, 1),
      videoChunk(83_333, false, 5),
    ];
    const audio = [
      audioChunk(0, 9),
      audioChunk(20_000, 13),
      audioChunk(40_000, 17),
    ];

    const first = muxVp8OpusWebM(320, 180, 1, video, audio);
    const second = muxVp8OpusWebM(320, 180, 1, video, audio);
    expect(second).toEqual(first);
  });

  it("starts a new Cluster before SimpleBlock signed timecode range is exhausted", () => {
    const bytes = muxVp8OpusWebM(
      160,
      90,
      1,
      [
        videoChunk(0, true, 1),
        videoChunk(31_000_000, true, 5),
      ],
      [
        audioChunk(0, 9),
        audioChunk(31_000_000, 13),
      ],
    );
    expect(occurrences(bytes, [0x1f, 0x43, 0xb6, 0x75])).toBe(2);
  });

  it("rejects missing tracks, non-key first video chunk and out-of-order timestamps", () => {
    expect(() => muxVp8OpusWebM(
      160,
      90,
      1,
      [],
      [audioChunk(0, 1)],
    )).toThrowError(AvExportError);

    expect(() => muxVp8OpusWebM(
      160,
      90,
      1,
      [videoChunk(0, false, 1)],
      [audioChunk(0, 5)],
    )).toThrowError(AvExportError);

    expect(() => muxVp8OpusWebM(
      160,
      90,
      1,
      [
        videoChunk(83_333, true, 1),
        videoChunk(0, false, 5),
      ],
      [audioChunk(0, 9)],
    )).toThrowError(AvExportError);
  });
});
