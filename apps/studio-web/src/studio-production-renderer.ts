import type { StagePoint } from "@aistudio/performance-engine";
import {
  isActingPerformanceArtifact,
  isCharacterRigArtifact,
  type ActingPerformanceArtifact,
  type CharacterRigArtifact,
  type EulerDegrees,
  type PerformancePoseKeyframe,
  type PerformanceTrackPayload,
} from "./studio-character-performance";
import {
  isCameraExecutionArtifact,
  type CameraExecutionArtifact,
  type CameraKeyframe,
} from "./studio-camera-executor";
import type { SceneBlockingArtifact, SceneReferenceIdentity } from "./studio-scene-blocking";

export const PRODUCTION_RENDER_EXECUTOR_KIND = "AISTUDIO_SOURCE_BOUND_2D_CUTOUT_V1" as const;
const CHECKSUM_OFFSET = 0x811c9dc5;
const CHECKSUM_PRIME = 0x01000193;
const CHARACTER_HEIGHT_METERS = 1.8;

export type ProductionCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface ProductionPoseSample {
  readonly timeSeconds: number;
  readonly rootPosition: StagePoint;
  readonly bodyPitchDegrees: number;
  readonly bodyLeanDegrees: number;
  readonly headYawDegrees: number;
  readonly rightArmSwingDegrees: number;
}

export interface ProductionCameraSample {
  readonly timeSeconds: number;
  readonly position: StagePoint;
  readonly target: StagePoint;
  readonly verticalFovDegrees: number;
  readonly distanceToTarget: number;
}

export interface ProductionFrameEvidence {
  readonly timeSeconds: number;
  readonly checksum: string;
  readonly sourceCoveragePixels: number;
  readonly sourceDrawWidth: number;
  readonly sourceDrawHeight: number;
  readonly pose: ProductionPoseSample;
  readonly camera: ProductionCameraSample;
}

export interface ProductionRenderArtifact {
  readonly schemaVersion: 1;
  readonly actorId: string;
  readonly shotId: string;
  readonly sourceCommit: string;
  readonly executorKind: typeof PRODUCTION_RENDER_EXECUTOR_KIND;
  readonly reference: SceneReferenceIdentity;
  readonly output: SceneBlockingArtifact["output"];
  readonly temporalEvidence: readonly ProductionFrameEvidence[];
  readonly continuity: {
    readonly exactSourceIdentity: true;
    readonly exactActorIdentity: true;
    readonly exactReferenceIdentity: true;
    readonly performanceValidated: true;
    readonly cameraValidated: true;
  };
  readonly renderModel: "SOURCE_PIXEL_2D_CUTOUT_CANONICAL_CONTROL";
  readonly createdAt: number;
}

export interface ProductionRenderBindings {
  readonly blocking: SceneBlockingArtifact;
  readonly rig: CharacterRigArtifact;
  readonly acting: ActingPerformanceArtifact;
  readonly camera: CameraExecutionArtifact;
  readonly sourceCommit: string;
}

export interface PreparedProductionRenderer {
  readonly bindings: ProductionRenderBindings;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  renderFrame(context: ProductionCanvasContext, timeSeconds: number, captureEvidence?: boolean): ProductionFrameEvidence | null;
  close(): void;
}

export type ProductionRendererPreparation =
  | { readonly ok: true; readonly renderer: PreparedProductionRenderer; readonly diagnostics: readonly string[] }
  | { readonly ok: false; readonly diagnostics: readonly string[] };

export type ProductionTemporalVerification =
  | { readonly ok: true; readonly artifact: ProductionRenderArtifact; readonly diagnostics: readonly string[] }
  | { readonly ok: false; readonly diagnostics: readonly string[] };

interface DecodedReference {
  readonly source: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  close(): void;
}

function isSha40(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

function sameReference(left: SceneReferenceIdentity, right: SceneReferenceIdentity): boolean {
  return left.name === right.name
    && left.mimeType === right.mimeType
    && left.size === right.size
    && left.width === right.width
    && left.height === right.height;
}

function lerp(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerpPoint(left: StagePoint, right: StagePoint, amount: number): StagePoint {
  return Object.freeze({
    x: lerp(left.x, right.x, amount),
    y: lerp(left.y, right.y, amount),
    z: lerp(left.z, right.z, amount),
  });
}

function eulerAt(
  left: Readonly<Partial<Record<string, EulerDegrees>>>,
  right: Readonly<Partial<Record<string, EulerDegrees>>>,
  key: string,
  amount: number,
): EulerDegrees | undefined {
  const a = left[key];
  const b = right[key];
  if (a === undefined && b === undefined) return undefined;
  const from = a ?? { x: 0, y: 0, z: 0 };
  const to = b ?? { x: 0, y: 0, z: 0 };
  return Object.freeze({
    x: lerp(from.x, to.x, amount),
    y: lerp(from.y, to.y, amount),
    z: lerp(from.z, to.z, amount),
  });
}

function keyframePair(
  keyframes: readonly PerformancePoseKeyframe[],
  timeSeconds: number,
): { readonly left: PerformancePoseKeyframe; readonly right: PerformancePoseKeyframe; readonly amount: number } {
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (first === undefined || last === undefined) throw new Error("Performance track has no keyframes.");
  if (timeSeconds <= first.timeSeconds) return { left: first, right: first, amount: 0 };
  if (timeSeconds >= last.timeSeconds) return { left: last, right: last, amount: 0 };
  for (let index = 1; index < keyframes.length; index += 1) {
    const right = keyframes[index];
    const left = keyframes[index - 1];
    if (left === undefined || right === undefined || timeSeconds > right.timeSeconds) continue;
    const span = right.timeSeconds - left.timeSeconds;
    return { left, right, amount: span <= 0 ? 0 : (timeSeconds - left.timeSeconds) / span };
  }
  return { left: last, right: last, amount: 0 };
}

function sampleTrack(payload: PerformanceTrackPayload, timeSeconds: number): PerformancePoseKeyframe {
  const pair = keyframePair(payload.keyframes, timeSeconds);
  const keys = new Set<string>([
    ...Object.keys(pair.left.rotations),
    ...Object.keys(pair.right.rotations),
  ]);
  const rotations: Record<string, EulerDegrees> = {};
  for (const key of keys) {
    const value = eulerAt(pair.left.rotations, pair.right.rotations, key, pair.amount);
    if (value !== undefined) rotations[key] = value;
  }
  return Object.freeze({
    timeSeconds,
    rootPosition: lerpPoint(pair.left.rootPosition, pair.right.rootPosition, pair.amount),
    rotations: Object.freeze(rotations),
  });
}

function rotationAxis(samples: readonly PerformancePoseKeyframe[], key: string, axis: keyof EulerDegrees): number {
  for (const sample of samples) {
    const value = (sample.rotations as Readonly<Record<string, EulerDegrees | undefined>>)[key];
    if (value !== undefined) return value[axis];
  }
  return 0;
}

export function sampleProductionPose(acting: ActingPerformanceArtifact, timeSeconds: number): ProductionPoseSample {
  if (!Number.isFinite(timeSeconds)) throw new RangeError("Production pose time must be finite.");
  const samples = acting.payloads.map((payload) => sampleTrack(payload, timeSeconds));
  if (samples.length === 0) throw new Error("Production performance contains no executable payloads.");
  const rootSample = acting.payloads.findIndex((payload) => payload.kind === "ROOT");
  const rootPosition = samples[rootSample >= 0 ? rootSample : 0]?.rootPosition;
  if (rootPosition === undefined) throw new Error("Production performance root sample is unavailable.");
  const bodyPitchDegrees = rotationAxis(samples, "chest", "x") + rotationAxis(samples, "spine", "x") * 0.5;
  const bodyLeanDegrees = rotationAxis(samples, "chest", "z") + rotationAxis(samples, "spine", "z") * 0.5;
  const headYawDegrees = rotationAxis(samples, "head", "y") + rotationAxis(samples, "neck", "y");
  const rightArmSwingDegrees = rotationAxis(samples, "rightUpperArm", "x")
    + rotationAxis(samples, "rightLowerArm", "x") * 0.5
    + rotationAxis(samples, "rightShoulder", "z") * 0.5;
  return Object.freeze({
    timeSeconds,
    rootPosition,
    bodyPitchDegrees,
    bodyLeanDegrees,
    headYawDegrees,
    rightArmSwingDegrees,
  });
}

export function sampleProductionCamera(camera: CameraExecutionArtifact, timeSeconds: number): ProductionCameraSample {
  if (!Number.isFinite(timeSeconds)) throw new RangeError("Production camera time must be finite.");
  const first = camera.keyframes[0];
  const last = camera.keyframes[camera.keyframes.length - 1];
  if (first === undefined || last === undefined) throw new Error("Production camera has no keyframes.");
  let sampled: CameraKeyframe;
  if (timeSeconds <= first.timeSeconds) sampled = first;
  else if (timeSeconds >= last.timeSeconds) sampled = last;
  else {
    sampled = last;
    for (let index = 1; index < camera.keyframes.length; index += 1) {
      const right = camera.keyframes[index];
      const left = camera.keyframes[index - 1];
      if (left === undefined || right === undefined || timeSeconds > right.timeSeconds) continue;
      const span = right.timeSeconds - left.timeSeconds;
      const amount = span <= 0 ? 0 : (timeSeconds - left.timeSeconds) / span;
      sampled = Object.freeze({
        timeSeconds,
        position: lerpPoint(left.position, right.position, amount),
        target: lerpPoint(left.target, right.target, amount),
        verticalFovDegrees: lerp(left.verticalFovDegrees, right.verticalFovDegrees, amount),
      });
      break;
    }
  }
  const distanceToTarget = Math.hypot(
    sampled.position.x - sampled.target.x,
    sampled.position.y - sampled.target.y,
    sampled.position.z - sampled.target.z,
  );
  return Object.freeze({
    timeSeconds,
    position: sampled.position,
    target: sampled.target,
    verticalFovDegrees: sampled.verticalFovDegrees,
    distanceToTarget,
  });
}

export function validateProductionRenderBindings(bindings: ProductionRenderBindings): readonly string[] {
  const { blocking, rig, acting, camera, sourceCommit } = bindings;
  const diagnostics: string[] = [];
  if (!isSha40(sourceCommit)) diagnostics.push("Production renderer requires the exact 40-character Studio source commit.");
  if (!isCharacterRigArtifact(rig, sourceCommit)) diagnostics.push("Production renderer rejected the character rig/source identity.");
  if (!isActingPerformanceArtifact(acting, sourceCommit)) diagnostics.push("Production renderer rejected the acting performance/source identity.");
  if (!isCameraExecutionArtifact(camera, sourceCommit)) diagnostics.push("Production renderer rejected the READY_FOR_RENDER camera/source identity.");
  if (blocking.actorId !== rig.actorId || blocking.actorId !== acting.actorId || blocking.actorId !== camera.actorId) {
    diagnostics.push("Production renderer actor identity changed between blocking, rig, acting and camera stages.");
  }
  if (rig.shotId !== acting.shotId || rig.shotId !== camera.shotId) {
    diagnostics.push("Production renderer shot identity changed between rig, acting and camera stages.");
  }
  if (!sameReference(blocking.reference, rig.reference) || !sameReference(blocking.reference, camera.reference)) {
    diagnostics.push("Production renderer reference identity changed after scene blocking.");
  }
  if (!camera.visibilitySamples.every((sample) => sample.visible)) {
    diagnostics.push("Production renderer requires all admitted camera visibility samples to remain visible.");
  }
  if (!Number.isFinite(blocking.output.durationSeconds) || blocking.output.durationSeconds <= 0) {
    diagnostics.push("Production renderer requires a positive shot duration.");
  }
  if (!Number.isSafeInteger(blocking.output.width) || !Number.isSafeInteger(blocking.output.height)
    || blocking.output.width <= 0 || blocking.output.height <= 0) {
    diagnostics.push("Production renderer requires positive integer output dimensions.");
  }
  return Object.freeze(diagnostics);
}

function fileMatchesReference(file: File, reference: SceneReferenceIdentity): boolean {
  return file.name === reference.name
    && file.size === reference.size
    && (file.type || reference.mimeType) === reference.mimeType;
}

async function decodeReference(file: File): Promise<DecodedReference> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  }
  if (typeof document === "undefined") throw new Error("Reference image decoding is unavailable in this runtime.");
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error("Production reference image could not be decoded."));
      node.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function fnv1a(hash: number, bytes: Uint8ClampedArray): number {
  let value = hash >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    value ^= bytes[index] ?? 0;
    value = Math.imul(value, CHECKSUM_PRIME) >>> 0;
  }
  return value;
}

function readbackChecksum(context: ProductionCanvasContext, width: number, height: number): string {
  const centerY = Math.max(0, Math.min(height - 1, Math.floor(height / 2)));
  const centerX = Math.max(0, Math.min(width - 1, Math.floor(width / 2)));
  const horizontal = context.getImageData(0, centerY, width, 1).data;
  const vertical = context.getImageData(centerX, 0, 1, height).data;
  let hash = fnv1a(CHECKSUM_OFFSET, horizontal);
  hash = fnv1a(hash, vertical);
  return hash.toString(16).padStart(8, "0");
}

function drawReferenceCutout(
  context: ProductionCanvasContext,
  decoded: DecodedReference,
  width: number,
  height: number,
  pose: ProductionPoseSample,
  camera: ProductionCameraSample,
): { readonly width: number; readonly height: number; readonly coveragePixels: number } {
  const fovRadians = camera.verticalFovDegrees * Math.PI / 180;
  const tangent = Math.tan(fovRadians / 2);
  if (!Number.isFinite(tangent) || tangent <= 0 || !Number.isFinite(camera.distanceToTarget) || camera.distanceToTarget <= 0) {
    throw new Error("Production camera projection is invalid at the requested frame time.");
  }
  const projectedCharacterHeight = CHARACTER_HEIGHT_METERS / (2 * camera.distanceToTarget * tangent) * height;
  const sourceAspect = decoded.width / decoded.height;
  const poseScale = 1 + clamp(-pose.bodyPitchDegrees / 600 + Math.abs(pose.rightArmSwingDegrees) / 2400, -0.04, 0.06);
  const drawHeight = clamp(projectedCharacterHeight * poseScale, height * 0.24, height * 0.88);
  const drawWidth = Math.min(width * 0.9, drawHeight * sourceAspect);
  const centerX = width / 2
    + clamp((pose.rootPosition.x - camera.target.x) * width * 0.08, -width * 0.18, width * 0.18)
    + clamp((pose.headYawDegrees + pose.rightArmSwingDegrees * 0.18) / 420 * width, -width * 0.08, width * 0.08);
  const centerY = height * 0.54
    + clamp((camera.target.y - 0.95) * height * 0.12, -height * 0.08, height * 0.08)
    + clamp(pose.bodyPitchDegrees / 500 * height, -height * 0.04, height * 0.04);
  const rotationDegrees = clamp(
    pose.bodyLeanDegrees * 0.8 + pose.headYawDegrees * 0.08 + pose.rightArmSwingDegrees * 0.035,
    -12,
    12,
  );

  context.save();
  context.translate(centerX, centerY);
  context.rotate(rotationDegrees * Math.PI / 180);
  context.drawImage(decoded.source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();

  const clippedWidth = Math.max(0, Math.min(drawWidth, width));
  const clippedHeight = Math.max(0, Math.min(drawHeight, height));
  return Object.freeze({
    width: drawWidth,
    height: drawHeight,
    coveragePixels: Math.max(1, Math.round(clippedWidth * clippedHeight)),
  });
}

export async function prepareProductionRenderer(
  bindings: ProductionRenderBindings,
  referenceFile: File,
): Promise<ProductionRendererPreparation> {
  const diagnostics = [...validateProductionRenderBindings(bindings)];
  if (!fileMatchesReference(referenceFile, bindings.blocking.reference)) {
    diagnostics.push("Production renderer received a reference file that does not match scene-blocking name/type/size identity.");
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics: Object.freeze(diagnostics) };

  let decoded: DecodedReference;
  try {
    decoded = await decodeReference(referenceFile);
  } catch (error) {
    return {
      ok: false,
      diagnostics: Object.freeze([error instanceof Error ? error.message : "Production reference image decoding failed."]),
    };
  }
  if (decoded.width !== bindings.blocking.reference.width || decoded.height !== bindings.blocking.reference.height) {
    decoded.close();
    return {
      ok: false,
      diagnostics: Object.freeze(["Production renderer decoded dimensions do not match the admitted reference identity."]),
    };
  }

  const { width, height, durationSeconds } = bindings.blocking.output;
  let closed = false;
  const renderer: PreparedProductionRenderer = Object.freeze({
    bindings,
    width,
    height,
    durationSeconds,
    renderFrame(context: ProductionCanvasContext, timeSeconds: number, captureEvidence = false): ProductionFrameEvidence | null {
      if (closed) throw new Error("Production renderer is closed.");
      if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds > durationSeconds) {
        throw new RangeError(`Production frame time ${timeSeconds} is outside 0..${durationSeconds}s.`);
      }
      if (context.canvas.width !== width || context.canvas.height !== height) {
        throw new Error(`Production render target must be ${width}×${height}.`);
      }
      const pose = sampleProductionPose(bindings.acting, timeSeconds);
      const camera = sampleProductionCamera(bindings.camera, timeSeconds);
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.fillStyle = "rgb(10, 12, 16)";
      context.fillRect(0, 0, width, height);
      context.fillStyle = "rgb(18, 21, 27)";
      context.fillRect(0, Math.round(height * 0.76), width, Math.ceil(height * 0.24));
      const draw = drawReferenceCutout(context, decoded, width, height, pose, camera);
      context.restore();
      if (!captureEvidence) return null;
      return Object.freeze({
        timeSeconds,
        checksum: readbackChecksum(context, width, height),
        sourceCoveragePixels: draw.coveragePixels,
        sourceDrawWidth: draw.width,
        sourceDrawHeight: draw.height,
        pose,
        camera,
      });
    },
    close() {
      if (closed) return;
      closed = true;
      decoded.close();
    },
  });

  return {
    ok: true,
    renderer,
    diagnostics: Object.freeze([
      "Decoded exact reference pixels and bound them to the exact-source rig, validated performance and READY_FOR_RENDER camera.",
      "Renderer is an explicit source-pixel 2D cutout driven by canonical control transforms; it does not claim image-derived bones, learned deformation or photorealistic 3D reconstruction.",
    ]),
  };
}

function createEvidenceCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  if (typeof document === "undefined") throw new Error("Production temporal verification requires a canvas runtime.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function verifyProductionTemporalMotion(
  renderer: PreparedProductionRenderer,
  now = Date.now(),
): ProductionTemporalVerification {
  const canvas = createEvidenceCanvas(renderer.width, renderer.height);
  const context = canvas.getContext("2d");
  if (context === null) return { ok: false, diagnostics: Object.freeze(["Production temporal verification could not acquire a 2D canvas context."]) };
  const duration = renderer.durationSeconds;
  const times = [0, duration * 0.5, duration * 0.82];
  const evidence: ProductionFrameEvidence[] = [];
  try {
    for (const time of times) {
      const frame = renderer.renderFrame(context, time, true);
      if (frame === null) throw new Error("Production renderer did not emit frame evidence.");
      evidence.push(frame);
    }
  } catch (error) {
    return { ok: false, diagnostics: Object.freeze([error instanceof Error ? error.message : "Production temporal verification failed."]) };
  }
  if (evidence.some((frame) => frame.sourceCoveragePixels <= 0)) {
    return { ok: false, diagnostics: Object.freeze(["Production render evidence contains no source-pixel coverage."]) };
  }
  const checksums = new Set(evidence.map((frame) => frame.checksum));
  if (checksums.size < 2) {
    return { ok: false, diagnostics: Object.freeze(["Production render frames are temporally identical; animated-frame gate failed closed."]) };
  }
  const bindings = renderer.bindings;
  return {
    ok: true,
    artifact: Object.freeze({
      schemaVersion: 1,
      actorId: bindings.blocking.actorId,
      shotId: bindings.rig.shotId,
      sourceCommit: bindings.sourceCommit,
      executorKind: PRODUCTION_RENDER_EXECUTOR_KIND,
      reference: Object.freeze({ ...bindings.blocking.reference }),
      output: Object.freeze({ ...bindings.blocking.output }),
      temporalEvidence: Object.freeze(evidence),
      continuity: Object.freeze({
        exactSourceIdentity: true,
        exactActorIdentity: true,
        exactReferenceIdentity: true,
        performanceValidated: true,
        cameraValidated: true,
      }),
      renderModel: "SOURCE_PIXEL_2D_CUTOUT_CANONICAL_CONTROL",
      createdAt: now,
    }),
    diagnostics: Object.freeze([
      `Rendered ${evidence.length} exact-source temporal samples with ${checksums.size} distinct readback checksums.`,
      "Animated-frame evidence comes from source-pixel geometry transformed by sampled canonical performance and camera state.",
    ]),
  };
}
