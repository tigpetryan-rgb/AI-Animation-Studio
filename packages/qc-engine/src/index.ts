import type { StudioCommand } from "@aistudio/core-events";

export type QCDomain =
  | "STORY"
  | "IDENTITY"
  | "CONTINUITY"
  | "PERFORMANCE"
  | "PHYSICS"
  | "CAMERA_VISIBILITY"
  | "AUDIO"
  | "MEDIA"
  | "RENDER";

export type QCRuleClass = "HARD" | "SOFT";
export type QCSeverity = "INFO" | "WARNING" | "ERROR" | "FATAL";
export type QCDecision = "PASS" | "WARN" | "FAIL";

export interface QCCheck {
  readonly code: string;
  readonly domain: QCDomain;
  readonly ruleClass: QCRuleClass;
  readonly passed: boolean;
  readonly score: number;
  readonly severity: QCSeverity;
  readonly message: string;
  readonly entityIds?: readonly string[];
}

export interface QCPolicy {
  readonly minimumScore: number;
  readonly allowWarnings: boolean;
}

export interface QCReport {
  readonly targetId: string;
  readonly checks: readonly QCCheck[];
  readonly overallScore: number;
  readonly decision: QCDecision;
  readonly hardFailures: readonly string[];
  readonly warnings: readonly string[];
}

export type QCDiagnosticCode =
  | "QC_INVALID_POLICY"
  | "QC_INVALID_CHECK"
  | "QC_NO_CHECKS"
  | "QC_NO_REPAIR_CANDIDATE";

export interface QCDiagnostic {
  readonly code: QCDiagnosticCode;
  readonly message: string;
}

export type RepairScope =
  | "METADATA"
  | "LOCAL_ADJUSTMENT"
  | "PARTIAL_REGENERATION"
  | "FULL_REGENERATION";

export interface RepairCandidate {
  readonly id: string;
  readonly scope: RepairScope;
  readonly commands: readonly StudioCommand[];
  readonly affectedDomains: readonly QCDomain[];
  readonly estimatedCost: number;
  readonly preservesHumanLocks: boolean;
  readonly resolvesCodes: readonly string[];
}

export interface RepairPlan {
  readonly strategy: "MINIMUM_DESTRUCTIVE";
  readonly candidate: RepairCandidate;
}

const SCOPE_RANK: Readonly<Record<RepairScope, number>> = Object.freeze({
  METADATA: 0,
  LOCAL_ADJUSTMENT: 1,
  PARTIAL_REGENERATION: 2,
  FULL_REGENERATION: 3,
});

function isUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validatePolicy(policy: QCPolicy): readonly QCDiagnostic[] {
  if (!isUnitInterval(policy.minimumScore)) {
    return [{ code: "QC_INVALID_POLICY", message: "minimumScore must be between 0 and 1." }];
  }
  return [];
}

export function validateCheck(check: QCCheck): readonly QCDiagnostic[] {
  if (
    check.code.trim().length === 0
    || check.message.trim().length === 0
    || !isUnitInterval(check.score)
  ) {
    return [{ code: "QC_INVALID_CHECK", message: `QC check ${check.code || "<empty>"} is invalid.` }];
  }
  return [];
}

export function evaluateQC(
  targetId: string,
  checks: readonly QCCheck[],
  policy: QCPolicy,
): { readonly report?: QCReport; readonly diagnostics: readonly QCDiagnostic[] } {
  const policyDiagnostics = validatePolicy(policy);
  if (policyDiagnostics.length > 0) return { diagnostics: policyDiagnostics };
  if (checks.length === 0) {
    return { diagnostics: [{ code: "QC_NO_CHECKS", message: "At least one QC check is required." }] };
  }

  const invalid = checks.flatMap((check) => validateCheck(check));
  if (invalid.length > 0) return { diagnostics: invalid };

  const overallScore = checks.reduce((sum, check) => sum + check.score, 0) / checks.length;
  const hardFailures = checks
    .filter((check) => check.ruleClass === "HARD" && !check.passed)
    .map((check) => check.code)
    .sort();
  const warnings = checks
    .filter((check) => !check.passed && check.ruleClass === "SOFT")
    .map((check) => check.code)
    .sort();

  let decision: QCDecision;
  if (hardFailures.length > 0 || overallScore < policy.minimumScore) {
    decision = "FAIL";
  } else if (warnings.length > 0) {
    decision = policy.allowWarnings ? "WARN" : "FAIL";
  } else {
    decision = "PASS";
  }

  return {
    report: Object.freeze({
      targetId,
      checks: Object.freeze([...checks]),
      overallScore,
      decision,
      hardFailures: Object.freeze(hardFailures),
      warnings: Object.freeze(warnings),
    }),
    diagnostics: [],
  };
}

export function canApprove(report: QCReport): boolean {
  return report.decision === "PASS" || report.decision === "WARN";
}

export function selectMinimumDestructiveRepair(
  report: QCReport,
  candidates: readonly RepairCandidate[],
): { readonly plan?: RepairPlan; readonly diagnostics: readonly QCDiagnostic[] } {
  if (report.decision !== "FAIL") return { diagnostics: [] };

  const failedCodes = new Set([...report.hardFailures, ...report.warnings]);
  const eligible = candidates
    .filter((candidate) => candidate.preservesHumanLocks)
    .filter((candidate) => candidate.id.trim().length > 0)
    .filter((candidate) => Number.isFinite(candidate.estimatedCost) && candidate.estimatedCost >= 0)
    .filter((candidate) => candidate.resolvesCodes.some((code) => failedCodes.has(code)))
    .sort((a, b) => {
      const scope = SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope];
      if (scope !== 0) return scope;
      const affected = a.affectedDomains.length - b.affectedDomains.length;
      if (affected !== 0) return affected;
      const cost = a.estimatedCost - b.estimatedCost;
      if (cost !== 0) return cost;
      const commandCount = a.commands.length - b.commands.length;
      if (commandCount !== 0) return commandCount;
      return a.id.localeCompare(b.id);
    });

  const candidate = eligible[0];
  if (candidate === undefined) {
    return {
      diagnostics: [{
        code: "QC_NO_REPAIR_CANDIDATE",
        message: "No repair candidate can resolve the failure while preserving human locks.",
      }],
    };
  }

  return {
    plan: Object.freeze({ strategy: "MINIMUM_DESTRUCTIVE", candidate }),
    diagnostics: [],
  };
}

export function repairEscalationOrder(): readonly RepairScope[] {
  return ["METADATA", "LOCAL_ADJUSTMENT", "PARTIAL_REGENERATION", "FULL_REGENERATION"];
}
