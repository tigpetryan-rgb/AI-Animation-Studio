import {
  scheduleResourceBatch,
  type ResourceBudget,
  type ResourceRequest,
} from "@aistudio/resource-budget";

export type AutopilotMode = "MANUAL" | "ASSIST" | "AUTO_SCENE";
export type AutopilotEffect =
  | "READ_ONLY"
  | "REBUILDABLE_CANDIDATE"
  | "CANONICAL_MUTATION"
  | "DESTRUCTIVE";
export type ValidationPolicy = "NONE" | "REQUIRED";
export type AutopilotDecisionStatus = "AUTO_EXECUTE" | "PROPOSE" | "WAIT_HUMAN" | "DEFER" | "BLOCKED";

export type AutopilotReason =
  | "SAFE_AUTO_SCENE_ACTION"
  | "ASSIST_PROPOSAL"
  | "MANUAL_CONTROL_REQUIRED"
  | "DEPENDENCY_NOT_COMPLETED"
  | "HUMAN_LOCK"
  | "CRITICAL_AMBIGUITY"
  | "CANONICAL_APPROVAL_REQUIRED"
  | "DESTRUCTIVE_APPROVAL_REQUIRED"
  | "MISSING_VALIDATION_GATE"
  | "RESOURCE_BUDGET_REQUIRED"
  | "RESOURCE_BUSY"
  | "RESOURCE_UNAVAILABLE";

export type AutopilotDiagnosticCode =
  | "AUTO_DUPLICATE_ACTION"
  | "AUTO_MISSING_DEPENDENCY"
  | "AUTO_SELF_DEPENDENCY"
  | "AUTO_CYCLE"
  | "AUTO_EMPTY_ACTION_ID"
  | "AUTO_RESOURCE_ID_MISMATCH";

export interface AutopilotAction {
  readonly id: string;
  readonly dependsOn: readonly string[];
  readonly effect: AutopilotEffect;
  readonly validation: ValidationPolicy;
  readonly humanLocked: boolean;
  readonly criticalAmbiguity: boolean;
  readonly resource?: ResourceRequest;
}

export interface AutopilotDiagnostic {
  readonly code: AutopilotDiagnosticCode;
  readonly message: string;
  readonly actionId?: string;
}

export interface AutopilotDecision {
  readonly actionId: string;
  readonly status: AutopilotDecisionStatus;
  readonly reason: AutopilotReason;
}

export interface AutopilotPlan {
  readonly mode: AutopilotMode;
  readonly layers: readonly (readonly string[])[];
  readonly decisions: readonly AutopilotDecision[];
  readonly autoExecutable: readonly string[];
  readonly proposed: readonly string[];
  readonly waitingForHuman: readonly string[];
  readonly deferred: readonly string[];
  readonly blocked: readonly string[];
}

export interface AutopilotPlanInput {
  readonly mode: AutopilotMode;
  readonly actions: readonly AutopilotAction[];
  readonly completedActionIds?: readonly string[];
  readonly resourceBudget?: ResourceBudget;
}

export interface AutopilotEvidence {
  readonly source: "DETERMINISTIC_POLICY";
  readonly assumptions: readonly string[];
}

export class AutopilotPlanError extends Error {
  constructor(readonly diagnostics: readonly AutopilotDiagnostic[]) {
    super(diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"));
    this.name = "AutopilotPlanError";
  }
}

export function autopilotEvidence(): AutopilotEvidence {
  return Object.freeze({
    source: "DETERMINISTIC_POLICY",
    assumptions: Object.freeze([
      "AI proposals are candidates; this policy does not make generated output canonical truth.",
      "AUTO_SCENE may start read-only and rebuildable candidate work, but canonical mutations still require human approval in v1.",
      "Destructive operations are never auto-executed by v1 autopilot.",
      "Human locks and critical ambiguity always stop autonomous execution.",
      "Resource admission is a conservative policy decision and is not a measurement of free hardware capacity.",
    ]),
  });
}

export function validateAutopilotActions(actions: readonly AutopilotAction[]): readonly AutopilotDiagnostic[] {
  const diagnostics: AutopilotDiagnostic[] = [];
  const byId = new Map<string, AutopilotAction>();

  for (const action of actions) {
    if (action.id.trim().length === 0) {
      diagnostics.push({
        code: "AUTO_EMPTY_ACTION_ID",
        actionId: action.id,
        message: "Autopilot action id must not be empty.",
      });
      continue;
    }
    if (byId.has(action.id)) {
      diagnostics.push({
        code: "AUTO_DUPLICATE_ACTION",
        actionId: action.id,
        message: `Autopilot contains duplicate action ${action.id}.`,
      });
      continue;
    }
    byId.set(action.id, action);

    if (action.resource !== undefined && action.resource.id !== action.id) {
      diagnostics.push({
        code: "AUTO_RESOURCE_ID_MISMATCH",
        actionId: action.id,
        message: `Resource request id ${action.resource.id} must match action id ${action.id}.`,
      });
    }
  }

  for (const action of actions) {
    for (const dependency of action.dependsOn) {
      if (dependency === action.id) {
        diagnostics.push({
          code: "AUTO_SELF_DEPENDENCY",
          actionId: action.id,
          message: `Action ${action.id} depends on itself.`,
        });
      } else if (!byId.has(dependency)) {
        diagnostics.push({
          code: "AUTO_MISSING_DEPENDENCY",
          actionId: action.id,
          message: `Action ${action.id} depends on missing action ${dependency}.`,
        });
      }
    }
  }

  const structuralFailure = diagnostics.some((item) =>
    item.code === "AUTO_DUPLICATE_ACTION"
    || item.code === "AUTO_MISSING_DEPENDENCY"
    || item.code === "AUTO_SELF_DEPENDENCY"
    || item.code === "AUTO_EMPTY_ACTION_ID"
  );

  if (!structuralFailure && tryBuildLayers(actions) === null) {
    diagnostics.push({
      code: "AUTO_CYCLE",
      message: "Autopilot action graph contains a dependency cycle.",
    });
  }

  return Object.freeze(diagnostics);
}

function tryBuildLayers(actions: readonly AutopilotAction[]): readonly (readonly string[])[] | null {
  const nodes = [...actions].sort((a, b) => a.id.localeCompare(b.id));
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const action of nodes) {
    indegree.set(action.id, action.dependsOn.length);
    children.set(action.id, []);
  }
  for (const action of nodes) {
    for (const dependency of action.dependsOn) {
      children.get(dependency)?.push(action.id);
    }
  }

  let ready = nodes.filter((action) => (indegree.get(action.id) ?? 0) === 0).map((action) => action.id);
  const layers: string[][] = [];
  let visited = 0;

  while (ready.length > 0) {
    ready.sort((a, b) => a.localeCompare(b));
    const layer = [...ready];
    layers.push(layer);
    ready = [];
    visited += layer.length;

    for (const actionId of layer) {
      for (const childId of [...(children.get(actionId) ?? [])].sort((a, b) => a.localeCompare(b))) {
        const next = (indegree.get(childId) ?? 0) - 1;
        indegree.set(childId, next);
        if (next === 0) ready.push(childId);
      }
    }
  }

  return visited === nodes.length ? Object.freeze(layers.map((layer) => Object.freeze(layer))) : null;
}

export function buildAutopilotLayers(actions: readonly AutopilotAction[]): readonly (readonly string[])[] {
  const diagnostics = validateAutopilotActions(actions);
  if (diagnostics.length > 0) throw new AutopilotPlanError(diagnostics);
  const layers = tryBuildLayers(actions);
  if (layers === null) {
    throw new AutopilotPlanError([{ code: "AUTO_CYCLE", message: "Autopilot action graph contains a dependency cycle." }]);
  }
  return layers;
}

function policyDecision(
  mode: AutopilotMode,
  action: AutopilotAction,
  completed: ReadonlySet<string>,
): AutopilotDecision {
  if (action.dependsOn.some((dependency) => !completed.has(dependency))) {
    return Object.freeze({ actionId: action.id, status: "DEFER", reason: "DEPENDENCY_NOT_COMPLETED" });
  }
  if (action.humanLocked) {
    return Object.freeze({ actionId: action.id, status: "WAIT_HUMAN", reason: "HUMAN_LOCK" });
  }
  if (action.criticalAmbiguity) {
    return Object.freeze({ actionId: action.id, status: "WAIT_HUMAN", reason: "CRITICAL_AMBIGUITY" });
  }

  if (mode === "MANUAL") {
    return Object.freeze({ actionId: action.id, status: "WAIT_HUMAN", reason: "MANUAL_CONTROL_REQUIRED" });
  }

  if (action.effect === "CANONICAL_MUTATION") {
    return Object.freeze({ actionId: action.id, status: "WAIT_HUMAN", reason: "CANONICAL_APPROVAL_REQUIRED" });
  }
  if (action.effect === "DESTRUCTIVE") {
    return Object.freeze({ actionId: action.id, status: "WAIT_HUMAN", reason: "DESTRUCTIVE_APPROVAL_REQUIRED" });
  }

  if (mode === "ASSIST") {
    return Object.freeze({ actionId: action.id, status: "PROPOSE", reason: "ASSIST_PROPOSAL" });
  }

  if (action.effect === "REBUILDABLE_CANDIDATE" && action.validation !== "REQUIRED") {
    return Object.freeze({ actionId: action.id, status: "BLOCKED", reason: "MISSING_VALIDATION_GATE" });
  }

  return Object.freeze({ actionId: action.id, status: "AUTO_EXECUTE", reason: "SAFE_AUTO_SCENE_ACTION" });
}

function withResourcePolicy(
  decisions: readonly AutopilotDecision[],
  actions: readonly AutopilotAction[],
  budget: ResourceBudget | undefined,
): readonly AutopilotDecision[] {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const resourceCandidates = decisions
    .filter((decision) => decision.status === "AUTO_EXECUTE")
    .map((decision) => byId.get(decision.actionId))
    .filter((action): action is AutopilotAction => action !== undefined && action.resource !== undefined);

  if (resourceCandidates.length === 0) return decisions;
  if (budget === undefined) {
    return Object.freeze(decisions.map((decision) => {
      const action = byId.get(decision.actionId);
      if (decision.status === "AUTO_EXECUTE" && action?.resource !== undefined) {
        return Object.freeze({
          actionId: decision.actionId,
          status: "BLOCKED" as const,
          reason: "RESOURCE_BUDGET_REQUIRED" as const,
        });
      }
      return decision;
    }));
  }

  const scheduled = scheduleResourceBatch(
    resourceCandidates.map((action) => action.resource as ResourceRequest),
    budget,
  );
  const resourceDecision = new Map(scheduled.decisions.map((decision) => [decision.requestId, decision]));

  return Object.freeze(decisions.map((decision) => {
    if (decision.status !== "AUTO_EXECUTE") return decision;
    const action = byId.get(decision.actionId);
    if (action?.resource === undefined) return decision;
    const resource = resourceDecision.get(decision.actionId);
    if (resource?.status === "ADMIT") return decision;
    if (resource?.status === "DEFER") {
      return Object.freeze({ actionId: decision.actionId, status: "DEFER" as const, reason: "RESOURCE_BUSY" as const });
    }
    return Object.freeze({ actionId: decision.actionId, status: "BLOCKED" as const, reason: "RESOURCE_UNAVAILABLE" as const });
  }));
}

export function buildAutopilotPlan(input: AutopilotPlanInput): AutopilotPlan {
  const diagnostics = validateAutopilotActions(input.actions);
  if (diagnostics.length > 0) throw new AutopilotPlanError(diagnostics);

  const layers = buildAutopilotLayers(input.actions);
  const completed = new Set(input.completedActionIds ?? []);
  const orderedActions = layers.flatMap((layer) => layer.map((id) => input.actions.find((action) => action.id === id)))
    .filter((action): action is AutopilotAction => action !== undefined);
  const policy = orderedActions.map((action) => policyDecision(input.mode, action, completed));
  const decisions = withResourcePolicy(policy, input.actions, input.resourceBudget);

  const idsByStatus = (status: AutopilotDecisionStatus): readonly string[] =>
    Object.freeze(decisions.filter((decision) => decision.status === status).map((decision) => decision.actionId));

  return Object.freeze({
    mode: input.mode,
    layers,
    decisions,
    autoExecutable: idsByStatus("AUTO_EXECUTE"),
    proposed: idsByStatus("PROPOSE"),
    waitingForHuman: idsByStatus("WAIT_HUMAN"),
    deferred: idsByStatus("DEFER"),
    blocked: idsByStatus("BLOCKED"),
  });
}
