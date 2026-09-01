const DATABASE_NAME = "aistudio-production-reference-v1";
const DATABASE_VERSION = 1;
const STORE_NAME = "references";

interface StoredProductionReference {
  readonly chatId: string;
  readonly sourceCommit: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly lastModified: number;
  readonly sha256: string;
  readonly bytes: ArrayBuffer;
}

function isSha40(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (typeof crypto?.subtle?.digest !== "function") {
    throw new Error("Exact-source reference persistence requires Web Crypto SHA-256 support.");
  }
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Exact-source reference persistence requires IndexedDB."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "chatId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open the production reference database."));
    request.onblocked = () => reject(new Error("Production reference database upgrade is blocked."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Production reference transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Production reference transaction was aborted."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Production reference request failed."));
  });
}

function isStoredReference(value: unknown): value is StoredProductionReference {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StoredProductionReference>;
  return typeof candidate.chatId === "string"
    && typeof candidate.sourceCommit === "string"
    && isSha40(candidate.sourceCommit)
    && typeof candidate.name === "string"
    && typeof candidate.mimeType === "string"
    && typeof candidate.size === "number"
    && Number.isSafeInteger(candidate.size)
    && candidate.size >= 0
    && typeof candidate.lastModified === "number"
    && Number.isFinite(candidate.lastModified)
    && typeof candidate.sha256 === "string"
    && isSha256(candidate.sha256)
    && candidate.bytes instanceof ArrayBuffer
    && candidate.bytes.byteLength === candidate.size;
}

async function deleteStoredReference(chatId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).delete(chatId);
    await done;
  } finally {
    database.close();
  }
}

export async function persistProductionReferenceFile(
  chatId: string,
  sourceCommit: string,
  file: File,
): Promise<string> {
  if (chatId.trim().length === 0) throw new Error("Production reference persistence requires a chat id.");
  if (!isSha40(sourceCommit)) throw new Error("Production reference persistence requires an exact 40-character source commit.");
  if (!file.type.startsWith("image/") || file.size <= 0) throw new Error("Production reference persistence requires a non-empty image File.");

  const bytes = await file.arrayBuffer();
  const sha256 = await sha256Hex(bytes);
  const stored: StoredProductionReference = Object.freeze({
    chatId,
    sourceCommit,
    name: file.name,
    mimeType: file.type || "image/*",
    size: file.size,
    lastModified: file.lastModified,
    sha256,
    bytes,
  });

  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(STORE_NAME).put(stored);
    await done;
  } finally {
    database.close();
  }
  return sha256;
}

export async function restoreProductionReferenceFile(
  chatId: string,
  sourceCommit: string,
): Promise<File | null> {
  if (chatId.trim().length === 0 || !isSha40(sourceCommit)) return null;
  const database = await openDatabase();
  let value: unknown;
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const done = transactionDone(transaction);
    value = await requestResult(transaction.objectStore(STORE_NAME).get(chatId));
    await done;
  } finally {
    database.close();
  }

  if (!isStoredReference(value) || value.sourceCommit !== sourceCommit) return null;
  const digest = await sha256Hex(value.bytes);
  if (digest !== value.sha256) {
    await deleteStoredReference(chatId).catch(() => undefined);
    return null;
  }

  return new File([value.bytes.slice(0)], value.name, {
    type: value.mimeType,
    lastModified: value.lastModified,
  });
}
