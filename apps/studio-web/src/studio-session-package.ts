import {
  exportAistudioPackage,
  importAistudioPackage,
  type AistudioArchiveEntry,
} from "@aistudio/project-format";
import { rationalTime, type RationalTime } from "@aistudio/core-time";
import type { Timeline, TimelineClip, TimelineTrack, TimelineTrackKind } from "@aistudio/timeline-engine";
import {
  validateMovieSession,
  type MovieAudioAsset,
  type MovieExportProfile,
  type MovieImageAsset,
  type MovieTimelineAsset,
  type MovieVideoFileAsset,
  type StudioMovieSession,
} from "./studio-movie-session";

export const MOVIE_SESSION_PACKAGE_PATH = "MOVIE/session.json" as const;
export const MOVIE_SESSION_FORMAT = "aistudio-movie-session" as const;
export const MOVIE_SESSION_FORMAT_VERSION = 1 as const;

interface SerializedTime {
  readonly value: string;
  readonly timescale: string;
}

interface SerializedClip {
  readonly id: string;
  readonly assetId: string;
  readonly timelineStart: SerializedTime;
  readonly sourceIn: SerializedTime;
  readonly duration: SerializedTime;
}

interface SerializedTrack {
  readonly id: string;
  readonly kind: TimelineTrackKind;
  readonly allowsOverlap: boolean;
  readonly clips: readonly SerializedClip[];
}

interface SerializedMovieSession {
  readonly format: typeof MOVIE_SESSION_FORMAT;
  readonly formatVersion: typeof MOVIE_SESSION_FORMAT_VERSION;
  readonly timeline: {
    readonly id: string;
    readonly tracks: readonly SerializedTrack[];
  };
  readonly assets: readonly MovieTimelineAsset[];
  readonly exportProfile: MovieExportProfile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeTime(time: RationalTime): SerializedTime {
  return Object.freeze({ value: time.value.toString(), timescale: time.timescale.toString() });
}

function deserializeTime(value: unknown, label: string): RationalTime {
  if (!isRecord(value) || typeof value.value !== "string" || typeof value.timescale !== "string") {
    throw new Error(`${label} is not a serialized RationalTime.`);
  }
  try {
    return rationalTime(BigInt(value.value), BigInt(value.timescale));
  } catch {
    throw new Error(`${label} contains an invalid RationalTime.`);
  }
}

function serializeClip(clip: TimelineClip): SerializedClip {
  return Object.freeze({
    id: clip.id,
    assetId: clip.assetId,
    timelineStart: serializeTime(clip.timelineStart),
    sourceIn: serializeTime(clip.sourceIn),
    duration: serializeTime(clip.duration),
  });
}

function serializeTrack(track: TimelineTrack): SerializedTrack {
  return Object.freeze({
    id: track.id,
    kind: track.kind,
    allowsOverlap: track.allowsOverlap,
    clips: Object.freeze(track.clips.map(serializeClip)),
  });
}

function serializeSession(session: StudioMovieSession): SerializedMovieSession {
  const assets = Object.values(session.assets)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((asset) => Object.freeze({ ...asset } as MovieTimelineAsset));
  return Object.freeze({
    format: MOVIE_SESSION_FORMAT,
    formatVersion: MOVIE_SESSION_FORMAT_VERSION,
    timeline: Object.freeze({
      id: session.timeline.id,
      tracks: Object.freeze(session.timeline.tracks.map(serializeTrack)),
    }),
    assets: Object.freeze(assets),
    exportProfile: Object.freeze({ ...session.exportProfile }),
  });
}

function parseTrackKind(value: unknown): TimelineTrackKind {
  if (value === "video" || value === "audio" || value === "animation" || value === "camera" || value === "event") {
    return value;
  }
  throw new Error(`Unsupported Timeline track kind ${String(value)}.`);
}

function parseClip(value: unknown): TimelineClip {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.assetId !== "string") {
    throw new Error("Movie session contains a malformed Timeline clip.");
  }
  return Object.freeze({
    id: value.id,
    assetId: value.assetId,
    timelineStart: deserializeTime(value.timelineStart, `${value.id}.timelineStart`),
    sourceIn: deserializeTime(value.sourceIn, `${value.id}.sourceIn`),
    duration: deserializeTime(value.duration, `${value.id}.duration`),
  });
}

function parseTrack(value: unknown): TimelineTrack {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || typeof value.allowsOverlap !== "boolean"
    || !Array.isArray(value.clips)
  ) {
    throw new Error("Movie session contains a malformed Timeline track.");
  }
  return Object.freeze({
    id: value.id,
    kind: parseTrackKind(value.kind),
    allowsOverlap: value.allowsOverlap,
    clips: Object.freeze(value.clips.map(parseClip)),
  });
}

function parseMediaAsset(value: unknown): MovieTimelineAsset {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || typeof value.label !== "string"
    || typeof value.uri !== "string"
    || (value.encoding !== "identity" && value.encoding !== "base64")
    || typeof value.mimeType !== "string"
  ) {
    throw new Error("Movie session contains a malformed media asset.");
  }

  if (value.kind === "video" && value.mediaType === "image") {
    if (value.pan !== "left-to-right" && value.pan !== "right-to-left") {
      throw new Error(`Image asset ${value.id} contains an invalid pan mode.`);
    }
    return Object.freeze({
      id: value.id,
      kind: "video",
      mediaType: "image",
      label: value.label,
      uri: value.uri,
      encoding: value.encoding,
      mimeType: value.mimeType,
      pan: value.pan,
    } satisfies MovieImageAsset);
  }

  if (value.kind === "video" && value.mediaType === "video") {
    if (typeof value.loop !== "boolean") throw new Error(`Video asset ${value.id} requires loop state.`);
    return Object.freeze({
      id: value.id,
      kind: "video",
      mediaType: "video",
      label: value.label,
      uri: value.uri,
      encoding: value.encoding,
      mimeType: value.mimeType,
      loop: value.loop,
    } satisfies MovieVideoFileAsset);
  }

  if (value.kind === "audio" && value.mediaType === "audio") {
    if (typeof value.loop !== "boolean" || typeof value.gain !== "number" || !Number.isFinite(value.gain)) {
      throw new Error(`Audio asset ${value.id} contains invalid gain/loop state.`);
    }
    return Object.freeze({
      id: value.id,
      kind: "audio",
      mediaType: "audio",
      label: value.label,
      uri: value.uri,
      encoding: value.encoding,
      mimeType: value.mimeType,
      gain: value.gain,
      loop: value.loop,
    } satisfies MovieAudioAsset);
  }

  throw new Error(`Movie session contains unsupported media asset ${value.id}.`);
}

function parseExportProfile(value: unknown): MovieExportProfile {
  if (
    !isRecord(value)
    || typeof value.width !== "number"
    || typeof value.height !== "number"
    || typeof value.frameRate !== "number"
    || typeof value.sampleRate !== "number"
    || value.numberOfChannels !== 1
    || !Number.isInteger(value.width)
    || !Number.isInteger(value.height)
    || !Number.isFinite(value.frameRate)
    || !Number.isInteger(value.sampleRate)
    || value.width <= 0
    || value.height <= 0
    || value.frameRate <= 0
    || value.sampleRate <= 0
  ) {
    throw new Error("Movie session contains an invalid export profile.");
  }
  return Object.freeze({
    width: value.width,
    height: value.height,
    frameRate: value.frameRate,
    sampleRate: value.sampleRate,
    numberOfChannels: 1,
  });
}

function parseSerializedSession(value: unknown): Omit<StudioMovieSession, "project"> {
  if (
    !isRecord(value)
    || value.format !== MOVIE_SESSION_FORMAT
    || value.formatVersion !== MOVIE_SESSION_FORMAT_VERSION
    || !isRecord(value.timeline)
    || typeof value.timeline.id !== "string"
    || !Array.isArray(value.timeline.tracks)
    || !Array.isArray(value.assets)
  ) {
    throw new Error(".aistudio package contains an invalid movie-session manifest.");
  }

  const timeline: Timeline = Object.freeze({
    id: value.timeline.id,
    tracks: Object.freeze(value.timeline.tracks.map(parseTrack)),
  });
  const assets: Record<string, MovieTimelineAsset> = {};
  for (const rawAsset of value.assets) {
    const asset = parseMediaAsset(rawAsset);
    if (assets[asset.id] !== undefined) throw new Error(`Duplicate media asset ${asset.id}.`);
    assets[asset.id] = asset;
  }

  return Object.freeze({
    timeline,
    assets: Object.freeze(assets),
    exportProfile: parseExportProfile(value.exportProfile),
  });
}

export function movieSessionArchiveEntry(session: StudioMovieSession): AistudioArchiveEntry {
  const data = new TextEncoder().encode(JSON.stringify(serializeSession(session)));
  return Object.freeze({ path: MOVIE_SESSION_PACKAGE_PATH, data });
}

export async function exportMovieSessionPackage(session: StudioMovieSession): Promise<Uint8Array> {
  return exportAistudioPackage(session.project, [movieSessionArchiveEntry(session)]);
}

export async function importMovieSessionPackage(archive: Uint8Array): Promise<StudioMovieSession> {
  const imported = await importAistudioPackage(archive);
  const entry = imported.extraEntries.find((candidate) => candidate.path === MOVIE_SESSION_PACKAGE_PATH);
  if (entry === undefined) throw new Error(`.aistudio package is missing ${MOVIE_SESSION_PACKAGE_PATH}.`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(entry.data)) as unknown;
  } catch {
    throw new Error("Movie-session manifest is not valid JSON.");
  }
  const movie = parseSerializedSession(parsed);
  return validateMovieSession(Object.freeze({
    project: imported.project,
    timeline: movie.timeline,
    assets: movie.assets,
    exportProfile: movie.exportProfile,
  }));
}
