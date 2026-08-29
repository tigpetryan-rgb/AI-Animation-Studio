import { describe, expect, it } from "vitest";
import type { StudioCommand } from "@aistudio/core-events";
import {
  canApprove,
  evaluateQC,
  repairEscalationOrder,
  selectMinimumDestructiveRepair,
  validateCheck,
  validatePolicy,
  type QCCheck,
  type QCPolicy,
  type RepairCandidate,
} from "./index.js";

const policy: QCPolicy = { minimumScore: 0.8, allowWarnings: true };

function check(overrides: Partial<QCCheck> = {}): QCCheck {
  return {
    code: "CONT-001",
    domain: "CONTINUITY",
    ruleClass: "SOFT",
    passed: true,
    score: 1,
    severity: "INFO",
    message: "Continuity check passed.",
    ...overrides,
  };
}

const noopCommand = {
  type: "MOVE_ACTOR",
  actorId: "char_1",
  to: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  },
  meta: { source: "system" },
} as unknown as StudioCommand;

function repair(overrides: Partial<RepairCandidate> = {}): RepairCandidate {
  return {
    id: "local-fix",
    scope: "LOCAL_ADJUSTMENT",
    commands: [noopCommand],
    affectedDomains: ["CONTINUITY"],
    estimatedCost: 1,
    preservesHumanLocks: true,
    resolvesCodes: ["CONT-001"],
    ...overrides,
  };
}

describe("QC and self-healing policy", () => {
  it("rejects invalid score policy and invalid checks", () => {
    expect(validatePolicy({ minimumScore: 1.1, allowWarnings: true })[0]?.code).toBe("QC_INVALID_POLICY");
    expect(validateCheck(check({ score: -0.1 }))[0]?.code).toBe("QC_INVALID_CHECK");
  });

  it("hard-rule failure overrides a high aggregate score", () => {
    const result = evaluateQC("shot_1", [
      check({ code: "IDENTITY-LOCK", domain: "IDENTITY", ruleClass: "HARD", passed: false, score: 0.99, severity: "FATAL" }),
      check({ code: "PERF-OK" }),
    ], policy);
    expect(result.report?.decision).toBe("FAIL");
    expect(result.report?.hardFailures).toEqual(["IDENTITY-LOCK"]);
    expect(canApprove(result.report!)).toBe(false);
  });

  it("allows soft warning only when policy allows warnings", () => {
    const warning = check({ passed: false, score: 0.9, severity: "WARNING" });
    expect(evaluateQC("shot_1", [warning], policy).report?.decision).toBe("WARN");
    expect(evaluateQC("shot_1", [warning], { ...policy, allowWarnings: false }).report?.decision).toBe("FAIL");
  });

  it("fails when aggregate score is below threshold", () => {
    const result = evaluateQC("shot_1", [check({ score: 0.4 }), check({ score: 0.6 })], policy);
    expect(result.report?.decision).toBe("FAIL");
  });

  it("selects the least destructive repair before cheaper but broader regeneration", () => {
    const report = evaluateQC("shot_1", [check({ passed: false, score: 0.2 })], policy).report!;
    const result = selectMinimumDestructiveRepair(report, [
      repair({ id: "full", scope: "FULL_REGENERATION", estimatedCost: 0.1 }),
      repair({ id: "metadata", scope: "METADATA", estimatedCost: 100 }),
      repair({ id: "local", scope: "LOCAL_ADJUSTMENT", estimatedCost: 0.2 }),
    ]);
    expect(result.plan?.candidate.id).toBe("metadata");
  });

  it("never chooses a repair that violates a human lock", () => {
    const report = evaluateQC("shot_1", [check({ passed: false, score: 0.2 })], policy).report!;
    const result = selectMinimumDestructiveRepair(report, [
      repair({ id: "locked", scope: "METADATA", preservesHumanLocks: false }),
      repair({ id: "safe", scope: "LOCAL_ADJUSTMENT", preservesHumanLocks: true }),
    ]);
    expect(result.plan?.candidate.id).toBe("safe");
  });

  it("uses deterministic tie-breaking", () => {
    const report = evaluateQC("shot_1", [check({ passed: false, score: 0.2 })], policy).report!;
    const result = selectMinimumDestructiveRepair(report, [
      repair({ id: "z-fix" }),
      repair({ id: "a-fix" }),
    ]);
    expect(result.plan?.candidate.id).toBe("a-fix");
  });

  it("reports when no safe repair candidate exists", () => {
    const report = evaluateQC("shot_1", [check({ passed: false, score: 0.2 })], policy).report!;
    const result = selectMinimumDestructiveRepair(report, [repair({ preservesHumanLocks: false })]);
    expect(result.plan).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("QC_NO_REPAIR_CANDIDATE");
  });

  it("freezes the minimum-destructive escalation order", () => {
    expect(repairEscalationOrder()).toEqual([
      "METADATA",
      "LOCAL_ADJUSTMENT",
      "PARTIAL_REGENERATION",
      "FULL_REGENERATION",
    ]);
  });
});
