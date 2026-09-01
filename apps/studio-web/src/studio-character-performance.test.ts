import { describe, expect, it } from "vitest";
import { prepareCharacterRig, executeActingPerformance, isActingPerformanceArtifact, isCharacterRigArtifact } from "./studio-character-performance";
import type { SceneBlockingArtifact } from "./studio-scene-blocking";

const COMMIT = "1234567890abcdef1234567890abcdef12345678";

function blocking(actorId = "character-chat-1", shotId = "shot-chat-1"): { blocking: SceneBlockingArtifact; shotId: string } {
  return {
    shotId,
    blocking: {
      schemaVersion: 1,
      actorId,
      reference: { name: "actor.png", mimeType: "image/png", size: 123, width: 64, height: 64 },
      plan: {
        placements: [{ actorId: actorId as never, position: { x: 0, y: 0, z: 0 } }],
        paths: [{ actorId: actorId as never, points: [{ x: 0, y: 0, z: 0 }] }],
      },
      cameraDraft: {
        start: { x: 0, y: 1.15, z: 3.8 },
        end: { x: 0, y: 1.1, z: 2.4 },
        target: { x: 0, y: 0.95, z: 0 },
        framing: "MEDIUM_WIDE",
      },
      output: { width: 1920, height: 1080, frameRate: 24, durationSeconds: 10 },
      prompt: "ACTOR SPEAK Hello",
      preparedAt: 1,
    },
  };
}

describe("character rig and acting executor", () => {
  it("binds decoded character identity to an explicit canonical rig without image-derived bone claims", () => {
    const scene = blocking();
    const result = prepareCharacterRig(scene.blocking, scene.shotId, COMMIT, 10);
    expect(result.ok).toBe(true);
    expect(result.artifact?.skeleton.bones.length).toBeGreaterThanOrEqual(20);
    expect(result.artifact?.binding).toBe("REFERENCE_APPEARANCE_TO_CANONICAL_CONTROL_RIG");
    expect(result.artifact?.bindingNote).toContain("not inferred");
    expect(isCharacterRigArtifact(result.artifact, COMMIT)).toBe(true);
  });

  it("executes deterministic story IR into actual serializable skeletal keyframe tracks", () => {
    const scene = blocking();
    const rig = prepareCharacterRig(scene.blocking, scene.shotId, COMMIT, 10).artifact;
    if (rig === undefined) throw new Error("rig setup failed");
    const result = executeActingPerformance(scene.blocking, rig, "ACTOR SPEAK Hello world", COMMIT, 20);
    expect(result.ok).toBe(true);
    expect(result.gates).toEqual({ performance: true, contactIK: true, physics: true });
    expect(result.artifact?.story.events).toHaveLength(1);
    expect(result.artifact?.intents.map((item) => item.type)).toEqual(["GESTURE"]);
    expect(result.artifact?.performance.tracks.map((track) => track.kind)).toContain("RIGHT_HAND");
    expect(result.artifact?.payloads.every((payload) => payload.keyframes.length === 3)).toBe(true);
    expect(() => JSON.stringify(result.artifact)).not.toThrow();
    expect(isActingPerformanceArtifact(result.artifact, COMMIT)).toBe(true);
  });

  it("fails closed on unparsed natural language rather than inventing acting semantics", () => {
    const scene = blocking();
    const rig = prepareCharacterRig(scene.blocking, scene.shotId, COMMIT).artifact;
    if (rig === undefined) throw new Error("rig setup failed");
    const result = executeActingPerformance(scene.blocking, rig, "Create a dramatic ten second scene", COMMIT);
    expect(result.ok).toBe(false);
    expect(result.artifact).toBeUndefined();
    expect(result.diagnostics.join(" ")).toMatch(/not fabricated/i);
  });

  it("fails contact actions until real target anchors exist", () => {
    const scene = blocking();
    const rig = prepareCharacterRig(scene.blocking, scene.shotId, COMMIT).artifact;
    if (rig === undefined) throw new Error("rig setup failed");
    const result = executeActingPerformance(scene.blocking, rig, "ACTOR PICK_UP PROP", COMMIT);
    expect(result.ok).toBe(false);
    expect(result.artifact).toBeUndefined();
  });

  it("binds artifacts to exact source and shot identities", () => {
    const first = blocking("character-a", "shot-a");
    const second = blocking("character-b", "shot-b");
    const rigA = prepareCharacterRig(first.blocking, first.shotId, COMMIT).artifact;
    const rigB = prepareCharacterRig(second.blocking, second.shotId, COMMIT).artifact;
    expect(rigA?.shotId).toBe("shot-a");
    expect(rigB?.shotId).toBe("shot-b");
    expect(rigA?.skeleton.id).not.toBe(rigB?.skeleton.id);
    expect(isCharacterRigArtifact(rigA, "ffffffffffffffffffffffffffffffffffffffff")).toBe(false);
  });
});
