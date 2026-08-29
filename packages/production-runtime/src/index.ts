import type { Diagnostic, StudioCommand } from "@aistudio/core-events";
import {
  dispatchProjectCommand,
  type StudioProject,
} from "@aistudio/core-project";
import type { ProductionManifest } from "@aistudio/production-manifest";
import {
  evaluateProductionStep,
  type ProductionGateResult,
  type ProductionStage,
  type ProductionStepDecision,
  type SecurityEvaluationInput,
} from "@aistudio/production-orchestrator";
import type { AutopilotPlanInput } from "@aistudio/production-autopilot";
import type { QCReport } from "@aistudio/qc-engine";
import {
  executeWorkflow,
  type CancellationToken,
  type NodeExecutor,
  type WorkflowCache,
  type WorkflowExecutionReport,
  type WorkflowGraph,
  type WorkflowNodeResult,
} from "@aistudio/workflow-engine";

export type RuntimeDiagnosticCode =
  | "RUNTIME_DUPLICATE_SHOT"
  | "RUNTIME_EMPTY_SHOT_ID"
  | "RUNTIME_SHOT_NOT_FOUND"
  | "RUNTIME_STAGE_MISMATCH"
  | "RUNTIME_ORCHESTRATION_BLOCKED"
  | "RUNTIME_WORKFLOW_FAILED"
  | "RUNTIME_WORKFLOW_CANCELLED"
  | "RUNTIME_FINAL_RESULT_MISSING"
  | "RUNTIME_INVALID_CANDIDATE"
  | "RUNTIME_CANDIDATE_MISSING"
  | "RUNTIME_QC_TARGET_MISMATCH"
  | "RUNTIME_MANIFEST_REVISION_MISMATCH"
  | "RUNTIME_MANIFEST_TAKE_MISMATCH"
  | "RUNTIME_CANONICAL_COMMIT_REJECTED";

export interface RuntimeDiagnostic {
  readonly code: RuntimeDiagnosticCode;
  readonly message: string;
  readonly shotId?: string;
  readonly commandDiagnostics?: readonly Diagnostic[];
}

export interface CandidateArtifactIdentity {
  readonly takeId: string;
  readonly artifactSha256: string;
}

export interface CandidateArtifact extends CandidateArtifactIdentity {
  readonly finalNodeId: string;
  readonly workflowOutputHash: string;
}

export interface ShotRuntimeState {
  readonly shotId: string;
  readonly stage: ProductionStage;
  readonly candidate?: CandidateArtifact;
  readonly qcReport?: QCReport;
  readonly approvedTake?: CandidateArtifact;
}

export interface RuntimeTransition {
  readonly sequence: number;
  readonly shotId: string;
  readonly from: ProductionStage;
  readonly to: ProductionStage;
  readonly projectRevisionBefore: number;
  readonly projectRevisionAfter: number;
}

export interface ProductionRuntime {
  readonly project: StudioProject;
  readonly shots: Readonly<Record<string, ShotRuntimeState>>;
  readonly journal: readonly RuntimeTransition[];
}

export interface StageAdvanceInput {
  readonly gates?: readonly ProductionGateResult[];
  readonly security?: SecurityEvaluationInput;
  readonly autopilot?: AutopilotPlanInput;
}

export type CandidateResolver = (result: WorkflowNodeResult) => CandidateArtifactIdentity;

export interface CandidateWorkflowInput extends StageAdvanceInput {
  readonly graph: WorkflowGraph;
  readonly executors: ReadonlyMap<string, NodeExecutor>;
  readonly cache: WorkflowCache;
  readonly engineVersion: string;
  readonly finalNodeId: string;
  readonly resolveCandidate: CandidateResolver;
  readonly cancellation?: CancellationToken;
}

export interface ApprovalInput {
  readonly manifest: ProductionManifest;
  readonly humanApproved: boolean;
  readonly commands: readonly StudioCommand[];
}

export interface RuntimeAccepted {
  readonly accepted: true;
  readonly runtime: ProductionRuntime;
  readonly orchestration?: ProductionStepDecision;
  readonly workflowReport?: WorkflowExecutionReport;
}

export interface RuntimeRejected {
  readonly accepted: false;
  readonly runtime: ProductionRuntime;
  readonly diagnostics: readonly RuntimeDiagnostic[];
  readonly orchestration?: ProductionStepDecision;
  readonly workflowReport?: WorkflowExecutionReport;
}

export type RuntimeResult = RuntimeAccepted | RuntimeRejected;

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function freezeDiagnostics(values: readonly RuntimeDiagnostic[]): readonly RuntimeDiagnostic[] {
  return Object.freeze([...values]);
}

function getShot(runtime: ProductionRuntime, shotId: string): ShotRuntimeState | undefined {
  return runtime.shots[shotId];
}

function replaceShot(runtime: ProductionRuntime, shot: ShotRuntimeState): ProductionRuntime {
  return Object.freeze({
    ...runtime,
    shots: Object.freeze({ ...runtime.shots, [shot.shotId]: Object.freeze(shot) }),
  });
}

function appendTransition(
  runtime: ProductionRuntime,
  shotId: string,
  from: ProductionStage,
  to: ProductionStage,
  projectRevisionBefore: number,
  projectRevisionAfter: number,
): ProductionRuntime {
  const transition: RuntimeTransition = Object.freeze({
    sequence: runtime.journal.length + 1,
    shotId,
    from,
    to,
    projectRevisionBefore,
    projectRevisionAfter,
  });
  return Object.freeze({ ...runtime, journal: Object.freeze([...runtime.journal, transition]) });
}

function runtimeRejected(
  runtime: ProductionRuntime,
  diagnostics: readonly RuntimeDiagnostic[],
  orchestration?: ProductionStepDecision,
  workflowReport?: WorkflowExecutionReport,
): RuntimeRejected {
  return Object.freeze({
    accepted: false,
    runtime,
    diagnostics: freezeDiagnostics(diagnostics),
    ...(orchestration === undefined ? {} : { orchestration }),
    ...(workflowReport === undefined ? {} : { workflowReport }),
  });
}

function runtimeAccepted(
  runtime: ProductionRuntime,
  orchestration?: ProductionStepDecision,
  workflowReport?: WorkflowExecutionReport,
): RuntimeAccepted {
  return Object.freeze({
    accepted: true,
    runtime,
    ...(orchestration === undefined ? {} : { orchestration }),
    ...(workflowReport === undefined ? {} : { workflowReport }),
  });
}

function orchestrationInput(
  currentStage: ProductionStage,
  targetStage: ProductionStage,
  input: StageAdvanceInput,
): Parameters<typeof evaluateProductionStep>[0] {
  return {
    currentStage,
    targetStage,
    ...(input.gates === undefined ? {} : { gates: input.gates }),
    ...(input.security === undefined ? {} : { security: input.security }),
    ...(input.autopilot === undefined ? {} : { autopilot: input.autopilot }),
  };
}

function orchestrationFailure(
  runtime: ProductionRuntime,
  shotId: string,
  decision: ProductionStepDecision,
): RuntimeRejected {
  return runtimeRejected(runtime, [{
    code: "RUNTIME_ORCHESTRATION_BLOCKED",
    shotId,
    message: `Production orchestrator returned ${decision.status} for ${decision.currentStage} → ${decision.targetStage}.`,
  }], decision);
}

function validateShotStage(
  runtime: ProductionRuntime,
  shotId: string,
  expected?: ProductionStage,
): { readonly shot?: ShotRuntimeState; readonly diagnostics: readonly RuntimeDiagnostic[] } {
  const shot = getShot(runtime, shotId);
  if (shot === undefined) {
    return {
      diagnostics: freezeDiagnostics([{
        code: "RUNTIME_SHOT_NOT_FOUND",
        shotId,
        message: `Shot ${shotId} is not registered in the production runtime.`,
      }]),
    };
  }
  if (expected !== undefined && shot.stage !== expected) {
    return {
      shot,
      diagnostics: freezeDiagnostics([{
        code: "RUNTIME_STAGE_MISMATCH",
        shotId,
        message: `Shot ${shotId} is ${shot.stage}; expected ${expected}.`,
      }]),
    };
  }
  return { shot, diagnostics: [] };
}

export function createProductionRuntime(project: StudioProject, shotIds: readonly string[]): ProductionRuntime {
  const shots: Record<string, ShotRuntimeState> = {};
  for (const shotId of shotIds) {
    if (shotId.trim().length === 0) {
      throw new Error("RUNTIME_EMPTY_SHOT_ID: shot id must not be empty.");
    }
    if (shots[shotId] !== undefined) {
      throw new Error(`RUNTIME_DUPLICATE_SHOT: ${shotId}.`);
    }
    shots[shotId] = Object.freeze({ shotId, stage: "PLANNED" });
  }
  return Object.freeze({
    project,
    shots: Object.freeze(shots),
    journal: Object.freeze([]),
  });
}

export function advanceShotStage(
  runtime: ProductionRuntime,
  shotId: string,
  targetStage: Exclude<ProductionStage, "CANDIDATE" | "QC" | "APPROVED">,
  input: StageAdvanceInput = {},
): RuntimeResult {
  const validation = validateShotStage(runtime, shotId);
  if (validation.shot === undefined || validation.diagnostics.length > 0) {
    return runtimeRejected(runtime, validation.diagnostics);
  }

  const shot = validation.shot;
  const decision = evaluateProductionStep(orchestrationInput(shot.stage, targetStage, input));
  if (decision.status !== "ADVANCE") return orchestrationFailure(runtime, shotId, decision);

  const revision = runtime.project.state.revision;
  const withShot = replaceShot(runtime, { ...shot, stage: targetStage });
  const next = appendTransition(withShot, shotId, shot.stage, targetStage, revision, revision);
  return runtimeAccepted(next, decision);
}

export async function runCandidateWorkflow(
  runtime: ProductionRuntime,
  shotId: string,
  input: CandidateWorkflowInput,
): Promise<RuntimeResult> {
  const validation = validateShotStage(runtime, shotId, "READY_FOR_RENDER");
  if (validation.shot === undefined || validation.diagnostics.length > 0) {
    return runtimeRejected(runtime, validation.diagnostics);
  }

  const decision = evaluateProductionStep(orchestrationInput("READY_FOR_RENDER", "CANDIDATE", input));
  if (decision.status !== "ADVANCE") return orchestrationFailure(runtime, shotId, decision);

  let report: WorkflowExecutionReport;
  try {
    report = await executeWorkflow({
      graph: input.graph,
      executors: input.executors,
      cache: input.cache,
      engineVersion: input.engineVersion,
      ...(input.cancellation === undefined ? {} : { cancellation: input.cancellation }),
    });
  } catch (error) {
    return runtimeRejected(runtime, [{
      code: "RUNTIME_WORKFLOW_FAILED",
      shotId,
      message: error instanceof Error ? error.message : "Candidate workflow failed.",
    }], decision);
  }

  if (report.status !== "completed") {
    return runtimeRejected(runtime, [{
      code: "RUNTIME_WORKFLOW_CANCELLED",
      shotId,
      message: "Candidate workflow was cancelled; canonical production state remains unchanged.",
    }], decision, report);
  }

  const finalResult = report.results[input.finalNodeId];
  if (finalResult === undefined) {
    return runtimeRejected(runtime, [{
      code: "RUNTIME_FINAL_RESULT_MISSING",
      shotId,
      message: `Workflow completed without final node result ${input.finalNodeId}.`,
    }], decision, report);
  }

  let identity: CandidateArtifactIdentity;
  try {
    identity = input.resolveCandidate(finalResult);
  } catch (error) {
    return runtimeRejected(runtime, [{
      code: "RUNTIME_INVALID_CANDIDATE",
      shotId,
      message: error instanceof Error ? error.message : "Candidate resolver failed.",
    }], decision, report);
  }

  if (identity.takeId.trim().length === 0 || !isSha256(identity.artifactSha256)) {
    return runtimeRejected(runtime, [{
      code: "RUNTIME_INVALID_CANDIDATE",
      shotId,
      message: "Candidate requires a non-empty takeId and SHA-256 artifact identity.",
    }], decision, report);
  }

  const candidate: CandidateArtifact = Object.freeze({
    ...identity,
    finalNodeId: input.finalNodeId,
    workflowOutputHash: finalResult.outputHash,
  });
  const shot = validation.shot;
  const revision = runtime.project.state.revision;
  const withShot = replaceShot(runtime, { ...shot, stage: "CANDIDATE", candidate });
  const next = appendTransition(withShot, shotId, shot.stage, "CANDIDATE", revision, revision);
  return runtimeAccepted(next, decision, report);
}

export function enterShotQC(
  runtime: ProductionRuntime,
  shotId: string,
  qcReport: QCReport,
): RuntimeResult {
  const validation = validateShotStage(runtime, shotId, "CANDIDATE");
  if (validation.shot === undefined || validation.diagnostics.length > 0) {
    return runtimeRejected(runtime, validation.diagnostics);
  }
  const shot = validation.shot;
  const candidate = shot.candidate;
  if (candidate === undefined) {
    return runtimeRejected(runtime, [{
      code: "RUNTIME_CANDIDATE_MISSING",
      shotId,
      message: `Shot ${shotId} has no candidate artifact to validate.`,
    }]);
  }
  if (qcReport.targetId !== candidate.takeId) {
    return runtimeRejected(runtime, [{
      code: "RUNTIME_QC_TARGET_MISMATCH",
      shotId,
      message: `QC target ${qcReport.targetId} does not match candidate ${candidate.takeId}.`,
    }]);
  }

  const decision = evaluateProductionStep({
    currentStage: "CANDIDATE",
    targetStage: "QC",
    candidateArtifactPresent: true,
  });
  if (decision.status !== "ADVANCE") return orchestrationFailure(runtime, shotId, decision);

  const revision = runtime.project.state.revision;
  const withShot = replaceShot(runtime, { ...shot, stage: "QC", qcReport });
  const next = appendTransition(withShot, shotId, "CANDIDATE", "QC", revision, revision);
  return runtimeAccepted(next, decision);
}

function manifestMatchesCandidate(
  manifest: ProductionManifest,
  shotId: string,
  candidate: CandidateArtifact,
): boolean {
  return manifest.approvedTakes.some((take) =>
    take.shotId === shotId
    && take.takeId === candidate.takeId
    && take.artifactSha256.toLowerCase() === candidate.artifactSha256.toLowerCase()
  );
}

function commitCommandsAtomically(
  project: StudioProject,
  commands: readonly StudioCommand[],
): { readonly accepted: true; readonly project: StudioProject }
  | { readonly accepted: false; readonly diagnostics: readonly Diagnostic[] } {
  let next = project;
  for (const command of commands) {
    const result = dispatchProjectCommand(next, command);
    if (!result.accepted) {
      return { accepted: false, diagnostics: result.diagnostics };
    }
    next = result.project;
  }
  return { accepted: true, project: next };
}

export function approveShot(
  runtime: ProductionRuntime,
  shotId: string,
  input: ApprovalInput,
): RuntimeResult {
  const validation = validateShotStage(runtime, shotId, "QC");
  if (validation.shot === undefined || validation.diagnostics.length > 0) {
    return runtimeRejected(runtime, validation.diagnostics);
  }
  const shot = validation.shot;
  const candidate = shot.candidate;
  if (candidate === undefined || shot.qcReport === undefined) {
    return runtimeRejected(runtime, [{
      code: "RUNTIME_CANDIDATE_MISSING",
      shotId,
      message: `Shot ${shotId} must retain both candidate and QC evidence before approval.`,
    }]);
  }

  const currentRevision = runtime.project.state.revision;
  if (input.manifest.projectRevision !== currentRevision) {
    return runtimeRejected(runtime, [{
      code: "RUNTIME_MANIFEST_REVISION_MISMATCH",
      shotId,
      message: `Manifest project revision ${input.manifest.projectRevision} does not match current canonical revision ${currentRevision}.`,
    }]);
  }
  if (!manifestMatchesCandidate(input.manifest, shotId, candidate)) {
    return runtimeRejected(runtime, [{
      code: "RUNTIME_MANIFEST_TAKE_MISMATCH",
      shotId,
      message: `Manifest does not bind shot ${shotId} to candidate ${candidate.takeId} with the same artifact hash.`,
    }]);
  }

  const decision = evaluateProductionStep({
    currentStage: "QC",
    targetStage: "APPROVED",
    qcReport: shot.qcReport,
    manifest: input.manifest,
    humanApproved: input.humanApproved,
  });
  if (decision.status !== "ADVANCE") return orchestrationFailure(runtime, shotId, decision);

  const commit = commitCommandsAtomically(runtime.project, input.commands);
  if (!commit.accepted) {
    return runtimeRejected(runtime, [{
      code: "RUNTIME_CANONICAL_COMMIT_REJECTED",
      shotId,
      message: "Approved candidate commands failed canonical validation; runtime was not mutated.",
      commandDiagnostics: commit.diagnostics,
    }], decision);
  }

  const withProject: ProductionRuntime = Object.freeze({ ...runtime, project: commit.project });
  const withShot = replaceShot(withProject, {
    ...shot,
    stage: "APPROVED",
    approvedTake: candidate,
  });
  const next = appendTransition(
    withShot,
    shotId,
    "QC",
    "APPROVED",
    currentRevision,
    commit.project.state.revision,
  );
  return runtimeAccepted(next, decision);
}

export function productionRuntimeEvidence(): readonly string[] {
  return Object.freeze([
    "Candidate workflow results are stored as candidate evidence and never mutate canonical project state by themselves.",
    "QC is bound to the exact candidate take id before a shot may enter the QC stage.",
    "Approval requires exact manifest binding to candidate artifact SHA-256 and the current canonical project revision.",
    "Canonical commands are validated and applied transactionally only after orchestrator approval; any rejected command leaves the original runtime unchanged.",
    "Human locks remain enforced by core-state because approved AI/system commands keep their original provenance instead of being silently rewritten as human commands.",
  ]);
}
