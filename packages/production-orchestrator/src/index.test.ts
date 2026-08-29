import { describe, expect, it } from "vitest";
import type { ProductionManifest } from "@aistudio/production-manifest";
import type { QCReport } from "@aistudio/qc-engine";
import {
  evaluateProductionStep,
  isAdjacentProductionTransition,
  nextProductionStage,
  productionOrchestratorEvidence,
  type ProductionGateResult,
} from "./index.js";

const HASH = "a".repeat(64);

function gates(): readonly ProductionGateResult[] {
  return [
    { kind: "STORY", passed: true, hard: true, message: "story valid" },
    { kind: "BLOCKING", passed: true, hard: true, message: "blocking valid" },
    { kind: "PERFORMANCE", passed: true, hard: true, message: "performance valid" },
    { kind: "CONTACT_IK", passed: true, hard: true, message: "contact valid" },
    { kind: "PHYSICS", passed: true, hard: true, message: "physics valid" },
    { kind: "CAMERA_VISIBILITY", passed: true, hard: true, message: "camera valid" },
    { kind: "CONTINUITY", passed: true, hard: true, message: "continuity valid" },
  ];
}

function passingQC(): QCReport {
  return {
    targetId: "take-1",
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

function failingQC(): QCReport {
  return {
    ...passingQC(),
    overallScore: 0,
    decision: "FAIL",
    hardFailures: ["CONT-FAIL"],
  };
}

function manifest(unresolved: ProductionManifest["unresolved"] = []): ProductionManifest {
  return {
    format: "aistudio-production-manifest",
    formatVersion: 1,
    projectId: "project-1",
    projectRevision: 7,
    projectStateSha256: HASH,
    storyIrVersion: "story-3",
    storyIrSha256: HASH,
    sceneIds: ["scene-1"],
    shotIds: ["shot-1"],
    assets: [],
    models: [],
    engines: [{ id: "render-engine", version: "1.0.0" }],
    recipes: [],
    approvedTakes: [{
      sceneId: "scene-1",
      shotId: "shot-1",
      takeId: "take-1",
      artifactSha256: HASH,
    }],
    unresolved,
    evidence: {
      createdAt: "2026-08-29T00:00:00Z",
      studioVersion: "0.0.0",
    },
  };
}

describe("production orchestrator", () => {
  it("keeps the production law explicit", () => {
    const evidence = productionOrchestratorEvidence();
    expect(evidence.source).toBe("DETERMINISTIC_POLICY");
    expect(evidence.assumptions).toContain(
      "Autopilot may schedule safe candidate work, but it cannot approve canonical state in v1.",
    );
    expect(evidence.assumptions).toContain(
      "A failed candidate or failed QC report never mutates canonical production state.",
    );
  });

  it("advances only through adjacent lifecycle stages", () => {
    expect(nextProductionStage("PLANNED")).toBe("BLOCKED");
    expect(nextProductionStage("QC")).toBe("APPROVED");
    expect(nextProductionStage("APPROVED")).toBeUndefined();
    expect(isAdjacentProductionTransition("READY_FOR_RENDER", "CANDIDATE")).toBe(true);
    expect(isAdjacentProductionTransition("PLANNED", "READY_FOR_RENDER")).toBe(false);

    const decision = evaluateProductionStep({
      currentStage: "PLANNED",
      targetStage: "READY_FOR_RENDER",
      gates: gates(),
    });
    expect(decision.status).toBe("BLOCKED");
    expect(decision.diagnostics.map((item) => item.code)).toContain("ORCH_INVALID_TRANSITION");
  });

  it("requires all READY_FOR_RENDER validation gates", () => {
    const missing = evaluateProductionStep({
      currentStage: "PERFORMANCE_VALID",
      targetStage: "READY_FOR_RENDER",
      gates: gates().filter((gate) => gate.kind !== "CONTINUITY"),
    });
    expect(missing.status).toBe("WAIT_VALIDATION");
    expect(missing.diagnostics.map((item) => item.code)).toContain("ORCH_MISSING_GATE");

    const failed = evaluateProductionStep({
      currentStage: "PERFORMANCE_VALID",
      targetStage: "READY_FOR_RENDER",
      gates: gates().map((gate) => gate.kind === "PHYSICS" ? { ...gate, passed: false } : gate),
    });
    expect(failed.status).toBe("BLOCKED");
    expect(failed.diagnostics.map((item) => item.code)).toContain("ORCH_GATE_FAILED");
  });

  it("evaluates production security before candidate work", () => {
    const decision = evaluateProductionStep({
      currentStage: "READY_FOR_RENDER",
      targetStage: "CANDIDATE",
      security: {
        context: { phase: "PRODUCTION", pluginTrust: [] },
        requests: [{
          capability: "OUTBOUND_NETWORK",
          userInitiated: false,
          trustedSource: false,
        }],
      },
    });
    expect(decision.status).toBe("BLOCKED");
    expect(decision.security[0]?.decision.reason).toBe("PRODUCTION_NETWORK_FORBIDDEN");
    expect(decision.diagnostics.map((item) => item.code)).toContain("ORCH_SECURITY_DENIED");
  });

  it("preserves human gates required by the security layer", () => {
    const decision = evaluateProductionStep({
      currentStage: "READY_FOR_RENDER",
      targetStage: "CANDIDATE",
      security: {
        context: { phase: "PRODUCTION", pluginTrust: [] },
        requests: [{
          capability: "USER_FILE_IMPORT",
          userInitiated: false,
          trustedSource: true,
        }],
      },
    });
    expect(decision.status).toBe("WAIT_HUMAN");
    expect(decision.diagnostics.map((item) => item.code)).toContain("ORCH_SECURITY_HUMAN_REQUIRED");
  });

  it("requires an explicit candidate before entering QC", () => {
    const missing = evaluateProductionStep({
      currentStage: "CANDIDATE",
      targetStage: "QC",
      candidateArtifactPresent: false,
    });
    expect(missing.status).toBe("WAIT_VALIDATION");
    expect(missing.diagnostics.map((item) => item.code)).toContain("ORCH_CANDIDATE_REQUIRED");

    expect(evaluateProductionStep({
      currentStage: "CANDIDATE",
      targetStage: "QC",
      candidateArtifactPresent: true,
    }).status).toBe("ADVANCE");
  });

  it("blocks canonical approval when QC fails", () => {
    const decision = evaluateProductionStep({
      currentStage: "QC",
      targetStage: "APPROVED",
      qcReport: failingQC(),
      manifest: manifest(),
      humanApproved: true,
    });
    expect(decision.status).toBe("BLOCKED");
    expect(decision.diagnostics.map((item) => item.code)).toContain("ORCH_QC_FAILED");
  });

  it("does not approve while manifest dependencies are unresolved", () => {
    const decision = evaluateProductionStep({
      currentStage: "QC",
      targetStage: "APPROVED",
      qcReport: passingQC(),
      manifest: manifest([{ kind: "MODEL", id: "vision@1", reason: "model file missing" }]),
      humanApproved: true,
    });
    expect(decision.status).toBe("WAIT_VALIDATION");
    expect(decision.reproducibility?.status).toBe("INCOMPLETE");
    expect(decision.diagnostics.map((item) => item.code)).toContain("ORCH_MANIFEST_INCOMPLETE");
  });

  it("requires human approval even when QC and manifest are ready", () => {
    const decision = evaluateProductionStep({
      currentStage: "QC",
      targetStage: "APPROVED",
      qcReport: passingQC(),
      manifest: manifest(),
      humanApproved: false,
    });
    expect(decision.status).toBe("WAIT_HUMAN");
    expect(decision.diagnostics.map((item) => item.code)).toContain("ORCH_HUMAN_APPROVAL_REQUIRED");
  });

  it("advances to APPROVED only when QC, manifest and human approval all pass", () => {
    const decision = evaluateProductionStep({
      currentStage: "QC",
      targetStage: "APPROVED",
      qcReport: passingQC(),
      manifest: manifest(),
      humanApproved: true,
    });
    expect(decision.status).toBe("ADVANCE");
    expect(decision.reproducibility?.status).toBe("READY");
    expect(decision.diagnostics).toEqual([]);
  });

  it("integrates autopilot without letting it bypass canonical approval", () => {
    const decision = evaluateProductionStep({
      currentStage: "QC",
      targetStage: "APPROVED",
      qcReport: passingQC(),
      manifest: manifest(),
      humanApproved: false,
      autopilot: {
        mode: "AUTO_SCENE",
        actions: [{
          id: "approve-take",
          dependsOn: [],
          effect: "CANONICAL_MUTATION",
          validation: "REQUIRED",
          humanLocked: false,
          criticalAmbiguity: false,
        }],
      },
    });
    expect(decision.status).toBe("WAIT_HUMAN");
    expect(decision.autopilotPlan?.autoExecutable).toEqual([]);
    expect(decision.autopilotPlan?.waitingForHuman).toEqual(["approve-take"]);
  });
});
