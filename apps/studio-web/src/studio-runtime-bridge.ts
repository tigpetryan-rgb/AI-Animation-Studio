import { currentStudioBuildIdentity, type DeviceBuildIdentity } from "./device-check";

const ZERO_SHA = "0000000000000000000000000000000000000000";
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const NATIVE_FILE_CHUNK_BYTES = 512 * 1024;

export interface StudioRuntimeMediaCodec {
  readonly name: string;
  readonly mimeType: string;
  readonly encoder: boolean;
  readonly hardwareAccelerated: boolean;
  readonly softwareOnly: boolean;
  readonly vendor: boolean;
  readonly maxSupportedInstances: number;
}

export interface StudioRuntimeInfo {
  readonly schemaVersion: 1;
  readonly platform: "android";
  readonly manufacturer: string;
  readonly brand: string;
  readonly model: string;
  readonly device: string;
  readonly product: string;
  readonly board: string;
  readonly hardware: string;
  readonly buildId: string;
  readonly buildFingerprint: string;
  readonly androidRelease: string;
  readonly androidSdkInt: number;
  readonly androidIncremental: string;
  readonly securityPatch: string;
  readonly supportedAbis: readonly string[];
  readonly emulated: boolean;
  readonly physicalDeviceCandidate: boolean;
  readonly studioRepository: string;
  readonly studioCommitSha: string;
  readonly studioSourceDate: string;
  readonly exactStudioBuildBound: boolean;
  readonly runtimePackage: string;
  readonly runtimeVersion: string;
  readonly runtimeVersionCode: number;
  readonly webViewPackage: string | null;
  readonly webViewVersion: string | null;
  readonly mediaCodecs: readonly StudioRuntimeMediaCodec[];
}

export interface StudioRuntimeNativeSaveResult {
  readonly uri: string;
  readonly bytesWritten: number;
  readonly sha256: string;
}

export interface StudioRuntimeMp4Inspection {
  readonly videoTrackPresent: boolean;
  readonly audioTrackPresent: boolean;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly firstVideoFrameDecoded: boolean;
  readonly deterministicPlaybackVerified: boolean;
  readonly note: string;
}

export interface StudioRuntimeAndroidBridge {
  getRuntimeInfoJson(): string;
  beginFileWrite(requestJson: string): string;
  appendFileChunk(sessionId: string, base64Chunk: string): string;
  finishFileWrite(sessionId: string): string;
  abortFileWrite(sessionId: string): string;
  inspectSavedMp4(uri: string): string;
}

export interface StudioRuntimeClient {
  readonly info: StudioRuntimeInfo;
  saveBlob(fileName: string, mimeType: string, blob: Blob): Promise<StudioRuntimeNativeSaveResult>;
  inspectSavedMp4(uri: string): StudioRuntimeMp4Inspection;
}

export type StudioRuntimeInfoValidation =
  | { readonly ok: true; readonly info: StudioRuntimeInfo }
  | { readonly ok: false; readonly issues: readonly string[] };

declare global {
  interface Window {
    StudioRuntimeAndroid?: StudioRuntimeAndroidBridge;
    AIStudioRuntime?: StudioRuntimeClient;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requireString(record: Record<string, unknown>, key: string, issues: string[]): void {
  if (!isNonEmptyString(record[key])) issues.push(`${key} must be a non-empty string.`);
}

function requireBoolean(record: Record<string, unknown>, key: string, issues: string[]): void {
  if (typeof record[key] !== "boolean") issues.push(`${key} must be boolean.`);
}

function requireNonNegativeInteger(record: Record<string, unknown>, key: string, issues: string[]): void {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issues.push(`${key} must be a non-negative safe integer.`);
  }
}

export function validateStudioRuntimeInfo(
  input: unknown,
  expectedBuild: DeviceBuildIdentity = currentStudioBuildIdentity(),
): StudioRuntimeInfoValidation {
  const issues: string[] = [];
  if (!isRecord(input)) return { ok: false, issues: ["Runtime info root must be a JSON object."] };

  if (input.schemaVersion !== 1) issues.push("schemaVersion must equal 1.");
  if (input.platform !== "android") issues.push("platform must equal android.");

  for (const key of [
    "manufacturer",
    "brand",
    "model",
    "device",
    "product",
    "board",
    "hardware",
    "buildId",
    "buildFingerprint",
    "androidRelease",
    "androidIncremental",
    "securityPatch",
    "studioRepository",
    "studioCommitSha",
    "studioSourceDate",
    "runtimePackage",
    "runtimeVersion",
  ] as const) {
    requireString(input, key, issues);
  }

  requireNonNegativeInteger(input, "androidSdkInt", issues);
  requireNonNegativeInteger(input, "runtimeVersionCode", issues);
  requireBoolean(input, "emulated", issues);
  requireBoolean(input, "physicalDeviceCandidate", issues);
  requireBoolean(input, "exactStudioBuildBound", issues);

  if (!Array.isArray(input.supportedAbis) || input.supportedAbis.length === 0) {
    issues.push("supportedAbis must be a non-empty array.");
  } else if (input.supportedAbis.some((abi) => !isNonEmptyString(abi))) {
    issues.push("supportedAbis entries must be non-empty strings.");
  }

  if (typeof input.emulated === "boolean" && typeof input.physicalDeviceCandidate === "boolean") {
    if (input.physicalDeviceCandidate !== !input.emulated) {
      issues.push("physicalDeviceCandidate must be the inverse of emulated.");
    }
  }

  if (input.studioRepository !== expectedBuild.repository) {
    issues.push(`studioRepository must match running Studio repository ${expectedBuild.repository}.`);
  }
  if (typeof input.studioCommitSha !== "string" || !SHA40.test(input.studioCommitSha)) {
    issues.push("studioCommitSha must be a 40-character lowercase hexadecimal SHA.");
  } else {
    if (input.studioCommitSha !== expectedBuild.commit) {
      issues.push(`Runtime Studio commit ${input.studioCommitSha} does not match running Studio build ${expectedBuild.commit}.`);
    }
    if (typeof input.exactStudioBuildBound === "boolean") {
      const exactExpected = input.studioCommitSha !== ZERO_SHA;
      if (input.exactStudioBuildBound !== exactExpected) {
        issues.push(`exactStudioBuildBound must equal ${String(exactExpected)} for the supplied Studio commit.`);
      }
    }
  }
  if (!isNonEmptyString(input.studioSourceDate) || Number.isNaN(Date.parse(input.studioSourceDate))) {
    issues.push("studioSourceDate must be a valid date/time string.");
  } else if (input.studioSourceDate !== expectedBuild.sourceDate) {
    issues.push(`Runtime Studio source date ${input.studioSourceDate} does not match running Studio source date ${expectedBuild.sourceDate}.`);
  }

  const webViewPackageValid = input.webViewPackage === null || isNonEmptyString(input.webViewPackage);
  const webViewVersionValid = input.webViewVersion === null || isNonEmptyString(input.webViewVersion);
  if (!webViewPackageValid) issues.push("webViewPackage must be null or a non-empty string.");
  if (!webViewVersionValid) issues.push("webViewVersion must be null or a non-empty string.");
  if ((input.webViewPackage === null) !== (input.webViewVersion === null)) {
    issues.push("webViewPackage and webViewVersion must either both be present or both be null.");
  }

  if (!Array.isArray(input.mediaCodecs)) {
    issues.push("mediaCodecs must be an array.");
  } else {
    input.mediaCodecs.forEach((candidate, index) => {
      if (!isRecord(candidate)) {
        issues.push(`mediaCodecs[${index}] must be an object.`);
        return;
      }
      for (const key of ["name", "mimeType"] as const) {
        if (!isNonEmptyString(candidate[key])) issues.push(`mediaCodecs[${index}].${key} must be a non-empty string.`);
      }
      for (const key of ["encoder", "hardwareAccelerated", "softwareOnly", "vendor"] as const) {
        if (typeof candidate[key] !== "boolean") issues.push(`mediaCodecs[${index}].${key} must be boolean.`);
      }
      const maxInstances = candidate.maxSupportedInstances;
      if (typeof maxInstances !== "number" || !Number.isSafeInteger(maxInstances) || maxInstances < 0) {
        issues.push(`mediaCodecs[${index}].maxSupportedInstances must be a non-negative safe integer.`);
      }
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, info: input as unknown as StudioRuntimeInfo };
}

export function parseStudioRuntimeInfo(
  json: string,
  expectedBuild: DeviceBuildIdentity = currentStudioBuildIdentity(),
): StudioRuntimeInfoValidation {
  try {
    return validateStudioRuntimeInfo(JSON.parse(json) as unknown, expectedBuild);
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? `Invalid Runtime JSON: ${error.message}` : "Invalid Runtime JSON."],
    };
  }
}

export function isStudioRuntimePhysicalEvidenceCandidate(info: StudioRuntimeInfo): boolean {
  return info.physicalDeviceCandidate
    && !info.emulated
    && info.exactStudioBuildBound
    && info.studioCommitSha !== ZERO_SHA
    && info.webViewPackage !== null
    && info.webViewVersion !== null;
}

function nativeRecord(json: string, operation: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch (error) {
    throw new Error(`${operation} returned invalid JSON: ${error instanceof Error ? error.message : "unknown parse failure"}`);
  }
  if (!isRecord(parsed)) throw new Error(`${operation} returned a non-object response.`);
  if (parsed.ok !== true) {
    const message = isNonEmptyString(parsed.message) ? parsed.message : "Native Runtime operation failed.";
    throw new Error(`${operation}: ${message}`);
  }
  return parsed;
}

function requiredNativeString(record: Record<string, unknown>, key: string, operation: string): string {
  const value = record[key];
  if (!isNonEmptyString(value)) throw new Error(`${operation} response is missing ${key}.`);
  return value;
}

function requiredNativeInteger(record: Record<string, unknown>, key: string, operation: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${operation} response has invalid ${key}.`);
  }
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
  }
  return btoa(binary);
}

async function saveBlob(
  bridge: StudioRuntimeAndroidBridge,
  fileName: string,
  mimeType: string,
  blob: Blob,
): Promise<StudioRuntimeNativeSaveResult> {
  const begin = nativeRecord(bridge.beginFileWrite(JSON.stringify({ fileName, mimeType })), "beginFileWrite");
  const sessionId = requiredNativeString(begin, "sessionId", "beginFileWrite");

  try {
    for (let offset = 0; offset < blob.size; offset += NATIVE_FILE_CHUNK_BYTES) {
      const buffer = await blob.slice(offset, Math.min(blob.size, offset + NATIVE_FILE_CHUNK_BYTES)).arrayBuffer();
      nativeRecord(bridge.appendFileChunk(sessionId, bytesToBase64(new Uint8Array(buffer))), "appendFileChunk");
    }

    const finished = nativeRecord(bridge.finishFileWrite(sessionId), "finishFileWrite");
    const uri = requiredNativeString(finished, "uri", "finishFileWrite");
    const bytesWritten = requiredNativeInteger(finished, "bytesWritten", "finishFileWrite");
    const sha256 = requiredNativeString(finished, "sha256", "finishFileWrite");
    if (!SHA256.test(sha256)) throw new Error("finishFileWrite response has invalid sha256.");
    if (bytesWritten !== blob.size) {
      throw new Error(`Native save wrote ${bytesWritten} bytes but Studio supplied ${blob.size}.`);
    }
    return { uri, bytesWritten, sha256 };
  } catch (error) {
    try {
      bridge.abortFileWrite(sessionId);
    } catch {
      // Preserve the original failure.
    }
    throw error;
  }
}

function inspectSavedMp4(bridge: StudioRuntimeAndroidBridge, uri: string): StudioRuntimeMp4Inspection {
  const result = nativeRecord(bridge.inspectSavedMp4(uri), "inspectSavedMp4");
  const booleanKeys = [
    "videoTrackPresent",
    "audioTrackPresent",
    "firstVideoFrameDecoded",
    "deterministicPlaybackVerified",
  ] as const;
  for (const key of booleanKeys) {
    if (typeof result[key] !== "boolean") throw new Error(`inspectSavedMp4 response has invalid ${key}.`);
  }
  const durationMs = requiredNativeInteger(result, "durationMs", "inspectSavedMp4");
  const width = requiredNativeInteger(result, "width", "inspectSavedMp4");
  const height = requiredNativeInteger(result, "height", "inspectSavedMp4");
  const note = requiredNativeString(result, "note", "inspectSavedMp4");

  return {
    videoTrackPresent: result.videoTrackPresent as boolean,
    audioTrackPresent: result.audioTrackPresent as boolean,
    durationMs,
    width,
    height,
    firstVideoFrameDecoded: result.firstVideoFrameDecoded as boolean,
    deterministicPlaybackVerified: result.deterministicPlaybackVerified as boolean,
    note,
  };
}

export function createStudioRuntimeClient(
  bridge: StudioRuntimeAndroidBridge,
  expectedBuild: DeviceBuildIdentity = currentStudioBuildIdentity(),
): StudioRuntimeClient {
  const validation = parseStudioRuntimeInfo(bridge.getRuntimeInfoJson(), expectedBuild);
  if (!validation.ok) throw new Error(`Studio Runtime identity rejected: ${validation.issues.join(" ")}`);
  const info = validation.info;

  return {
    info,
    saveBlob: (fileName, mimeType, blob) => saveBlob(bridge, fileName, mimeType, blob),
    inspectSavedMp4: (uri) => inspectSavedMp4(bridge, uri),
  };
}

export function installStudioRuntimeBridge(): StudioRuntimeClient | null {
  const bridge = window.StudioRuntimeAndroid;
  if (bridge === undefined) return null;
  const client = createStudioRuntimeClient(bridge);
  window.AIStudioRuntime = client;
  window.dispatchEvent(new CustomEvent("aistudio:runtime-ready", { detail: client.info }));
  return client;
}

if (typeof window !== "undefined") {
  installStudioRuntimeBridge();
}
