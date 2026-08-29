import { describe, expect, it } from "vitest";
import {
  buildCapabilityPlan,
  type BrowserCapabilitySnapshot,
  type StorageBackend,
} from "@aistudio/platform-capabilities";
import {
  MemoryStorageAdapter,
  airGapNetworkPolicy,
  buildRuntimeAdapterPlan,
  createAtomicSavePlan,
  offlineCacheContract,
  saveAtomically,
  type BinaryStorageAdapter,
} from "./index.js";

function snapshot(overrides: Partial<BrowserCapabilitySnapshot> = {}): BrowserCapabilitySnapshot {
  return {
    secureContext: true,
    serviceWorker: true,
    opfs: true,
    indexedDb: true,
    webgpu: true,
    webgl2: true,
    webcodecs: true,
    wasm: true,
    wasmSimd: true,
    sharedArrayBuffer: true,
    offscreenCanvas: true,
    logicalCores: 8,
    deviceMemoryGB: 16,
    ...overrides,
  };
}

class TestStorageAdapter implements BinaryStorageAdapter {
  readonly kind: StorageBackend = "MEMORY";
  readonly persistent = false;
  readonly atomicReplace: boolean;
  protected readonly entries = new Map<string, Uint8Array>();

  constructor(
    atomicReplace = true,
    private readonly corruptReadback = false,
    private readonly failReplace = false,
  ) {
    this.atomicReplace = atomicReplace;
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    const value = this.entries.get(path);
    if (value === undefined) return undefined;
    if (this.corruptReadback && path.includes(".tmp.")) {
      const corrupted = value.slice();
      if (corrupted.byteLength > 0) corrupted[0] = (corrupted[0] ?? 0) ^ 0xff;
      return corrupted;
    }
    return value.slice();
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    this.entries.set(path, data.slice());
  }

  async remove(path: string): Promise<void> {
    this.entries.delete(path);
  }

  async list(prefix: string): Promise<readonly string[]> {
    return [...this.entries.keys()].filter((path) => path.startsWith(prefix)).sort();
  }

  async replace(fromPath: string, toPath: string): Promise<void> {
    if (this.failReplace) throw new Error("replace failed for test");
    const value = this.entries.get(fromPath);
    if (value === undefined) throw new Error("source missing");
    this.entries.set(toPath, value.slice());
    this.entries.delete(fromPath);
  }
}

describe("browser runtime", () => {
  it("builds the local runtime adapter plan from a full capability plan", () => {
    const runtime = buildRuntimeAdapterPlan(buildCapabilityPlan(snapshot()));
    expect(runtime).toEqual({
      storage: "OPFS",
      codec: "WEBCODECS",
      renderer: "WEBGPU",
      compute: "WEBGPU",
      persistentProjectStorage: true,
      offlineInstallSupported: true,
      coreNetworkRequired: false,
      telemetryEnabled: false,
    });
    expect(Object.isFrozen(runtime)).toBe(true);
  });

  it("degrades deterministically without turning network into a dependency", () => {
    const runtime = buildRuntimeAdapterPlan(buildCapabilityPlan(snapshot({
      serviceWorker: false,
      opfs: false,
      indexedDb: false,
      webgpu: false,
      webgl2: false,
      webcodecs: false,
      wasmSimd: false,
    })));
    expect(runtime.storage).toBe("MEMORY");
    expect(runtime.codec).toBe("WASM");
    expect(runtime.renderer).toBe("CPU_CANVAS");
    expect(runtime.compute).toBe("WASM_CPU");
    expect(runtime.persistentProjectStorage).toBe(false);
    expect(runtime.offlineInstallSupported).toBe(false);
    expect(runtime.coreNetworkRequired).toBe(false);
    expect(runtime.telemetryEnabled).toBe(false);
  });

  it("freezes an air-gap-first network policy", () => {
    expect(airGapNetworkPolicy()).toEqual({
      coreNetworkRequired: false,
      externalRequestsByDefault: "BLOCKED",
      telemetryEnabled: false,
      runtimeModelDownloadRequired: false,
    });
  });

  it("memory storage clones inputs and outputs and lists deterministically", async () => {
    const storage = new MemoryStorageAdapter();
    const input = new Uint8Array([1, 2, 3]);
    await storage.write("projects/b.bin", input);
    await storage.write("projects/a.bin", new Uint8Array([4]));
    input[0] = 99;

    const firstRead = await storage.read("/projects/b.bin");
    expect([...firstRead!]).toEqual([1, 2, 3]);
    firstRead![0] = 88;
    expect([...(await storage.read("/projects/b.bin"))!]).toEqual([1, 2, 3]);
    expect(await storage.list("/projects")).toEqual(["/projects/a.bin", "/projects/b.bin"]);

    await storage.replace("/projects/a.bin", "/projects/c.bin");
    expect(await storage.read("/projects/a.bin")).toBeUndefined();
    expect([...(await storage.read("/projects/c.bin"))!]).toEqual([4]);
  });

  it("creates the frozen verified-temp atomic save protocol", () => {
    const plan = createAtomicSavePlan("projects/film.aistudio", 7);
    expect(plan).toEqual({
      targetPath: "/projects/film.aistudio",
      tempPath: "/projects/film.aistudio.tmp.7",
      steps: ["WRITE_TEMP", "VERIFY_TEMP", "REPLACE_TARGET", "CLEANUP_TEMP"],
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.steps)).toBe(true);
  });

  it("commits a verified atomic save and removes the temporary entry", async () => {
    const storage = new MemoryStorageAdapter();
    const plan = createAtomicSavePlan("project.aistudio", 1);
    const result = await saveAtomically(storage, plan, new Uint8Array([7, 8, 9]));
    expect(result).toEqual({ committed: true, diagnostics: [] });
    expect([...(await storage.read("/project.aistudio"))!]).toEqual([7, 8, 9]);
    expect(await storage.read("/project.aistudio.tmp.1")).toBeUndefined();
  });

  it("rejects storage backends that cannot guarantee atomic replacement", async () => {
    const storage = new TestStorageAdapter(false);
    const result = await saveAtomically(storage, createAtomicSavePlan("p", 1), new Uint8Array([1]));
    expect(result.committed).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("SAVE_ADAPTER_NOT_ATOMIC");
  });

  it("does not commit corrupted temporary bytes", async () => {
    const storage = new TestStorageAdapter(true, true, false);
    const plan = createAtomicSavePlan("p", 2);
    const result = await saveAtomically(storage, plan, new Uint8Array([1, 2]));
    expect(result.committed).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("SAVE_VERIFY_FAILED");
    expect(await storage.read(plan.targetPath)).toBeUndefined();
    expect(await storage.list(plan.tempPath)).toEqual([]);
  });

  it("reports replace failure without reporting a committed save", async () => {
    const storage = new TestStorageAdapter(true, false, true);
    const plan = createAtomicSavePlan("p", 3);
    const result = await saveAtomically(storage, plan, new Uint8Array([1, 2]));
    expect(result.committed).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("SAVE_REPLACE_FAILED");
    expect(await storage.read(plan.targetPath)).toBeUndefined();
  });

  it("rejects unsafe storage paths and invalid revisions", () => {
    expect(() => createAtomicSavePlan("", 0)).toThrow("Storage path must not be empty");
    expect(() => createAtomicSavePlan("/project/../secret", 0)).toThrow("Parent traversal is not allowed");
    expect(() => createAtomicSavePlan("project", -1)).toThrow("revision must be a non-negative safe integer");
  });

  it("freezes a deterministic offline shell cache contract", () => {
    const contract = offlineCacheContract(" shell-v1 ", [
      " ./manifest.webmanifest ",
      "./",
      "./index.html",
      "./index.html",
      " ",
    ]);
    expect(contract).toEqual({
      shellAssets: ["./", "./index.html", "./manifest.webmanifest"],
      externalNetworkFallback: false,
      cacheVersion: "shell-v1",
    });
    expect(Object.isFrozen(contract)).toBe(true);
    expect(Object.isFrozen(contract.shellAssets)).toBe(true);
    expect(() => offlineCacheContract(" ", [])).toThrow("cacheVersion must not be empty");
  });
});
