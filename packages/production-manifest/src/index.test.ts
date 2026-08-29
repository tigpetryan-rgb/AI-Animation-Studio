import { describe, expect, it } from "vitest";
import {
  assessReproducibility,
  digestProductionManifest,
  normalizeProductionManifest,
  productionManifestEvidence,
  reproducibilityPayload,
  validateProductionManifest,
  type DigestProvider,
  type ProductionManifest,
} from "./index.js";

const H0 = "0".repeat(64);
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);
const H4 = "4".repeat(64);
const H5 = "5".repeat(64);

function manifest(overrides: Partial<ProductionManifest> = {}): ProductionManifest {
  return {
    format: "aistudio-production-manifest",
    formatVersion: 1,
    projectId: "project-1",
    projectRevision: 7,
    projectStateSha256: H0,
    storyIrVersion: "story-v3",
    storyIrSha256: H1,
    sceneIds: ["scene-b", "scene-a"],
    shotIds: ["shot-2", "shot-1"],
    assets: [
      { id: "asset-b", kind: "AUDIO", sha256: H3 },
      { id: "asset-a", kind: "IMAGE", sha256: H2 },
    ],
    models: [{
      id: "vision-local",
      version: "1.2.0",
      sha256: H4,
      task: "VISION",
      quantization: "INT8",
      backend: "WASM_SIMD",
      adapterId: "vision-adapter",
      adapterVersion: "2.0.0",
    }],
    engines: [
      { id: "timeline", version: "1.0.0" },
      { id: "composition", version: "1.0.0" },
    ],
    recipes: [{ id: "recipe-shot-1", sha256: H5 }],
    approvedTakes: [{
      sceneId: "scene-a",
      shotId: "shot-1",
      takeId: "take-1",
      artifactSha256: H2,
    }],
    unresolved: [],
    evidence: {
      createdAt: "2026-08-29T00:00:00.000Z",
      studioVersion: "0.0.0",
      capabilityTier: "QUALITY",
      renderer: "WEBGPU",
      compute: "WEBGPU",
      browserLabel: "Browser A",
    },
    ...overrides,
  };
}

const deterministicDigest: DigestProvider = async (bytes) => {
  const output = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    const slot = index % output.length;
    output[slot] = ((output[slot] ?? 0) + (bytes[index] ?? 0) + index) % 256;
  }
  return output;
};

describe("production manifest", () => {
  it("normalizes dependency sets into deterministic order", () => {
    const normalized = normalizeProductionManifest(manifest());
    expect(normalized.sceneIds).toEqual(["scene-a", "scene-b"]);
    expect(normalized.shotIds).toEqual(["shot-1", "shot-2"]);
    expect(normalized.assets.map((item) => item.id)).toEqual(["asset-a", "asset-b"]);
    expect(normalized.engines.map((item) => item.id)).toEqual(["composition", "timeline"]);
  });

  it("reports a complete exact dependency identity as READY", () => {
    expect(assessReproducibility(manifest())).toEqual({
      status: "READY",
      diagnostics: [],
      unresolved: [],
    });
  });

  it("keeps missing dependencies explicit instead of pretending reproducibility", () => {
    const value = manifest({
      unresolved: [{ kind: "MODEL", id: "motion-local@1", reason: "Model binary is not installed." }],
    });
    expect(assessReproducibility(value).status).toBe("INCOMPLETE");
    expect(assessReproducibility(value).unresolved).toHaveLength(1);
  });

  it("rejects malformed hashes, revisions and duplicate stable identities", () => {
    const value = manifest({
      projectRevision: -1,
      projectStateSha256: "bad",
      sceneIds: ["scene-a", "scene-a"],
      assets: [
        { id: "same", kind: "IMAGE", sha256: H2 },
        { id: "same", kind: "VIDEO", sha256: H3 },
      ],
    });
    const codes = validateProductionManifest(value).map((item) => item.code);
    expect(codes).toContain("MANIFEST_INVALID_REVISION");
    expect(codes).toContain("MANIFEST_INVALID_HASH");
    expect(codes).toContain("MANIFEST_DUPLICATE_DEPENDENCY");
    expect(assessReproducibility(value).status).toBe("INVALID");
  });

  it("excludes evidence-only timestamps and browser labels from the strict reproducibility payload", () => {
    const first = manifest();
    const second = manifest({
      evidence: {
        ...first.evidence,
        createdAt: "2030-01-01T00:00:00.000Z",
        browserLabel: "Different Browser",
        capabilityTier: "LITE",
      },
    });
    expect(reproducibilityPayload(first)).toBe(reproducibilityPayload(second));
  });

  it("produces the same digest when dependency input ordering changes", async () => {
    const first = manifest();
    const second = manifest({
      sceneIds: [...first.sceneIds].reverse(),
      shotIds: [...first.shotIds].reverse(),
      assets: [...first.assets].reverse(),
      engines: [...first.engines].reverse(),
    });
    const a = await digestProductionManifest(first, deterministicDigest);
    const b = await digestProductionManifest(second, deterministicDigest);
    expect(a.canonicalPayload).toBe(b.canonicalPayload);
    expect(a.sha256).toBe(b.sha256);
    expect(a.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes the digest when a strict content dependency changes", async () => {
    const first = manifest();
    const second = manifest({
      assets: first.assets.map((asset) => asset.id === "asset-a" ? { ...asset, sha256: H5 } : asset),
    });
    const a = await digestProductionManifest(first, deterministicDigest);
    const b = await digestProductionManifest(second, deterministicDigest);
    expect(a.canonicalPayload).not.toBe(b.canonicalPayload);
    expect(a.sha256).not.toBe(b.sha256);
  });

  it("refuses to digest an invalid manifest", async () => {
    await expect(digestProductionManifest(manifest({ projectStateSha256: "bad" }), deterministicDigest))
      .rejects.toThrow("Cannot digest an invalid production manifest.");
  });

  it("requires a SHA-256 provider to return exactly 32 bytes", async () => {
    await expect(digestProductionManifest(manifest(), async () => new Uint8Array(31)))
      .rejects.toThrow("exactly 32 bytes");
  });

  it("documents the limit of reproducibility claims", () => {
    expect(productionManifestEvidence()).toContain(
      "A READY manifest means dependency identity is complete; it does not guarantee bit-identical GPU output across different drivers or hardware.",
    );
    expect(productionManifestEvidence()).toContain(
      "Model binaries are referenced by stable id, version and SHA-256 and are not duplicated into the manifest.",
    );
  });
});
