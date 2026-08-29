import { describe, expect, it } from "vitest";
import type { ResourceBudget, ResourceRequest } from "@aistudio/resource-budget";
import {
  AutopilotPlanError,
  autopilotEvidence,
  buildAutopilotLayers,
  buildAutopilotPlan,
  validateAutopilotActions,
  type AutopilotAction,
} from "./index.js";

function resource(id: string, overrides: Partial<ResourceRequest> = {}): ResourceRequest {
  return {
    id,
    priority: "NORMAL",
    compute: "CPU_ONLY",
    memoryMB: 128,
    scratchMB: 64,
    cpuSlots: 1,
    gpuSlots: 0,
    quality: "PREVIEW",
    ...overrides,
  };
}

function action(id: string, overrides: Partial<AutopilotAction> = {}): AutopilotAction {
  return {
    id,
    dependsOn: [],
    effect: "READ_ONLY",
    validation: "NONE",
    humanLocked: false,
    criticalAmbiguity: false,
    ...overrides,
  };
}

function budget(overrides: Partial<ResourceBudget> = {}): ResourceBudget {
  return {
    tier: "QUALITY",
    memoryHardMB: 2048,
    memoryWorkingMB: 1600,
    memoryReserveMB: 448,
    scratchBudgetMB: 1024,
    maxCpuSlots: 4,
    maxGpuSlots: 1,
    maxConcurrentJobs: 3,
    ...overrides,
  };
}

describe("production autopilot", () => {
  it("keeps autonomy evidence explicit about canonical truth and destructive work", () => {
    const evidence = autopilotEvidence();
    expect(evidence.source).toBe("DETERMINISTIC_POLICY");
    expect(evidence.assumptions).toContain(
      "AUTO_SCENE may start read-only and rebuildable candidate work, but canonical mutations still require human approval in v1.",
    );
    expect(evidence.assumptions).toContain(
      "Destructive operations are never auto-executed by v1 autopilot.",
    );
  });

  it("builds deterministic dependency layers", () => {
    expect(buildAutopilotLayers([
      action("qc", { dependsOn: ["candidate"] }),
      action("compile"),
      action("candidate", { dependsOn: ["compile"] }),
    ])).toEqual([["compile"], ["candidate"], ["qc"]]);
  });

  it("rejects duplicate, missing and cyclic graph structures", () => {
    expect(validateAutopilotActions([
      action("same"),
      action("same"),
    ]).map((item) => item.code)).toContain("AUTO_DUPLICATE_ACTION");

    expect(validateAutopilotActions([
      action("a", { dependsOn: ["missing"] }),
    ]).map((item) => item.code)).toContain("AUTO_MISSING_DEPENDENCY");

    expect(() => buildAutopilotLayers([
      action("a", { dependsOn: ["b"] }),
      action("b", { dependsOn: ["a"] }),
    ])).toThrow(AutopilotPlanError);
  });

  it("requires resource request ids to match stable action ids", () => {
    expect(validateAutopilotActions([
      action("render", { resource: resource("other") }),
    ]).map((item) => item.code)).toContain("AUTO_RESOURCE_ID_MISMATCH");
  });

  it("MANUAL mode never auto-executes ready work", () => {
    const plan = buildAutopilotPlan({
      mode: "MANUAL",
      actions: [action("analyze")],
    });
    expect(plan.autoExecutable).toEqual([]);
    expect(plan.waitingForHuman).toEqual(["analyze"]);
    expect(plan.decisions[0]?.reason).toBe("MANUAL_CONTROL_REQUIRED");
  });

  it("ASSIST mode proposes non-canonical work but gates canonical mutations", () => {
    const plan = buildAutopilotPlan({
      mode: "ASSIST",
      actions: [
        action("analyze"),
        action("commit", { effect: "CANONICAL_MUTATION" }),
      ],
    });
    expect(plan.proposed).toEqual(["analyze"]);
    expect(plan.waitingForHuman).toEqual(["commit"]);
    expect(plan.decisions.find((item) => item.actionId === "commit")?.reason).toBe("CANONICAL_APPROVAL_REQUIRED");
  });

  it("AUTO_SCENE starts safe work but never auto-executes canonical or destructive work", () => {
    const plan = buildAutopilotPlan({
      mode: "AUTO_SCENE",
      actions: [
        action("analyze"),
        action("commit", { effect: "CANONICAL_MUTATION" }),
        action("delete-source", { effect: "DESTRUCTIVE" }),
      ],
    });
    expect(plan.autoExecutable).toEqual(["analyze"]);
    expect(plan.waitingForHuman).toEqual(["commit", "delete-source"]);
  });

  it("requires a validation gate before autonomous candidate generation", () => {
    const missing = buildAutopilotPlan({
      mode: "AUTO_SCENE",
      actions: [action("candidate", { effect: "REBUILDABLE_CANDIDATE", validation: "NONE" })],
    });
    expect(missing.blocked).toEqual(["candidate"]);
    expect(missing.decisions[0]?.reason).toBe("MISSING_VALIDATION_GATE");

    const valid = buildAutopilotPlan({
      mode: "AUTO_SCENE",
      actions: [action("candidate", { effect: "REBUILDABLE_CANDIDATE", validation: "REQUIRED" })],
    });
    expect(valid.autoExecutable).toEqual(["candidate"]);
  });

  it("human locks and critical ambiguity stop AUTO_SCENE", () => {
    const plan = buildAutopilotPlan({
      mode: "AUTO_SCENE",
      actions: [
        action("locked", { humanLocked: true }),
        action("ambiguous", { criticalAmbiguity: true }),
      ],
    });
    expect(plan.waitingForHuman).toEqual(["ambiguous", "locked"]);
    expect(plan.autoExecutable).toEqual([]);
  });

  it("does not pretend an uncompleted dependency has already run", () => {
    const plan = buildAutopilotPlan({
      mode: "AUTO_SCENE",
      actions: [
        action("compile"),
        action("candidate", {
          dependsOn: ["compile"],
          effect: "REBUILDABLE_CANDIDATE",
          validation: "REQUIRED",
        }),
      ],
    });
    expect(plan.autoExecutable).toEqual(["compile"]);
    expect(plan.deferred).toEqual(["candidate"]);
    expect(plan.decisions.find((item) => item.actionId === "candidate")?.reason).toBe("DEPENDENCY_NOT_COMPLETED");
  });

  it("allows downstream automation only when dependencies are explicitly completed", () => {
    const plan = buildAutopilotPlan({
      mode: "AUTO_SCENE",
      completedActionIds: ["compile"],
      actions: [
        action("compile"),
        action("candidate", {
          dependsOn: ["compile"],
          effect: "REBUILDABLE_CANDIDATE",
          validation: "REQUIRED",
        }),
      ],
    });
    expect(plan.autoExecutable).toEqual(["compile", "candidate"]);
  });

  it("requires a resource budget before auto-starting resource-consuming work", () => {
    const plan = buildAutopilotPlan({
      mode: "AUTO_SCENE",
      actions: [action("render", { resource: resource("render") })],
    });
    expect(plan.blocked).toEqual(["render"]);
    expect(plan.decisions[0]?.reason).toBe("RESOURCE_BUDGET_REQUIRED");
  });

  it("uses producer admission to defer busy work and block impossible work", () => {
    const plan = buildAutopilotPlan({
      mode: "AUTO_SCENE",
      resourceBudget: budget({ memoryHardMB: 512, memoryWorkingMB: 256, maxConcurrentJobs: 1 }),
      actions: [
        action("a", { resource: resource("a", { memoryMB: 200 }) }),
        action("b", { resource: resource("b", { memoryMB: 200 }) }),
        action("huge", { resource: resource("huge", { memoryMB: 600 }) }),
      ],
    });
    expect(plan.autoExecutable).toEqual(["a"]);
    expect(plan.deferred).toEqual(["b"]);
    expect(plan.blocked).toEqual(["huge"]);
    expect(plan.decisions.find((item) => item.actionId === "b")?.reason).toBe("RESOURCE_BUSY");
    expect(plan.decisions.find((item) => item.actionId === "huge")?.reason).toBe("RESOURCE_UNAVAILABLE");
  });
});
