import { describe, expect, it } from "vitest";
import {
  createAvcFragmentedMp4Fragment,
  createAvcOpusFragmentedMp4InitSegment,
  createOpusFragmentedMp4Fragment,
  hasAvcOpusFragmentedMp4Header,
} from "./fragmented-mp4-core";

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

describe("fragmented H.264 + Opus MP4", () => {
  it("builds an initialization segment with movie fragments enabled", () => {
    const init = createAvcOpusFragmentedMp4InitSegment(320, 180, 1, avcC);

    expect(hasAvcOpusFragmentedMp4Header(init)).toBe(true);
    expect(containsAscii(init, "moov")).toBe(true);
    expect(containsAscii(init, "mvex")).toBe(true);
    expect(containsAscii(init, "avcC")).toBe(true);
    expect(containsAscii(init, "dOps")).toBe(true);
  });

  it("builds independently writable video fragments", () => {
    const fragment = createAvcFragmentedMp4Fragment(1, 0, [
      { duration: 7_500, key: true, data: new Uint8Array([1, 2, 3, 4]) },
      { duration: 7_500, key: false, data: new Uint8Array([5, 6, 7]) },
    ]);

    expect(containsAscii(fragment, "moof")).toBe(true);
    expect(containsAscii(fragment, "tfdt")).toBe(true);
    expect(containsAscii(fragment, "trun")).toBe(true);
    expect(containsAscii(fragment, "mdat")).toBe(true);
    expect(fragment.byteLength).toBeLessThan(512);
  });

  it("builds independently writable Opus fragments with large decode times", () => {
    const fragment = createOpusFragmentedMp4Fragment(7, 5_000_000_000, [
      { duration: 960, data: new Uint8Array([8, 9, 10]) },
      { duration: 960, data: new Uint8Array([11, 12]) },
    ]);

    expect(containsAscii(fragment, "moof")).toBe(true);
    expect(containsAscii(fragment, "mdat")).toBe(true);
  });
});
