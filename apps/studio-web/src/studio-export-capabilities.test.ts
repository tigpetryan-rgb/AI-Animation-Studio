import { describe, expect, it } from "vitest";
import {
  isStudioExportSelectionSupported,
  probeStudioExportCapabilities,
  studioCapabilityKey,
  studioCompatibilitySummary,
  type StudioCodecCapabilityProbe,
} from "./studio-export-capabilities";
import { DEFAULT_STUDIO_EXPORT_SETTINGS } from "./studio-export-plan";
import type { MovieExportProfile } from "./studio-movie-session";

const sourceProfile: MovieExportProfile = Object.freeze({
  width: 320,
  height: 180,
  frameRate: 12,
  sampleRate: 48_000,
  numberOfChannels: 1,
});

describe("Studio export capability matrix", () => {
  it("filters resolution/frame-rate combinations using the active device encoder", async () => {
    const probe: StudioCodecCapabilityProbe = {
      async video(config) {
        return config.width === 320 && config.height === 180 && config.framerate === 12;
      },
      async audio(config) {
        return config.codec === "opus";
      },
    };

    const matrix = await probeStudioExportCapabilities(
      sourceProfile,
      4,
      DEFAULT_STUDIO_EXPORT_SETTINGS,
      probe,
    );

    expect(matrix.video[studioCapabilityKey("source", "source")]).toBe(true);
    expect(matrix.video[studioCapabilityKey("720p", "24")]).toBe(false);
    expect(matrix.video[studioCapabilityKey("1080p", "30")]).toBe(false);
    expect(matrix.opusSupported).toBe(true);
    expect(matrix.aacSupported).toBe(false);
    expect(isStudioExportSelectionSupported(matrix, DEFAULT_STUDIO_EXPORT_SETTINGS)).toBe(true);
  });

  it("reports native AAC separately from the currently enabled Opus MP4 path", async () => {
    const probe: StudioCodecCapabilityProbe = {
      async video() { return true; },
      async audio() { return true; },
    };
    const matrix = await probeStudioExportCapabilities(
      sourceProfile,
      4,
      DEFAULT_STUDIO_EXPORT_SETTINGS,
      probe,
    );

    expect(matrix.aacSupported).toBe(true);
    expect(studioCompatibilitySummary(matrix)).toContain("native AAC is also available");
  });

  it("fails closed when WebCodecs is unavailable", async () => {
    const matrix = await probeStudioExportCapabilities(
      sourceProfile,
      4,
      DEFAULT_STUDIO_EXPORT_SETTINGS,
      null,
    );

    expect(matrix.webCodecsAvailable).toBe(false);
    expect(matrix.opusSupported).toBe(false);
    expect(matrix.video[studioCapabilityKey("source", "source")]).toBe(false);
  });
});
