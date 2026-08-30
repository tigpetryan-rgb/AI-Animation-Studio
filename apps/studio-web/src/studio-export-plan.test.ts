import { describe, expect, it } from "vitest";
import {
  DEFAULT_STUDIO_EXPORT_SETTINGS,
  MAX_IN_MEMORY_EXPORT_BYTES,
  exportPlanSummary,
  planStudioExport,
  type StudioExportSettings,
} from "./studio-export-plan";
import type { MovieExportProfile } from "./studio-movie-session";

const sourceProfile: MovieExportProfile = Object.freeze({
  width: 320,
  height: 180,
  frameRate: 12,
  sampleRate: 48_000,
  numberOfChannels: 1,
});

describe("Studio export workload plan", () => {
  it("uses source defaults without silently changing the Timeline profile", () => {
    const plan = planStudioExport(sourceProfile, 4, DEFAULT_STUDIO_EXPORT_SETTINGS);

    expect(plan.width).toBe(320);
    expect(plan.height).toBe(180);
    expect(plan.frameRate).toBe(12);
    expect(plan.frameCount).toBe(48);
    expect(plan.totalAudioFrames).toBe(192_000);
    expect(plan.videoBitrate).toBeGreaterThanOrEqual(400_000);
    expect(plan.audioBitrate).toBe(96_000);
    expect(plan.blockedReason).toBeNull();
  });

  it("resolves HD, frame-rate, quality and audio controls into encoder settings", () => {
    const settings: StudioExportSettings = {
      resolution: "720p",
      frameRate: "24",
      quality: "high",
      audioBitrate: "128",
    };
    const plan = planStudioExport(sourceProfile, 10, settings);

    expect(plan.width).toBe(1280);
    expect(plan.height).toBe(720);
    expect(plan.frameRate).toBe(24);
    expect(plan.frameCount).toBe(240);
    expect(plan.videoBitrate).toBeGreaterThan(3_000_000);
    expect(plan.audioBitrate).toBe(128_000);
    expect(exportPlanSummary(plan)).toContain("1280×720 @ 24 fps");
  });

  it("warns before large in-memory jobs and blocks jobs beyond the current safety limit", () => {
    const large = planStudioExport(sourceProfile, 20 * 60, {
      resolution: "1080p",
      frameRate: "30",
      quality: "high",
      audioBitrate: "128",
    });
    expect(large.estimatedOutputBytes).toBeGreaterThan(256 * 1024 * 1024);
    expect(large.warning).not.toBeNull();
    expect(large.blockedReason).toBeNull();

    const unsafe = planStudioExport(sourceProfile, 90 * 60, {
      resolution: "1080p",
      frameRate: "30",
      quality: "high",
      audioBitrate: "128",
    });
    expect(unsafe.estimatedOutputBytes).toBeGreaterThan(MAX_IN_MEMORY_EXPORT_BYTES);
    expect(unsafe.blockedReason).toContain("safety limit");
  });
});
