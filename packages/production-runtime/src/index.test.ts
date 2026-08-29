import { describe, expect, it } from "vitest";
import { createStudioProject } from "@aistudio/core-project";
import { asCharacterId, asProjectId } from "@aistudio/core-types";
import type { ProductionManifest } from "@aistudio/production-manifest";
import type { ProductionGateResult } from "@aistudio/production-orchestrator";
import type { QCReport } from "@aistudio/qc-engine";
import {
  MemoryWorkflowCache,
  MutableCancellationToken,
  type NodeExecutor,
  type WorkflowGraph,
} from "@aistudio/workflow-engine";
import {
  advanceShotStage,
  approveShot,
  createProductionRuntime,
  enterShotQC,
  productionRuntimeEvidence,
  runCandidateWorkflow,
  type ProductionRuntime,
  type RuntimeResult,
} from "./index.js";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const SHOT_ID = "shot-1";

function project() {
  return createStudioProject({ projectId: asProjectId("project-1"), name: "Film" });
}

function gate(kind: ProductionGateResult["kind"]): ProductionGateResult {
  return { kind, passed: true, hard: true, message: `${kind} valid` };
}

function blockingGates(): readonly ProductionGateResult[] {
  return [gate("STORY"), gate("BLOCKING")];
}

function performanceGates(): readonly ProductionGateResult[] {
  return [gate("PERFORMANCE"), gate("CONTACT_IK"), gate("PHYSICS")];
}

function renderReadyGates(): readonly ProductionGateResult[] {
  return [
    gate("STORY"),
    gate("BLOCKING"),
    gate("PERFORMANCE"),
    gate("CONTACT_IK"),
    gate("PHYSICS"),
    gate("CAMERA_VISIBILITY"),
    gate("CONTINUITY"),
  ];
}

function accepted(result: RuntimeResult): ProductionRuntime {
  if (!result.accepted) {
    throw new Error(result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"));
  }
  return result.runtime;
}

function readyRuntime(): ProductionRuntime {
  let runtime = createProductionRuntime(project(), [SHOT_ID]);
  runtime = accepted(advanceShotStage(runtime, SHOT_ID, "BLOCKED", { gates: blockingGates() }));
  runtime = accepted(advanceShotStage(runtime, SHOT_ID, "REHEARSED", { gates: [gate("BLOCKING")] }));
  runtime = accepted(advanceShotStage(runtime, SHOT_ID, "PERFORMANCE_VALID", { gates: performanceGates() }));
  runtime = accepted(advanceShotStage(runtime, SHOT_ID, "READY_FOR_RENDER", { gates: renderReadyGates() }));
  return runtime;
}

const graph: WorkflowGraph = {
  nodes: [{
    id: "render",
    type: "RENDER",
    version: 1,
    dependsOn: [],
    params: {},
  }],
};

function renderer(counter?: { calls: number }): NodeExecutor {
  return {
    type: "RENDER",
    async execute() {
      if (counter !== undefined) counter.calls += 1;
      return { value: { path: "candidate" }, outputHash: "workflow-output-hash" };
    },
  };
}

async function candidateRuntime(): Promise<ProductionRuntime> {
  const runtime = readyRuntime();
  const result = await runCandidateWorkflow(runtime, SHOT_ID, {
    graph,
    executors: new Map([["RENDER", renderer()]]),
    cache: new MemoryWorkflowCache(),
    engineVersion: "workflow-1",
    finalNodeId: "render",
    resolveCandidate: () => ({ takeId: "take-1", artifactSha256: HASH }),
  });
  return accepted(result);
}

function passingQC(targetId = "take-1"): QCReport {
  return {
    targetId,
    checks: [{
      code: "CONT-OK",
      domain: "CONTINUITY",
      ruleClass: "HARD",
      passed: true,
      score: 1,
      severity: "INFO",
      message: "ok",
    }],
    overallScore: 1,
    decision: "PASS",
    hardFailures: [],
    warnings: [],
  };
}

function failingQC(targetId = "take-1"): QCReport {
  return {
    ...passingQC(targetId),
    overallScore: 0,
    decision: "FAIL",
    hardFailures: ["CONT-FAIL"],
  };
}

function manifest(
  revision: number,
  artifactSha256 = HASH,
  takeId = "take-1",
): ProductionManifest {
  return {
    format: "aistudio-production-manifest",
    formatVersion: 1,
    projectId: "project-1",
    projectRevision: revision,
    projectStateSha256: HASH,
    storyIrVersion: "story-1",
    storyIrSha256: HASH,
    sceneIds: ["scene-1"],
    shotIds: [SHOT_ID],
    assets: [],
    models: [],
    engines: [{ id: "render-engine", version: "1.0.0" }],
    recipes: [],
    approvedTakes: [{
      sceneId: "scene-1",
      shotId: SHOT_ID,
      takeId,
      artifactSha256,
    }],
    unresolved: [],
    evidence: {
      createdAt: "2026-08-29T00:00:00Z",
      studioVersion: "0.0.0",
    },
  };
}

async function qcRuntime(qc: QCReport = passingQC()): Promise<ProductionRuntime> {
  const candidate = await candidateRuntime();
  return accepted(enterShotQC(candidate, SHOT_ID, qc));
}

describe("transactional production runtime", () => {
  it("documents candidate isolation and transactional canonical commit", () => {
    const evidence = productionRuntimeEvidence();
    expect(evidence).toContain(
      "Candidate workflow results are stored as candidate evidence and never mutate canonical project state by themselves.",
    );
    expect(evidence).toContain(
      "Canonical commands are validated and applied transactionally only after orchestrator approval; any rejected command leaves the original runtime unchanged.",
    );
  });

  it("rejects empty and duplicate shot registration", () => {
    expect(() => createProductionRuntime(project(), [""])).toThrow(/RUNTIME_EMPTY_SHOT_ID/);
    expect(() => createProductionRuntime(project(), [SHOT_ID, SHOT_ID])).toThrow(/RUNTIME_DUPLICATE_SHOT/);
  });

  it("cannot skip deterministic lifecycle stages", () => {
    const runtime = createProductionRuntime(project(), [SHOT_ID]);
    const result = advanceShotStage(runtime, SHOT_ID, "READY_FOR_RENDER", { gates: renderReadyGates() });
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.diagnostics.map((item) => item.code)).toContain("RUNTIME_ORCHESTRATION_BLOCKED");
    expect(result.orchestration?.diagnostics.map((item) => item.code)).toContain("ORCH_INVALID_TRANSITION");
    expect(result.runtime).toBe(runtime);
    expect(runtime.shots[SHOT_ID]?.stage).toBe("PLANNED");
  });

  it("requires every READY_FOR_RENDER validation gate", () => {
    let runtime = createProductionRuntime(project(), [SHOT_ID]);
    runtime = accepted(advanceShotStage(runtime, SHOT_ID, "BLOCKED", { gates: blockingGates() }));
    runtime = accepted(advanceShotStage(runtime, SHOT_ID, "REHEARSED", { gates: [gate("BLOCKING")] }));
    runtime = accepted(advanceShotStage(runtime, SHOT_ID, "PERFORMANCE_VALID", { gates: performanceGates() }));

    const result = advanceShotStage(runtime, SHOT_ID, "READY_FOR_RENDER", {
      gates: renderReadyGates().filter((item) => item.kind !== "CONTINUITY"),
    });
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.orchestration?.status).toBe("WAIT_VALIDATION");
    expect(result.orchestration?.diagnostics.map((item) => item.code)).toContain("ORCH_MISSING_GATE");
    expect(result.runtime.shots[SHOT_ID]?.stage).toBe("PERFORMANCE_VALID");
  });

  it("creates a candidate without mutating canonical project state", async () => {
    const runtime = readyRuntime();
    const beforeRevision = runtime.project.state.revision;
    const result = await runCandidateWorkflow(runtime, SHOT_ID, {
      graph,
      executors: new Map([["RENDER", renderer()]]),
      cache: new MemoryWorkflowCache(),
      engineVersion: "workflow-1",
      finalNodeId: "render",
      resolveCandidate: () => ({ takeId: "take-1", artifactSha256: HASH }),
    });

    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.runtime.shots[SHOT_ID]?.stage).toBe("CANDIDATE");
    expect(result.runtime.shots[SHOT_ID]?.candidate?.takeId).toBe("take-1");
    expect(result.runtime.project.state.revision).toBe(beforeRevision);
    expect(result.runtime.project).toBe(runtime.project);
    expect(result.workflowReport?.status).toBe("completed");
  });

  it("blocks production network use before executing candidate workflow", async () => {
    const runtime = readyRuntime();
    const counter = { calls: 0 };
    const result = await runCandidateWorkflow(runtime, SHOT_ID, {
      graph,
      executors: new Map([["RENDER", renderer(counter)]]),
      cache: new MemoryWorkflowCache(),
      engineVersion: "workflow-1",
      finalNodeId: "render",
      resolveCandidate: () => ({ takeId: "take-1", artifactSha256: HASH }),
      security: {
        context: { phase: "PRODUCTION", pluginTrust: [] },
        requests: [{
          capability: "OUTBOUND_NETWORK",
          userInitiated: false,
          trustedSource: false,
        }],
      },
    });

    expect(result.accepted).toBe(false);
    expect(counter.calls).toBe(0);
    if (result.accepted) return;
    expect(result.orchestration?.status).toBe("BLOCKED");
    expect(result.runtime).toBe(runtime);
    expect(runtime.shots[SHOT_ID]?.stage).toBe("READY_FOR_RENDER");
  });

  it("leaves runtime unchanged when candidate workflow is cancelled", async () => {
    const runtime = readyRuntime();
    const cancellation = new MutableCancellationToken();
    cancellation.cancel();
    const result = await runCandidateWorkflow(runtime, SHOT_ID, {
      graph,
      executors: new Map([["RENDER", renderer()]]),
      cache: new MemoryWorkflowCache(),
      engineVersion: "workflow-1",
      finalNodeId: "render",
      resolveCandidate: () => ({ takeId: "take-1", artifactSha256: HASH }),
      cancellation,
    });

    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.diagnostics.map((item) => item.code)).toContain("RUNTIME_WORKFLOW_CANCELLED");
    expect(result.runtime).toBe(runtime);
    expect(result.runtime.shots[SHOT_ID]?.candidate).toBeUndefined();
  });

  it("rejects malformed candidate artifact identity without state mutation", async () => {
    const runtime = readyRuntime();
    const result = await runCandidateWorkflow(runtime, SHOT_ID, {
      graph,
      executors: new Map([["RENDER", renderer()]]),
      cache: new MemoryWorkflowCache(),
      engineVersion: "workflow-1",
      finalNodeId: "render",
      resolveCandidate: () => ({ takeId: "take-1", artifactSha256: "not-a-hash" }),
    });

    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.diagnostics.map((item) => item.code)).toContain("RUNTIME_INVALID_CANDIDATE");
    expect(result.runtime).toBe(runtime);
  });

  it("binds QC to the exact candidate take", async () => {
    const runtime = await candidateRuntime();
    const result = enterShotQC(runtime, SHOT_ID, passingQC("take-other"));
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.diagnostics.map((item) => item.code)).toContain("RUNTIME_QC_TARGET_MISMATCH");
    expect(result.runtime.shots[SHOT_ID]?.stage).toBe("CANDIDATE");
    expect(result.runtime.shots[SHOT_ID]?.qcReport).toBeUndefined();
  });

  it("blocks approval when QC fails", async () => {
    const runtime = await qcRuntime(failingQC());
    const result = approveShot(runtime, SHOT_ID, {
      manifest: manifest(runtime.project.state.revision),
      humanApproved: true,
      commands: [],
    });
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.orchestration?.diagnostics.map((item) => item.code)).toContain("ORCH_QC_FAILED");
    expect(result.runtime.shots[SHOT_ID]?.stage).toBe("QC");
  });

  it("blocks approval for stale canonical revision", async () => {
    const runtime = await qcRuntime();
    const result = approveShot(runtime, SHOT_ID, {
      manifest: manifest(runtime.project.state.revision + 1),
      humanApproved: true,
      commands: [],
    });
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.diagnostics.map((item) => item.code)).toContain("RUNTIME_MANIFEST_REVISION_MISMATCH");
    expect(result.runtime).toBe(runtime);
  });

  it("blocks approval when manifest take hash does not match candidate", async () => {
    const runtime = await qcRuntime();
    const result = approveShot(runtime, SHOT_ID, {
      manifest: manifest(runtime.project.state.revision, OTHER_HASH),
      humanApproved: true,
      commands: [],
    });
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.diagnostics.map((item) => item.code)).toContain("RUNTIME_MANIFEST_TAKE_MISMATCH");
    expect(result.runtime).toBe(runtime);
  });

  it("preserves the explicit human approval gate", async () => {
    const runtime = await qcRuntime();
    const result = approveShot(runtime, SHOT_ID, {
      manifest: manifest(runtime.project.state.revision),
      humanApproved: false,
      commands: [],
    });
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.orchestration?.status).toBe("WAIT_HUMAN");
    expect(result.runtime.shots[SHOT_ID]?.stage).toBe("QC");
  });

  it("advances to APPROVED when QC, manifest and human approval all pass", async () => {
    const runtime = await qcRuntime();
    const result = approveShot(runtime, SHOT_ID, {
      manifest: manifest(runtime.project.state.revision),
      humanApproved: true,
      commands: [],
    });
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.runtime.shots[SHOT_ID]?.stage).toBe("APPROVED");
    expect(result.runtime.shots[SHOT_ID]?.approvedTake?.artifactSha256).toBe(HASH);
    expect(result.runtime.project.state.revision).toBe(runtime.project.state.revision);
    expect(result.runtime.journal.at(-1)?.projectRevisionBefore).toBe(runtime.project.state.revision);
    expect(result.runtime.journal.at(-1)?.projectRevisionAfter).toBe(runtime.project.state.revision);
  });

  it("rolls back the entire canonical commit when any approved command is rejected", async () => {
    const runtime = await qcRuntime();
    const result = approveShot(runtime, SHOT_ID, {
      manifest: manifest(runtime.project.state.revision),
      humanApproved: true,
      commands: [{
        type: "MOVE_ACTOR",
        actorId: asCharacterId("missing-actor"),
        to: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          scale: { x: 1, y: 1, z: 1 },
        },
        meta: { source: "ai" },
      }],
    });

    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(result.diagnostics.map((item) => item.code)).toContain("RUNTIME_CANONICAL_COMMIT_REJECTED");
    expect(result.diagnostics[0]?.commandDiagnostics?.map((item) => item.code)).toContain("CMD_ACTOR_NOT_FOUND");
    expect(result.runtime).toBe(runtime);
    expect(result.runtime.project.state.revision).toBe(runtime.project.state.revision);
    expect(result.runtime.shots[SHOT_ID]?.stage).toBe("QC");
  });
});
