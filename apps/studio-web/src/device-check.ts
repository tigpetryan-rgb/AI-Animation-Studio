export type DeviceCheckStatus = "PASS" | "FAIL" | "UNAVAILABLE";
export type DeviceVerificationSummary = "READY" | "DEGRADED" | "FAILED";

export interface DeviceCheckResult {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly status: DeviceCheckStatus;
  readonly detail: string;
  readonly durationMs: number;
}

export interface DeviceVerificationReport {
  readonly schemaVersion: 1;
  readonly capturedAt: string;
  readonly userAgent: string;
  readonly summary: DeviceVerificationSummary;
  readonly checks: readonly DeviceCheckResult[];
  readonly note: string;
}

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

export function summarizeDeviceChecks(checks: readonly DeviceCheckResult[]): DeviceVerificationSummary {
  if (checks.some((check) => check.required && check.status !== "PASS")) return "FAILED";
  if (checks.some((check) => check.status !== "PASS")) return "DEGRADED";
  return "READY";
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
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    summary: summarizeDeviceChecks(checks),
    checks,
    note: "This report proves runtime behavior on this browser session only; it is not a cross-device performance guarantee.",
  };
}

export function serializeDeviceVerificationReport(report: DeviceVerificationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
