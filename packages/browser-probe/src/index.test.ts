import { describe, expect, it } from "vitest";
import {
  probeBrowserCapabilities,
  probeWithEvidence,
  safeBrowserFeatureProbes,
  type BrowserGlobalLike,
} from "./index.js";

function globals(overrides: BrowserGlobalLike = {}): BrowserGlobalLike {
  return {
    isSecureContext: true,
    navigator: {
      serviceWorker: {},
      storage: { getDirectory: () => undefined },
      gpu: {},
      hardwareConcurrency: 8,
      deviceMemory: 16,
    },
    indexedDB: {},
    VideoEncoder: function VideoEncoder() {},
    VideoDecoder: function VideoDecoder() {},
    WebAssembly: {},
    SharedArrayBuffer: function SharedArrayBuffer() {},
    OffscreenCanvas: function OffscreenCanvas() {},
    ...overrides,
  };
}

describe("browser capability probe", () => {
  it("maps runtime feature presence into the canonical capability snapshot", () => {
    const snapshot = probeBrowserCapabilities(globals(), {
      webgl2: () => true,
      wasmSimd: () => true,
    });
    expect(snapshot).toEqual({
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
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("uses conservative defaults for invalid numeric hints", () => {
    const snapshot = probeBrowserCapabilities(globals({
      navigator: {
        hardwareConcurrency: Number.NaN,
        deviceMemory: -1,
      },
    }), safeBrowserFeatureProbes());
    expect(snapshot.logicalCores).toBe(1);
    expect("deviceMemoryGB" in snapshot).toBe(false);
  });

  it("requires both encoder and decoder presence for WebCodecs", () => {
    const onlyEncoder = probeBrowserCapabilities(globals({ VideoDecoder: undefined }), safeBrowserFeatureProbes());
    expect(onlyEncoder.webcodecs).toBe(false);
  });

  it("does not claim WASM SIMD when WebAssembly itself is absent", () => {
    let called = false;
    const snapshot = probeBrowserCapabilities(globals({ WebAssembly: undefined }), {
      webgl2: () => true,
      wasmSimd: () => {
        called = true;
        return true;
      },
    });
    expect(snapshot.wasm).toBe(false);
    expect(snapshot.wasmSimd).toBe(false);
    expect(called).toBe(false);
  });

  it("converts throwing executable probes into unavailable features", () => {
    const probes = safeBrowserFeatureProbes({
      webgl2: () => { throw new Error("no canvas"); },
      wasmSimd: () => { throw new Error("validation failed"); },
    });
    expect(probes.webgl2()).toBe(false);
    expect(probes.wasmSimd()).toBe(false);
  });

  it("attaches evidence that explicitly separates detection from hardware verification", () => {
    const result = probeWithEvidence(globals(), {
      webgl2: () => true,
      wasmSimd: () => true,
    });
    expect(result.source).toBe("RUNTIME_PROBE");
    expect(result.assumptions).toContain("Representative device verification remains separate from this capability snapshot.");
    expect(Object.isFrozen(result.assumptions)).toBe(true);
    expect(result.snapshot.webgpu).toBe(true);
  });

  it("does not mistake missing APIs for available capabilities", () => {
    const snapshot = probeBrowserCapabilities({}, safeBrowserFeatureProbes());
    expect(snapshot).toEqual({
      secureContext: false,
      serviceWorker: false,
      opfs: false,
      indexedDb: false,
      webgpu: false,
      webgl2: false,
      webcodecs: false,
      wasm: false,
      wasmSimd: false,
      sharedArrayBuffer: false,
      offscreenCanvas: false,
      logicalCores: 1,
    });
  });
});
