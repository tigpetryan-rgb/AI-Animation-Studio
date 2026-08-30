import { describe, expect, it } from "vitest";
import {
  MAX_STREAMING_PEAK_WORKING_BYTES,
  planStudioExport,
  type StudioExportSettings,
} from "./studio-export-plan";
import type { MovieExportProfile } from "./studio-movie-session";

const profile: MovieExportProfile = Object.freeze({
  width: 1920,
  height: 1080,
  frameRate: 30,
  sampleRate: 48_000,
  numberOfChannels: 1,
});

const settings: StudioExportSettings = Object.freeze({
  resolution: "1080p",
  frameRate: "30",
  quality: "high",
  audioBitrate: "128",
});

describe("Studio long-export planning", () => {
  it("keeps the streaming working-set estimate independent of movie duration", () => {
    const oneMinute = planStudioExport(profile, 60, settings, "streaming");
    const twoHours = planStudioExport(profile, 2 * 60 * 60, settings, "streaming");

    expect(twoHours.frameCount).toBe(216_000);
    expect(twoHours.totalAudioFrames).toBe(345_600_000);
    expect(twoHours.estimatedOutputBytes).toBeGreaterThan(10 * 1024 * 1024 * 1024);
    expect(twoHours.estimatedPeakWorkingBytes).toBe(oneMinute.estimatedPeakWorkingBytes);
    expect(twoHours.estimatedPeakWorkingBytes).toBeLessThan(MAX_STREAMING_PEAK_WORKING_BYTES);
    expect(twoHours.blockedReason).toBeNull();
    expect(twoHours.warning).toContain("Large disk-backed export");
  });

  it("keeps a 24-hour streaming plan inside safe integer timeline counts", () => {
    const twentyFourHours = planStudioExport(profile, 24 * 60 * 60, settings, "streaming");

    expect(Number.isSafeInteger(twentyFourHours.frameCount)).toBe(true);
    expect(Number.isSafeInteger(twentyFourHours.totalAudioFrames)).toBe(true);
    expect(twentyFourHours.frameCount).toBe(2_592_000);
    expect(twentyFourHours.totalAudioFrames).toBe(4_147_200_000);
    expect(twentyFourHours.estimatedPeakWorkingBytes).toBeLessThan(MAX_STREAMING_PEAK_WORKING_BYTES);
    expect(twentyFourHours.blockedReason).toBeNull();
  });
});
