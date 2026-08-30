import type { MovieExportProfile } from "./studio-movie-session";

export type ExportResolutionPreset = "source" | "720p" | "1080p";
export type ExportFrameRatePreset = "source" | "24" | "30";
export type ExportQualityPreset = "draft" | "balanced" | "high";
export type ExportAudioBitratePreset = "64" | "96" | "128";
export type ExportStorageMode = "memory" | "streaming";

export interface StudioExportSettings {
  readonly resolution: ExportResolutionPreset;
  readonly frameRate: ExportFrameRatePreset;
  readonly quality: ExportQualityPreset;
  readonly audioBitrate: ExportAudioBitratePreset;
}

export interface StudioExportPlan {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly frameCount: number;
  readonly sampleRate: number;
  readonly totalAudioFrames: number;
  readonly videoBitrate: number;
  readonly audioBitrate: number;
  readonly estimatedOutputBytes: number;
  readonly estimatedPeakWorkingBytes: number;
  readonly storageMode: ExportStorageMode;
  readonly warning: string | null;
  readonly blockedReason: string | null;
}

export const DEFAULT_STUDIO_EXPORT_SETTINGS: StudioExportSettings = Object.freeze({
  resolution: "source",
  frameRate: "source",
  quality: "balanced",
  audioBitrate: "96",
});

export const MAX_IN_MEMORY_EXPORT_BYTES = 768 * 1024 * 1024;
export const WARN_IN_MEMORY_EXPORT_BYTES = 256 * 1024 * 1024;
export const MAX_STREAMING_PEAK_WORKING_BYTES = 256 * 1024 * 1024;
export const MAX_EXPORT_PIXELS = 1920 * 1080;

const QUALITY_BITS_PER_PIXEL_FRAME: Readonly<Record<ExportQualityPreset, number>> = Object.freeze({
  draft: 0.08,
  balanced: 0.12,
  high: 0.18,
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function dimensions(profile: MovieExportProfile, preset: ExportResolutionPreset): readonly [number, number] {
  if (preset === "720p") return [1280, 720];
  if (preset === "1080p") return [1920, 1080];
  return [profile.width, profile.height];
}

function outputFrameRate(profile: MovieExportProfile, preset: ExportFrameRatePreset): number {
  if (preset === "24") return 24;
  if (preset === "30") return 30;
  return profile.frameRate;
}

function videoBitrate(width: number, height: number, frameRate: number, quality: ExportQualityPreset): number {
  const raw = Math.round(width * height * frameRate * QUALITY_BITS_PER_PIXEL_FRAME[quality]);
  return clamp(raw, 400_000, 18_000_000);
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function planStudioExport(
  profile: MovieExportProfile,
  durationSeconds: number,
  settings: StudioExportSettings,
  storageMode: ExportStorageMode = "memory",
): StudioExportPlan {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new RangeError("Export duration must be a positive finite number.");
  }

  const [width, height] = dimensions(profile, settings.resolution);
  const frameRate = outputFrameRate(profile, settings.frameRate);
  const frameCount = Math.ceil(durationSeconds * frameRate);
  const totalAudioFrames = Math.ceil(durationSeconds * profile.sampleRate);
  const resolvedVideoBitrate = videoBitrate(width, height, frameRate, settings.quality);
  const resolvedAudioBitrate = Number(settings.audioBitrate) * 1000 * profile.numberOfChannels;

  const encodedPayloadBytes = (resolvedVideoBitrate + resolvedAudioBitrate) * durationSeconds / 8;
  const estimatedOutputBytes = Math.ceil(encodedPayloadBytes * 1.04 + 256 * 1024);
  const rgbaSurfaceBytes = width * height * 4;
  const oneSecondEncodedBytes = (resolvedVideoBitrate + resolvedAudioBitrate) / 8;
  const estimatedPeakWorkingBytes = storageMode === "streaming"
    ? Math.ceil(
      rgbaSurfaceBytes * 8
      + oneSecondEncodedBytes * 3
      + 48 * 1024 * 1024,
    )
    : Math.ceil(
      estimatedOutputBytes * 2.15
      + rgbaSurfaceBytes * 8
      + 32 * 1024 * 1024,
    );

  let blockedReason: string | null = null;
  if (width * height > MAX_EXPORT_PIXELS) {
    blockedReason = `This build limits in-browser MP4 export to 1920×1080; requested ${width}×${height}.`;
  } else if (storageMode === "memory" && estimatedOutputBytes > MAX_IN_MEMORY_EXPORT_BYTES) {
    blockedReason = `Estimated MP4 size ${formatMegabytes(estimatedOutputBytes)} exceeds the current ${formatMegabytes(MAX_IN_MEMORY_EXPORT_BYTES)} in-memory export safety limit.`;
  } else if (storageMode === "streaming" && estimatedPeakWorkingBytes > MAX_STREAMING_PEAK_WORKING_BYTES) {
    blockedReason = `Estimated streaming working set ${formatMegabytes(estimatedPeakWorkingBytes)} exceeds the current ${formatMegabytes(MAX_STREAMING_PEAK_WORKING_BYTES)} browser safety limit.`;
  }

  let warning: string | null = null;
  if (blockedReason === null && storageMode === "memory" && estimatedOutputBytes >= WARN_IN_MEMORY_EXPORT_BYTES) {
    warning = `Large in-memory export: about ${formatMegabytes(estimatedOutputBytes)} output and ${formatMegabytes(estimatedPeakWorkingBytes)} estimated peak working memory.`;
  } else if (blockedReason === null && storageMode === "memory" && estimatedPeakWorkingBytes >= 512 * 1024 * 1024) {
    warning = `This export may need about ${formatMegabytes(estimatedPeakWorkingBytes)} of peak working memory.`;
  } else if (blockedReason === null && storageMode === "streaming" && estimatedOutputBytes >= 2 * 1024 * 1024 * 1024) {
    warning = `Large disk-backed export: about ${formatMegabytes(estimatedOutputBytes)} output. Streaming keeps the encoded movie out of RAM, but sufficient local storage is required.`;
  }

  return Object.freeze({
    width,
    height,
    frameRate,
    frameCount,
    sampleRate: profile.sampleRate,
    totalAudioFrames,
    videoBitrate: resolvedVideoBitrate,
    audioBitrate: resolvedAudioBitrate,
    estimatedOutputBytes,
    estimatedPeakWorkingBytes,
    storageMode,
    warning,
    blockedReason,
  });
}

export function exportPlanSummary(plan: StudioExportPlan): string {
  const outputMb = plan.estimatedOutputBytes / (1024 * 1024);
  const peakMb = plan.estimatedPeakWorkingBytes / (1024 * 1024);
  const storageLabel = plan.storageMode === "streaming" ? "disk-streamed" : "in-memory";
  return `${plan.width}×${plan.height} @ ${plan.frameRate} fps · video ${(plan.videoBitrate / 1_000_000).toFixed(2)} Mbps · audio ${Math.round(plan.audioBitrate / 1000)} kbps · est. ${outputMb.toFixed(outputMb >= 100 ? 0 : 1)} MB output / ${peakMb.toFixed(0)} MB peak · ${storageLabel}`;
}
