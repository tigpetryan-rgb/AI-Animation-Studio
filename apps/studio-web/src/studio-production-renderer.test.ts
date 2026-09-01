import { describe, expect, it } from "vitest";
import { executeActingPerformance, prepareCharacterRig } from "./studio-character-performance";
import { prepareCameraExecution } from "./studio-camera-executor";
import {
  sampleProductionCamera,
  sampleProductionPose,
  validateProductionRenderBindings,
} from "./studio-production-renderer";
import type { SceneBlockingArtifact } from "./studio-scene-blocking";

const COMMIT = "1234567890abcdef1234567890abcdef12345678";

function blocking(): SceneBlockingArtifact {
  const actorId = "character-render";
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
    output: { width: 320, height: 240, frameRate: 12, durationSeconds: 2 },
    prompt: "ACTOR SPEAK Hello",
    preparedAt: 1,
  };
}

function prepared() {
  const scene = blocking();
  const rig = prepareCharacterRig(scene, "shot-render", COMMIT).artifact;
  if (rig === undefined) throw new Error("rig setup failed");
  const acting = executeActingPerformance(scene, rig, scene.prompt, COMMIT).artifact;
  if (acting === undefined) throw new Error("acting setup failed");
  const camera = prepareCameraExecution(scene, rig, acting, COMMIT).artifact;
  if (camera === undefined) throw new Error("camera setup failed");
  return { scene, rig, acting, camera };
}

describe("source-bound production renderer controls", () => {
  it("samples real acting keyframes and camera keyframes into temporally varying render controls", () => {
    const { acting, camera } = prepared();
    const beginning = sampleProductionPose(acting, 0);
    const middle = sampleProductionPose(acting, 1);
    const startCamera = sampleProductionCamera(camera, 0);
    const laterCamera = sampleProductionCamera(camera, 1.64);

    expect(beginning.bodyLeanDegrees).toBe(0);
    expect(Math.abs(middle.bodyLeanDegrees) + Math.abs(middle.rightArmSwingDegrees)).toBeGreaterThan(0);
    expect(laterCamera.distanceToTarget).not.toBe(startCamera.distanceToTarget);
    expect(laterCamera.verticalFovDegrees).toBe(50);
  });

  it("requires exact source, actor, reference, performance and admitted camera continuity", () => {
    const { scene, rig, acting, camera } = prepared();
    expect(validateProductionRenderBindings({ blocking: scene, rig, acting, camera, sourceCommit: COMMIT })).toEqual([]);
    expect(validateProductionRenderBindings({ blocking: scene, rig, acting, camera, sourceCommit: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" }).length).toBeGreaterThan(0);
  });
});
