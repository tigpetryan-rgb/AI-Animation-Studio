import type { StagePoint } from "@aistudio/performance-engine";
import type { ActingPerformanceArtifact, CharacterRigArtifact } from "./studio-character-performance";
import type { SceneBlockingArtifact, SceneReferenceIdentity } from "./studio-scene-blocking";

export const CAMERA_EXECUTOR_KIND = "AISTUDIO_DETERMINISTIC_LOOKAT_CAMERA_V1" as const;

export interface CameraKeyframe {
  readonly timeSeconds: number;
  readonly position: StagePoint;
  readonly target: StagePoint;
  readonly verticalFovDegrees: number;
}

export interface CameraVisibilitySample {
  readonly timeSeconds: number;
  readonly depthNear: number;
  readonly minNdcX: number;
  readonly maxNdcX: number;
  readonly minNdcY: number;
  readonly maxNdcY: number;
  readonly visible: boolean;
}

export interface CameraExecutionArtifact {
  readonly schemaVersion: 1;
  readonly actorId: string;
  readonly shotId: string;
  readonly sourceCommit: string;
  readonly executorKind: typeof CAMERA_EXECUTOR_KIND;
  readonly reference: SceneReferenceIdentity;
  readonly keyframes: readonly CameraKeyframe[];
  readonly visibilitySamples: readonly CameraVisibilitySample[];
  readonly visibilityMarginNdc: number;
  readonly continuity: {
    readonly exactReferenceIdentity: true;
    readonly exactActorIdentity: true;
    readonly exactSourceIdentity: true;
  };
  readonly createdAt: number;
}

export interface CameraExecutionResult {
  readonly ok: boolean;
  readonly artifact?: CameraExecutionArtifact;
  readonly diagnostics: readonly string[];
  readonly gates: {
    readonly cameraVisibility: boolean;
    readonly continuity: boolean;
  };
}

interface Vector3 { readonly x: number; readonly y: number; readonly z: number; }

const CAMERA_FOV_DEGREES = 50;
const VISIBILITY_MARGIN_NDC = 0.04;
const CHARACTER_HALF_WIDTH_METERS = 0.34;
const CHARACTER_HEIGHT_METERS = 1.8;

function point(x: number, y: number, z: number): StagePoint {
  return Object.freeze({ x, y, z });
}
function sub(a: Vector3, b: Vector3): Vector3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function scale(a: Vector3, value: number): Vector3 { return { x: a.x * value, y: a.y * value, z: a.z * value }; }
function dot(a: Vector3, b: Vector3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a: Vector3, b: Vector3): Vector3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function length(a: Vector3): number { return Math.hypot(a.x, a.y, a.z); }
function normalize(a: Vector3): Vector3 | null {
  const value = length(a);
  return Number.isFinite(value) && value > 1e-6 ? scale(a, 1 / value) : null;
}
function lerp(a: Vector3, b: Vector3, amount: number): StagePoint {
  return point(a.x + (b.x - a.x) * amount, a.y + (b.y - a.y) * amount, a.z + (b.z - a.z) * amount);
}
function sameReference(a: SceneReferenceIdentity, b: SceneReferenceIdentity): boolean {
  return a.name === b.name && a.mimeType === b.mimeType && a.size === b.size && a.width === b.width && a.height === b.height;
}
function isSha40(value: string): boolean { return /^[0-9a-f]{40}$/.test(value); }

function cameraAt(keyframes: readonly CameraKeyframe[], timeSeconds: number): CameraKeyframe {
  if (keyframes.length === 0) throw new Error("Camera execution requires keyframes.");
  if (timeSeconds <= keyframes[0]!.timeSeconds) return keyframes[0]!;
  const last = keyframes[keyframes.length - 1]!;
  if (timeSeconds >= last.timeSeconds) return last;
  for (let index = 1; index < keyframes.length; index += 1) {
    const right = keyframes[index]!;
    const left = keyframes[index - 1]!;
    if (timeSeconds > right.timeSeconds) continue;
    const span = right.timeSeconds - left.timeSeconds;
    const amount = span <= 0 ? 0 : (timeSeconds - left.timeSeconds) / span;
    return Object.freeze({
      timeSeconds,
      position: lerp(left.position, right.position, amount),
      target: lerp(left.target, right.target, amount),
      verticalFovDegrees: left.verticalFovDegrees + (right.verticalFovDegrees - left.verticalFovDegrees) * amount,
    });
  }
  return last;
}

function characterBounds(root: StagePoint): readonly StagePoint[] {
  const centerY = root.y + CHARACTER_HEIGHT_METERS / 2;
  const halfHeight = CHARACTER_HEIGHT_METERS / 2;
  return Object.freeze([
    point(root.x - CHARACTER_HALF_WIDTH_METERS, centerY - halfHeight, root.z),
    point(root.x + CHARACTER_HALF_WIDTH_METERS, centerY - halfHeight, root.z),
    point(root.x - CHARACTER_HALF_WIDTH_METERS, centerY + halfHeight, root.z),
    point(root.x + CHARACTER_HALF_WIDTH_METERS, centerY + halfHeight, root.z),
    point(root.x, centerY, root.z),
  ]);
}

function visibilitySample(
  camera: CameraKeyframe,
  actorRoot: StagePoint,
  aspect: number,
): CameraVisibilitySample {
  const forward = normalize(sub(camera.target, camera.position));
  const worldUp: Vector3 = { x: 0, y: 1, z: 0 };
  if (forward === null) {
    return Object.freeze({ timeSeconds: camera.timeSeconds, depthNear: -1, minNdcX: Infinity, maxNdcX: Infinity, minNdcY: Infinity, maxNdcY: Infinity, visible: false });
  }
  let right = normalize(cross(forward, worldUp));
  if (right === null) right = normalize(cross(forward, { x: 0, y: 0, z: 1 }));
  if (right === null) {
    return Object.freeze({ timeSeconds: camera.timeSeconds, depthNear: -1, minNdcX: Infinity, maxNdcX: Infinity, minNdcY: Infinity, maxNdcY: Infinity, visible: false });
  }
  const up = normalize(cross(right, forward));
  if (up === null) {
    return Object.freeze({ timeSeconds: camera.timeSeconds, depthNear: -1, minNdcX: Infinity, maxNdcX: Infinity, minNdcY: Infinity, maxNdcY: Infinity, visible: false });
  }

  const tangent = Math.tan((camera.verticalFovDegrees * Math.PI) / 360);
  let depthNear = Infinity;
  let minNdcX = Infinity;
  let maxNdcX = -Infinity;
  let minNdcY = Infinity;
  let maxNdcY = -Infinity;
  for (const world of characterBounds(actorRoot)) {
    const relative = sub(world, camera.position);
    const depth = dot(relative, forward);
    depthNear = Math.min(depthNear, depth);
    if (depth <= 1e-4 || !Number.isFinite(tangent) || tangent <= 0 || !Number.isFinite(aspect) || aspect <= 0) {
      minNdcX = Infinity; maxNdcX = Infinity; minNdcY = Infinity; maxNdcY = Infinity; break;
    }
    const ndcX = dot(relative, right) / (depth * tangent * aspect);
    const ndcY = dot(relative, up) / (depth * tangent);
    minNdcX = Math.min(minNdcX, ndcX); maxNdcX = Math.max(maxNdcX, ndcX);
    minNdcY = Math.min(minNdcY, ndcY); maxNdcY = Math.max(maxNdcY, ndcY);
  }
  const limit = 1 - VISIBILITY_MARGIN_NDC;
  const visible = depthNear > 0
    && minNdcX >= -limit && maxNdcX <= limit
    && minNdcY >= -limit && maxNdcY <= limit;
  return Object.freeze({ timeSeconds: camera.timeSeconds, depthNear, minNdcX, maxNdcX, minNdcY, maxNdcY, visible });
}

export function prepareCameraExecution(
  blocking: SceneBlockingArtifact,
  rig: CharacterRigArtifact,
  acting: ActingPerformanceArtifact,
  sourceCommit: string,
  now = Date.now(),
): CameraExecutionResult {
  const fail = (diagnostics: readonly string[], cameraVisibility = false, continuity = false): CameraExecutionResult => ({
    ok: false,
    diagnostics: Object.freeze([...diagnostics]),
    gates: Object.freeze({ cameraVisibility, continuity }),
  });

  if (!isSha40(sourceCommit) || rig.sourceCommit !== sourceCommit || acting.sourceCommit !== sourceCommit) {
    return fail(["Camera executor source identity does not match the rig/performance source commit."]);
  }
  if (rig.actorId !== blocking.actorId || acting.actorId !== blocking.actorId || rig.shotId !== acting.shotId) {
    return fail(["Camera executor actor/shot identity does not match blocking, rig and acting artifacts."]);
  }
  const continuity = sameReference(blocking.reference, rig.reference);
  if (!continuity) return fail(["Exact reference identity changed between blocking and character rig."], false, false);
  const placement = blocking.plan.placements.find((item) => item.actorId === blocking.actorId);
  if (placement === undefined) return fail(["Camera visibility requires the blocked actor placement."], false, true);
  const duration = blocking.output.durationSeconds;
  if (!Number.isFinite(duration) || duration <= 0) return fail(["Camera execution requires a positive shot duration."], false, true);
  const aspect = blocking.output.width / blocking.output.height;
  if (!Number.isFinite(aspect) || aspect <= 0) return fail(["Camera execution requires a valid output aspect ratio."], false, true);

  const draft = blocking.cameraDraft;
  const keyframes: readonly CameraKeyframe[] = Object.freeze([
    Object.freeze({ timeSeconds: 0, position: point(draft.start.x, draft.start.y, draft.start.z), target: point(draft.target.x, draft.target.y, draft.target.z), verticalFovDegrees: CAMERA_FOV_DEGREES }),
    Object.freeze({ timeSeconds: duration / 2, position: lerp(draft.start, draft.end, 0.5), target: point(draft.target.x, draft.target.y, draft.target.z), verticalFovDegrees: CAMERA_FOV_DEGREES }),
    Object.freeze({ timeSeconds: duration, position: point(draft.end.x, draft.end.y, draft.end.z), target: point(draft.target.x, draft.target.y, draft.target.z), verticalFovDegrees: CAMERA_FOV_DEGREES }),
  ]);
  const sampleTimes = [0, duration * 0.25, duration * 0.5, duration * 0.75, duration];
  const samples = Object.freeze(sampleTimes.map((time) => visibilitySample(cameraAt(keyframes, time), placement.position, aspect)));
  const cameraVisibility = samples.every((sample) => sample.visible);
  if (!cameraVisibility) {
    const first = samples.find((sample) => !sample.visible)!;
    return fail([
      `Camera visibility failed at ${first.timeSeconds.toFixed(3)}s: depth=${first.depthNear.toFixed(3)}, ndc=[${first.minNdcX.toFixed(3)},${first.maxNdcX.toFixed(3)}]×[${first.minNdcY.toFixed(3)},${first.maxNdcY.toFixed(3)}].`,
    ], false, true);
  }

  return {
    ok: true,
    artifact: Object.freeze({
      schemaVersion: 1,
      actorId: blocking.actorId,
      shotId: rig.shotId,
      sourceCommit,
      executorKind: CAMERA_EXECUTOR_KIND,
      reference: Object.freeze({ ...blocking.reference }),
      keyframes,
      visibilitySamples: samples,
      visibilityMarginNdc: VISIBILITY_MARGIN_NDC,
      continuity: Object.freeze({ exactReferenceIdentity: true, exactActorIdentity: true, exactSourceIdentity: true }),
      createdAt: now,
    }),
    diagnostics: Object.freeze([
      `Camera path validated at ${samples.length} temporal samples with full character bounds inside the ${Math.round(CAMERA_FOV_DEGREES)}° vertical frustum.`,
      "Continuity gate is exact source/reference/actor identity continuity; no unmeasured visual-similarity score is claimed.",
    ]),
    gates: Object.freeze({ cameraVisibility: true, continuity: true }),
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCameraExecutionArtifact(value: unknown, expectedCommit?: string): value is CameraExecutionArtifact {
  if (!record(value) || value.schemaVersion !== 1 || value.executorKind !== CAMERA_EXECUTOR_KIND) return false;
  if (typeof value.actorId !== "string" || typeof value.shotId !== "string" || typeof value.sourceCommit !== "string") return false;
  if (!isSha40(value.sourceCommit) || (expectedCommit !== undefined && value.sourceCommit !== expectedCommit)) return false;
  if (!Array.isArray(value.keyframes) || value.keyframes.length < 2 || !Array.isArray(value.visibilitySamples) || value.visibilitySamples.length < 2) return false;
  if (!record(value.continuity) || value.continuity.exactReferenceIdentity !== true || value.continuity.exactActorIdentity !== true || value.continuity.exactSourceIdentity !== true) return false;
  return value.visibilitySamples.every((sample) => record(sample) && sample.visible === true);
}
