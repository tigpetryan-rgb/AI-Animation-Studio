import {
  AV_MP4_AUDIO_CODEC,
  AV_MP4_OPUS_SAMPLE_RATE,
  AV_MP4_VIDEO_CODEC,
} from "@aistudio/media-export/mp4";
import {
  planStudioExport,
  type ExportFrameRatePreset,
  type ExportResolutionPreset,
  type StudioExportPlan,
  type StudioExportSettings,
} from "./studio-export-plan";
import type { MovieExportProfile } from "./studio-movie-session";

export type StudioCapabilityKey = `${ExportResolutionPreset}:${ExportFrameRatePreset}`;

export interface StudioCodecCapabilityProbe {
  video(config: VideoEncoderConfig): Promise<boolean>;
  audio(config: AudioEncoderConfig): Promise<boolean>;
}

export interface StudioExportCapabilityMatrix {
  readonly webCodecsAvailable: boolean;
  readonly opusSupported: boolean;
  readonly aacSupported: boolean;
  readonly video: Readonly<Record<StudioCapabilityKey, boolean>>;
}

const RESOLUTIONS: readonly ExportResolutionPreset[] = ["source", "720p", "1080p"];
const FRAME_RATES: readonly ExportFrameRatePreset[] = ["source", "24", "30"];

export function studioCapabilityKey(
  resolution: ExportResolutionPreset,
  frameRate: ExportFrameRatePreset,
): StudioCapabilityKey {
  return `${resolution}:${frameRate}`;
}

export function studioVideoEncoderConfig(plan: StudioExportPlan): VideoEncoderConfig {
  return {
    codec: AV_MP4_VIDEO_CODEC,
    width: plan.width,
    height: plan.height,
    bitrate: plan.videoBitrate,
    framerate: plan.frameRate,
    latencyMode: "realtime",
    avc: { format: "avc" },
  };
}

function opusEncoderConfig(profile: MovieExportProfile, plan: StudioExportPlan): AudioEncoderConfig {
  return {
    codec: AV_MP4_AUDIO_CODEC,
    sampleRate: AV_MP4_OPUS_SAMPLE_RATE,
    numberOfChannels: profile.numberOfChannels,
    bitrate: plan.audioBitrate,
  };
}

function aacEncoderConfig(profile: MovieExportProfile, plan: StudioExportPlan): AudioEncoderConfig {
  return {
    codec: "mp4a.40.2",
    sampleRate: profile.sampleRate,
    numberOfChannels: profile.numberOfChannels,
    bitrate: plan.audioBitrate,
  };
}

export function browserStudioCodecCapabilityProbe(): StudioCodecCapabilityProbe | null {
  if (typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined") return null;
  return {
    async video(config) {
      try {
        return (await VideoEncoder.isConfigSupported(config)).supported;
      } catch {
        return false;
      }
    },
    async audio(config) {
      try {
        return (await AudioEncoder.isConfigSupported(config)).supported;
      } catch {
        return false;
      }
    },
  };
}

export async function probeStudioExportCapabilities(
  profile: MovieExportProfile,
  durationSeconds: number,
  settings: StudioExportSettings,
  probe: StudioCodecCapabilityProbe | null = browserStudioCodecCapabilityProbe(),
): Promise<StudioExportCapabilityMatrix> {
  if (probe === null) {
    const empty = Object.fromEntries(
      RESOLUTIONS.flatMap((resolution) => FRAME_RATES.map((frameRate) => [studioCapabilityKey(resolution, frameRate), false])),
    ) as Record<StudioCapabilityKey, boolean>;
    return Object.freeze({
      webCodecsAvailable: false,
      opusSupported: false,
      aacSupported: false,
      video: Object.freeze(empty),
    });
  }

  const combinations = RESOLUTIONS.flatMap((resolution) => FRAME_RATES.map((frameRate) => ({ resolution, frameRate })));
  const videoEntries = await Promise.all(combinations.map(async ({ resolution, frameRate }) => {
    const plan = planStudioExport(profile, durationSeconds, { ...settings, resolution, frameRate }, "streaming");
    const supported = plan.blockedReason === null && await probe.video(studioVideoEncoderConfig(plan));
    return [studioCapabilityKey(resolution, frameRate), supported] as const;
  }));

  const selectedPlan = planStudioExport(profile, durationSeconds, settings, "streaming");
  const [opusSupported, aacSupported] = await Promise.all([
    probe.audio(opusEncoderConfig(profile, selectedPlan)),
    probe.audio(aacEncoderConfig(profile, selectedPlan)),
  ]);

  return Object.freeze({
    webCodecsAvailable: true,
    opusSupported,
    aacSupported,
    video: Object.freeze(Object.fromEntries(videoEntries) as Record<StudioCapabilityKey, boolean>),
  });
}

export function isStudioExportSelectionSupported(
  matrix: StudioExportCapabilityMatrix,
  settings: StudioExportSettings,
): boolean {
  return matrix.opusSupported && matrix.video[studioCapabilityKey(settings.resolution, settings.frameRate)] === true;
}

export function studioCompatibilitySummary(matrix: StudioExportCapabilityMatrix): string {
  if (!matrix.webCodecsAvailable) return "WebCodecs export is unavailable on this browser.";
  if (!matrix.opusSupported) return "Native Opus encoding is unavailable on this browser.";
  if (matrix.aacSupported) return "H.264 + Opus is ready; native AAC is also available for a future compatibility mux path.";
  return "H.264 + Opus is the available native MP4 path; native AAC is unavailable on this browser.";
}
