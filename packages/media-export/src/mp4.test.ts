import { describe, expect, it } from "vitest";
import {
  Mp4ExportError,
  hasAvcOpusMp4Header,
  muxAvcOpusMp4,
  type AvcMp4MuxChunk,
  type OpusMp4MuxChunk,
} from "./mp4-core.js";

const avcC = new Uint8Array([
  1, 0x42, 0x00, 0x1e, 0xff,
  0xe1, 0x00, 0x02, 0x67, 0x42,
  0x01, 0x00, 0x02, 0x68, 0xce,
]);

const videoChunks: AvcMp4MuxChunk[] = [
  {
    timestampUs: 0,
    durationUs: 33_333,
    key: true,
    data: new Uint8Array([0, 0, 0, 1, 0x65]),
  },
  {
    timestampUs: 33_333,
    durationUs: 33_333,
    key: false,
    data: new Uint8Array([0, 0, 0, 1, 0x41]),
  },
  {
    timestampUs: 66_666,
    durationUs: 33_333,
    key: false,
    data: new Uint8Array([0, 0, 0, 1, 0x41]),
  },
];

const audioChunks: OpusMp4MuxChunk[] = [
  { timestampUs: 0, durationUs: 20_000, data: new Uint8Array([0xf8, 0xff, 0xfe]) },
  { timestampUs: 20_000, durationUs: 20_000, data: new Uint8Array([0xf8, 0xff, 0xfd]) },
  { timestampUs: 40_000, durationUs: 20_000, data: new Uint8Array([0xf8, 0xff, 0xfc]) },
  { timestampUs: 60_000, durationUs: 20_000, data: new Uint8Array([0xf8, 0xff, 0xfb]) },
  { timestampUs: 80_000, durationUs: 20_000, data: new Uint8Array([0xf8, 0xff, 0xfa]) },
];

function ascii(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function topLevelTypes(bytes: Uint8Array): string[] {
  const types: string[] = [];
  let offset = 0;
  while (offset + 8 <= bytes.byteLength) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    const size = view.getUint32(0, false);
    if (size < 8 || offset + size > bytes.byteLength) break;
    types.push(String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!));
    offset += size;
  }
  return types;
}

describe("H.264 + Opus MP4 muxer", () => {
  it("writes a deterministic ISO BMFF file with AVC and Opus tracks", () => {
    const bytes = muxAvcOpusMp4(160, 90, 1, avcC, videoChunks, audioChunks);
    const text = ascii(bytes);

    expect(hasAvcOpusMp4Header(bytes)).toBe(true);
    expect(topLevelTypes(bytes)).toEqual(["ftyp", "moov", "mdat"]);
    expect(text).toContain("avc1");
    expect(text).toContain("avcC");
    expect(text).toContain("Opus");
    expect(text).toContain("dOps");
    expect(text).toContain("stts");
    expect(text).toContain("stsz");
    expect(text).toContain("stco");
    expect(text).toContain("stss");
  });

  it("stores Opus channel count, pre-skip and 48 kHz input rate in dOps", () => {
    const bytes = muxAvcOpusMp4(160, 90, 1, avcC, videoChunks, audioChunks);
    const marker = new TextEncoder().encode("dOps");
    let index = -1;
    for (let offset = 0; offset <= bytes.byteLength - marker.byteLength; offset += 1) {
      if (marker.every((value, markerIndex) => bytes[offset + markerIndex] === value)) {
        index = offset;
        break;
      }
    }

    expect(index).toBeGreaterThanOrEqual(0);
    const payload = index + 4;
    expect(bytes[payload]).toBe(0);
    expect(bytes[payload + 1]).toBe(1);
    expect(new DataView(bytes.buffer, bytes.byteOffset + payload + 2, 2).getUint16(0, false)).toBe(312);
    expect(new DataView(bytes.buffer, bytes.byteOffset + payload + 4, 4).getUint32(0, false)).toBe(48_000);
  });

  it("rejects an H.264 stream whose first sample is not a key frame", () => {
    const invalid = videoChunks.map((chunk, index) => ({ ...chunk, key: index === 0 ? false : chunk.key }));
    expect(() => muxAvcOpusMp4(160, 90, 1, avcC, invalid, audioChunks)).toThrowError(Mp4ExportError);
  });

  it("rejects malformed AVC decoder configuration and non-monotonic audio timestamps", () => {
    expect(() => muxAvcOpusMp4(160, 90, 1, new Uint8Array([1, 2, 3]), videoChunks, audioChunks))
      .toThrowError(Mp4ExportError);

    const invalidAudio = [
      audioChunks[0]!,
      { ...audioChunks[1]!, timestampUs: 0 },
    ];
    expect(() => muxAvcOpusMp4(160, 90, 1, avcC, videoChunks, invalidAudio))
      .toThrowError(Mp4ExportError);
  });
});
