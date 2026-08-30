import { createStudioProject, type StudioProject } from "@aistudio/core-project";
import { compareTime, rationalTime, ZERO_TIME, type RationalTime } from "@aistudio/core-time";
import { asProjectId } from "@aistudio/core-types";
import {
  clipEnd,
  clipsAtTime,
  mapTimelineToSource,
  validateTimeline,
  type Timeline,
  type TimelineClip,
  type TimelineTrack,
  type TimelineTrackKind,
} from "@aistudio/timeline-engine";

export interface MovieExportProfile {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly sampleRate: number;
  readonly numberOfChannels: 1;
}

export type MovieMediaEncoding = "identity" | "base64";

interface MovieMediaSource {
  readonly uri: string;
  readonly encoding: MovieMediaEncoding;
  readonly mimeType: string;
}

export interface MovieImageAsset extends MovieMediaSource {
  readonly id: string;
  readonly kind: "video";
  readonly mediaType: "image";
  readonly label: string;
  readonly pan: "left-to-right" | "right-to-left";
}

export interface MovieVideoFileAsset extends MovieMediaSource {
  readonly id: string;
  readonly kind: "video";
  readonly mediaType: "video";
  readonly label: string;
  readonly loop: boolean;
}

export type MovieVideoAsset = MovieImageAsset | MovieVideoFileAsset;

export interface MovieAudioAsset extends MovieMediaSource {
  readonly id: string;
  readonly kind: "audio";
  readonly mediaType: "audio";
  readonly label: string;
  readonly gain: number;
  readonly loop: boolean;
}

export type MovieTimelineAsset = MovieVideoAsset | MovieAudioAsset;

export interface StudioMovieSession {
  readonly project: StudioProject;
  readonly timeline: Timeline;
  readonly assets: Readonly<Record<string, MovieTimelineAsset>>;
  readonly exportProfile: MovieExportProfile;
}

export interface SampledTimelineClip<TAsset extends MovieTimelineAsset> {
  readonly track: TimelineTrack;
  readonly clip: TimelineClip;
  readonly asset: TAsset;
  readonly timelineTime: RationalTime;
  readonly sourceTime: RationalTime;
}

export interface MovieTimelineSample {
  readonly video: SampledTimelineClip<MovieVideoAsset> | undefined;
  readonly audio: SampledTimelineClip<MovieAudioAsset> | undefined;
}

function seconds(time: RationalTime): number {
  return Number(time.value) / Number(time.timescale);
}

function requireTrack(timeline: Timeline, kind: TimelineTrackKind): TimelineTrack | undefined {
  return timeline.tracks.find((track) => track.kind === kind);
}

function resolveClip<TAsset extends MovieTimelineAsset>(
  session: StudioMovieSession,
  kind: "video" | "audio",
  timelineTime: RationalTime,
): SampledTimelineClip<TAsset> | undefined {
  const track = requireTrack(session.timeline, kind);
  if (track === undefined) return undefined;
  const clip = clipsAtTime(track, timelineTime)[0];
  if (clip === undefined) return undefined;
  const asset = session.assets[clip.assetId];
  if (asset === undefined || asset.kind !== kind) {
    throw new Error(`Timeline clip ${clip.id} references missing ${kind} asset ${clip.assetId}.`);
  }
  return {
    track,
    clip,
    asset: asset as TAsset,
    timelineTime,
    sourceTime: mapTimelineToSource(clip, timelineTime),
  };
}

export function sampleMovieTimeline(
  session: StudioMovieSession,
  timelineTime: RationalTime,
): MovieTimelineSample {
  return {
    video: resolveClip<MovieVideoAsset>(session, "video", timelineTime),
    audio: resolveClip<MovieAudioAsset>(session, "audio", timelineTime),
  };
}

export function movieDuration(session: StudioMovieSession): RationalTime {
  let end = ZERO_TIME;
  for (const track of session.timeline.tracks) {
    for (const clip of track.clips) {
      const candidate = clipEnd(clip);
      if (compareTime(candidate, end) > 0) end = candidate;
    }
  }
  return end;
}

export function movieDurationSeconds(session: StudioMovieSession): number {
  return seconds(movieDuration(session));
}

export function rationalSeconds(time: RationalTime): number {
  return seconds(time);
}

function validateMediaSource(asset: MovieTimelineAsset): void {
  if (asset.uri.trim().length === 0) throw new Error(`Media asset ${asset.id} requires a URI.`);
  if (asset.mimeType.trim().length === 0) throw new Error(`Media asset ${asset.id} requires a MIME type.`);
  if (asset.mediaType === "image" && !asset.mimeType.startsWith("image/")) {
    throw new Error(`Image asset ${asset.id} requires an image MIME type.`);
  }
  if (asset.mediaType === "video" && !asset.mimeType.startsWith("video/")) {
    throw new Error(`Video asset ${asset.id} requires a video MIME type.`);
  }
  if (asset.mediaType === "audio" && !asset.mimeType.startsWith("audio/")) {
    throw new Error(`Audio asset ${asset.id} requires an audio MIME type.`);
  }
}

export function validateMovieSession(session: StudioMovieSession): StudioMovieSession {
  const diagnostics = validateTimeline(session.timeline);
  if (diagnostics.length > 0) {
    throw new Error(`Movie timeline is invalid: ${diagnostics[0]?.code ?? "unknown"}.`);
  }
  for (const asset of Object.values(session.assets)) validateMediaSource(asset);
  for (const track of session.timeline.tracks) {
    if (track.kind !== "video" && track.kind !== "audio") continue;
    for (const clip of track.clips) {
      const asset = session.assets[clip.assetId];
      if (asset === undefined || asset.kind !== track.kind) {
        throw new Error(`Clip ${clip.id} does not resolve to a ${track.kind} asset.`);
      }
    }
  }
  if (compareTime(movieDuration(session), ZERO_TIME) <= 0) {
    throw new Error("Movie timeline must have a positive duration.");
  }
  return session;
}

export function createLocalDemoMovieSession(): StudioMovieSession {
  const project = createStudioProject({
    projectId: asProjectId("local-demo-project"),
    name: "Local Demo Movie",
  });

  const assets: Readonly<Record<string, MovieTimelineAsset>> = Object.freeze({
    "visual-opening": Object.freeze({
      id: "visual-opening",
      kind: "video",
      mediaType: "image",
      label: "Opening shot",
      uri: "./demo-media/opening-shot.svg",
      encoding: "identity",
      mimeType: "image/svg+xml",
      pan: "left-to-right",
    }),
    "visual-action": Object.freeze({
      id: "visual-action",
      kind: "video",
      mediaType: "video",
      label: "Action video",
      uri: "./demo-media/action-shot.webm.b64",
      encoding: "base64",
      mimeType: "video/webm",
      loop: true,
    }),
    "audio-opening": Object.freeze({
      id: "audio-opening",
      kind: "audio",
      mediaType: "audio",
      label: "Opening audio",
      uri: "./demo-media/opening-tone.ogg.b64",
      encoding: "base64",
      mimeType: "audio/ogg",
      gain: 0.32,
      loop: true,
    }),
    "audio-action": Object.freeze({
      id: "audio-action",
      kind: "audio",
      mediaType: "audio",
      label: "Action audio",
      uri: "./demo-media/action-tone.ogg.b64",
      encoding: "base64",
      mimeType: "audio/ogg",
      gain: 0.32,
      loop: true,
    }),
  });

  const timeline: Timeline = Object.freeze({
    id: "local-demo-timeline",
    tracks: Object.freeze([
      Object.freeze({
        id: "picture",
        kind: "video" as const,
        allowsOverlap: false,
        clips: Object.freeze([
          Object.freeze({
            id: "opening-shot",
            assetId: "visual-opening",
            timelineStart: rationalTime(0n, 1n),
            sourceIn: rationalTime(0n, 1n),
            duration: rationalTime(2n, 1n),
          }),
          Object.freeze({
            id: "action-shot",
            assetId: "visual-action",
            timelineStart: rationalTime(2n, 1n),
            sourceIn: rationalTime(1n, 2n),
            duration: rationalTime(2n, 1n),
          }),
        ]),
      }),
      Object.freeze({
        id: "dialogue-music",
        kind: "audio" as const,
        allowsOverlap: false,
        clips: Object.freeze([
          Object.freeze({
            id: "opening-audio",
            assetId: "audio-opening",
            timelineStart: rationalTime(0n, 1n),
            sourceIn: rationalTime(0n, 1n),
            duration: rationalTime(2n, 1n),
          }),
          Object.freeze({
            id: "action-audio",
            assetId: "audio-action",
            timelineStart: rationalTime(2n, 1n),
            sourceIn: rationalTime(1n, 4n),
            duration: rationalTime(2n, 1n),
          }),
        ]),
      }),
    ]),
  });

  return validateMovieSession(Object.freeze({
    project,
    timeline,
    assets,
    exportProfile: Object.freeze({
      width: 320,
      height: 180,
      frameRate: 12,
      sampleRate: 48_000,
      numberOfChannels: 1,
    }),
  }));
}

const localDemoSession = createLocalDemoMovieSession();
const movieSessionRegistry = new Map<string, StudioMovieSession>([
  [localDemoSession.project.projectId, localDemoSession],
]);

function announceMovieSession(session: StudioMovieSession): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("aistudio:movie-session-change", {
    detail: { projectId: session.project.projectId },
  }));
}

export function registerMovieSession(session: StudioMovieSession): StudioMovieSession {
  const validated = validateMovieSession(session);
  movieSessionRegistry.set(validated.project.projectId, validated);
  announceMovieSession(validated);
  return validated;
}

export function resetLocalDemoMovieSession(): StudioMovieSession {
  movieSessionRegistry.set(localDemoSession.project.projectId, localDemoSession);
  announceMovieSession(localDemoSession);
  return localDemoSession;
}

export function movieSessionForProjectId(projectId: string | null): StudioMovieSession | null {
  if (projectId === null) return null;
  return movieSessionRegistry.get(projectId) ?? null;
}
