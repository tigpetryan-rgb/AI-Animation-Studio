import { describe, expect, it } from "vitest";
import { rationalTime } from "@aistudio/core-time";
import {
  createLocalDemoMovieSession,
  movieDurationSeconds,
  rationalSeconds,
  sampleMovieTimeline,
} from "./studio-movie-session";

describe("Studio movie session", () => {
  it("binds the local demo project to a four-second canonical timeline", () => {
    const session = createLocalDemoMovieSession();
    expect(session.project.projectId).toBe("local-demo-project");
    expect(movieDurationSeconds(session)).toBe(4);
    expect(session.timeline.tracks.map((track) => track.kind)).toEqual(["video", "audio"]);
  });

  it("samples the first timeline clips through the timeline engine", () => {
    const session = createLocalDemoMovieSession();
    const sample = sampleMovieTimeline(session, rationalTime(1n, 1n));
    expect(sample.video?.clip.id).toBe("opening-shot");
    expect(sample.video?.asset.label).toBe("Opening shot");
    expect(rationalSeconds(sample.video!.sourceTime)).toBe(1);
    expect(sample.audio?.clip.id).toBe("opening-audio");
    expect(sample.audio?.asset.frequencyHz).toBe(330);
  });

  it("honors clip source-in offsets after the edit point", () => {
    const session = createLocalDemoMovieSession();
    const sample = sampleMovieTimeline(session, rationalTime(5n, 2n));
    expect(sample.video?.clip.id).toBe("action-shot");
    expect(sample.video?.asset.label).toBe("Action shot");
    expect(rationalSeconds(sample.video!.sourceTime)).toBe(1);
    expect(sample.audio?.clip.id).toBe("action-audio");
    expect(rationalSeconds(sample.audio!.sourceTime)).toBe(0.75);
  });
});
