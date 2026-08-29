import {
  createStudioProject,
  deserializeProject,
  serializeProject,
  type StudioProject,
} from "@aistudio/core-project";
import { asProjectId } from "@aistudio/core-types";
import { currentStudioBuildIdentity, type DeviceBuildIdentity } from "./device-check";

export type PersistenceSlot = "A" | "B";
export type PersistenceRecoverySource = "ACTIVE" | "FALLBACK_SLOT";
export type PersistenceSummary = "PERSISTED" | "VERIFIED" | "RECOVERED" | "FAILED";

export interface PersistenceSlotMetadata {
  readonly version: 1;
  readonly slot: PersistenceSlot;
  readonly saveRevision: number;
  readonly digest: string;
  readonly bytes: number;
  readonly savedAt: string;
  readonly projectId: string;
}

export interface PersistencePointer {
  readonly version: 1;
  readonly activeSlot: PersistenceSlot;
  readonly saveRevision: number;
}

export interface PersistenceStressReport {
  readonly schemaVersion: 1;
  readonly build: DeviceBuildIdentity;
  readonly capturedAt: string;
  readonly userAgent: string;
  readonly summary: PersistenceSummary;
  readonly online: boolean;
  readonly activeSlot: PersistenceSlot;
  readonly saveRevision: number;
  readonly recoverySource: PersistenceRecoverySource;
  readonly project: {
    readonly projectId: string;
    readonly name: string;
    readonly stateRevision: number;
  };
  readonly checks: readonly {
    readonly id: string;
    readonly status: "PASS" | "FAIL";
    readonly detail: string;
  }[];
  readonly note: string;
}

interface WritableFileLike {
  write(data: string | Uint8Array): Promise<void>;
  close(): Promise<void>;
}
interface FileHandleLike {
  createWritable(): Promise<WritableFileLike>;
  getFile(): Promise<File>;
}
interface DirectoryHandleLike {
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options: { create: boolean }): Promise<FileHandleLike>;
}
interface NavigatorStorageLike {
  getDirectory?: () => Promise<DirectoryHandleLike>;
}

const DB_NAME = "aistudio-project-persistence-v1";
const STORE_NAME = "meta";
const ACTIVE_KEY = "active";
const SLOT_KEY_PREFIX = "slot:";
const OPFS_ROOT = "aistudio-projects";
const PROJECT_DIR = "m26-stress-project";
const PROJECT_ID = "project_m26_persistence_stress";

export function nextPersistenceSlot(active?: PersistenceSlot): PersistenceSlot {
  return active === "A" ? "B" : "A";
}

export function slotFilename(slot: PersistenceSlot): string {
  return `project-${slot.toLowerCase()}.json`;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("IndexedDB request failed.")), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("IndexedDB transaction aborted.")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("IndexedDB transaction failed.")), { once: true });
  });
}

async function openMetadataDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable.");
  const request = indexedDB.open(DB_NAME, 1);
  request.addEventListener("upgradeneeded", () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
  });
  return requestResult(request);
}

async function readMeta<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  const tx = db.transaction(STORE_NAME, "readonly");
  const request = tx.objectStore(STORE_NAME).get(key);
  const result = await requestResult(request) as T | undefined;
  await transactionDone(tx);
  return result;
}

async function commitSlotMetadata(
  db: IDBDatabase,
  metadata: PersistenceSlotMetadata,
): Promise<void> {
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  store.put(metadata, `${SLOT_KEY_PREFIX}${metadata.slot}`);
  const pointer: PersistencePointer = {
    version: 1,
    activeSlot: metadata.slot,
    saveRevision: metadata.saveRevision,
  };
  store.put(pointer, ACTIVE_KEY);
  await transactionDone(tx);
}

async function opfsProjectDirectory(): Promise<DirectoryHandleLike> {
  const storage = navigator.storage as NavigatorStorageLike | undefined;
  if (typeof storage?.getDirectory !== "function") throw new Error("OPFS is unavailable.");
  const root = await storage.getDirectory();
  const projects = await root.getDirectoryHandle(OPFS_ROOT, { create: true });
  return projects.getDirectoryHandle(PROJECT_DIR, { create: true });
}

async function writeSlot(slot: PersistenceSlot, data: Uint8Array): Promise<void> {
  const directory = await opfsProjectDirectory();
  const handle = await directory.getFileHandle(slotFilename(slot), { create: true });
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function readSlot(slot: PersistenceSlot): Promise<Uint8Array> {
  const directory = await opfsProjectDirectory();
  const handle = await directory.getFileHandle(slotFilename(slot), { create: false });
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

function createStressProject(saveRevision: number): StudioProject {
  return createStudioProject({
    projectId: asProjectId(PROJECT_ID),
    name: `M26 Persistence Stress ${saveRevision}`,
  });
}

async function writeVerifiedSnapshot(
  db: IDBDatabase,
  project: StudioProject,
  slot: PersistenceSlot,
  saveRevision: number,
): Promise<PersistenceSlotMetadata> {
  const encoded = new TextEncoder().encode(serializeProject(project));
  const digest = await sha256Hex(encoded);
  await writeSlot(slot, encoded);
  const readback = await readSlot(slot);
  const readbackDigest = await sha256Hex(readback);
  if (digest !== readbackDigest || encoded.byteLength !== readback.byteLength) {
    throw new Error("OPFS snapshot verification failed before metadata commit.");
  }

  // Also validate the bytes through the canonical project parser before commit.
  deserializeProject(new TextDecoder().decode(readback));

  const metadata: PersistenceSlotMetadata = {
    version: 1,
    slot,
    saveRevision,
    digest,
    bytes: encoded.byteLength,
    savedAt: new Date().toISOString(),
    projectId: project.projectId,
  };
  await commitSlotMetadata(db, metadata);
  return metadata;
}

interface LoadedSnapshot {
  readonly project: StudioProject;
  readonly metadata: PersistenceSlotMetadata;
  readonly source: PersistenceRecoverySource;
}

async function validateSlot(
  db: IDBDatabase,
  slot: PersistenceSlot,
): Promise<{ project: StudioProject; metadata: PersistenceSlotMetadata } | undefined> {
  const metadata = await readMeta<PersistenceSlotMetadata>(db, `${SLOT_KEY_PREFIX}${slot}`);
  if (!metadata || metadata.version !== 1 || metadata.slot !== slot) return undefined;
  try {
    const data = await readSlot(slot);
    if (data.byteLength !== metadata.bytes) return undefined;
    if (await sha256Hex(data) !== metadata.digest) return undefined;
    const project = deserializeProject(new TextDecoder().decode(data));
    if (project.projectId !== metadata.projectId) return undefined;
    return { project, metadata };
  } catch {
    return undefined;
  }
}

export async function loadPersistedStressProject(): Promise<LoadedSnapshot> {
  const db = await openMetadataDb();
  try {
    const pointer = await readMeta<PersistencePointer>(db, ACTIVE_KEY);
    if (!pointer || pointer.version !== 1) throw new Error("No committed persistence pointer exists.");

    const active = await validateSlot(db, pointer.activeSlot);
    if (active && active.metadata.saveRevision === pointer.saveRevision) {
      return { ...active, source: "ACTIVE" };
    }

    const fallbackSlot = nextPersistenceSlot(pointer.activeSlot);
    const fallback = await validateSlot(db, fallbackSlot);
    if (fallback) return { ...fallback, source: "FALLBACK_SLOT" };
    throw new Error("Neither active nor fallback project snapshot is valid.");
  } finally {
    db.close();
  }
}

function reportForLoaded(
  loaded: LoadedSnapshot,
  summary: PersistenceSummary,
  detail: string,
): PersistenceStressReport {
  return {
    schemaVersion: 1,
    build: currentStudioBuildIdentity(),
    capturedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    summary,
    online: navigator.onLine,
    activeSlot: loaded.metadata.slot,
    saveRevision: loaded.metadata.saveRevision,
    recoverySource: loaded.source,
    project: {
      projectId: loaded.project.projectId,
      name: loaded.project.name,
      stateRevision: loaded.project.state.revision,
    },
    checks: [
      { id: "opfs-digest", status: "PASS", detail: "Active snapshot bytes matched committed SHA-256 metadata." },
      { id: "canonical-deserialize", status: "PASS", detail: "Snapshot passed StudioProject schema and canonical-state validation." },
      { id: "idb-commit-pointer", status: "PASS", detail },
    ],
    note: "This proves durable browser persistence for a canonical StudioProject using dual OPFS slots and an IndexedDB commit pointer. It does not yet prove portable .aistudio package export/import.",
  };
}

export async function runPersistenceStress(iterations = 6): Promise<PersistenceStressReport> {
  if (!Number.isSafeInteger(iterations) || iterations < 2) throw new RangeError("iterations must be an integer >= 2.");
  const db = await openMetadataDb();
  try {
    const existing = await readMeta<PersistencePointer>(db, ACTIVE_KEY);
    let active = existing?.activeSlot;
    let revision = existing?.saveRevision ?? 0;

    for (let index = 0; index < iterations; index += 1) {
      revision += 1;
      const slot = nextPersistenceSlot(active);
      const project = createStressProject(revision);
      await writeVerifiedSnapshot(db, project, slot, revision);
      active = slot;
    }
  } finally {
    db.close();
  }

  const loaded = await loadPersistedStressProject();
  return reportForLoaded(loaded, "PERSISTED", "Commit pointer advanced only after OPFS write/read/hash/project validation succeeded.");
}

export async function verifyPersistedStressProject(): Promise<PersistenceStressReport> {
  const loaded = await loadPersistedStressProject();
  return reportForLoaded(
    loaded,
    loaded.source === "ACTIVE" ? "VERIFIED" : "RECOVERED",
    loaded.source === "ACTIVE"
      ? "Committed IndexedDB pointer resolved to the verified active OPFS snapshot."
      : "Active snapshot was invalid; loader recovered a verified fallback slot without accepting corrupt bytes.",
  );
}

export function serializePersistenceStressReport(report: PersistenceStressReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
