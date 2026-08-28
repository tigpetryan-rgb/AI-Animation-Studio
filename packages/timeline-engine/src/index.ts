import {
  ZERO_TIME,
  addTime,
  compareTime,
  rationalTime,
  subtractTime,
  type RationalTime,
} from "@aistudio/core-time";

export type TimelineTrackKind = "video" | "audio" | "animation" | "camera" | "event";

export interface TimelineClip {
  readonly id: string;
  readonly assetId: string;
  readonly timelineStart: RationalTime;
  readonly sourceIn: RationalTime;
  readonly duration: RationalTime;
}

export interface TimelineTrack {
  readonly id: string;
  readonly kind: TimelineTrackKind;
  readonly allowsOverlap: boolean;
  readonly clips: readonly TimelineClip[];
}

export interface Timeline {
  readonly id: string;
  readonly tracks: readonly TimelineTrack[];
}

export type TimelineDiagnosticCode =
  | "TL_DUPLICATE_TRACK"
  | "TL_DUPLICATE_CLIP"
  | "TL_NEGATIVE_START"
  | "TL_NEGATIVE_SOURCE_IN"
  | "TL_NONPOSITIVE_DURATION"
  | "TL_OVERLAP";

export interface TimelineDiagnostic {
  readonly code: TimelineDiagnosticCode;
  readonly message: string;
  readonly trackId?: string;
  readonly clipId?: string;
}

export function clipEnd(clip: TimelineClip): RationalTime {
  return addTime(clip.timelineStart, clip.duration);
}

export function validateTimeline(timeline: Timeline): readonly TimelineDiagnostic[] {
  const diagnostics: TimelineDiagnostic[] = [];
  const trackIds = new Set<string>();
  const clipIds = new Set<string>();

  for (const track of timeline.tracks) {
    if (trackIds.has(track.id)) {
      diagnostics.push({ code: "TL_DUPLICATE_TRACK", trackId: track.id, message: `Duplicate track ${track.id}.` });
    }
    trackIds.add(track.id);

    const sorted = [...track.clips].sort((a, b) => {
      const timeOrder = compareTime(a.timelineStart, b.timelineStart);
      return timeOrder !== 0 ? timeOrder : a.id.localeCompare(b.id);
    });

    for (const clip of sorted) {
      if (clipIds.has(clip.id)) {
        diagnostics.push({ code: "TL_DUPLICATE_CLIP", trackId: track.id, clipId: clip.id, message: `Duplicate clip ${clip.id}.` });
      }
      clipIds.add(clip.id);
      if (compareTime(clip.timelineStart, ZERO_TIME) < 0) {
        diagnostics.push({ code: "TL_NEGATIVE_START", trackId: track.id, clipId: clip.id, message: `Clip ${clip.id} starts before timeline zero.` });
      }
      if (compareTime(clip.sourceIn, ZERO_TIME) < 0) {
        diagnostics.push({ code: "TL_NEGATIVE_SOURCE_IN", trackId: track.id, clipId: clip.id, message: `Clip ${clip.id} has negative source in.` });
      }
      if (compareTime(clip.duration, ZERO_TIME) <= 0) {
        diagnostics.push({ code: "TL_NONPOSITIVE_DURATION", trackId: track.id, clipId: clip.id, message: `Clip ${clip.id} duration must be positive.` });
      }
    }

    if (!track.allowsOverlap) {
      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (previous !== undefined && current !== undefined && compareTime(clipEnd(previous), current.timelineStart) > 0) {
          diagnostics.push({
            code: "TL_OVERLAP",
            trackId: track.id,
            clipId: current.id,
            message: `Clip ${current.id} overlaps ${previous.id} on exclusive track ${track.id}.`,
          });
        }
      }
    }
  }

  return diagnostics;
}

export function mapTimelineToSource(clip: TimelineClip, timelineTime: RationalTime): RationalTime {
  if (compareTime(timelineTime, clip.timelineStart) < 0 || compareTime(timelineTime, clipEnd(clip)) >= 0) {
    throw new RangeError(`Timeline time is outside clip ${clip.id}.`);
  }
  return addTime(clip.sourceIn, subtractTime(timelineTime, clip.timelineStart));
}

export function clipsAtTime(track: TimelineTrack, time: RationalTime): readonly TimelineClip[] {
  return track.clips
    .filter((clip) => compareTime(time, clip.timelineStart) >= 0 && compareTime(time, clipEnd(clip)) < 0)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function trimClipStart(clip: TimelineClip, newStart: RationalTime): TimelineClip {
  const oldEnd = clipEnd(clip);
  if (compareTime(newStart, clip.timelineStart) < 0 || compareTime(newStart, oldEnd) >= 0) {
    throw new RangeError("Trim start must stay inside the existing clip range.");
  }
  const delta = subtractTime(newStart, clip.timelineStart);
  return {
    ...clip,
    timelineStart: newStart,
    sourceIn: addTime(clip.sourceIn, delta),
    duration: subtractTime(oldEnd, newStart),
  };
}

export function trimClipEnd(clip: TimelineClip, newEnd: RationalTime): TimelineClip {
  if (compareTime(newEnd, clip.timelineStart) <= 0 || compareTime(newEnd, clipEnd(clip)) > 0) {
    throw new RangeError("Trim end must stay inside the existing clip range.");
  }
  return { ...clip, duration: subtractTime(newEnd, clip.timelineStart) };
}

export function slipClip(clip: TimelineClip, newSourceIn: RationalTime): TimelineClip {
  if (compareTime(newSourceIn, ZERO_TIME) < 0) {
    throw new RangeError("Source in cannot be negative.");
  }
  return { ...clip, sourceIn: newSourceIn };
}

export function rippleDelete(track: TimelineTrack, clipId: string): TimelineTrack {
  const removed = track.clips.find((clip) => clip.id === clipId);
  if (removed === undefined) throw new RangeError(`Unknown clip ${clipId}.`);
  const removedEnd = clipEnd(removed);
  const clips = track.clips
    .filter((clip) => clip.id !== clipId)
    .map((clip) => compareTime(clip.timelineStart, removedEnd) >= 0
      ? { ...clip, timelineStart: subtractTime(clip.timelineStart, removed.duration) }
      : clip);
  return { ...track, clips };
}

export type KeyframeInterpolation = "hold" | "linear" | "bezier";

export interface NumberKeyframe {
  readonly time: RationalTime;
  readonly value: number;
  readonly interpolation: KeyframeInterpolation;
  readonly outControlValue?: number;
  readonly inControlValue?: number;
}

export interface AnimatedNumberProperty {
  readonly defaultValue: number;
  readonly keyframes: readonly NumberKeyframe[];
}

function timeRatio(value: RationalTime, start: RationalTime, end: RationalTime): number {
  const numerator = subtractTime(value, start);
  const denominator = subtractTime(end, start);
  if (denominator.value === 0n) return 0;
  return Number(numerator.value * denominator.timescale) / Number(numerator.timescale * denominator.value);
}

export function evaluateAnimatedNumber(property: AnimatedNumberProperty, time: RationalTime): number {
  if (property.keyframes.length === 0) return property.defaultValue;
  const keyframes = [...property.keyframes].sort((a, b) => compareTime(a.time, b.time));
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (first === undefined || last === undefined) return property.defaultValue;
  if (compareTime(time, first.time) <= 0) return first.value;
  if (compareTime(time, last.time) >= 0) return last.value;

  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const current = keyframes[index];
    const next = keyframes[index + 1];
    if (current === undefined || next === undefined) continue;
    if (compareTime(time, current.time) >= 0 && compareTime(time, next.time) < 0) {
      if (current.interpolation === "hold") return current.value;
      const t = timeRatio(time, current.time, next.time);
      if (current.interpolation === "linear") return current.value + (next.value - current.value) * t;
      const p0 = current.value;
      const p1 = current.outControlValue ?? current.value;
      const p2 = next.inControlValue ?? next.value;
      const p3 = next.value;
      const u = 1 - t;
      return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
    }
  }

  return property.defaultValue;
}

export const oneSecond = rationalTime(1n, 1n);
