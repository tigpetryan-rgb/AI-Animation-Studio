import { describe, expect, it } from "vitest";
import {
  buildCapabilityPlan,
  capabilityWarnings,
  classifyTier,
  deriveMemoryBudgetMB,
  fullStudioRequirements,
  selectCodec,
  selectCompute,
  selectRenderer,
  selectStorage,
  selectStudioMode,
  type BrowserCapabilitySnapshot,
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

describe("platform capability planning", () => {
  it("requires secure context, service worker, OPFS and IndexedDB for Full Studio", () => {
    expect(selectStudioMode(snapshot())).toBe("FULL_STUDIO");
    expect(selectStudioMode(snapshot({ secureContext: false }))).toBe("COMPATIBILITY");
    expect(selectStudioMode(snapshot({ serviceWorker: false }))).toBe("COMPATIBILITY");
    expect(selectStudioMode(snapshot({ opfs: false }))).toBe("COMPATIBILITY");
    expect(selectStudioMode(snapshot({ indexedDb: false }))).toBe("COMPATIBILITY");
  });

  it("uses deterministic renderer, compute, storage and codec fallbacks", () => {
    expect(selectRenderer(snapshot())).toBe("WEBGPU");
    expect(selectRenderer(snapshot({ webgpu: false }))).toBe("WEBGL2");
    expect(selectRenderer(snapshot({ webgpu: false, webgl2: false }))).toBe("CPU_CANVAS");

    expect(selectCompute(snapshot())).toBe("WEBGPU");
    expect(selectCompute(snapshot({ webgpu: false }))).toBe("WASM_SIMD");
    expect(selectCompute(snapshot({ webgpu: false, wasmSimd: false }))).toBe("WASM_CPU");

    expect(selectStorage(snapshot())).toBe("OPFS");
    expect(selectStorage(snapshot({ opfs: false }))).toBe("INDEXED_DB");
    expect(selectStorage(snapshot({ opfs: false, indexedDb: false }))).toBe("MEMORY");

    expect(selectCodec(snapshot())).toBe("WEBCODECS");
    expect(selectCodec(snapshot({ webcodecs: false }))).toBe("WASM");
  });

  it("derives conservative bounded local memory budgets", () => {
    expect(deriveMemoryBudgetMB(snapshot({ deviceMemoryGB: 16 }))).toBe(6553);
    expect(deriveMemoryBudgetMB(snapshot({ deviceMemoryGB: 2 }))).toBe(819);
    expect(deriveMemoryBudgetMB(snapshot({ deviceMemoryGB: 0 }))).toBe(1024);
    const { deviceMemoryGB: _ignored, ...withoutMemory } = snapshot();
    expect(deriveMemoryBudgetMB(withoutMemory)).toBe(1024);
  });

  it("classifies LITE, STANDARD, QUALITY and ULTRA deterministically", () => {
    expect(classifyTier(snapshot({ deviceMemoryGB: 16, logicalCores: 8, webgpu: true }))).toBe("ULTRA");
    expect(classifyTier(snapshot({ deviceMemoryGB: 8, logicalCores: 6, webgpu: true }))).toBe("QUALITY");
    expect(classifyTier(snapshot({ deviceMemoryGB: 4, logicalCores: 4, webgpu: false, webgl2: true }))).toBe("STANDARD");
    expect(classifyTier(snapshot({ deviceMemoryGB: 2, logicalCores: 2, webgpu: false, webgl2: false }))).toBe("LITE");
  });

  it("emits explicit graceful-degradation warnings", () => {
    const warnings = capabilityWarnings(snapshot({
      secureContext: false,
      serviceWorker: false,
      opfs: false,
      indexedDb: false,
      webgpu: false,
      webcodecs: false,
      wasmSimd: false,
      logicalCores: 2,
      deviceMemoryGB: 2,
    }));
    expect(warnings.map((warning) => warning.code)).toEqual([
      "PLATFORM_INSECURE_CONTEXT",
      "PLATFORM_NO_SERVICE_WORKER",
      "PLATFORM_NO_PERSISTENT_STORAGE",
      "PLATFORM_NO_WEBGPU",
      "PLATFORM_NO_WEBCODECS",
      "PLATFORM_NO_WASM_SIMD",
      "PLATFORM_LOW_MEMORY",
      "PLATFORM_LOW_CPU",
    ]);
  });

  it("builds one immutable deterministic capability plan", () => {
    const plan = buildCapabilityPlan(snapshot({ webgpu: false, deviceMemoryGB: 4, logicalCores: 4 }));
    expect(plan.mode).toBe("FULL_STUDIO");
    expect(plan.tier).toBe("STANDARD");
    expect(plan.renderer).toBe("WEBGL2");
    expect(plan.compute).toBe("WASM_SIMD");
    expect(plan.storage).toBe("OPFS");
    expect(plan.codec).toBe("WEBCODECS");
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it("freezes the declared Full Studio requirement set", () => {
    expect(fullStudioRequirements()).toEqual(["secureContext", "serviceWorker", "opfs", "indexedDb"]);
  });
});
