import type {
  ChangeSet,
  Diagnostic,
  StudioCommand,
} from "@aistudio/core-events";
import {
  createCanonicalState,
  executeCommand,
  validateStateInvariants,
  type CanonicalState,
} from "@aistudio/core-state";
import type { ProjectId, Transform3D } from "@aistudio/core-types";

export const PROJECT_FORMAT_VERSION = 1 as const;

export interface ProjectHistory {
  /** Permanent audit journal. Entries are never removed by undo/redo. */
  readonly journal: readonly ChangeSet[];
  /** Accepted user/system actions currently reachable by Undo. */
  readonly undoStack: readonly ChangeSet[];
  /** Actions removed by Undo and available to Redo, next redo first. */
  readonly redoStack: readonly ChangeSet[];
}

export interface StudioProject {
  readonly formatVersion: typeof PROJECT_FORMAT_VERSION;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly state: CanonicalState;
  readonly history: ProjectHistory;
}

export interface CreateStudioProjectInput {
  readonly projectId: ProjectId;
  readonly name: string;
  readonly state?: CanonicalState;
}

export interface ProjectDispatchAccepted {
  readonly accepted: true;
  readonly project: StudioProject;
  readonly diagnostics: readonly Diagnostic[];
  readonly changeSet: ChangeSet;
}

export interface ProjectDispatchRejected {
  readonly accepted: false;
  readonly project: StudioProject;
  readonly diagnostics: readonly Diagnostic[];
}

export type ProjectDispatchResult = ProjectDispatchAccepted | ProjectDispatchRejected;

export type ProjectHistoryReason =
  | "NOTHING_TO_UNDO"
  | "NOTHING_TO_REDO"
  | "UNDO_REJECTED"
  | "REDO_REJECTED";

export interface ProjectHistoryApplied {
  readonly applied: true;
  readonly project: StudioProject;
  readonly generatedChangeSets: readonly ChangeSet[];
}

export interface ProjectHistoryNotApplied {
  readonly applied: false;
  readonly project: StudioProject;
  readonly reason: ProjectHistoryReason;
  readonly diagnostics: readonly Diagnostic[];
}

export type ProjectHistoryResult = ProjectHistoryApplied | ProjectHistoryNotApplied;

export type ProjectFormatErrorCode =
  | "PROJECT_INVALID_JSON"
  | "PROJECT_INVALID_DOCUMENT"
  | "PROJECT_UNSUPPORTED_VERSION"
  | "PROJECT_INVALID_STATE";

export class ProjectFormatError extends Error {
  readonly code: ProjectFormatErrorCode;

  constructor(code: ProjectFormatErrorCode, message: string) {
    super(message);
    this.name = "ProjectFormatError";
    this.code = code;
  }
}

export function createStudioProject(input: CreateStudioProjectInput): StudioProject {
  if (input.name.trim().length === 0) {
    throw new RangeError("Project name must not be empty.");
  }

  const state = input.state ?? createCanonicalState();
  const stateDiagnostics = validateStateInvariants(state);
  if (stateDiagnostics.length > 0) {
    throw new ProjectFormatError(
      "PROJECT_INVALID_STATE",
      `Cannot create project from invalid canonical state: ${stateDiagnostics[0]?.code ?? "unknown"}.`,
    );
  }

  return {
    formatVersion: PROJECT_FORMAT_VERSION,
    projectId: input.projectId,
    name: input.name,
    state,
    history: {
      journal: [],
      undoStack: [],
      redoStack: [],
    },
  };
}

export function dispatchProjectCommand(
  project: StudioProject,
  command: StudioCommand,
): ProjectDispatchResult {
  const execution = executeCommand(project.state, command);
  if (!execution.accepted) {
    return {
      accepted: false,
      project,
      diagnostics: execution.diagnostics,
    };
  }

  const changeSet = execution.changeSet;
  return {
    accepted: true,
    diagnostics: execution.diagnostics,
    changeSet,
    project: {
      ...project,
      state: execution.state,
      history: {
        journal: [...project.history.journal, changeSet],
        undoStack: [...project.history.undoStack, changeSet],
        redoStack: [],
      },
    },
  };
}

interface AtomicCommandSuccess {
  readonly accepted: true;
  readonly state: CanonicalState;
  readonly changeSets: readonly ChangeSet[];
}

interface AtomicCommandFailure {
  readonly accepted: false;
  readonly diagnostics: readonly Diagnostic[];
}

function executeCommandsAtomically(
  initialState: CanonicalState,
  commands: readonly StudioCommand[],
): AtomicCommandSuccess | AtomicCommandFailure {
  let state = initialState;
  const changeSets: ChangeSet[] = [];

  for (const command of commands) {
    const execution = executeCommand(state, command);
    if (!execution.accepted) {
      return {
        accepted: false,
        diagnostics: execution.diagnostics,
      };
    }

    state = execution.state;
    changeSets.push(execution.changeSet);
  }

  return { accepted: true, state, changeSets };
}

export function undoProject(project: StudioProject): ProjectHistoryResult {
  const original = project.history.undoStack.at(-1);
  if (original === undefined) {
    return {
      applied: false,
      project,
      reason: "NOTHING_TO_UNDO",
      diagnostics: [],
    };
  }

  const execution = executeCommandsAtomically(project.state, original.undoCommands);
  if (!execution.accepted) {
    return {
      applied: false,
      project,
      reason: "UNDO_REJECTED",
      diagnostics: execution.diagnostics,
    };
  }

  return {
    applied: true,
    generatedChangeSets: execution.changeSets,
    project: {
      ...project,
      state: execution.state,
      history: {
        journal: [...project.history.journal, ...execution.changeSets],
        undoStack: project.history.undoStack.slice(0, -1),
        redoStack: [original, ...project.history.redoStack],
      },
    },
  };
}

export function redoProject(project: StudioProject): ProjectHistoryResult {
  const original = project.history.redoStack[0];
  if (original === undefined) {
    return {
      applied: false,
      project,
      reason: "NOTHING_TO_REDO",
      diagnostics: [],
    };
  }

  const execution = executeCommand(project.state, original.command);
  if (!execution.accepted) {
    return {
      applied: false,
      project,
      reason: "REDO_REJECTED",
      diagnostics: execution.diagnostics,
    };
  }

  const newChangeSet = execution.changeSet;
  return {
    applied: true,
    generatedChangeSets: [newChangeSet],
    project: {
      ...project,
      state: execution.state,
      history: {
        journal: [...project.history.journal, newChangeSet],
        undoStack: [...project.history.undoStack, newChangeSet],
        redoStack: project.history.redoStack.slice(1),
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isVec3(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z)
  );
}

function isTransform(value: unknown): value is Transform3D {
  if (!isRecord(value) || !isVec3(value.position) || !isVec3(value.scale)) {
    return false;
  }

  const rotation = value.rotation;
  if (
    !isRecord(rotation) ||
    !isFiniteNumber(rotation.x) ||
    !isFiniteNumber(rotation.y) ||
    !isFiniteNumber(rotation.z) ||
    !isFiniteNumber(rotation.w)
  ) {
    return false;
  }

  const scale = value.scale as Record<string, unknown>;
  return (
    typeof scale.x === "number" &&
    scale.x > 0 &&
    typeof scale.y === "number" &&
    scale.y > 0 &&
    typeof scale.z === "number" &&
    scale.z > 0
  );
}

function isCommandSource(value: unknown): boolean {
  return value === "human" || value === "system" || value === "ai";
}

function isCommandMeta(value: unknown): boolean {
  return isRecord(value) && isCommandSource(value.source);
}

function isStudioCommand(value: unknown): value is StudioCommand {
  if (!isRecord(value) || !isCommandMeta(value.meta)) {
    return false;
  }

  switch (value.type) {
    case "MOVE_ACTOR":
      return typeof value.actorId === "string" && isTransform(value.to);
    case "PICK_UP_PROP":
      return typeof value.actorId === "string" && typeof value.propId === "string";
    case "PUT_DOWN_PROP":
      return (
        typeof value.actorId === "string" &&
        typeof value.propId === "string" &&
        isTransform(value.at)
      );
    default:
      return false;
  }
}

function isLockState(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }

  return (
    isRecord(value) &&
    typeof value.locked === "boolean" &&
    (value.owner === "human" || value.owner === "system") &&
    (value.reason === undefined || typeof value.reason === "string")
  );
}

function isActorState(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isNonNegativeInteger(value.revision) &&
    isTransform(value.transform) &&
    Array.isArray(value.heldPropIds) &&
    value.heldPropIds.every((item) => typeof item === "string") &&
    isLockState(value.lock)
  );
}

function isPropState(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isNonNegativeInteger(value.revision) &&
    isTransform(value.transform) &&
    (value.holderCharacterId === null || typeof value.holderCharacterId === "string") &&
    isLockState(value.lock)
  );
}

function isCanonicalState(value: unknown): value is CanonicalState {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.revision) ||
    !isRecord(value.actors) ||
    !isRecord(value.props)
  ) {
    return false;
  }

  return (
    Object.values(value.actors).every(isActorState) &&
    Object.values(value.props).every(isPropState)
  );
}

function isChangeSet(value: unknown): value is ChangeSet {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.sequence) &&
    isNonNegativeInteger(value.beforeRevision) &&
    isNonNegativeInteger(value.afterRevision) &&
    isStudioCommand(value.command) &&
    Array.isArray(value.events) &&
    Array.isArray(value.undoCommands) &&
    value.undoCommands.every(isStudioCommand)
  );
}

function isHistory(value: unknown): value is ProjectHistory {
  return (
    isRecord(value) &&
    Array.isArray(value.journal) &&
    value.journal.every(isChangeSet) &&
    Array.isArray(value.undoStack) &&
    value.undoStack.every(isChangeSet) &&
    Array.isArray(value.redoStack) &&
    value.redoStack.every(isChangeSet)
  );
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = stableJsonValue(value[key]);
    }
    return result;
  }

  return value;
}

export function serializeProject(project: StudioProject): string {
  return JSON.stringify(stableJsonValue(project));
}

export function deserializeProject(serialized: string): StudioProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    throw new ProjectFormatError("PROJECT_INVALID_JSON", "Project snapshot is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new ProjectFormatError("PROJECT_INVALID_DOCUMENT", "Project snapshot must be an object.");
  }

  if (parsed.formatVersion !== PROJECT_FORMAT_VERSION) {
    throw new ProjectFormatError(
      "PROJECT_UNSUPPORTED_VERSION",
      `Unsupported project format version: ${String(parsed.formatVersion)}.`,
    );
  }

  if (
    typeof parsed.projectId !== "string" ||
    parsed.projectId.length === 0 ||
    typeof parsed.name !== "string" ||
    parsed.name.trim().length === 0 ||
    !isCanonicalState(parsed.state) ||
    !isHistory(parsed.history)
  ) {
    throw new ProjectFormatError(
      "PROJECT_INVALID_DOCUMENT",
      "Project snapshot does not match the Foundation M0 project schema.",
    );
  }

  const project = parsed as unknown as StudioProject;
  const stateDiagnostics = validateStateInvariants(project.state);
  if (stateDiagnostics.length > 0) {
    throw new ProjectFormatError(
      "PROJECT_INVALID_STATE",
      `Project contains an invalid canonical state: ${stateDiagnostics[0]?.code ?? "unknown"}.`,
    );
  }

  return project;
}
