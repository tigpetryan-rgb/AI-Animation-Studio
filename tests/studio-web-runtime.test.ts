import { describe, expect, it } from "vitest";
import { createStudioBootModel } from "../apps/studio-web/src/runtime";
import type { BrowserCapabilitySnapshot } from "@aistudio/platform-capabilities";

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

describe("Studio Web boot model", () => {
  it("boots Full Studio on a declared full-capability browser", () => {
    const boot = createStudioBootModel(snapshot());
    expect(boot.plan.mode).toBe("FULL_STUDIO");
    expect(boot.plan.tier).toBe("ULTRA");
    expect(boot.plan.renderer).toBe("WEBGPU");
    expect(boot.shell.workspace).toBe("DIRECTOR");
    expect(boot.banner).toContain("Full Studio");
  });

  it("boots Compatibility Mode with deterministic fallbacks", () => {
    const boot = createStudioBootModel(snapshot({
      secureContext: false,
      serviceWorker: false,
      opfs: false,
      webgpu: false,
      webcodecs: false,
      wasmSimd: false,
      logicalCores: 2,
      deviceMemoryGB: 2,
    }));
    expect(boot.plan.mode).toBe("COMPATIBILITY");
    expect(boot.plan.renderer).toBe("WEBGL2");
    expect(boot.plan.compute).toBe("WASM_CPU");
    expect(boot.plan.storage).toBe("INDEXED_DB");
    expect(boot.plan.codec).toBe("WASM");
    expect(boot.plan.warnings.length).toBeGreaterThan(0);
  });
});
