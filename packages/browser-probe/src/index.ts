import type { BrowserCapabilitySnapshot } from "@aistudio/platform-capabilities";

export interface BrowserNavigatorLike {
  readonly serviceWorker?: unknown;
  readonly storage?: { readonly getDirectory?: unknown };
  readonly gpu?: unknown;
  readonly hardwareConcurrency?: unknown;
  readonly deviceMemory?: unknown;
}

export interface BrowserGlobalLike {
  readonly isSecureContext?: unknown;
  readonly navigator?: BrowserNavigatorLike;
  readonly indexedDB?: unknown;
  readonly VideoEncoder?: unknown;
  readonly VideoDecoder?: unknown;
  readonly WebAssembly?: unknown;
  readonly SharedArrayBuffer?: unknown;
  readonly OffscreenCanvas?: unknown;
}

export interface BrowserFeatureProbes {
  webgl2(): boolean;
  wasmSimd(): boolean;
}

function positiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function positiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

export function probeBrowserCapabilities(
  globals: BrowserGlobalLike,
  probes: BrowserFeatureProbes,
): BrowserCapabilitySnapshot {
  const navigator = globals.navigator;
  const hardwareConcurrency = positiveInteger(navigator?.hardwareConcurrency, 1);
  const deviceMemoryGB = positiveNumber(navigator?.deviceMemory);

  const base: BrowserCapabilitySnapshot = {
    secureContext: globals.isSecureContext === true,
    serviceWorker: navigator?.serviceWorker !== undefined,
    opfs: typeof navigator?.storage?.getDirectory === "function",
    indexedDb: globals.indexedDB !== undefined,
    webgpu: navigator?.gpu !== undefined,
    webgl2: probes.webgl2(),
    webcodecs: typeof globals.VideoEncoder === "function" && typeof globals.VideoDecoder === "function",
    wasm: globals.WebAssembly !== undefined,
    wasmSimd: globals.WebAssembly !== undefined && probes.wasmSimd(),
    sharedArrayBuffer: typeof globals.SharedArrayBuffer === "function",
    offscreenCanvas: typeof globals.OffscreenCanvas === "function",
    logicalCores: hardwareConcurrency,
  };

  return deviceMemoryGB === undefined
    ? Object.freeze(base)
    : Object.freeze({ ...base, deviceMemoryGB });
}

export interface BrowserProbeEvidence {
  readonly source: "RUNTIME_PROBE";
  readonly assumptions: readonly string[];
  readonly snapshot: BrowserCapabilitySnapshot;
}

export function probeWithEvidence(
  globals: BrowserGlobalLike,
  probes: BrowserFeatureProbes,
): BrowserProbeEvidence {
  return Object.freeze({
    source: "RUNTIME_PROBE",
    assumptions: Object.freeze([
      "Feature presence does not prove performance, driver stability or codec coverage.",
      "WebGL2 and WASM SIMD require executable probes supplied by the host runtime.",
      "Representative device verification remains separate from this capability snapshot.",
    ]),
    snapshot: probeBrowserCapabilities(globals, probes),
  });
}

export function safeBrowserFeatureProbes(
  probes: Partial<BrowserFeatureProbes> = {},
): BrowserFeatureProbes {
  return Object.freeze({
    webgl2: () => {
      try {
        return probes.webgl2?.() === true;
      } catch {
        return false;
      }
    },
    wasmSimd: () => {
      try {
        return probes.wasmSimd?.() === true;
      } catch {
        return false;
      }
    },
  });
}
