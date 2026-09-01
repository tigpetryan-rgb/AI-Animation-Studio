import { describe, expect, it } from "vitest";
import { executeActingPerformance, prepareCharacterRig } from "./studio-character-performance";
import { isCameraExecutionArtifact, prepareCameraExecution } from "./studio-camera-executor";
import type { SceneBlockingArtifact } from "./studio-scene-blocking";

const COMMIT = "1234567890abcdef1234567890abcdef12345678";

function blocking(): SceneBlockingArtifact {
  const actorId = "character-camera";
  return {
    schemaVersion: 1,
    actorId,
    reference: { name: "actor.png", mimeType: "image/png", size: 123, width: 640, height: 960 },
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
  };
}

function prepared() {
  const scene = blocking();
  const rig = prepareCharacterRig(scene, "shot-camera", COMMIT).artifact;
  if (rig === undefined) throw new Error("rig setup failed");
  const acting = executeActingPerformance(scene, rig, "ACTOR SPEAK Hello", COMMIT).artifact;
  if (acting === undefined) throw new Error("acting setup failed");
  return { scene, rig, acting };
}

describe("deterministic camera executor", () => {
  it("samples an actual look-at camera path and proves full character bounds remain visible", () => {
    const { scene, rig, acting } = prepared();
    const result = prepareCameraExecution(scene, rig, acting, COMMIT, 50);
    expect(result.ok).toBe(true);
    expect(result.gates).toEqual({ cameraVisibility: true, continuity: true });
    expect(result.artifact?.keyframes).toHaveLength(3);
    expect(result.artifact?.visibilitySamples).toHaveLength(5);
    expect(result.artifact?.visibilitySamples.every((sample) => sample.visible)).toBe(true);
    expect(isCameraExecutionArtifact(result.artifact, COMMIT)).toBe(true);
  });

  it("fails closed when the exact reference identity changes", () => {
    const { scene, rig, acting } = prepared();
    const changed = { ...scene, reference: { ...scene.reference, size: scene.reference.size + 1 } };
    const result = prepareCameraExecution(changed, rig, acting, COMMIT);
    expect(result.ok).toBe(false);
    expect(result.gates.continuity).toBe(false);
  });

  it("fails visibility for a camera that does not frame the actor", () => {
    const { scene, rig, acting } = prepared();
    const bad = { ...scene, cameraDraft: { ...scene.cameraDraft, start: { x: 20, y: 1, z: 0.2 }, end: { x: 20, y: 1, z: 0.1 }, target: { x: 20, y: 1, z: 0 } } };
    const result = prepareCameraExecution(bad, rig, acting, COMMIT);
    expect(result.ok).toBe(false);
    expect(result.gates).toEqual({ cameraVisibility: false, continuity: true });
  });
});
