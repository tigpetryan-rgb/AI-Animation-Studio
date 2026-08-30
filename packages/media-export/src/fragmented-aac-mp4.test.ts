import { describe, expect, it } from "vitest";
import {
  AV_MP4_AAC_AUDIO_CODEC,
  AV_MP4_AAC_MIME_TYPE,
  createAacAudioSpecificConfig,
  createAacFragmentedMp4Fragment,
  createAvcAacFragmentedMp4InitSegment,
  hasAvcAacFragmentedMp4Header,
} from "./fragmented-aac-mp4-core";

function containsAscii(bytes: Uint8Array, value: string): boolean {
  const needle = new TextEncoder().encode(value);
  outer: for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

const avcC = new Uint8Array([1, 0x42, 0, 0x1e, 0xff, 0xe1, 0]);

describe("fragmented H.264 + AAC MP4", () => {
  it("builds AAC-LC AudioSpecificConfig for 48 kHz mono and stereo", () => {
    expect([...createAacAudioSpecificConfig(48_000, 1)]).toEqual([0x11, 0x88]);
    expect([...createAacAudioSpecificConfig(48_000, 2)]).toEqual([0x11, 0x90]);
    expect(() => createAacAudioSpecificConfig(12_345, 1)).toThrow(/not supported/);
  });

  it("builds an initialization segment with standard mp4a/esds AAC signaling", () => {
    const init = createAvcAacFragmentedMp4InitSegment(320, 180, 48_000, 1, avcC, 96_000);

    expect(hasAvcAacFragmentedMp4Header(init)).toBe(true);
    expect(containsAscii(init, "moov")).toBe(true);
    expect(containsAscii(init, "mvex")).toBe(true);
    expect(containsAscii(init, "avcC")).toBe(true);
    expect(containsAscii(init, "mp4a")).toBe(true);
    expect(containsAscii(init, "esds")).toBe(true);
    expect(containsAscii(init, "Opus")).toBe(false);
    expect(AV_MP4_AAC_AUDIO_CODEC).toBe("mp4a.40.2");
    expect(AV_MP4_AAC_MIME_TYPE).toContain("mp4a.40.2");
  });

  it("builds independently writable AAC fragments with 64-bit decode time", () => {
    const fragment = createAacFragmentedMp4Fragment(9, 5_000_000_000, [
      { duration: 1024, data: new Uint8Array([1, 2, 3, 4]) },
      { duration: 1024, data: new Uint8Array([5, 6, 7]) },
    ]);

    expect(containsAscii(fragment, "moof")).toBe(true);
    expect(containsAscii(fragment, "tfdt")).toBe(true);
    expect(containsAscii(fragment, "trun")).toBe(true);
    expect(containsAscii(fragment, "mdat")).toBe(true);
    expect(fragment.byteLength).toBeLessThan(512);
  });
});
