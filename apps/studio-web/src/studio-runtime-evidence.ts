import { currentStudioBuildIdentity, type DeviceBuildIdentity } from "./device-check";
import {
  isStudioRuntimePhysicalEvidenceCandidate,
  validateStudioRuntimeInfo,
  type StudioRuntimeInfo,
  type StudioRuntimeMp4Inspection,
  type StudioRuntimeNativeSaveResult,
} from "./studio-runtime-bridge";

const SHA256 = /^[0-9a-f]{64}$/;

export interface StudioRuntimeCertificationEvidence {
  readonly schemaVersion: 1;
  readonly capturedAt: string;
  readonly userAgent: string;
  readonly projectId: string;
  readonly physicalHardwareConfirmed: boolean;
  readonly runtime: StudioRuntimeInfo;
  readonly nativeSave: StudioRuntimeNativeSaveResult;
  readonly nativeInspection: StudioRuntimeMp4Inspection;
}

export type StudioRuntimeCertificationValidation =
  | { readonly ok: true; readonly report: StudioRuntimeCertificationEvidence }
  | { readonly ok: false; readonly issues: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readBoolean(record: Record<string, unknown>, key: string, path: string, issues: string[]): boolean | null {
  const value = record[key];
  if (typeof value !== "boolean") {
    issues.push(`${path}.${key} must be boolean.`);
    return null;
  }
  return value;
}

function readNonNegativeInteger(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[],
): number | null {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issues.push(`${path}.${key} must be a non-negative safe integer.`);
    return null;
  }
  return value;
}

export function createStudioRuntimeCertificationEvidence(
  runtime: StudioRuntimeInfo,
  nativeSave: StudioRuntimeNativeSaveResult,
  nativeInspection: StudioRuntimeMp4Inspection,
  projectId: string,
  physicalHardwareConfirmed: boolean,
  capturedAt = new Date().toISOString(),
  userAgent = navigator.userAgent,
): StudioRuntimeCertificationEvidence {
  return Object.freeze({
    schemaVersion: 1,
    capturedAt,
    userAgent,
    projectId,
    physicalHardwareConfirmed,
    runtime,
    nativeSave,
    nativeInspection,
  });
}

export function validateStudioRuntimeCertificationEvidence(
  input: unknown,
  expectedBuild: DeviceBuildIdentity = currentStudioBuildIdentity(),
): StudioRuntimeCertificationValidation {
  const issues: string[] = [];
  if (!isRecord(input)) return { ok: false, issues: ["Runtime evidence root must be a JSON object."] };

  if (input.schemaVersion !== 1) issues.push("schemaVersion must equal 1.");
  if (!isNonEmptyString(input.capturedAt) || Number.isNaN(Date.parse(input.capturedAt))) {
    issues.push("capturedAt must be a valid date/time string.");
  }
  if (!isNonEmptyString(input.userAgent)) issues.push("userAgent must be a non-empty string.");
  if (!isNonEmptyString(input.projectId)) issues.push("projectId must be a non-empty string.");
  if (input.physicalHardwareConfirmed !== true) {
    issues.push("physicalHardwareConfirmed must equal true for M55 certification evidence.");
  }

  let runtime: StudioRuntimeInfo | null = null;
  const runtimeValidation = validateStudioRuntimeInfo(input.runtime, expectedBuild);
  if (!runtimeValidation.ok) {
    issues.push(...runtimeValidation.issues.map((issue) => `runtime: ${issue}`));
  } else {
    runtime = runtimeValidation.info;
    if (!isStudioRuntimePhysicalEvidenceCandidate(runtime)) {
      issues.push("runtime is not eligible as a physical-device evidence candidate.");
    }
  }

  let nativeSave: StudioRuntimeNativeSaveResult | null = null;
  if (!isRecord(input.nativeSave)) {
    issues.push("nativeSave must be an object.");
  } else {
    const uri = input.nativeSave.uri;
    const bytesWritten = readNonNegativeInteger(input.nativeSave, "bytesWritten", "nativeSave", issues);
    const sha256 = input.nativeSave.sha256;
    if (!isNonEmptyString(uri)) issues.push("nativeSave.uri must be a non-empty string.");
    if (bytesWritten !== null && bytesWritten <= 0) issues.push("nativeSave.bytesWritten must be greater than zero.");
    if (typeof sha256 !== "string" || !SHA256.test(sha256)) {
      issues.push("nativeSave.sha256 must be a 64-character lowercase hexadecimal SHA-256.");
    }
    if (isNonEmptyString(uri) && bytesWritten !== null && bytesWritten > 0 && typeof sha256 === "string" && SHA256.test(sha256)) {
      nativeSave = { uri, bytesWritten, sha256 };
    }
  }

  let nativeInspection: StudioRuntimeMp4Inspection | null = null;
  if (!isRecord(input.nativeInspection)) {
    issues.push("nativeInspection must be an object.");
  } else {
    const videoTrackPresent = readBoolean(input.nativeInspection, "videoTrackPresent", "nativeInspection", issues);
    const audioTrackPresent = readBoolean(input.nativeInspection, "audioTrackPresent", "nativeInspection", issues);
    const firstVideoFrameDecoded = readBoolean(input.nativeInspection, "firstVideoFrameDecoded", "nativeInspection", issues);
    const deterministicPlaybackVerified = readBoolean(
      input.nativeInspection,
      "deterministicPlaybackVerified",
      "nativeInspection",
      issues,
    );
    const durationMs = readNonNegativeInteger(input.nativeInspection, "durationMs", "nativeInspection", issues);
    const width = readNonNegativeInteger(input.nativeInspection, "width", "nativeInspection", issues);
    const height = readNonNegativeInteger(input.nativeInspection, "height", "nativeInspection", issues);
    const note = input.nativeInspection.note;
    if (!isNonEmptyString(note)) issues.push("nativeInspection.note must be a non-empty string.");

    if (videoTrackPresent !== true) issues.push("nativeInspection.videoTrackPresent must equal true.");
    if (audioTrackPresent !== true) issues.push("nativeInspection.audioTrackPresent must equal true.");
    if (firstVideoFrameDecoded !== true) issues.push("nativeInspection.firstVideoFrameDecoded must equal true.");
    if (deterministicPlaybackVerified !== true) {
      issues.push("nativeInspection.deterministicPlaybackVerified must equal true.");
    }
    if (durationMs !== null && durationMs <= 0) issues.push("nativeInspection.durationMs must be greater than zero.");
    if (width !== null && width <= 0) issues.push("nativeInspection.width must be greater than zero.");
    if (height !== null && height <= 0) issues.push("nativeInspection.height must be greater than zero.");

    if (
      videoTrackPresent !== null
      && audioTrackPresent !== null
      && firstVideoFrameDecoded !== null
      && deterministicPlaybackVerified !== null
      && durationMs !== null
      && width !== null
      && height !== null
      && isNonEmptyString(note)
    ) {
      nativeInspection = {
        videoTrackPresent,
        audioTrackPresent,
        durationMs,
        width,
        height,
        firstVideoFrameDecoded,
        deterministicPlaybackVerified,
        note,
      };
    }
  }

  if (issues.length > 0 || runtime === null || nativeSave === null || nativeInspection === null) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    report: {
      schemaVersion: 1,
      capturedAt: input.capturedAt as string,
      userAgent: input.userAgent as string,
      projectId: input.projectId as string,
      physicalHardwareConfirmed: true,
      runtime,
      nativeSave,
      nativeInspection,
    },
  };
}
