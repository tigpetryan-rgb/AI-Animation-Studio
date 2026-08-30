import type { FragmentedMp4ByteSink } from "@aistudio/media-export/mp4";

export interface StudioStreamingExportFile {
  readonly sink: FragmentedMp4ByteSink;
  readonly storageLabel: string;
  finalize(mimeType: string, downloadName: string): Promise<File>;
  abort(reason?: unknown): Promise<void>;
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
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function canUseDiskStreamedExport(): boolean {
  return window.isSecureContext && typeof navigator.storage?.getDirectory === "function";
}

export async function createStudioStreamingExportFile(fileStem: string): Promise<StudioStreamingExportFile> {
  if (!canUseDiskStreamedExport()) throw new Error("Disk-backed browser export storage is unavailable.");

  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle("aistudio-exports", { create: true });
  const suffix = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const temporaryName = `${fileStem}-${suffix}.partial.mp4`;
  const handle = await directory.getFileHandle(temporaryName, { create: true });
  const writable = await handle.createWritable();
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
    sink: {
      async write(bytes) {
        if (settled) throw new Error("Streaming export file is already closed.");
        await writable.write(copyBuffer(bytes));
      },
    },
    async finalize(mimeType, downloadName) {
      if (settled) throw new Error("Streaming export file is already closed.");
      settled = true;
      await writable.close();
      const stored = await handle.getFile();
      const file = new File([stored], downloadName, { type: mimeType, lastModified: Date.now() });
      triggerFileDownload(file, downloadName);
      window.setTimeout(() => { void removeTemporaryEntry(); }, 30_000);
      return file;
    },
    async abort(reason) {
      if (!settled) {
        settled = true;
        try {
          await writable.abort(reason);
        } catch {
          // Closing/removing below is enough for cleanup if abort itself is unsupported by the runtime.
        }
      }
      await removeTemporaryEntry();
    },
  };
}
