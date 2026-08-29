import { describe, expect, it } from "vitest";
import type { CapabilityPlan } from "@aistudio/platform-capabilities";
import {
  buildProducerBudgetEvidence,
  deriveProducerBudget,
  producerQualityDecision,
  recommendPreviewQuality,
  scheduleResourceBatch,
  validateResourceRequest,
  type ResourceRequest,
} from "./index.js";

function capability(overrides: Partial<CapabilityPlan> = {}): CapabilityPlan {
  return {
    mode: "FULL_STUDIO",
    tier: "QUALITY",
    renderer: "WEBGPU",
    compute: "WEBGPU",
    storage: "OPFS",
    codec: "WEBCODECS",
    memoryBudgetMB: 4096,
    warnings: [],
    ...overrides,
  };
}

function request(id: string, overrides: Partial<ResourceRequest> = {}): ResourceRequest {
  return {
    id,
    priority: "NORMAL",
    compute: "CPU_ONLY",
    memoryMB: 256,
    scratchMB: 128,
    cpuSlots: 1,
    gpuSlots: 0,
    quality: "PREVIEW",
    ...overrides,
  };
}

describe("resource budget producer", () => {
  it("derives conservative working memory and concurrency ceilings", () => {
    const budget = deriveProducerBudget(capability());
    expect(budget.memoryHardMB).toBe(4096);
    expect(budget.memoryReserveMB).toBe(819);
    expect(budget.memoryWorkingMB).toBe(3277);
    expect(budget.maxCpuSlots).toBe(4);
    expect(budget.maxGpuSlots).toBe(1);
    expect(budget.maxConcurrentJobs).toBe(3);
    expect(Object.isFrozen(budget)).toBe(true);
  });

  it("keeps evidence explicit that policy ceilings are not hardware measurements", () => {
    const evidence = buildProducerBudgetEvidence(capability());
    expect(evidence.source).toBe("POLICY_DERIVED");
    expect(evidence.assumptions).toContain(
      "Budget caps are conservative policy ceilings, not measurements of currently free RAM, VRAM or disk space.",
    );
    expect(evidence.assumptions).toContain(
      "Representative device benchmarks remain separate from this scheduling policy.",
    );
  });

  it("validates malformed requests instead of silently normalizing them", () => {
    expect(validateResourceRequest(request("", {
      memoryMB: Number.NaN,
      cpuSlots: 0,
    }))).toEqual(["EMPTY_ID", "INVALID_MEMORY", "INVALID_COMPUTE_SLOTS"]);
  });

  it("orders work deterministically by priority and then request id", () => {
    const plan = scheduleResourceBatch([
      request("normal-b"),
      request("critical-z", { priority: "CRITICAL" }),
      request("normal-a"),
    ], deriveProducerBudget(capability({ tier: "ULTRA", memoryBudgetMB: 8192 })));

    expect(plan.decisions.map((decision) => decision.requestId)).toEqual([
      "critical-z",
      "normal-a",
      "normal-b",
    ]);
  });

  it("rejects a request that can never fit the hard memory ceiling", () => {
    const budget = deriveProducerBudget(capability({ tier: "LITE", memoryBudgetMB: 512 }));
    const plan = scheduleResourceBatch([
      request("too-large", { memoryMB: 513 }),
    ], budget);

    expect(plan.rejected).toEqual(["too-large"]);
    expect(plan.decisions[0]?.reason).toBe("MEMORY_HARD_LIMIT");
  });

  it("defers work instead of oversubscribing the active working-memory budget", () => {
    const budget = deriveProducerBudget(capability({ tier: "STANDARD", memoryBudgetMB: 1024 }));
    const plan = scheduleResourceBatch([
      request("first", { memoryMB: 500 }),
      request("second", { memoryMB: 500 }),
    ], budget);

    expect(plan.admitted).toEqual(["first"]);
    expect(plan.deferred).toEqual(["second"]);
    expect(plan.decisions[1]?.reason).toBe("WORKING_MEMORY_BUSY");
    expect(plan.usage.memoryMB).toBe(500);
  });

  it("rejects GPU-required work when WebGPU compute is unavailable", () => {
    const budget = deriveProducerBudget(capability({ compute: "WASM_SIMD", renderer: "WEBGL2" }));
    const plan = scheduleResourceBatch([
      request("gpu-job", {
        compute: "GPU_REQUIRED",
        cpuSlots: 0,
        gpuSlots: 1,
      }),
    ], budget);

    expect(plan.rejected).toEqual(["gpu-job"]);
    expect(plan.decisions[0]?.reason).toBe("GPU_CAPACITY_UNAVAILABLE");
  });

  it("lets GPU-preferred work fall back to the CPU lane when GPU capacity is busy", () => {
    const budget = deriveProducerBudget(capability({ tier: "ULTRA", memoryBudgetMB: 8192 }));
    const plan = scheduleResourceBatch([
      request("gpu-a", {
        priority: "CRITICAL",
        compute: "GPU_REQUIRED",
        cpuSlots: 0,
        gpuSlots: 1,
      }),
      request("gpu-preferred", {
        compute: "GPU_PREFERRED",
        cpuSlots: 1,
        gpuSlots: 1,
      }),
    ], budget);

    expect(plan.decisions[0]?.lane).toBe("GPU");
    expect(plan.decisions[1]?.lane).toBe("CPU");
    expect(plan.admitted).toEqual(["gpu-a", "gpu-preferred"]);
  });

  it("rejects duplicate stable request ids", () => {
    const plan = scheduleResourceBatch([
      request("same"),
      request("same", { priority: "BACKGROUND" }),
    ], deriveProducerBudget(capability()));

    expect(plan.admitted).toEqual(["same"]);
    expect(plan.rejected).toEqual(["same"]);
    expect(plan.decisions[1]?.reason).toBe("DUPLICATE_REQUEST_ID");
  });

  it("degrades preview recommendations under pressure without silently lowering standard or final work", () => {
    expect(recommendPreviewQuality("ULTRA", 0.95)).toBe("PROXY");
    expect(producerQualityDecision("PREVIEW", "PROXY")).toEqual({
      requested: "PREVIEW",
      recommended: "PROXY",
      automatic: true,
    });
    expect(producerQualityDecision("STANDARD", "PROXY")).toEqual({
      requested: "STANDARD",
      recommended: "STANDARD",
      automatic: false,
    });
    expect(producerQualityDecision("FINAL", "PROXY")).toEqual({
      requested: "FINAL",
      recommended: "FINAL",
      automatic: false,
    });
  });
});
