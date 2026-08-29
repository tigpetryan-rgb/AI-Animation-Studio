export type PlatformTier = "LITE" | "STANDARD" | "QUALITY" | "ULTRA";
export type StudioMode = "FULL_STUDIO" | "COMPATIBILITY";
export type RendererBackend = "WEBGPU" | "WEBGL2" | "CPU_CANVAS";
export type ComputeBackend = "WEBGPU" | "WASM_SIMD" | "WASM_CPU";
export type StorageBackend = "OPFS" | "INDEXED_DB" | "MEMORY";
export type CodecBackend = "WEBCODECS" | "WASM";

export interface BrowserCapabilitySnapshot {
  readonly secureContext: boolean;
  readonly serviceWorker: boolean;
  readonly opfs: boolean;
  readonly indexedDb: boolean;
  readonly webgpu: boolean;
  readonly webgl2: boolean;
  readonly webcodecs: boolean;
  readonly wasm: boolean;
  readonly wasmSimd: boolean;
  readonly sharedArrayBuffer: boolean;
  readonly offscreenCanvas: boolean;
  readonly logicalCores: number;
  readonly deviceMemoryGB?: number;
}

export interface CapabilityPlan {
  readonly mode: StudioMode;
  readonly tier: PlatformTier;
  readonly renderer: RendererBackend;
  readonly compute: ComputeBackend;
  readonly storage: StorageBackend;
  readonly codec: CodecBackend;
  readonly memoryBudgetMB: number;
  readonly warnings: readonly CapabilityWarning[];
}

export type CapabilityWarningCode =
  | "PLATFORM_INSECURE_CONTEXT"
  | "PLATFORM_NO_SERVICE_WORKER"
  | "PLATFORM_NO_PERSISTENT_STORAGE"
  | "PLATFORM_NO_WEBGPU"
  | "PLATFORM_NO_WEBCODECS"
  | "PLATFORM_NO_WASM_SIMD"
  | "PLATFORM_LOW_MEMORY"
  | "PLATFORM_LOW_CPU";

export interface CapabilityWarning {
  readonly code: CapabilityWarningCode;
  readonly message: string;
}

export function selectStudioMode(snapshot: BrowserCapabilitySnapshot): StudioMode {
  return snapshot.secureContext
    && snapshot.serviceWorker
    && snapshot.opfs
    && snapshot.indexedDb
    ? "FULL_STUDIO"
    : "COMPATIBILITY";
}

export function selectRenderer(snapshot: BrowserCapabilitySnapshot): RendererBackend {
  if (snapshot.webgpu) return "WEBGPU";
  if (snapshot.webgl2) return "WEBGL2";
  return "CPU_CANVAS";
}

export function selectCompute(snapshot: BrowserCapabilitySnapshot): ComputeBackend {
  if (snapshot.webgpu) return "WEBGPU";
  if (snapshot.wasm && snapshot.wasmSimd) return "WASM_SIMD";
  return "WASM_CPU";
}

export function selectStorage(snapshot: BrowserCapabilitySnapshot): StorageBackend {
  if (snapshot.opfs) return "OPFS";
  if (snapshot.indexedDb) return "INDEXED_DB";
  return "MEMORY";
}

export function selectCodec(snapshot: BrowserCapabilitySnapshot): CodecBackend {
  return snapshot.webcodecs ? "WEBCODECS" : "WASM";
}

export function deriveMemoryBudgetMB(snapshot: BrowserCapabilitySnapshot): number {
  const reported = snapshot.deviceMemoryGB;
  if (reported === undefined || !Number.isFinite(reported) || reported <= 0) return 1024;
  const conservativeShare = Math.floor(reported * 1024 * 0.4);
  return Math.max(512, Math.min(conservativeShare, 8192));
}

export function classifyTier(snapshot: BrowserCapabilitySnapshot): PlatformTier {
  const memory = deriveMemoryBudgetMB(snapshot);
  const cores = Number.isFinite(snapshot.logicalCores) ? Math.max(1, Math.floor(snapshot.logicalCores)) : 1;

  if (snapshot.webgpu && memory >= 4096 && cores >= 8) return "ULTRA";
  if (snapshot.webgpu && memory >= 2048 && cores >= 6) return "QUALITY";
  if ((snapshot.webgpu || snapshot.webgl2) && memory >= 1024 && cores >= 4) return "STANDARD";
  return "LITE";
}

export function capabilityWarnings(snapshot: BrowserCapabilitySnapshot): readonly CapabilityWarning[] {
  const warnings: CapabilityWarning[] = [];
  if (!snapshot.secureContext) warnings.push({ code: "PLATFORM_INSECURE_CONTEXT", message: "Full Studio requires a secure context or trusted local origin." });
  if (!snapshot.serviceWorker) warnings.push({ code: "PLATFORM_NO_SERVICE_WORKER", message: "Offline installation and app-shell caching are limited without Service Worker support." });
  if (!snapshot.opfs && !snapshot.indexedDb) warnings.push({ code: "PLATFORM_NO_PERSISTENT_STORAGE", message: "No supported persistent browser storage backend is available." });
  if (!snapshot.webgpu) warnings.push({ code: "PLATFORM_NO_WEBGPU", message: "WebGPU is unavailable; rendering and AI compute must use fallbacks." });
  if (!snapshot.webcodecs) warnings.push({ code: "PLATFORM_NO_WEBCODECS", message: "WebCodecs is unavailable; media encoding/decoding must use a WASM fallback." });
  if (!snapshot.wasmSimd) warnings.push({ code: "PLATFORM_NO_WASM_SIMD", message: "WASM SIMD is unavailable; CPU inference may be slower." });
  if (deriveMemoryBudgetMB(snapshot) < 1024) warnings.push({ code: "PLATFORM_LOW_MEMORY", message: "The conservative local memory budget is below 1 GB." });
  if (snapshot.logicalCores < 4) warnings.push({ code: "PLATFORM_LOW_CPU", message: "Fewer than four logical CPU cores are available." });
  return Object.freeze(warnings);
}

export function buildCapabilityPlan(snapshot: BrowserCapabilitySnapshot): CapabilityPlan {
  return Object.freeze({
    mode: selectStudioMode(snapshot),
    tier: classifyTier(snapshot),
    renderer: selectRenderer(snapshot),
    compute: selectCompute(snapshot),
    storage: selectStorage(snapshot),
    codec: selectCodec(snapshot),
    memoryBudgetMB: deriveMemoryBudgetMB(snapshot),
    warnings: capabilityWarnings(snapshot),
  });
}

export interface CapabilityProbe {
  snapshot(): BrowserCapabilitySnapshot;
}

export function fullStudioRequirements(): readonly (keyof BrowserCapabilitySnapshot)[] {
  return ["secureContext", "serviceWorker", "opfs", "indexedDb"];
}
