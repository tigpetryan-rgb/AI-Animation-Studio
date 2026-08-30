import type { FragmentedMp4ByteSink } from "@aistudio/media-export/mp4";

export const STUDIO_STREAMING_STORAGE_HEADROOM_BYTES = 64 * 1024 * 1024;
export const STUDIO_STREAMING_STORAGE_HEADROOM_RATIO = 1.1;
const FINALIZED_EXPORT_CLEANUP_DELAY_MS = 30_000;

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

export interface StudioStreamingExportFile {
  readonly sink: FragmentedMp4ByteSink;
  readonly storageLabel: string;
  readonly budget: StudioStreamingStorageBudget | null;
  finalize(mimeType: string, downloadName: string): Promise<File>;
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

export function canUseDiskStreamedExport(): boolean {
  return window.isSecureContext && typeof navigator.storage?.getDirectory === "function";
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
  if (!canUseDiskStreamedExport()) {
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
        return stored;
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
