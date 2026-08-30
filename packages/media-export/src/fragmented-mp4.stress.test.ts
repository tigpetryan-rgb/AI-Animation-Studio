import { describe, expect, it } from "vitest";
import {
  createAvcFragmentedMp4Fragment,
  createOpusFragmentedMp4Fragment,
  type FragmentedMp4Sample,
} from "./fragmented-mp4-core";

const VIDEO_TIMESCALE = 90_000;
const AUDIO_TIMESCALE = 48_000;
const VIDEO_SAMPLES_PER_SECOND = 30;
const AUDIO_SAMPLES_PER_SECOND = 50;
const TWO_HOURS_SECONDS = 2 * 60 * 60;

describe("fragmented MP4 long timeline stress", () => {
  it("walks a two-hour 30 fps timeline without growing individual fragments with duration", () => {
    const videoSamples: readonly FragmentedMp4Sample[] = Array.from(
      { length: VIDEO_SAMPLES_PER_SECOND },
      (_, index) => ({
        duration: VIDEO_TIMESCALE / VIDEO_SAMPLES_PER_SECOND,
        key: index === 0,
        data: new Uint8Array([0, 0, 0, index & 0xff]),
      }),
    );
    const audioSamples: readonly FragmentedMp4Sample[] = Array.from(
      { length: AUDIO_SAMPLES_PER_SECOND },
      (_, index) => ({
        duration: AUDIO_TIMESCALE / AUDIO_SAMPLES_PER_SECOND,
        data: new Uint8Array([index & 0xff, 1, 2, 3]),
      }),
    );

    let sequence = 1;
    let totalBytes = 0;
    let maxFragmentBytes = 0;
    for (let second = 0; second < TWO_HOURS_SECONDS; second += 1) {
      const video = createAvcFragmentedMp4Fragment(
        sequence,
        second * VIDEO_TIMESCALE,
        videoSamples,
      );
      sequence += 1;
      const audio = createOpusFragmentedMp4Fragment(
        sequence,
        second * AUDIO_TIMESCALE,
        audioSamples,
      );
      sequence += 1;

      totalBytes += video.byteLength + audio.byteLength;
      maxFragmentBytes = Math.max(maxFragmentBytes, video.byteLength, audio.byteLength);
    }

    expect(sequence).toBe(TWO_HOURS_SECONDS * 2 + 1);
    expect(totalBytes).toBeGreaterThan(5 * 1024 * 1024);
    expect(maxFragmentBytes).toBeLessThan(4 * 1024);
  });

  it("keeps 64-bit decode times valid beyond the 32-bit timescale boundary", () => {
    const fragment = createAvcFragmentedMp4Fragment(100_000, 5_000_000_000, [
      { duration: 3_000, key: true, data: new Uint8Array([1, 2, 3, 4]) },
    ]);

    expect(fragment.byteLength).toBeGreaterThan(64);
    expect(fragment.byteLength).toBeLessThan(512);
  });
});
