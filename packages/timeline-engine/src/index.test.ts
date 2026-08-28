import { describe, expect, it } from "vitest";
import { rationalTime, timeFromFrame } from "@aistudio/core-time";
import {
  clipsAtTime,
  evaluateAnimatedNumber,
  mapTimelineToSource,
  rippleDelete,
  slipClip,
  trimClipEnd,
  trimClipStart,
  validateTimeline,
  type TimelineClip,
  type TimelineTrack,
} from "./index.js";

const clipA: TimelineClip = {
  id: "a",
  assetId: "asset_a",
  timelineStart: rationalTime(0n, 1n),
  sourceIn: rationalTime(5n, 1n),
  duration: rationalTime(2n, 1n),
};

const clipB: TimelineClip = {
  id: "b",
  assetId: "asset_b",
  timelineStart: rationalTime(2n, 1n),
  sourceIn: rationalTime(0n, 1n),
  duration: rationalTime(3n, 1n),
};

const track: TimelineTrack = {
  id: "v1",
  kind: "video",
  allowsOverlap: false,
  clips: [clipA, clipB],
};

describe("timeline engine", () => {
  it("validates a contiguous exclusive track", () => {
    expect(validateTimeline({ id: "tl", tracks: [track] })).toEqual([]);
  });

  it("detects exact overlap", () => {
    const overlapping = { ...clipB, timelineStart: rationalTime(3n, 2n) };
    expect(validateTimeline({ id: "tl", tracks: [{ ...track, clips: [clipA, overlapping] }] })[0]?.code).toBe("TL_OVERLAP");
  });

  it("maps timeline time to source time exactly", () => {
    expect(mapTimelineToSource(clipA, rationalTime(3n, 2n))).toEqual(rationalTime(13n, 2n));
    expect(() => mapTimelineToSource(clipA, rationalTime(2n, 1n))).toThrow(RangeError);
  });

  it("trims and slips clips without float time", () => {
    const startTrimmed = trimClipStart(clipA, rationalTime(1n, 2n));
    expect(startTrimmed.sourceIn).toEqual(rationalTime(11n, 2n));
    expect(startTrimmed.duration).toEqual(rationalTime(3n, 2n));

    const endTrimmed = trimClipEnd(clipA, rationalTime(3n, 2n));
    expect(endTrimmed.duration).toEqual(rationalTime(3n, 2n));

    const slipped = slipClip(clipA, rationalTime(25n, 4n));
    expect(slipped.timelineStart).toEqual(clipA.timelineStart);
    expect(slipped.sourceIn).toEqual(rationalTime(25n, 4n));
  });

  it("ripple deletes and shifts only clips after the removed range", () => {
    const third = { ...clipB, id: "c", timelineStart: rationalTime(5n, 1n) };
    const result = rippleDelete({ ...track, clips: [clipA, clipB, third] }, "b");
    expect(result.clips.map((clip) => [clip.id, clip.timelineStart])).toEqual([
      ["a", rationalTime(0n, 1n)],
      ["c", rationalTime(2n, 1n)],
    ]);
  });

  it("returns active clips with end-exclusive semantics", () => {
    expect(clipsAtTime(track, rationalTime(1999n, 1000n)).map((clip) => clip.id)).toEqual(["a"]);
    expect(clipsAtTime(track, rationalTime(2n, 1n)).map((clip) => clip.id)).toEqual(["b"]);
  });

  it("evaluates hold, linear and bezier number keyframes", () => {
    expect(evaluateAnimatedNumber({
      defaultValue: 0,
      keyframes: [
        { time: rationalTime(0n, 1n), value: 10, interpolation: "hold" },
        { time: rationalTime(1n, 1n), value: 20, interpolation: "linear" },
      ],
    }, rationalTime(1n, 2n))).toBe(10);

    expect(evaluateAnimatedNumber({
      defaultValue: 0,
      keyframes: [
        { time: rationalTime(0n, 1n), value: 0, interpolation: "linear" },
        { time: rationalTime(1n, 1n), value: 10, interpolation: "linear" },
      ],
    }, rationalTime(1n, 2n))).toBe(5);

    expect(evaluateAnimatedNumber({
      defaultValue: 0,
      keyframes: [
        { time: rationalTime(0n, 1n), value: 0, interpolation: "bezier", outControlValue: 0 },
        { time: rationalTime(1n, 1n), value: 10, interpolation: "linear", inControlValue: 10 },
      ],
    }, rationalTime(1n, 2n))).toBe(5);
  });

  it("keeps fractional FPS positions exact", () => {
    const frame = timeFromFrame(100n, 30000n, 1001n);
    const fractionalClip = { ...clipA, timelineStart: frame, duration: timeFromFrame(1n, 30000n, 1001n) };
    expect(validateTimeline({ id: "ntsc", tracks: [{ ...track, clips: [fractionalClip] }] })).toEqual([]);
  });
});
