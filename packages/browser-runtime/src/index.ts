import type {
  CapabilityPlan,
  CodecBackend,
  ComputeBackend,
  RendererBackend,
  StorageBackend,
} from "@aistudio/platform-capabilities";

export interface RuntimeAdapterPlan {
  readonly storage: StorageBackend;
  readonly codec: CodecBackend;
  readonly renderer: RendererBackend;
  readonly compute: ComputeBackend;
  readonly persistentProjectStorage: boolean;
  readonly offlineInstallSupported: boolean;
  readonly coreNetworkRequired: false;
  readonly telemetryEnabled: false;
}

export function buildRuntimeAdapterPlan(plan: CapabilityPlan): RuntimeAdapterPlan {
  const noServiceWorker = plan.warnings.some((warning) => warning.code === "PLATFORM_NO_SERVICE_WORKER");
  return Object.freeze({
    storage: plan.storage,
    codec: plan.codec,
    renderer: plan.renderer,
    compute: plan.compute,
    persistentProjectStorage: plan.storage !== "MEMORY",
    offlineInstallSupported: !noServiceWorker,
    coreNetworkRequired: false,
    telemetryEnabled: false,
  });
}

export interface RuntimeNetworkPolicy {
  readonly coreNetworkRequired: false;
  readonly externalRequestsByDefault: "BLOCKED";
  readonly telemetryEnabled: false;
  readonly runtimeModelDownloadRequired: false;
}

export function airGapNetworkPolicy(): RuntimeNetworkPolicy {
  return Object.freeze({
    coreNetworkRequired: false,
    externalRequestsByDefault: "BLOCKED",
    telemetryEnabled: false,
    runtimeModelDownloadRequired: false,
  });
}

export interface BinaryStorageAdapter {
  readonly kind: StorageBackend;
  readonly persistent: boolean;
  readonly atomicReplace: boolean;
  read(path: string): Promise<Uint8Array | undefined>;
  write(path: string, data: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  list(prefix: string): Promise<readonly string[]>;
  replace(fromPath: string, toPath: string): Promise<void>;
}

export class MemoryStorageAdapter implements BinaryStorageAdapter {
  readonly kind = "MEMORY" as const;
  readonly persistent = false;
  readonly atomicReplace = true;
  private readonly entries = new Map<string, Uint8Array>();

  async read(path: string): Promise<Uint8Array | undefined> {
    const value = this.entries.get(normalizePath(path));
    return value?.slice();
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    this.entries.set(normalizePath(path), data.slice());
  }

  async remove(path: string): Promise<void> {
    this.entries.delete(normalizePath(path));
  }

  async list(prefix: string): Promise<readonly string[]> {
    const normalized = normalizePath(prefix);
    return [...this.entries.keys()].filter((path) => path.startsWith(normalized)).sort();
  }

  async replace(fromPath: string, toPath: string): Promise<void> {
    const from = normalizePath(fromPath);
    const to = normalizePath(toPath);
    const value = this.entries.get(from);
    if (value === undefined) throw new Error(`Temporary storage entry not found: ${from}`);
    this.entries.set(to, value.slice());
    this.entries.delete(from);
  }
}

export type AtomicSaveStep =
  | "WRITE_TEMP"
  | "VERIFY_TEMP"
  | "REPLACE_TARGET"
  | "CLEANUP_TEMP";

export interface AtomicSavePlan {
  readonly targetPath: string;
  readonly tempPath: string;
  readonly steps: readonly AtomicSaveStep[];
}

export function createAtomicSavePlan(targetPath: string, revision: number): AtomicSavePlan {
  const target = normalizePath(targetPath);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new RangeError("revision must be a non-negative safe integer.");
  }
  const steps: readonly AtomicSaveStep[] = Object.freeze([
    "WRITE_TEMP",
    "VERIFY_TEMP",
    "REPLACE_TARGET",
    "CLEANUP_TEMP",
  ]);
  return Object.freeze({
    targetPath: target,
    tempPath: `${target}.tmp.${revision}`,
    steps,
  });
}

export type AtomicSaveDiagnosticCode =
  | "SAVE_ADAPTER_NOT_ATOMIC"
  | "SAVE_VERIFY_FAILED"
  | "SAVE_REPLACE_FAILED";

export interface AtomicSaveDiagnostic {
  readonly code: AtomicSaveDiagnosticCode;
  readonly message: string;
}

export interface AtomicSaveResult {
  readonly committed: boolean;
  readonly diagnostics: readonly AtomicSaveDiagnostic[];
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export async function saveAtomically(
  adapter: BinaryStorageAdapter,
  plan: AtomicSavePlan,
  data: Uint8Array,
): Promise<AtomicSaveResult> {
  if (!adapter.atomicReplace) {
    return {
      committed: false,
      diagnostics: [{
        code: "SAVE_ADAPTER_NOT_ATOMIC",
        message: `Storage backend ${adapter.kind} does not guarantee atomic replace.`,
      }],
    };
  }

  await adapter.write(plan.tempPath, data);
  const readback = await adapter.read(plan.tempPath);
  if (readback === undefined || !equalBytes(readback, data)) {
    await adapter.remove(plan.tempPath);
    return {
      committed: false,
      diagnostics: [{ code: "SAVE_VERIFY_FAILED", message: "Temporary write verification failed." }],
    };
  }

  try {
    await adapter.replace(plan.tempPath, plan.targetPath);
  } catch (error) {
    await adapter.remove(plan.tempPath);
    return {
      committed: false,
      diagnostics: [{
        code: "SAVE_REPLACE_FAILED",
        message: error instanceof Error ? error.message : "Atomic replace failed.",
      }],
    };
  }

  await adapter.remove(plan.tempPath);
  return { committed: true, diagnostics: [] };
}

export type MediaDirection = "DECODE" | "ENCODE";

export interface MediaCodecAdapter {
  readonly backend: CodecBackend;
  readonly localOnly: true;
  supports(mimeType: string, direction: MediaDirection): boolean;
}

export interface OfflineCacheContract {
  readonly shellAssets: readonly string[];
  readonly externalNetworkFallback: false;
  readonly cacheVersion: string;
}

export function offlineCacheContract(cacheVersion: string, shellAssets: readonly string[]): OfflineCacheContract {
  const version = cacheVersion.trim();
  if (version.length === 0) throw new Error("cacheVersion must not be empty.");
  const normalizedAssets = [...new Set(shellAssets.map((asset) => asset.trim()).filter((asset) => asset.length > 0))].sort();
  return Object.freeze({
    shellAssets: Object.freeze(normalizedAssets),
    externalNetworkFallback: false,
    cacheVersion: version,
  });
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) throw new Error("Storage path must not be empty.");
  const withRoot = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const collapsed = withRoot.replace(/\/{2,}/g, "/");
  if (collapsed.includes("/../") || collapsed.endsWith("/..")) {
    throw new Error("Parent traversal is not allowed in storage paths.");
  }
  return collapsed;
}
