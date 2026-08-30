import type { FragmentedMp4ByteSink } from "@aistudio/media-export/mp4";
import type {
  StudioRuntimeMp4Inspection,
  StudioRuntimeNativeSaveResult,
} from "./studio-runtime-bridge";

export const STUDIO_STREAMING_STORAGE_HEADROOM_BYTES = 64 * 1024 * 1024;
export const STUDIO_STREAMING_STORAGE_HEADROOM_RATIO = 1.1;
const FINALIZED_EXPORT_CLEANUP_DELAY_MS = 30_000;
const NATIVE_STREAM_CHUNK_BYTES = 512 * 1024;

export type StudioExportStorageErrorCode =
  | "STORAGE_UNAVAILABLE"
  | "STORAGE_INSUFFICIENT_CAPACITY"
  | "STORAGE_WRITE_FAILED";

export class StudioExportStorageError extends Error {
  readonly code: StudioExportStorageErrorCode;

  constructor(code: StudioExportStorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StudioExportStorageError";
    this.code = code;
  }
}

export interface StudioStreamingStorageBudget {
  readonly estimatedOutputBytes: number;
  readonly requiredBytes: number;
  readonly quotaBytes: number | null;
  readonly usageBytes: number | null;
  readonly availableBytes: number | null;
  readonly sufficient: boolean;
  readonly message: string;
}

export interface StudioStreamingExportFinalization {
  readonly size: number;
  readonly nativeSave: StudioRuntimeNativeSaveResult | null;
  readonly nativeInspection: StudioRuntimeMp4Inspection | null;
}

export interface StudioStreamingExportFile {
  readonly sink: FragmentedMp4ByteSink;
  readonly storageLabel: string;
  readonly budget: StudioStreamingStorageBudget | null;
  finalize(mimeType: string, downloadName: string): Promise<StudioStreamingExportFinalization>;
  abort(reason?: unknown): Promise<void>;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function evaluateStudioStreamingStorageBudget(
  estimatedOutputBytes: number,
  quotaBytes?: number,
  usageBytes?: number,
): StudioStreamingStorageBudget {
  if (!Number.isFinite(estimatedOutputBytes) || estimatedOutputBytes <= 0) {
    throw new RangeError("Estimated export size must be a positive finite number.");
  }
  const requiredBytes = Math.ceil(
    estimatedOutputBytes * STUDIO_STREAMING_STORAGE_HEADROOM_RATIO
    + STUDIO_STREAMING_STORAGE_HEADROOM_BYTES,
  );
  const hasEstimate = Number.isFinite(quotaBytes) && Number.isFinite(usageBytes)
    && (quotaBytes ?? -1) >= 0 && (usageBytes ?? -1) >= 0;
  if (!hasEstimate) {
    return Object.freeze({
      estimatedOutputBytes,
      requiredBytes,
      quotaBytes: null,
      usageBytes: null,
      availableBytes: null,
      sufficient: true,
      message: `Browser storage quota is unknown; export needs about ${formatMegabytes(requiredBytes)} including safety headroom.`,
    });
  }

  const resolvedQuota = quotaBytes as number;
  const resolvedUsage = usageBytes as number;
  const availableBytes = Math.max(0, resolvedQuota - resolvedUsage);
  const sufficient = availableBytes >= requiredBytes;
  return Object.freeze({
    estimatedOutputBytes,
    requiredBytes,
    quotaBytes: resolvedQuota,
    usageBytes: resolvedUsage,
    availableBytes,
    sufficient,
    message: sufficient
      ? `Disk preflight ready · ${formatMegabytes(availableBytes)} available / ${formatMegabytes(requiredBytes)} required with safety headroom.`
      : `Not enough browser storage for this export: ${formatMegabytes(availableBytes)} available, about ${formatMegabytes(requiredBytes)} required including safety headroom.`,
  });
}

function copyBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function triggerFileDownload(file: File, filename: string): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), FINALIZED_EXPORT_CLEANUP_DELAY_MS);
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException
    && (error.name === "QuotaExceededError" || error.name === "NotReadableError");
}

function storageWriteError(error: unknown): StudioExportStorageError {
  if (isQuotaError(error)) {
    return new StudioExportStorageError(
      "STORAGE_INSUFFICIENT_CAPACITY",
      "Local browser storage filled up during export. Free disk space or lower the export quality, then retry.",
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  return new StudioExportStorageError(
    "STORAGE_WRITE_FAILED",
    error instanceof Error ? `Disk-streamed export failed: ${error.message}` : "Disk-streamed export failed while writing temporary media.",
    error instanceof Error ? { cause: error } : undefined,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNativeResponse(json: string, operation: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch (error) {
    throw new Error(`${operation} returned invalid JSON: ${error instanceof Error ? error.message : "parse failure"}`);
  }
  if (!isRecord(parsed)) throw new Error(`${operation} returned a non-object response.`);
  if (parsed.ok !== true) {
    const message = typeof parsed.message === "string" && parsed.message.length > 0
      ? parsed.message
      : "Native Runtime operation failed.";
    throw new Error(`${operation}: ${message}`);
  }
  return parsed;
}

function requiredString(record: Record<string, unknown>, key: string, operation: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${operation} response is missing ${key}.`);
  return value;
}

function requiredNonNegativeInteger(record: Record<string, unknown>, key: string, operation: string): number {
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

function canUseNativeRuntimeStream(): boolean {
  return window.AIStudioRuntime !== undefined && window.StudioRuntimeAndroid !== undefined;
}

async function createNativeRuntimeStreamingExportFile(fileStem: string): Promise<StudioStreamingExportFile> {
  const runtime = window.AIStudioRuntime;
  const bridge = window.StudioRuntimeAndroid;
  if (runtime === undefined || bridge === undefined) {
    throw new StudioExportStorageError("STORAGE_UNAVAILABLE", "Validated Android Runtime storage bridge is unavailable.");
  }

  const expectedDownloadName = `${fileStem}-timeline.mp4`;
  let sessionId = "";
  let settled = false;
  try {
    const begin = parseNativeResponse(
      bridge.beginFileWrite(JSON.stringify({ fileName: expectedDownloadName, mimeType: "video/mp4" })),
      "beginFileWrite",
    );
    sessionId = requiredString(begin, "sessionId", "beginFileWrite");
  } catch (error) {
    throw storageWriteError(error);
  }

  return {
    storageLabel: "Android MediaStore native stream",
    budget: null,
    sink: {
      async write(bytes) {
        if (settled) throw new StudioExportStorageError("STORAGE_WRITE_FAILED", "Native streaming export file is already closed.");
        try {
          for (let offset = 0; offset < bytes.byteLength; offset += NATIVE_STREAM_CHUNK_BYTES) {
            const chunk = bytes.subarray(offset, Math.min(bytes.byteLength, offset + NATIVE_STREAM_CHUNK_BYTES));
            parseNativeResponse(bridge.appendFileChunk(sessionId, bytesToBase64(chunk)), "appendFileChunk");
          }
        } catch (error) {
          throw storageWriteError(error);
        }
      },
    },
    async finalize(mimeType, downloadName) {
      if (settled) throw new StudioExportStorageError("STORAGE_WRITE_FAILED", "Native streaming export file is already closed.");
      if (mimeType !== "video/mp4" || downloadName !== expectedDownloadName) {
        settled = true;
        try {
          parseNativeResponse(bridge.abortFileWrite(sessionId), "abortFileWrite");
        } catch {
          // Destination mismatch is the primary error; abort is best effort here.
        }
        throw new StudioExportStorageError("STORAGE_WRITE_FAILED", "Native streaming destination identity changed during export.");
      }
      settled = true;
      try {
        const finished = parseNativeResponse(bridge.finishFileWrite(sessionId), "finishFileWrite");
        const nativeSave: StudioRuntimeNativeSaveResult = {
          uri: requiredString(finished, "uri", "finishFileWrite"),
          bytesWritten: requiredNonNegativeInteger(finished, "bytesWritten", "finishFileWrite"),
          sha256: requiredString(finished, "sha256", "finishFileWrite"),
        };
        if (!/^[0-9a-f]{64}$/.test(nativeSave.sha256)) {
          throw new Error("finishFileWrite response has invalid sha256.");
        }
        const nativeInspection = runtime.inspectSavedMp4(nativeSave.uri);
        window.dispatchEvent(new CustomEvent("aistudio:native-export-finalized", {
          detail: Object.freeze({ nativeSave, nativeInspection }),
        }));
        return Object.freeze({
          size: nativeSave.bytesWritten,
          nativeSave,
          nativeInspection,
        });
      } catch (error) {
        try {
          bridge.abortFileWrite(sessionId);
        } catch {
          // Preserve the finalization error.
        }
        throw storageWriteError(error);
      }
    },
    async abort() {
      if (settled) return;
      settled = true;
      try {
        parseNativeResponse(bridge.abortFileWrite(sessionId), "abortFileWrite");
      } catch (error) {
        throw storageWriteError(error);
      }
    },
  };
}

export function canUseDiskStreamedExport(): boolean {
  return canUseNativeRuntimeStream()
    || (window.isSecureContext && typeof navigator.storage?.getDirectory === "function");
}

export async function estimateStudioStreamingExportCapacity(
  estimatedOutputBytes: number,
): Promise<StudioStreamingStorageBudget> {
  if (typeof navigator.storage?.estimate !== "function") {
    return evaluateStudioStreamingStorageBudget(estimatedOutputBytes);
  }
  try {
    const estimate = await navigator.storage.estimate();
    return evaluateStudioStreamingStorageBudget(estimatedOutputBytes, estimate.quota, estimate.usage);
  } catch {
    return evaluateStudioStreamingStorageBudget(estimatedOutputBytes);
  }
}

export async function createStudioStreamingExportFile(
  fileStem: string,
  estimatedOutputBytes?: number,
): Promise<StudioStreamingExportFile> {
  if (canUseNativeRuntimeStream()) {
    return createNativeRuntimeStreamingExportFile(fileStem);
  }
  if (!window.isSecureContext || typeof navigator.storage?.getDirectory !== "function") {
    throw new StudioExportStorageError("STORAGE_UNAVAILABLE", "Disk-backed browser export storage is unavailable.");
  }

  const budget = estimatedOutputBytes === undefined
    ? null
    : await estimateStudioStreamingExportCapacity(estimatedOutputBytes);
  if (budget !== null && !budget.sufficient) {
    throw new StudioExportStorageError("STORAGE_INSUFFICIENT_CAPACITY", budget.message);
  }

  let directory: FileSystemDirectoryHandle;
  let temporaryName: string;
  let handle: FileSystemFileHandle;
  let writable: FileSystemWritableFileStream;
  try {
    const root = await navigator.storage.getDirectory();
    directory = await root.getDirectoryHandle("aistudio-exports", { create: true });
    const suffix = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    temporaryName = `${fileStem}-${suffix}.partial.mp4`;
    handle = await directory.getFileHandle(temporaryName, { create: true });
    writable = await handle.createWritable();
  } catch (error) {
    throw storageWriteError(error);
  }
  let settled = false;

  const removeTemporaryEntry = async (): Promise<void> => {
    try {
      await directory.removeEntry(temporaryName);
    } catch {
      // Best-effort cleanup. The browser may already have removed an aborted entry.
    }
  };

  return {
    storageLabel: "OPFS disk stream",
    budget,
    sink: {
      async write(bytes) {
        if (settled) throw new StudioExportStorageError("STORAGE_WRITE_FAILED", "Streaming export file is already closed.");
        try {
          await writable.write(copyBuffer(bytes));
        } catch (error) {
          throw storageWriteError(error);
        }
      },
    },
    async finalize(mimeType, downloadName) {
      if (settled) throw new StudioExportStorageError("STORAGE_WRITE_FAILED", "Streaming export file is already closed.");
      settled = true;
      try {
        await writable.close();
        const stored = await handle.getFile();
        void mimeType;
        triggerFileDownload(stored, downloadName);
        // Keep the backing OPFS entry alive long enough for the browser download
        // to finish opening/reading it. Cancel/failure cleanup remains immediate.
        window.setTimeout(() => { void removeTemporaryEntry(); }, FINALIZED_EXPORT_CLEANUP_DELAY_MS);
        return Object.freeze({ size: stored.size, nativeSave: null, nativeInspection: null });
      } catch (error) {
        await removeTemporaryEntry();
        throw storageWriteError(error);
      }
    },
    async abort(reason) {
      if (!settled) {
        settled = true;
        try {
          await writable.abort(reason);
        } catch {
          // Removing the OPFS entry below is enough if abort itself is unsupported.
        }
      }
      await removeTemporaryEntry();
    },
  };
}
