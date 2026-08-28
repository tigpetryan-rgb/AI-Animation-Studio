import { compareTime, ZERO_TIME, type RationalTime } from "@aistudio/core-time";
import type { CharacterId } from "@aistudio/core-types";
import type { StoryEvent } from "@aistudio/film-compiler";

export type SemanticBoneRole =
  | "hips" | "spine" | "chest" | "neck" | "head"
  | "leftShoulder" | "leftUpperArm" | "leftLowerArm" | "leftHand"
  | "rightShoulder" | "rightUpperArm" | "rightLowerArm" | "rightHand"
  | "leftUpperLeg" | "leftLowerLeg" | "leftFoot" | "leftToe"
  | "rightUpperLeg" | "rightLowerLeg" | "rightFoot" | "rightToe";

export interface BoneDefinition {
  readonly id: string;
  readonly parentId?: string;
  readonly semanticRole?: SemanticBoneRole;
}

export interface SkeletonDefinition {
  readonly id: string;
  readonly version: number;
  readonly bones: readonly BoneDefinition[];
}

export type PerformanceTrackKind = "ROOT" | "BODY" | "HEAD" | "FACE" | "GAZE" | "LEFT_HAND" | "RIGHT_HAND" | "SECONDARY";
export type PerformanceSource = "LIBRARY" | "CAPTURED" | "GENERATED" | "MANUAL";
export type PerformanceStatus = "CANDIDATE" | "APPROVED";

export interface PerformanceTrack {
  readonly kind: PerformanceTrackKind;
  readonly payloadRef: string;
}

export type ContactPhase = "BEGIN" | "HOLD" | "END";

export interface ContactEvent {
  readonly id: string;
  readonly time: RationalTime;
  readonly phase: ContactPhase;
  readonly effector: "LEFT_HAND" | "RIGHT_HAND" | "LEFT_FOOT" | "RIGHT_FOOT";
  readonly targetEntityId: string;
  readonly targetAnchor?: string;
}

export interface Performance {
  readonly id: string;
  readonly version: number;
  readonly source: PerformanceSource;
  readonly status: PerformanceStatus;
  readonly skeletonId: string;
  readonly duration: RationalTime;
  readonly tracks: readonly PerformanceTrack[];
  readonly contacts: readonly ContactEvent[];
}

export type PerformanceIntentType =
  | "LOCOMOTE" | "TURN" | "LOOK" | "REACH" | "GRASP" | "RELEASE"
  | "OPEN" | "CLOSE" | "SIT" | "STAND" | "GESTURE" | "REACT" | "IDLE";

export interface PerformanceIntent {
  readonly type: PerformanceIntentType;
  readonly actorId: CharacterId;
  readonly targetId?: string;
  readonly sourceEventId: string;
}

export interface StagePoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BlockingPlacement {
  readonly actorId: CharacterId;
  readonly position: StagePoint;
}

export interface BlockingPath {
  readonly actorId: CharacterId;
  readonly points: readonly StagePoint[];
}

export interface BlockingPlan {
  readonly placements: readonly BlockingPlacement[];
  readonly paths: readonly BlockingPath[];
}

export interface InteractionAnchor {
  readonly entityId: string;
  readonly name: string;
  readonly position: StagePoint;
}

export interface IKTarget {
  readonly effector: "LEFT_HAND" | "RIGHT_HAND" | "LEFT_FOOT" | "RIGHT_FOOT";
  readonly targetEntityId?: string;
  readonly targetAnchor?: string;
  readonly targetPosition?: StagePoint;
  readonly weight: number;
}

export type PerformanceDiagnosticCode =
  | "PERF_DUPLICATE_BONE"
  | "PERF_MISSING_PARENT"
  | "PERF_DUPLICATE_SEMANTIC_BONE"
  | "PERF_MISSING_REQUIRED_SEMANTIC_BONE"
  | "PERF_NONPOSITIVE_DURATION"
  | "PERF_DUPLICATE_TRACK"
  | "PERF_CONTACT_OUT_OF_RANGE"
  | "PERF_INVALID_IK_WEIGHT";

export interface PerformanceDiagnostic {
  readonly code: PerformanceDiagnosticCode;
  readonly message: string;
  readonly targetId?: string;
}

const REQUIRED_SEMANTICS: readonly SemanticBoneRole[] = ["hips", "head", "leftHand", "rightHand", "leftFoot", "rightFoot"];

export function validateSkeleton(skeleton: SkeletonDefinition): readonly PerformanceDiagnostic[] {
  const diagnostics: PerformanceDiagnostic[] = [];
  const ids = new Set<string>();
  const semantics = new Set<SemanticBoneRole>();

  for (const bone of skeleton.bones) {
    if (ids.has(bone.id)) diagnostics.push({ code: "PERF_DUPLICATE_BONE", targetId: bone.id, message: `Duplicate bone ${bone.id}.` });
    ids.add(bone.id);
  }
  for (const bone of skeleton.bones) {
    if (bone.parentId !== undefined && !ids.has(bone.parentId)) {
      diagnostics.push({ code: "PERF_MISSING_PARENT", targetId: bone.id, message: `Bone ${bone.id} references missing parent ${bone.parentId}.` });
    }
    if (bone.semanticRole !== undefined) {
      if (semantics.has(bone.semanticRole)) diagnostics.push({ code: "PERF_DUPLICATE_SEMANTIC_BONE", targetId: bone.id, message: `Semantic role ${bone.semanticRole} is mapped more than once.` });
      semantics.add(bone.semanticRole);
    }
  }
  for (const required of REQUIRED_SEMANTICS) {
    if (!semantics.has(required)) diagnostics.push({ code: "PERF_MISSING_REQUIRED_SEMANTIC_BONE", targetId: required, message: `Missing required semantic bone ${required}.` });
  }
  return diagnostics;
}

export function validatePerformance(performance: Performance): readonly PerformanceDiagnostic[] {
  const diagnostics: PerformanceDiagnostic[] = [];
  if (compareTime(performance.duration, ZERO_TIME) <= 0) diagnostics.push({ code: "PERF_NONPOSITIVE_DURATION", targetId: performance.id, message: "Performance duration must be positive." });
  const tracks = new Set<PerformanceTrackKind>();
  for (const track of performance.tracks) {
    if (tracks.has(track.kind)) diagnostics.push({ code: "PERF_DUPLICATE_TRACK", targetId: track.kind, message: `Duplicate ${track.kind} track.` });
    tracks.add(track.kind);
  }
  for (const contact of performance.contacts) {
    if (compareTime(contact.time, ZERO_TIME) < 0 || compareTime(contact.time, performance.duration) > 0) {
      diagnostics.push({ code: "PERF_CONTACT_OUT_OF_RANGE", targetId: contact.id, message: `Contact ${contact.id} is outside performance duration.` });
    }
  }
  return diagnostics;
}

export function validateIKTarget(target: IKTarget): readonly PerformanceDiagnostic[] {
  return Number.isFinite(target.weight) && target.weight >= 0 && target.weight <= 1
    ? []
    : [{ code: "PERF_INVALID_IK_WEIGHT", targetId: target.effector, message: "IK weight must be between 0 and 1." }];
}

export function canReach(origin: StagePoint, target: StagePoint, maxReachMeters: number, toleranceMeters = 0): boolean {
  if (!Number.isFinite(maxReachMeters) || maxReachMeters < 0 || !Number.isFinite(toleranceMeters) || toleranceMeters < 0) return false;
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dz = target.z - origin.z;
  return Math.hypot(dx, dy, dz) <= maxReachMeters + toleranceMeters;
}

export const CONSTRAINT_PRIORITY = Object.freeze({
  HARD_CONTACT: 5,
  STORY_INTERACTION: 4,
  IK_TARGET: 3,
  BASE_PERFORMANCE: 2,
  SECONDARY_MOTION: 1,
});

function intent(event: StoryEvent, type: PerformanceIntentType): PerformanceIntent {
  return {
    type,
    actorId: event.actorId,
    ...(event.targetId === undefined ? {} : { targetId: String(event.targetId) }),
    sourceEventId: String(event.id),
  };
}

export function lowerStoryEventToPerformanceIntents(event: StoryEvent): readonly PerformanceIntent[] {
  switch (event.type) {
    case "ENTER": case "EXIT": case "MOVE_TO": case "WALK_TO": case "RUN_TO": return [intent(event, "LOCOMOTE")];
    case "TURN_TO": return [intent(event, "TURN")];
    case "LOOK_AT": case "NOTICE": case "SEARCH_FOR": return [intent(event, "LOOK")];
    case "PICK_UP": case "RECEIVE": return [intent(event, "REACH"), intent(event, "GRASP")];
    case "PUT_DOWN": case "GIVE": return [intent(event, "REACH"), intent(event, "RELEASE")];
    case "OPEN": return [intent(event, "REACH"), intent(event, "OPEN")];
    case "CLOSE": return [intent(event, "REACH"), intent(event, "CLOSE")];
    case "SIT": return [intent(event, "SIT")];
    case "STAND": return [intent(event, "STAND")];
    case "REACT": return [intent(event, "REACT")];
    case "WAIT": return [intent(event, "IDLE")];
    case "TOUCH": case "USE": case "LOCK": case "UNLOCK": return [intent(event, "REACH"), intent(event, "GESTURE")];
    case "SPEAK": case "RESPOND": case "CHANGE_STATE": return [intent(event, "GESTURE")];
  }
}

export function semanticSkeletonCompatible(source: SkeletonDefinition, target: SkeletonDefinition): boolean {
  const sourceRoles = new Set(source.bones.flatMap((bone) => bone.semanticRole === undefined ? [] : [bone.semanticRole]));
  const targetRoles = new Set(target.bones.flatMap((bone) => bone.semanticRole === undefined ? [] : [bone.semanticRole]));
  return REQUIRED_SEMANTICS.every((role) => sourceRoles.has(role) && targetRoles.has(role));
}
