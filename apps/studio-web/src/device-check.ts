declare const __AISTUDIO_BUILD_REPOSITORY__: string;
declare const __AISTUDIO_BUILD_COMMIT__: string;
declare const __AISTUDIO_BUILD_SOURCE_DATE__: string;

export type DeviceCheckStatus = "PASS" | "FAIL" | "UNAVAILABLE";
export type DeviceVerificationSummary = "READY" | "DEGRADED" | "FAILED";
export type DeviceCompatibilityMode = "FULL" | "FALLBACK" | "BLOCKED";

export interface DeviceBuildIdentity {
  readonly repository: string;
  readonly commit: string;
  readonly sourceDate: string;
}

export interface DeviceCheckResult {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly status: DeviceCheckStatus;
  readonly detail: string;
  readonly durationMs: number;
}

export interface DeviceVerificationReport {
  readonly schemaVersion: 2;
  readonly build: DeviceBuildIdentity;
  readonly capturedAt: string;
  readonly userAgent: string;
  readonly summary: DeviceVerificationSummary;
  readonly checks: readonly DeviceCheckResult[];
  readonly note: string;
}

export type DeviceReportValidation =
  | { readonly ok: true; readonly report: DeviceVerificationReport }
  | { readonly ok: false; readonly issues: readonly string[] };

export interface DeviceVerificationIntake {
  readonly mode: DeviceCompatibilityMode;
  readonly requiredPassed: number;
  readonly requiredTotal: number;
  readonly optionalPassed: number;
  readonly optionalTotal: number;
  readonly failedRequired: readonly string[];
  readonly degradedOptional: readonly string[];
}

const STUDIO_REPOSITORY = "tigpetryan-rgb/AI-Animation-Studio";
const DEVELOPMENT_COMMIT = "0000000000000000000000000000000000000000";
const DEVELOPMENT_SOURCE_DATE = "1970-01-01T00:00:00.000Z";
const SHA40 = /^[0-9a-f]{40}$/;

const REQUIRED_CHECK_IDS = [
  "secure-context",
  "service-worker",
  "opfs",
  "indexeddb",
  "wasm",
] as const;
const OPTIONAL_CHECK_IDS = ["webgpu", "webcodecs"] as const;
const DEVICE_CHECK_STATUSES = new Set<DeviceCheckStatus>(["PASS", "FAIL", "UNAVAILABLE"]);
const DEVICE_SUMMARIES = new Set<DeviceVerificationSummary>(["READY", "DEGRADED", "FAILED"]);

interface WritableHandleLike {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface FileHandleLike {
  createWritable(): Promise<WritableHandleLike>;
  getFile(): Promise<File>;
}

interface DirectoryHandleLike {
  getFileHandle(name: string, options: { create: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string): Promise<void>;
}

interface GpuLike {
  requestAdapter(): Promise<unknown | null>;
}

interface CodecSupportResult {
  readonly supported: boolean;
}

interface VideoDecoderLike {
  isConfigSupported(config: { codec: string }): Promise<CodecSupportResult>;
}

interface VideoEncoderLike {
  isConfigSupported(config: {
    codec: string;
    width: number;
    height: number;
    bitrate: number;
    framerate: number;
  }): Promise<CodecSupportResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function currentStudioBuildIdentity(): DeviceBuildIdentity {
  return {
    repository:
      typeof __AISTUDIO_BUILD_REPOSITORY__ === "string"
        ? __AISTUDIO_BUILD_REPOSITORY__
        : STUDIO_REPOSITORY,
    commit:
      typeof __AISTUDIO_BUILD_COMMIT__ === "string"
        ? __AISTUDIO_BUILD_COMMIT__
        : DEVELOPMENT_COMMIT,
    sourceDate:
      typeof __AISTUDIO_BUILD_SOURCE_DATE__ === "string"
        ? __AISTUDIO_BUILD_SOURCE_DATE__
        : DEVELOPMENT_SOURCE_DATE,
  };
}

export function summarizeDeviceChecks(checks: readonly DeviceCheckResult[]): DeviceVerificationSummary {
  if (checks.some((check) => check.required && check.status !== "PASS")) return "FAILED";
  if (checks.some((check) => check.status !== "PASS")) return "DEGRADED";
  return "READY";
}

export function validateDeviceVerificationReport(
  input: unknown,
  expectedBuild?: DeviceBuildIdentity,
): DeviceReportValidation {
  const issues: string[] = [];
  if (!isRecord(input)) return { ok: false, issues: ["Report root must be a JSON object."] };

  if (input.schemaVersion !== 2) issues.push("schemaVersion must equal 2.");

  let build: DeviceBuildIdentity | null = null;
  if (!isRecord(input.build)) {
    issues.push("build must be an object.");
  } else {
    const repository = input.build.repository;
    const commit = input.build.commit;
    const sourceDate = input.build.sourceDate;

    if (repository !== STUDIO_REPOSITORY) {
      issues.push(`build.repository must equal ${STUDIO_REPOSITORY}.`);
    }
    if (typeof commit !== "string" || !SHA40.test(commit)) {
      issues.push("build.commit must be a 40-character lowercase hexadecimal SHA.");
    }
    if (!isNonEmptyString(sourceDate) || Number.isNaN(Date.parse(sourceDate))) {
      issues.push("build.sourceDate must be a valid date/time string.");
    }

    if (
      repository === STUDIO_REPOSITORY
      && typeof commit === "string"
      && SHA40.test(commit)
      && isNonEmptyString(sourceDate)
      && !Number.isNaN(Date.parse(sourceDate))
    ) {
      build = { repository, commit, sourceDate };
    }
  }

  if (build && expectedBuild) {
    if (build.repository !== expectedBuild.repository) {
      issues.push(`Report repository ${build.repository} does not match running Studio repository ${expectedBuild.repository}.`);
    }
    if (build.commit !== expectedBuild.commit) {
      issues.push(`Report build commit ${build.commit} does not match running Studio build ${expectedBuild.commit}.`);
    }
  }

  if (!isNonEmptyString(input.capturedAt) || Number.isNaN(Date.parse(input.capturedAt))) {
    issues.push("capturedAt must be a valid date/time string.");
  }
  if (!isNonEmptyString(input.userAgent)) issues.push("userAgent must be a non-empty string.");
  if (!DEVICE_SUMMARIES.has(input.summary as DeviceVerificationSummary)) {
    issues.push("summary must be READY, DEGRADED or FAILED.");
  }
  if (typeof input.note !== "string") issues.push("note must be a string.");
  if (!Array.isArray(input.checks)) {
    issues.push("checks must be an array.");
    return { ok: false, issues };
  }

  const checks: DeviceCheckResult[] = [];
  const seenIds = new Set<string>();
  input.checks.forEach((rawCheck, index) => {
    if (!isRecord(rawCheck)) {
      issues.push(`checks[${index}] must be an object.`);
      return;
    }

    const id = rawCheck.id;
    const label = rawCheck.label;
    const required = rawCheck.required;
    const status = rawCheck.status;
    const detail = rawCheck.detail;
    const durationMs = rawCheck.durationMs;

    if (!isNonEmptyString(id)) issues.push(`checks[${index}].id must be a non-empty string.`);
    if (!isNonEmptyString(label)) issues.push(`checks[${index}].label must be a non-empty string.`);
    if (typeof required !== "boolean") issues.push(`checks[${index}].required must be boolean.`);
    if (!DEVICE_CHECK_STATUSES.has(status as DeviceCheckStatus)) {
      issues.push(`checks[${index}].status must be PASS, FAIL or UNAVAILABLE.`);
    }
    if (typeof detail !== "string") issues.push(`checks[${index}].detail must be a string.`);
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
      issues.push(`checks[${index}].durationMs must be a finite non-negative number.`);
    }

    if (isNonEmptyString(id)) {
      if (seenIds.has(id)) issues.push(`Duplicate check id: ${id}.`);
      seenIds.add(id);
    }

    if (
      isNonEmptyString(id)
      && isNonEmptyString(label)
      && typeof required === "boolean"
      && DEVICE_CHECK_STATUSES.has(status as DeviceCheckStatus)
      && typeof detail === "string"
      && typeof durationMs === "number"
      && Number.isFinite(durationMs)
      && durationMs >= 0
    ) {
      checks.push({ id, label, required, status: status as DeviceCheckStatus, detail, durationMs });
    }
  });

  for (const id of REQUIRED_CHECK_IDS) {
    const check = checks.find((candidate) => candidate.id === id);
    if (!check) issues.push(`Missing required canonical check: ${id}.`);
    else if (!check.required) issues.push(`Canonical check ${id} must be marked required=true.`);
  }
  for (const id of OPTIONAL_CHECK_IDS) {
    const check = checks.find((candidate) => candidate.id === id);
    if (!check) issues.push(`Missing optional canonical check: ${id}.`);
    else if (check.required) issues.push(`Canonical check ${id} must be marked required=false.`);
  }

  if (checks.length > 0 && DEVICE_SUMMARIES.has(input.summary as DeviceVerificationSummary)) {
    const computed = summarizeDeviceChecks(checks);
    if (computed !== input.summary) {
      issues.push(`summary does not match checks: expected ${computed}, received ${String(input.summary)}.`);
    }
  }

  if (issues.length > 0 || build === null) return { ok: false, issues };

  return {
    ok: true,
    report: {
      schemaVersion: 2,
      build,
      capturedAt: input.capturedAt as string,
      userAgent: input.userAgent as string,
      summary: input.summary as DeviceVerificationSummary,
      checks,
      note: input.note as string,
    },
  };
}

export function parseDeviceVerificationReport(
  json: string,
  expectedBuild?: DeviceBuildIdentity,
): DeviceReportValidation {
  try {
    return validateDeviceVerificationReport(JSON.parse(json) as unknown, expectedBuild);
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON."],
    };
  }
}

export function analyzeDeviceVerificationReport(report: DeviceVerificationReport): DeviceVerificationIntake {
  const required = REQUIRED_CHECK_IDS.map((id) => report.checks.find((check) => check.id === id)).filter(
    (check): check is DeviceCheckResult => check !== undefined,
  );
  const optional = OPTIONAL_CHECK_IDS.map((id) => report.checks.find((check) => check.id === id)).filter(
    (check): check is DeviceCheckResult => check !== undefined,
  );
  const failedRequired = required.filter((check) => check.status !== "PASS").map((check) => check.id);
  const degradedOptional = optional.filter((check) => check.status !== "PASS").map((check) => check.id);

  return {
    mode: failedRequired.length > 0 ? "BLOCKED" : degradedOptional.length > 0 ? "FALLBACK" : "FULL",
    requiredPassed: required.filter((check) => check.status === "PASS").length,
    requiredTotal: REQUIRED_CHECK_IDS.length,
    optionalPassed: optional.filter((check) => check.status === "PASS").length,
    optionalTotal: OPTIONAL_CHECK_IDS.length,
    failedRequired,
    degradedOptional,
  };
}

async function measure(
  id: string,
  label: string,
  required: boolean,
  operation: () => Promise<{ status: DeviceCheckStatus; detail: string }>,
): Promise<DeviceCheckResult> {
  const started = performance.now();
  try {
    const result = await operation();
    return {
      id,
      label,
      required,
      ...result,
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    };
  } catch (error) {
    return {
      id,
      label,
      required,
      status: "FAIL",
      detail: error instanceof Error ? error.message : "Unknown runtime error",
      durationMs: Math.round((performance.now() - started) * 100) / 100,
    };
  }
}

async function verifyServiceWorker(): Promise<{ status: DeviceCheckStatus; detail: string }> {
  if (!("serviceWorker" in navigator)) {
    return { status: "UNAVAILABLE", detail: "Service Worker API is unavailable." };
  }
  await navigator.serviceWorker.register("./sw.js");
  const registration = await navigator.serviceWorker.ready;
  return {
    status: registration.active ? "PASS" : "FAIL",
    detail: registration.active
      ? `Active Service Worker; controlled=${String(navigator.serviceWorker.controller !== null)}`
      : "Service Worker registration has no active worker.",
  };
}

async function verifyOpfs(): Promise<{ status: DeviceCheckStatus; detail: string }> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<DirectoryHandleLike>;
  };
  if (typeof storage.getDirectory !== "function") {
    return { status: "UNAVAILABLE", detail: "OPFS getDirectory() is unavailable." };
  }

  const directory = await storage.getDirectory();
  const fileName = `aistudio-device-check-${Date.now()}.txt`;
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write("ai-animation-studio-opfs-ok");
  await writable.close();
  const payload = await (await fileHandle.getFile()).text();
  await directory.removeEntry(fileName);

  return payload === "ai-animation-studio-opfs-ok"
    ? { status: "PASS", detail: "Create/write/read/delete round-trip succeeded." }
    : { status: "FAIL", detail: "OPFS readback did not match the written payload." };
}

async function verifyIndexedDb(): Promise<{ status: DeviceCheckStatus; detail: string }> {
  if (!("indexedDB" in globalThis)) {
    return { status: "UNAVAILABLE", detail: "IndexedDB is unavailable." };
  }

  const databaseName = `aistudio-device-check-${Date.now()}`;
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("probe");
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed."));
    request.onsuccess = () => resolve(request.result);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("probe", "readwrite");
      transaction.objectStore("probe").put("indexeddb-ok", "value");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB write failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB write aborted."));
    });

    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction("probe", "readonly");
      const request = transaction.objectStore("probe").get("value");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed."));
    });

    return value === "indexeddb-ok"
      ? { status: "PASS", detail: "Create/write/read round-trip succeeded." }
      : { status: "FAIL", detail: "IndexedDB readback did not match the written payload." };
  } finally {
    database.close();
    indexedDB.deleteDatabase(databaseName);
  }
}

async function verifyWebGpu(): Promise<{ status: DeviceCheckStatus; detail: string }> {
  const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
  if (!gpu) return { status: "UNAVAILABLE", detail: "WebGPU API is unavailable." };
  const adapter = await gpu.requestAdapter();
  return adapter
    ? { status: "PASS", detail: "WebGPU returned a real GPU adapter." }
    : { status: "UNAVAILABLE", detail: "WebGPU API exists but no adapter was returned." };
}

async function verifyWebCodecs(): Promise<{ status: DeviceCheckStatus; detail: string }> {
  const codecs = globalThis as typeof globalThis & {
    VideoDecoder?: VideoDecoderLike;
    VideoEncoder?: VideoEncoderLike;
  };
  if (!codecs.VideoDecoder || !codecs.VideoEncoder) {
    return { status: "UNAVAILABLE", detail: "VideoEncoder/VideoDecoder APIs are unavailable." };
  }

  const [decoder, encoder] = await Promise.all([
    codecs.VideoDecoder.isConfigSupported({ codec: "vp8" }),
    codecs.VideoEncoder.isConfigSupported({
      codec: "vp8",
      width: 640,
      height: 360,
      bitrate: 1_000_000,
      framerate: 30,
    }),
  ]);

  return decoder.supported && encoder.supported
    ? { status: "PASS", detail: "VP8 decode and encode configurations are supported." }
    : { status: "UNAVAILABLE", detail: `VP8 decoder=${String(decoder.supported)}, encoder=${String(encoder.supported)}.` };
}

async function verifyWasm(): Promise<{ status: DeviceCheckStatus; detail: string }> {
  if (typeof WebAssembly !== "object" || typeof WebAssembly.validate !== "function") {
    return { status: "UNAVAILABLE", detail: "WebAssembly is unavailable." };
  }
  const minimalModule = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  return WebAssembly.validate(minimalModule)
    ? { status: "PASS", detail: "WebAssembly validation succeeded." }
    : { status: "FAIL", detail: "WebAssembly validation rejected a minimal valid module." };
}

export async function runBrowserDeviceVerification(): Promise<DeviceVerificationReport> {
  const checks = await Promise.all([
    measure("secure-context", "Secure Context", true, async () => ({
      status: window.isSecureContext ? "PASS" : "FAIL",
      detail: window.isSecureContext ? "Secure context is active." : "Secure context is required for Full Studio.",
    })),
    measure("service-worker", "Service Worker", true, verifyServiceWorker),
    measure("opfs", "OPFS", true, verifyOpfs),
    measure("indexeddb", "IndexedDB", true, verifyIndexedDb),
    measure("wasm", "WebAssembly", true, verifyWasm),
    measure("webgpu", "WebGPU Adapter", false, verifyWebGpu),
    measure("webcodecs", "WebCodecs VP8", false, verifyWebCodecs),
  ]);

  return {
    schemaVersion: 2,
    build: currentStudioBuildIdentity(),
    capturedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    summary: summarizeDeviceChecks(checks),
    checks,
    note: "This report proves runtime behavior for this exact Studio build and browser session only; it is not a cross-device performance guarantee.",
  };
}

export function serializeDeviceVerificationReport(report: DeviceVerificationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
