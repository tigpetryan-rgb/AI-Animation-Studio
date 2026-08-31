import { rationalTime, serializeTime, type SerializedRationalTime } from "@aistudio/core-time";
import { asCharacterId } from "@aistudio/core-types";
import { compileStory, type StoryEntityRegistry, type StoryIR } from "@aistudio/film-compiler";
import {
  lowerStoryEventToPerformanceIntents,
  semanticSkeletonCompatible,
  validatePerformance,
  validateSkeleton,
  type BoneDefinition,
  type Performance,
  type PerformanceIntent,
  type PerformanceTrackKind,
  type SemanticBoneRole,
  type SkeletonDefinition,
  type StagePoint,
} from "@aistudio/performance-engine";
import type { SceneBlockingArtifact, SceneReferenceIdentity } from "./studio-scene-blocking";

export const CANONICAL_RIG_KIND = "AISTUDIO_CANONICAL_HUMANOID_V1" as const;
export const PERFORMANCE_EXECUTOR_KIND = "AISTUDIO_DETERMINISTIC_KEYFRAME_V1" as const;

export interface CharacterRigArtifact {
  readonly schemaVersion: 1;
  readonly actorId: string;
  readonly shotId: string;
  readonly sourceCommit: string;
  readonly rigKind: typeof CANONICAL_RIG_KIND;
  readonly reference: SceneReferenceIdentity;
  readonly skeleton: SkeletonDefinition;
  readonly binding: "REFERENCE_APPEARANCE_TO_CANONICAL_CONTROL_RIG";
  readonly bindingNote: string;
  readonly preparedAt: number;
}

export interface CharacterRigResult {
  readonly ok: boolean;
  readonly artifact?: CharacterRigArtifact;
  readonly diagnostics: readonly string[];
}

export interface EulerDegrees {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PerformancePoseKeyframe {
  readonly timeSeconds: number;
  readonly rootPosition: StagePoint;
  readonly rotations: Readonly<Partial<Record<SemanticBoneRole, EulerDegrees>>>;
}

export interface PerformanceTrackPayload {
  readonly id: string;
  readonly kind: PerformanceTrackKind;
  readonly keyframes: readonly PerformancePoseKeyframe[];
}

export interface SerializedContactEvent {
  readonly id: string;
  readonly time: SerializedRationalTime;
  readonly phase: "BEGIN" | "HOLD" | "END";
  readonly effector: "LEFT_HAND" | "RIGHT_HAND" | "LEFT_FOOT" | "RIGHT_FOOT";
  readonly targetEntityId: string;
  readonly targetAnchor?: string;
}

export interface SerializedPerformance {
  readonly id: string;
  readonly version: number;
  readonly source: "GENERATED";
  readonly status: "CANDIDATE";
  readonly skeletonId: string;
  readonly duration: SerializedRationalTime;
  readonly tracks: readonly { readonly kind: PerformanceTrackKind; readonly payloadRef: string }[];
  readonly contacts: readonly SerializedContactEvent[];
}

export interface ActingPerformanceArtifact {
  readonly schemaVersion: 1;
  readonly actorId: string;
  readonly shotId: string;
  readonly sourceCommit: string;
  readonly executorKind: typeof PERFORMANCE_EXECUTOR_KIND;
  readonly story: StoryIR;
  readonly intents: readonly PerformanceIntent[];
  readonly performance: SerializedPerformance;
  readonly payloads: readonly PerformanceTrackPayload[];
  readonly kinematicModel: "BOUNDED_PROCEDURAL_SKELETAL_POSE";
  readonly createdAt: number;
}

export interface ActingPerformanceResult {
  readonly ok: boolean;
  readonly artifact?: ActingPerformanceArtifact;
  readonly diagnostics: readonly string[];
  readonly gates: {
    readonly performance: boolean;
    readonly contactIK: boolean;
    readonly physics: boolean;
  };
}

function point(x: number, y: number, z: number): StagePoint {
  return Object.freeze({ x, y, z });
}

function rotation(x = 0, y = 0, z = 0): EulerDegrees {
  return Object.freeze({ x, y, z });
}

function canonicalSkeleton(actorId: string): SkeletonDefinition {
  const prefix = `${actorId}-rig`;
  const bones: readonly BoneDefinition[] = Object.freeze([
      { id: `${prefix}-hips`, semanticRole: "hips" },
      { id: `${prefix}-spine`, parentId: `${prefix}-hips`, semanticRole: "spine" },
      { id: `${prefix}-chest`, parentId: `${prefix}-spine`, semanticRole: "chest" },
      { id: `${prefix}-neck`, parentId: `${prefix}-chest`, semanticRole: "neck" },
      { id: `${prefix}-head`, parentId: `${prefix}-neck`, semanticRole: "head" },
      { id: `${prefix}-l-shoulder`, parentId: `${prefix}-chest`, semanticRole: "leftShoulder" },
      { id: `${prefix}-l-upper-arm`, parentId: `${prefix}-l-shoulder`, semanticRole: "leftUpperArm" },
      { id: `${prefix}-l-lower-arm`, parentId: `${prefix}-l-upper-arm`, semanticRole: "leftLowerArm" },
      { id: `${prefix}-l-hand`, parentId: `${prefix}-l-lower-arm`, semanticRole: "leftHand" },
      { id: `${prefix}-r-shoulder`, parentId: `${prefix}-chest`, semanticRole: "rightShoulder" },
      { id: `${prefix}-r-upper-arm`, parentId: `${prefix}-r-shoulder`, semanticRole: "rightUpperArm" },
      { id: `${prefix}-r-lower-arm`, parentId: `${prefix}-r-upper-arm`, semanticRole: "rightLowerArm" },
      { id: `${prefix}-r-hand`, parentId: `${prefix}-r-lower-arm`, semanticRole: "rightHand" },
      { id: `${prefix}-l-upper-leg`, parentId: `${prefix}-hips`, semanticRole: "leftUpperLeg" },
      { id: `${prefix}-l-lower-leg`, parentId: `${prefix}-l-upper-leg`, semanticRole: "leftLowerLeg" },
      { id: `${prefix}-l-foot`, parentId: `${prefix}-l-lower-leg`, semanticRole: "leftFoot" },
      { id: `${prefix}-l-toe`, parentId: `${prefix}-l-foot`, semanticRole: "leftToe" },
      { id: `${prefix}-r-upper-leg`, parentId: `${prefix}-hips`, semanticRole: "rightUpperLeg" },
      { id: `${prefix}-r-lower-leg`, parentId: `${prefix}-r-upper-leg`, semanticRole: "rightLowerLeg" },
      { id: `${prefix}-r-foot`, parentId: `${prefix}-r-lower-leg`, semanticRole: "rightFoot" },
      { id: `${prefix}-r-toe`, parentId: `${prefix}-r-foot`, semanticRole: "rightToe" },
    ]);
  return Object.freeze({ id: `${prefix}-v1`, version: 1, bones });
}

function isSha40(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

function finitePoint(value: StagePoint): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

export function prepareCharacterRig(
  blocking: SceneBlockingArtifact,
  shotId: string,
  sourceCommit: string,
  now = Date.now(),
): CharacterRigResult {
  const diagnostics: string[] = [];
  if (!isSha40(sourceCommit)) diagnostics.push("Character rig requires the exact 40-character Studio source commit.");
  if (shotId.trim().length === 0) diagnostics.push("Character rig requires a non-empty shot identity.");
  if (blocking.actorId.trim().length === 0) diagnostics.push("Character rig requires the blocking actor identity.");
  if (blocking.reference.size <= 0 || blocking.reference.width <= 0 || blocking.reference.height <= 0) {
    diagnostics.push("Character rig requires a decoded, non-empty reference image identity.");
  }
  const skeleton = canonicalSkeleton(blocking.actorId);
  diagnostics.push(...validateSkeleton(skeleton).map((item) => item.message));
  if (diagnostics.length > 0) return { ok: false, diagnostics: Object.freeze(diagnostics) };

  return {
    ok: true,
    artifact: Object.freeze({
      schemaVersion: 1,
      actorId: blocking.actorId,
      shotId,
      sourceCommit,
      rigKind: CANONICAL_RIG_KIND,
      reference: Object.freeze({ ...blocking.reference }),
      skeleton,
      binding: "REFERENCE_APPEARANCE_TO_CANONICAL_CONTROL_RIG",
      bindingNote: "The decoded reference establishes character appearance/identity. Bone locations are not inferred from pixels; animation uses the explicit canonical Studio control rig.",
      preparedAt: now,
    }),
    diagnostics: Object.freeze([
      "Reference identity is bound to the canonical Studio humanoid control rig without claiming image-derived bone inference.",
    ]),
  };
}

function registryForRig(rig: CharacterRigArtifact): StoryEntityRegistry {
  return {
    entities: [{
      id: asCharacterId(rig.actorId),
      kind: "character",
      aliases: Object.freeze(["ACTOR", "CHARACTER", rig.actorId]),
    }],
  };
}

function requestedTrackKinds(intents: readonly PerformanceIntent[]): readonly PerformanceTrackKind[] {
  const kinds = new Set<PerformanceTrackKind>(["ROOT", "BODY", "HEAD"]);
  for (const item of intents) {
    if (item.type === "LOOK") kinds.add("GAZE");
    if (["REACH", "GRASP", "RELEASE", "OPEN", "CLOSE", "GESTURE", "REACT"].includes(item.type)) {
      kinds.add("RIGHT_HAND");
    }
  }
  return Object.freeze([...kinds]);
}

function hasIntent(intents: readonly PerformanceIntent[], ...types: readonly PerformanceIntent["type"][]): boolean {
  return intents.some((item) => types.includes(item.type));
}

function keyframesForTrack(
  kind: PerformanceTrackKind,
  durationSeconds: number,
  origin: StagePoint,
  intents: readonly PerformanceIntent[],
): readonly PerformancePoseKeyframe[] {
  const midpoint = durationSeconds / 2;
  const root = point(origin.x, origin.y, origin.z);
  const empty = Object.freeze({}) as Readonly<Partial<Record<SemanticBoneRole, EulerDegrees>>>;
  const centerRotations: Partial<Record<SemanticBoneRole, EulerDegrees>> = {};

  if (kind === "BODY") {
    centerRotations.chest = hasIntent(intents, "GESTURE") ? rotation(0, 7, 2.5)
      : hasIntent(intents, "REACT") ? rotation(-4, -8, -3)
      : hasIntent(intents, "SIT") ? rotation(12, 0, 0)
      : hasIntent(intents, "STAND") ? rotation(-4, 0, 0)
      : rotation(1.5, 0, 1);
    centerRotations.spine = hasIntent(intents, "GESTURE", "REACT") ? rotation(0, -3, -1) : rotation(0.75, 0, -0.5);
  }
  if (kind === "HEAD" || kind === "GAZE") {
    centerRotations.head = hasIntent(intents, "LOOK") ? rotation(-2, 14, 0)
      : hasIntent(intents, "REACT") ? rotation(-7, -9, 2)
      : rotation(-2, 4, 0);
    centerRotations.neck = rotation(0, hasIntent(intents, "LOOK") ? 5 : 1.5, 0);
  }
  if (kind === "RIGHT_HAND") {
    centerRotations.rightShoulder = rotation(0, 0, hasIntent(intents, "GESTURE", "REACT") ? -8 : -3);
    centerRotations.rightUpperArm = hasIntent(intents, "GESTURE") ? rotation(-28, 12, -18)
      : hasIntent(intents, "REACT") ? rotation(-18, -10, -12)
      : rotation(-12, 5, -8);
    centerRotations.rightLowerArm = hasIntent(intents, "GESTURE", "REACT") ? rotation(-42, 0, 8) : rotation(-22, 0, 4);
    centerRotations.rightHand = rotation(0, 0, hasIntent(intents, "GESTURE") ? 14 : 5);
  }

  return Object.freeze([
    Object.freeze({ timeSeconds: 0, rootPosition: root, rotations: empty }),
    Object.freeze({ timeSeconds: midpoint, rootPosition: root, rotations: Object.freeze(centerRotations) }),
    Object.freeze({ timeSeconds: durationSeconds, rootPosition: root, rotations: empty }),
  ]);
}

function validatePayloads(payloads: readonly PerformanceTrackPayload[], durationSeconds: number): readonly string[] {
  const diagnostics: string[] = [];
  const ids = new Set<string>();
  for (const payload of payloads) {
    if (ids.has(payload.id)) diagnostics.push(`Duplicate performance payload ${payload.id}.`);
    ids.add(payload.id);
    if (payload.keyframes.length < 2) diagnostics.push(`Performance payload ${payload.id} requires at least two keyframes.`);
    let previous = -Infinity;
    for (const keyframe of payload.keyframes) {
      if (!Number.isFinite(keyframe.timeSeconds) || keyframe.timeSeconds < 0 || keyframe.timeSeconds > durationSeconds) {
        diagnostics.push(`Performance payload ${payload.id} contains an out-of-range keyframe.`);
      }
      if (keyframe.timeSeconds < previous) diagnostics.push(`Performance payload ${payload.id} keyframes are not monotonic.`);
      previous = keyframe.timeSeconds;
      if (!finitePoint(keyframe.rootPosition)) diagnostics.push(`Performance payload ${payload.id} contains a non-finite root position.`);
      for (const value of Object.values(keyframe.rotations)) {
        if (value === undefined) continue;
        if (![value.x, value.y, value.z].every((axis) => Number.isFinite(axis) && Math.abs(axis) <= 120)) {
          diagnostics.push(`Performance payload ${payload.id} exceeds bounded skeletal rotation limits.`);
        }
      }
    }
  }
  return Object.freeze(diagnostics);
}

function hasUnsupportedContactIntent(intents: readonly PerformanceIntent[]): boolean {
  return hasIntent(intents, "REACH", "GRASP", "RELEASE", "OPEN", "CLOSE");
}

function serializePerformance(performance: Performance): SerializedPerformance {
  return Object.freeze({
    id: performance.id,
    version: performance.version,
    source: "GENERATED",
    status: "CANDIDATE",
    skeletonId: performance.skeletonId,
    duration: serializeTime(performance.duration),
    tracks: Object.freeze(performance.tracks.map((track) => Object.freeze({ ...track }))),
    contacts: Object.freeze(performance.contacts.map((contact) => Object.freeze({
      id: contact.id,
      time: serializeTime(contact.time),
      phase: contact.phase,
      effector: contact.effector,
      targetEntityId: contact.targetEntityId,
      ...(contact.targetAnchor === undefined ? {} : { targetAnchor: contact.targetAnchor }),
    }))),
  });
}

export function executeActingPerformance(
  blocking: SceneBlockingArtifact,
  rig: CharacterRigArtifact,
  prompt: string,
  sourceCommit: string,
  now = Date.now(),
): ActingPerformanceResult {
  const failed = (diagnostics: readonly string[]): ActingPerformanceResult => ({
    ok: false,
    diagnostics: Object.freeze([...diagnostics]),
    gates: Object.freeze({ performance: false, contactIK: false, physics: false }),
  });

  if (!isSha40(sourceCommit) || sourceCommit !== rig.sourceCommit) {
    return failed(["Acting executor source identity does not match the prepared character rig."]);
  }
  if (blocking.actorId !== rig.actorId || rig.shotId.trim().length === 0) {
    return failed(["Acting executor actor/shot identity does not match scene blocking."]);
  }
  if (!semanticSkeletonCompatible(rig.skeleton, rig.skeleton) || validateSkeleton(rig.skeleton).length > 0) {
    return failed(["Prepared character rig is not semantically valid for performance execution."]);
  }

  const storyResult = compileStory(prompt, registryForRig(rig));
  if (!storyResult.ok || storyResult.ir.events.length === 0) {
    const messages = storyResult.diagnostics.map((item) => item.message);
    return failed([
      ...(messages.length > 0 ? messages : ["The story prompt produced no executable events."]),
      "Acting was not fabricated from unparsed natural language. Use deterministic action script syntax such as `ACTOR SPEAK Hello` or `ACTOR WAIT` until a semantic story parser is connected.",
    ]);
  }

  const intents = Object.freeze(storyResult.ir.events.flatMap((event) => [...lowerStoryEventToPerformanceIntents(event)]));
  if (intents.length === 0) return failed(["Story events produced no executable performance intents."]);

  const durationSeconds = blocking.output.durationSeconds;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return failed(["Acting requires a positive shot duration."]);
  const millis = Math.max(1, Math.round(durationSeconds * 1000));
  const duration = rationalTime(BigInt(millis), 1000n);
  const kinds = requestedTrackKinds(intents);
  const payloads = Object.freeze(kinds.map((kind) => {
    const id = `${rig.shotId}-${kind.toLowerCase()}-v1`;
    return Object.freeze({
      id,
      kind,
      keyframes: keyframesForTrack(kind, durationSeconds, blocking.plan.placements[0]?.position ?? point(0, 0, 0), intents),
    });
  }));
  const performance: Performance = Object.freeze({
    id: `${rig.shotId}-performance-v1`,
    version: 1,
    source: "GENERATED",
    status: "CANDIDATE",
    skeletonId: rig.skeleton.id,
    duration,
    tracks: Object.freeze(payloads.map((payload) => Object.freeze({ kind: payload.kind, payloadRef: payload.id }))),
    contacts: Object.freeze([]),
  });

  const structural = [...validatePerformance(performance).map((item) => item.message), ...validatePayloads(payloads, durationSeconds)];
  const contactIK = !hasUnsupportedContactIntent(intents);
  const performanceGate = structural.length === 0;
  const physicsGate = performanceGate && payloads.every((payload) => payload.keyframes.every((keyframe) => finitePoint(keyframe.rootPosition)));
  if (!performanceGate || !contactIK || !physicsGate) {
    return {
      ok: false,
      diagnostics: Object.freeze([
        ...structural,
        ...(contactIK ? [] : ["Interaction intents require real target anchors/contact IK; no contact was fabricated."]),
        ...(physicsGate ? [] : ["Deterministic skeletal poses failed bounded kinematic validation."]),
      ]),
      gates: Object.freeze({ performance: performanceGate, contactIK, physics: physicsGate }),
    };
  }

  return {
    ok: true,
    artifact: Object.freeze({
      schemaVersion: 1,
      actorId: rig.actorId,
      shotId: rig.shotId,
      sourceCommit,
      executorKind: PERFORMANCE_EXECUTOR_KIND,
      story: storyResult.ir,
      intents,
      performance: serializePerformance(performance),
      payloads,
      kinematicModel: "BOUNDED_PROCEDURAL_SKELETAL_POSE",
      createdAt: now,
    }),
    diagnostics: Object.freeze([
      `Executed ${intents.length} performance intent(s) into ${payloads.length} skeletal keyframe track(s).`,
      "Contact/IK passed because this performance claims no target contact; interaction actions remain fail-closed until real anchors are available.",
      "Physics gate is limited to finite, bounded kinematic skeletal poses; no unimplemented dynamic simulation is claimed.",
    ]),
    gates: Object.freeze({ performance: true, contactIK: true, physics: true }),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCharacterRigArtifact(value: unknown, expectedCommit?: string): value is CharacterRigArtifact {
  if (!record(value) || value.schemaVersion !== 1 || value.rigKind !== CANONICAL_RIG_KIND) return false;
  if (typeof value.actorId !== "string" || typeof value.shotId !== "string" || typeof value.sourceCommit !== "string") return false;
  if (expectedCommit !== undefined && value.sourceCommit !== expectedCommit) return false;
  if (!isSha40(value.sourceCommit) || value.binding !== "REFERENCE_APPEARANCE_TO_CANONICAL_CONTROL_RIG") return false;
  if (!record(value.skeleton) || !Array.isArray(value.skeleton.bones)) return false;
  return validateSkeleton(value.skeleton as unknown as SkeletonDefinition).length === 0;
}

export function isActingPerformanceArtifact(value: unknown, expectedCommit?: string): value is ActingPerformanceArtifact {
  if (!record(value) || value.schemaVersion !== 1 || value.executorKind !== PERFORMANCE_EXECUTOR_KIND) return false;
  if (typeof value.actorId !== "string" || typeof value.shotId !== "string" || typeof value.sourceCommit !== "string") return false;
  if (expectedCommit !== undefined && value.sourceCommit !== expectedCommit) return false;
  if (!isSha40(value.sourceCommit) || !Array.isArray(value.intents) || !Array.isArray(value.payloads)) return false;
  if (!record(value.performance) || !Array.isArray(value.performance.tracks) || !record(value.performance.duration)) return false;
  return value.payloads.length > 0 && value.payloads.every((payload) => record(payload) && Array.isArray(payload.keyframes) && payload.keyframes.length >= 2);
}
