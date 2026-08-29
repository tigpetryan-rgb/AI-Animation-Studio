import {
  buildAutopilotPlan,
  type AutopilotPlan,
  type AutopilotPlanInput,
} from "@aistudio/production-autopilot";
import {
  assessReproducibility,
  type ProductionManifest,
  type ReproducibilityAssessment,
} from "@aistudio/production-manifest";
import { canApprove, type QCReport } from "@aistudio/qc-engine";
import {
  evaluateSecurityRequest,
  type SecurityContext,
  type SecurityDecision,
  type SecurityRequest,
} from "@aistudio/security-policy";

export type ProductionStage =
  | "PLANNED"
  | "BLOCKED"
  | "REHEARSED"
  | "PERFORMANCE_VALID"
  | "READY_FOR_RENDER"
  | "CANDIDATE"
  | "QC"
  | "APPROVED";

export type ProductionGateKind =
  | "STORY"
  | "BLOCKING"
  | "PERFORMANCE"
  | "CONTACT_IK"
  | "PHYSICS"
  | "CAMERA_VISIBILITY"
  | "CONTINUITY";

export type OrchestratorDecisionStatus =
  | "ADVANCE"
  | "WAIT_VALIDATION"
  | "WAIT_HUMAN"
  | "BLOCKED";

export type OrchestratorDiagnosticCode =
  | "ORCH_INVALID_TRANSITION"
  | "ORCH_MISSING_GATE"
  | "ORCH_GATE_FAILED"
  | "ORCH_SECURITY_DENIED"
  | "ORCH_SECURITY_HUMAN_REQUIRED"
  | "ORCH_CANDIDATE_REQUIRED"
  | "ORCH_QC_REQUIRED"
  | "ORCH_QC_FAILED"
  | "ORCH_MANIFEST_REQUIRED"
  | "ORCH_MANIFEST_INCOMPLETE"
  | "ORCH_MANIFEST_INVALID"
  | "ORCH_HUMAN_APPROVAL_REQUIRED"
  | "ORCH_AUTOPILOT_INVALID";

export interface ProductionGateResult {
  readonly kind: ProductionGateKind;
  readonly passed: boolean;
  readonly hard: boolean;
  readonly message: string;
}

export interface SecurityEvaluationInput {
  readonly context: SecurityContext;
  readonly requests: readonly SecurityRequest[];
}

export interface ProductionStepInput {
  readonly currentStage: ProductionStage;
  readonly targetStage: ProductionStage;
  readonly gates?: readonly ProductionGateResult[];
  readonly security?: SecurityEvaluationInput;
  readonly candidateArtifactPresent?: boolean;
  readonly qcReport?: QCReport;
  readonly manifest?: ProductionManifest;
  readonly humanApproved?: boolean;
  readonly autopilot?: AutopilotPlanInput;
}

export interface OrchestratorDiagnostic {
  readonly code: OrchestratorDiagnosticCode;
  readonly message: string;
  readonly gate?: ProductionGateKind;
}

export interface SecurityEvaluation {
  readonly request: SecurityRequest;
  readonly decision: SecurityDecision;
}

export interface ProductionStepDecision {
  readonly status: OrchestratorDecisionStatus;
  readonly currentStage: ProductionStage;
  readonly targetStage: ProductionStage;
  readonly diagnostics: readonly OrchestratorDiagnostic[];
  readonly security: readonly SecurityEvaluation[];
  readonly reproducibility?: ReproducibilityAssessment;
  readonly autopilotPlan?: AutopilotPlan;
}

const STAGES: readonly ProductionStage[] = Object.freeze([
  "PLANNED",
  "BLOCKED",
  "REHEARSED",
  "PERFORMANCE_VALID",
  "READY_FOR_RENDER",
  "CANDIDATE",
  "QC",
  "APPROVED",
]);

function gateList(...values: ProductionGateKind[]): readonly ProductionGateKind[] {
  return Object.freeze(values);
}

const REQUIRED_GATES: Readonly<Partial<Record<ProductionStage, readonly ProductionGateKind[]>>> = Object.freeze({
  BLOCKED: gateList("STORY", "BLOCKING"),
  REHEARSED: gateList("BLOCKING"),
  PERFORMANCE_VALID: gateList("PERFORMANCE", "CONTACT_IK", "PHYSICS"),
  READY_FOR_RENDER: gateList(
    "STORY",
    "BLOCKING",
    "PERFORMANCE",
    "CONTACT_IK",
    "PHYSICS",
    "CAMERA_VISIBILITY",
    "CONTINUITY",
  ),
});

export interface ProductionOrchestratorEvidence {
  readonly source: "DETERMINISTIC_POLICY";
  readonly assumptions: readonly string[];
}

export function productionOrchestratorEvidence(): ProductionOrchestratorEvidence {
  return Object.freeze({
    source: "DETERMINISTIC_POLICY",
    assumptions: Object.freeze([
      "Shot stages advance only through adjacent deterministic lifecycle transitions.",
      "Validation, security, QC, manifest completeness and human approval are independent gates and cannot be inferred from generated pixels.",
      "Autopilot may schedule safe candidate work, but it cannot approve canonical state in v1.",
      "A failed candidate or failed QC report never mutates canonical production state.",
      "Production security requests are evaluated before candidate work and remote capabilities remain governed by the offline security policy.",
    ]),
  });
}

export function nextProductionStage(stage: ProductionStage): ProductionStage | undefined {
  const index = STAGES.indexOf(stage);
  return index >= 0 && index < STAGES.length - 1 ? STAGES[index + 1] : undefined;
}

export function isAdjacentProductionTransition(current: ProductionStage, target: ProductionStage): boolean {
  return nextProductionStage(current) === target;
}

function frozenDiagnostics(values: readonly OrchestratorDiagnostic[]): readonly OrchestratorDiagnostic[] {
  return Object.freeze([...values]);
}

function gateDiagnostics(targetStage: ProductionStage, gates: readonly ProductionGateResult[]): readonly OrchestratorDiagnostic[] {
  const required = REQUIRED_GATES[targetStage] ?? [];
  const byKind = new Map<ProductionGateKind, ProductionGateResult>();
  for (const gate of gates) byKind.set(gate.kind, gate);

  const diagnostics: OrchestratorDiagnostic[] = [];
  for (const kind of required) {
    const gate = byKind.get(kind);
    if (gate === undefined) {
      diagnostics.push({
        code: "ORCH_MISSING_GATE",
        gate: kind,
        message: `Required ${kind} validation gate is missing for ${targetStage}.`,
      });
      continue;
    }
    if (!gate.passed) {
      diagnostics.push({
        code: "ORCH_GATE_FAILED",
        gate: kind,
        message: gate.message.trim().length > 0 ? gate.message : `${kind} validation failed.`,
      });
    }
  }
  return frozenDiagnostics(diagnostics);
}

function decisionStatus(diagnostics: readonly OrchestratorDiagnostic[], gates: readonly ProductionGateResult[]): OrchestratorDecisionStatus {
  const hardGateFailures = new Set(
    gates.filter((gate) => gate.hard && !gate.passed).map((gate) => gate.kind),
  );

  if (diagnostics.some((item) =>
    item.code === "ORCH_INVALID_TRANSITION"
    || item.code === "ORCH_SECURITY_DENIED"
    || item.code === "ORCH_QC_FAILED"
    || item.code === "ORCH_MANIFEST_INVALID"
    || item.code === "ORCH_AUTOPILOT_INVALID"
    || (item.code === "ORCH_GATE_FAILED" && item.gate !== undefined && hardGateFailures.has(item.gate))
  )) return "BLOCKED";

  if (diagnostics.some((item) =>
    item.code === "ORCH_SECURITY_HUMAN_REQUIRED"
    || item.code === "ORCH_HUMAN_APPROVAL_REQUIRED"
  )) return "WAIT_HUMAN";

  if (diagnostics.length > 0) return "WAIT_VALIDATION";
  return "ADVANCE";
}

export function evaluateProductionStep(input: ProductionStepInput): ProductionStepDecision {
  const diagnostics: OrchestratorDiagnostic[] = [];
  const gates = input.gates ?? [];

  if (!isAdjacentProductionTransition(input.currentStage, input.targetStage)) {
    diagnostics.push({
      code: "ORCH_INVALID_TRANSITION",
      message: `Production stage ${input.currentStage} cannot advance directly to ${input.targetStage}.`,
    });
  }

  diagnostics.push(...gateDiagnostics(input.targetStage, gates));

  const security: SecurityEvaluation[] = [];
  if (input.security !== undefined) {
    for (const request of input.security.requests) {
      const decision = evaluateSecurityRequest(request, input.security.context);
      security.push(Object.freeze({ request, decision }));
      if (decision.status === "DENY") {
        diagnostics.push({
          code: "ORCH_SECURITY_DENIED",
          message: `Security denied capability ${request.capability}: ${decision.reason}.`,
        });
      } else if (decision.status === "REQUIRE_HUMAN") {
        diagnostics.push({
          code: "ORCH_SECURITY_HUMAN_REQUIRED",
          message: `Capability ${request.capability} requires human approval: ${decision.reason}.`,
        });
      }
    }
  }

  if (input.targetStage === "QC" && input.candidateArtifactPresent !== true) {
    diagnostics.push({
      code: "ORCH_CANDIDATE_REQUIRED",
      message: "QC requires an explicit candidate artifact; canonical state is not a substitute for a candidate.",
    });
  }

  let reproducibility: ReproducibilityAssessment | undefined;
  if (input.targetStage === "APPROVED") {
    if (input.qcReport === undefined) {
      diagnostics.push({ code: "ORCH_QC_REQUIRED", message: "Approval requires an explicit QC report." });
    } else if (!canApprove(input.qcReport)) {
      diagnostics.push({ code: "ORCH_QC_FAILED", message: "Approval is blocked because QC did not pass." });
    }

    if (input.manifest === undefined) {
      diagnostics.push({
        code: "ORCH_MANIFEST_REQUIRED",
        message: "Approval requires a production manifest with exact dependency identity.",
      });
    } else {
      reproducibility = assessReproducibility(input.manifest);
      if (reproducibility.status === "INVALID") {
        diagnostics.push({ code: "ORCH_MANIFEST_INVALID", message: "Production manifest is invalid." });
      } else if (reproducibility.status === "INCOMPLETE") {
        diagnostics.push({
          code: "ORCH_MANIFEST_INCOMPLETE",
          message: "Production manifest has unresolved dependencies and is not ready for approval.",
        });
      }
    }

    if (input.humanApproved !== true) {
      diagnostics.push({
        code: "ORCH_HUMAN_APPROVAL_REQUIRED",
        message: "Canonical take approval requires an explicit human approval in v1.",
      });
    }
  }

  let autopilotPlan: AutopilotPlan | undefined;
  if (input.autopilot !== undefined) {
    try {
      autopilotPlan = buildAutopilotPlan(input.autopilot);
    } catch (error) {
      diagnostics.push({
        code: "ORCH_AUTOPILOT_INVALID",
        message: error instanceof Error ? error.message : "Autopilot plan is invalid.",
      });
    }
  }

  const status = decisionStatus(diagnostics, gates);
  const base = {
    status,
    currentStage: input.currentStage,
    targetStage: input.targetStage,
    diagnostics: frozenDiagnostics(diagnostics),
    security: Object.freeze([...security]),
  };

  return Object.freeze({
    ...base,
    ...(reproducibility === undefined ? {} : { reproducibility }),
    ...(autopilotPlan === undefined ? {} : { autopilotPlan }),
  });
}
