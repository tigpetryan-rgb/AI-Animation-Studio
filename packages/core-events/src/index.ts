import type {
  CharacterId,
  PropId,
  Transform3D,
} from "@aistudio/core-types";

export type CommandSource = "human" | "system" | "ai";

export interface CommandMeta {
  readonly source: CommandSource;
  readonly requestId?: string;
}

export interface MoveActorCommand {
  readonly type: "MOVE_ACTOR";
  readonly actorId: CharacterId;
  readonly to: Transform3D;
  readonly meta: CommandMeta;
}

export interface PickUpPropCommand {
  readonly type: "PICK_UP_PROP";
  readonly actorId: CharacterId;
  readonly propId: PropId;
  readonly meta: CommandMeta;
}

export interface PutDownPropCommand {
  readonly type: "PUT_DOWN_PROP";
  readonly actorId: CharacterId;
  readonly propId: PropId;
  readonly at: Transform3D;
  readonly meta: CommandMeta;
}

export type StudioCommand =
  | MoveActorCommand
  | PickUpPropCommand
  | PutDownPropCommand;

export interface ActorMovedEvent {
  readonly type: "ACTOR_MOVED";
  readonly actorId: CharacterId;
  readonly from: Transform3D;
  readonly to: Transform3D;
}

export interface PropPickedUpEvent {
  readonly type: "PROP_PICKED_UP";
  readonly actorId: CharacterId;
  readonly propId: PropId;
  readonly previousTransform: Transform3D;
}

export interface PropPutDownEvent {
  readonly type: "PROP_PUT_DOWN";
  readonly actorId: CharacterId;
  readonly propId: PropId;
  readonly at: Transform3D;
}

export type StudioEvent = ActorMovedEvent | PropPickedUpEvent | PropPutDownEvent;

export type DiagnosticSeverity = "error" | "warning";

export type DiagnosticCode =
  | "STATE_PROP_HOLDER_MISMATCH"
  | "STATE_ACTOR_HELD_PROP_MISSING"
  | "CMD_ACTOR_NOT_FOUND"
  | "CMD_PROP_NOT_FOUND"
  | "CMD_ENTITY_HUMAN_LOCKED"
  | "CMD_PROP_ALREADY_HELD"
  | "CMD_PROP_HELD_BY_OTHER"
  | "CMD_PROP_NOT_HELD_BY_ACTOR"
  | "CMD_NON_FINITE_TRANSFORM"
  | "CMD_INVALID_SCALE";

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly entityId?: string;
}

export interface ChangeSet {
  readonly sequence: number;
  readonly beforeRevision: number;
  readonly afterRevision: number;
  readonly command: StudioCommand;
  readonly events: readonly StudioEvent[];
  readonly undoCommands: readonly StudioCommand[];
}
