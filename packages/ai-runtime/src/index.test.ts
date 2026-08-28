import { describe, expect, it } from "vitest";
import type { StudioCommand } from "@aistudio/core-events";
import {
  ModelRegistry,
  availableBackends,
  selectModel,
  validateAgentProposal,
  validateModel,
  type DeviceCapabilities,
  type ModelRef,
} from "./index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function model(overrides: Partial<ModelRef> = {}): ModelRef {
  return {
    id: "vision-small",
    version: "1.0.0",
    sha256: HASH_A,
    task: "VISION",
    quantization: "INT8",
    estimatedRamMB: 512,
    supportedBackends: ["WEBGPU", "WASM_SIMD", "WASM_CPU"],
    minimumTier: "LITE",
    licenseId: "Apache-2.0",
    ...overrides,
  };
}

const qualityDevice: DeviceCapabilities = {
  webgpu: true,
  wasm: true,
  wasmSimd: true,
  memoryBudgetMB: 4096,
  tier: "QUALITY",
};

describe("local AI runtime", () => {
  it("orders local backends WebGPU → WASM SIMD → WASM CPU", () => {
    expect(availableBackends(qualityDevice)).toEqual(["WEBGPU", "WASM_SIMD", "WASM_CPU"]);
    expect(availableBackends({ ...qualityDevice, webgpu: false })).toEqual(["WASM_SIMD", "WASM_CPU"]);
    expect(availableBackends({ ...qualityDevice, webgpu: false, wasmSimd: false })).toEqual(["WASM_CPU"]);
  });

  it("validates immutable model identity metadata", () => {
    expect(validateModel(model())).toEqual([]);
    expect(validateModel(model({ sha256: "not-a-hash" }))[0]?.code).toBe("AI_INVALID_MODEL");
  });

  it("rejects duplicate model id/version registrations", () => {
    const registry = new ModelRegistry();
    expect(registry.register(model())).toEqual([]);
    expect(registry.register(model())[0]?.code).toBe("AI_DUPLICATE_MODEL_VERSION");
  });

  it("selects WebGPU first and falls back deterministically", () => {
    const registry = new ModelRegistry();
    registry.register(model());
    expect(selectModel(registry, "VISION", qualityDevice).selection?.backend).toBe("WEBGPU");
    expect(selectModel(registry, "VISION", { ...qualityDevice, webgpu: false }).selection?.backend).toBe("WASM_SIMD");
    expect(selectModel(registry, "VISION", { ...qualityDevice, webgpu: false, wasmSimd: false }).selection?.backend).toBe("WASM_CPU");
  });

  it("filters models that exceed the local memory budget", () => {
    const registry = new ModelRegistry();
    registry.register(model({ estimatedRamMB: 2048 }));
    const result = selectModel(registry, "VISION", { ...qualityDevice, memoryBudgetMB: 1024 });
    expect(result.selection).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("AI_MODEL_OVER_MEMORY_BUDGET");
  });

  it("uses deterministic tie-breaking for equal candidates", () => {
    const registry = new ModelRegistry();
    registry.register(model({ id: "z-model", sha256: HASH_A }));
    registry.register(model({ id: "a-model", sha256: HASH_B }));
    expect(selectModel(registry, "VISION", qualityDevice).selection?.model.id).toBe("a-model");
  });

  it("reports when no model exists for a task", () => {
    const result = selectModel(new ModelRegistry(), "TTS", qualityDevice);
    expect(result.diagnostics[0]?.code).toBe("AI_NO_MODEL_FOR_TASK");
  });

  it("keeps AI output as a proposal containing commands rather than state setters", () => {
    const command = {
      type: "PICK_UP_PROP",
      actorId: "char_bim",
      propId: "prop_key",
      meta: { source: "ai" },
    } as unknown as StudioCommand;
    const proposal = {
      proposalId: "proposal_1",
      commands: [command],
      confidence: 0.9,
      evidence: [{ kind: "RULE" as const, description: "Story event requires pickup." }],
    };
    expect(validateAgentProposal(proposal)).toEqual([]);
    expect(proposal.commands[0]?.meta.source).toBe("ai");
    expect("state" in proposal).toBe(false);
  });
});
