import { describe, expect, it } from "vitest";
import { rationalTime } from "@aistudio/core-time";
import { importAistudioPackage } from "@aistudio/project-format";
import {
  createLocalDemoMovieSession,
  movieDurationSeconds,
  rationalSeconds,
  sampleMovieTimeline,
} from "./studio-movie-session";
import {
  MOVIE_SESSION_PACKAGE_PATH,
  exportMovieSessionPackage,
  importMovieSessionPackage,
} from "./studio-session-package";

describe("Studio movie session package", () => {
  it("stores the Timeline/media manifest as a checksummed .aistudio entry", async () => {
    const source = createLocalDemoMovieSession();
    const bytes = await exportMovieSessionPackage(source);
    const imported = await importAistudioPackage(bytes);

    expect(imported.project.projectId).toBe(source.project.projectId);
    expect(imported.extraEntries.map((entry) => entry.path)).toContain(MOVIE_SESSION_PACKAGE_PATH);
    expect(imported.checksums.entries[MOVIE_SESSION_PACKAGE_PATH]).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reopens the same editable Timeline and media bindings", async () => {
    const source = createLocalDemoMovieSession();
    const reopened = await importMovieSessionPackage(await exportMovieSessionPackage(source));

    expect(reopened.project.projectId).toBe(source.project.projectId);
    expect(reopened.timeline.id).toBe(source.timeline.id);
    expect(movieDurationSeconds(reopened)).toBe(4);
    expect(Object.keys(reopened.assets).sort()).toEqual(Object.keys(source.assets).sort());
    expect(reopened.assets["visual-action"]?.mediaType).toBe("video");
    expect(reopened.assets["audio-opening"]?.mediaType).toBe("audio");

    const sample = sampleMovieTimeline(reopened, rationalTime(5n, 2n));
    expect(sample.video?.clip.id).toBe("action-shot");
    expect(rationalSeconds(sample.video!.sourceTime)).toBe(1);
    expect(sample.audio?.clip.id).toBe("action-audio");
    expect(rationalSeconds(sample.audio!.sourceTime)).toBe(0.75);
  });
});
