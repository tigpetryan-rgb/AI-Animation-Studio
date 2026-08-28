import { describe, expect, it } from "vitest";
import { rationalTime } from "@aistudio/core-time";
import { asCharacterId, asEventId, asPropId } from "@aistudio/core-types";
import type { StoryEvent } from "@aistudio/film-compiler";
import {
  CONSTRAINT_PRIORITY,
  canReach,
  lowerStoryEventToPerformanceIntents,
  semanticSkeletonCompatible,
  validateIKTarget,
  validatePerformance,
  validateSkeleton,
  type Performance,
  type SkeletonDefinition,
} from "./index.js";

const requiredBones = [
  { id: "hips", semanticRole: "hips" as const },
  { id: "head", parentId: "hips", semanticRole: "head" as const },
  { id: "lh", parentId: "hips", semanticRole: "leftHand" as const },
  { id: "rh", parentId: "hips", semanticRole: "rightHand" as const },
  { id: "lf", parentId: "hips", semanticRole: "leftFoot" as const },
  { id: "rf", parentId: "hips", semanticRole: "rightFoot" as const },
];

const skeleton: SkeletonDefinition = { id: "rig_a", version: 1, bones: requiredBones };

function event(type: StoryEvent["type"], targetId = asPropId("prop_key")): StoryEvent {
  return {
    id: asEventId("story_event_1"),
    type,
    actorId: asCharacterId("char_bim"),
    targetId,
    parameters: {},
    preconditions: [],
    effects: [],
    causes: [],
    sourceSpan: { line: 1, startColumn: 1, endColumn: 10, text: "x" },
    confidence: 1,
    humanLock: false,
  };
}

describe("performance engine", () => {
  it("validates semantic skeleton contracts", () => {
    expect(validateSkeleton(skeleton)).toEqual([]);
    expect(validateSkeleton({ id: "bad", version: 1, bones: requiredBones.slice(0, 2) }).some((item) => item.code === "PERF_MISSING_REQUIRED_SEMANTIC_BONE")).toBe(true);
  });

  it("detects duplicate semantic mappings and missing parents", () => {
    const broken: SkeletonDefinition = {
      id: "broken",
      version: 1,
      bones: [
        ...requiredBones,
        { id: "other_head", parentId: "missing", semanticRole: "head" },
      ],
    };
    const codes = validateSkeleton(broken).map((item) => item.code);
    expect(codes).toContain("PERF_MISSING_PARENT");
    expect(codes).toContain("PERF_DUPLICATE_SEMANTIC_BONE");
  });

  it("lowers story truth to production intents without camera data", () => {
    expect(lowerStoryEventToPerformanceIntents(event("PICK_UP")).map((item) => item.type)).toEqual(["REACH", "GRASP"]);
    expect(lowerStoryEventToPerformanceIntents(event("OPEN")).map((item) => item.type)).toEqual(["REACH", "OPEN"]);
    expect(lowerStoryEventToPerformanceIntents(event("WAIT")).map((item) => item.type)).toEqual(["IDLE"]);
  });

  it("checks reachability in canonical meter coordinates", () => {
    expect(canReach({ x: 0, y: 0, z: 0 }, { x: 0.6, y: 0, z: 0.8 }, 1)).toBe(true);
    expect(canReach({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 1)).toBe(false);
    expect(canReach({ x: 0, y: 0, z: 0 }, { x: 1.05, y: 0, z: 0 }, 1, 0.1)).toBe(true);
  });

  it("enforces contact-first constraint priority", () => {
    expect(CONSTRAINT_PRIORITY.HARD_CONTACT).toBeGreaterThan(CONSTRAINT_PRIORITY.STORY_INTERACTION);
    expect(CONSTRAINT_PRIORITY.STORY_INTERACTION).toBeGreaterThan(CONSTRAINT_PRIORITY.IK_TARGET);
    expect(CONSTRAINT_PRIORITY.IK_TARGET).toBeGreaterThan(CONSTRAINT_PRIORITY.BASE_PERFORMANCE);
    expect(CONSTRAINT_PRIORITY.BASE_PERFORMANCE).toBeGreaterThan(CONSTRAINT_PRIORITY.SECONDARY_MOTION);
  });

  it("validates performance duration, tracks and contact timing", () => {
    const performance: Performance = {
      id: "perf_1",
      version: 1,
      source: "GENERATED",
      status: "CANDIDATE",
      skeletonId: skeleton.id,
      duration: rationalTime(2n, 1n),
      tracks: [
        { kind: "BODY", payloadRef: "body" },
        { kind: "BODY", payloadRef: "duplicate" },
      ],
      contacts: [{
        id: "contact_1",
        time: rationalTime(3n, 1n),
        phase: "BEGIN",
        effector: "RIGHT_HAND",
        targetEntityId: "prop_key",
      }],
    };
    const codes = validatePerformance(performance).map((item) => item.code);
    expect(codes).toContain("PERF_DUPLICATE_TRACK");
    expect(codes).toContain("PERF_CONTACT_OUT_OF_RANGE");
  });

  it("validates IK weights and semantic retarget compatibility", () => {
    expect(validateIKTarget({ effector: "RIGHT_HAND", weight: 1, targetEntityId: "prop_key" })).toEqual([]);
    expect(validateIKTarget({ effector: "RIGHT_HAND", weight: 1.1 }).map((item) => item.code)).toEqual(["PERF_INVALID_IK_WEIGHT"]);
    expect(semanticSkeletonCompatible(skeleton, { id: "rig_b", version: 2, bones: [...requiredBones].reverse() })).toBe(true);
  });
});
