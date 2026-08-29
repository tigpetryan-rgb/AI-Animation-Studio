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
    expect(Object.values(session.assets).map((asset) => asset.mediaType).sort()).toEqual([
      "audio",
      "audio",
      "image",
      "video",
    ]);
  });

  it("samples decoded-media descriptors through the timeline engine", () => {
    const session = createLocalDemoMovieSession();
    const sample = sampleMovieTimeline(session, rationalTime(1n, 1n));
    expect(sample.video?.clip.id).toBe("opening-shot");
    expect(sample.video?.asset.mediaType).toBe("image");
    expect(rationalSeconds(sample.video!.sourceTime)).toBe(1);
    expect(sample.audio?.clip.id).toBe("opening-audio");
    expect(sample.audio?.asset.mediaType).toBe("audio");
    expect(sample.audio?.asset.mimeType).toBe("audio/ogg");
  });

  it("honors source-in offsets for real video and audio assets after the edit point", () => {
    const session = createLocalDemoMovieSession();
    const sample = sampleMovieTimeline(session, rationalTime(5n, 2n));
    expect(sample.video?.clip.id).toBe("action-shot");
    expect(sample.video?.asset.mediaType).toBe("video");
    expect(sample.video?.asset.mimeType).toBe("video/webm");
    expect(rationalSeconds(sample.video!.sourceTime)).toBe(1);
    expect(sample.audio?.clip.id).toBe("action-audio");
    expect(sample.audio?.asset.mediaType).toBe("audio");
    expect(rationalSeconds(sample.audio!.sourceTime)).toBe(0.75);
  });
});
