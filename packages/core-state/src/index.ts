import type {
  ChangeSet,
  Diagnostic,
  DiagnosticCode,
  StudioCommand,
  StudioEvent,
} from "@aistudio/core-events";
import type {
  CharacterId,
  LockState,
  PropId,
  Transform3D,
} from "@aistudio/core-types";

export interface ActorState {
  readonly id: CharacterId;
  readonly revision: number;
  readonly transform: Transform3D;
  readonly heldPropIds: readonly PropId[];
  readonly lock?: LockState;
}

export interface PropState {
  readonly id: PropId;
  readonly revision: number;
  readonly transform: Transform3D;
  readonly holderCharacterId: CharacterId | null;
  readonly lock?: LockState;
}

export interface CanonicalState {
  readonly revision: number;
  readonly actors: Readonly<Record<string, ActorState>>;
  readonly props: Readonly<Record<string, PropState>>;
}

export interface AcceptedCommandExecution {
  readonly accepted: true;
  readonly state: CanonicalState;
  readonly diagnostics: readonly Diagnostic[];
  readonly changeSet: ChangeSet;
}

export interface RejectedCommandExecution {
  readonly accepted: false;
  readonly state: CanonicalState;
  readonly diagnostics: readonly Diagnostic[];
}

export type CommandExecution = AcceptedCommandExecution | RejectedCommandExecution;

export function createCanonicalState(
  actors: readonly ActorState[] = [],
  props: readonly PropState[] = [],
): CanonicalState {
  return {
    revision: 0,
    actors: Object.fromEntries(actors.map((actor) => [actor.id, actor])),
    props: Object.fromEntries(props.map((prop) => [prop.id, prop])),
  };
}

function diagnostic(
  code: DiagnosticCode,
  message: string,
  entityId?: string,
): Diagnostic {
  if (entityId === undefined) {
    return { code, severity: "error", message };
  }

  return { code, severity: "error", message, entityId };
}

function isHumanLocked(
  entity: { readonly lock?: LockState },
  source: StudioCommand["meta"]["source"],
): boolean {
  return source !== "human" && entity.lock?.locked === true && entity.lock.owner === "human";
}

function validateTransform(transform: Transform3D): readonly Diagnostic[] {
  const values = [
    transform.position.x,
    transform.position.y,
    transform.position.z,
    transform.rotation.x,
    transform.rotation.y,
    transform.rotation.z,
    transform.rotation.w,
    transform.scale.x,
    transform.scale.y,
    transform.scale.z,
  ];

  if (values.some((value) => !Number.isFinite(value))) {
    return [diagnostic("CMD_NON_FINITE_TRANSFORM", "Transform contains a non-finite number.")];
  }

  if (transform.scale.x <= 0 || transform.scale.y <= 0 || transform.scale.z <= 0) {
    return [diagnostic("CMD_INVALID_SCALE", "Transform scale components must be greater than zero.")];
  }

  return [];
}

export function validateStateInvariants(state: CanonicalState): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const actor of Object.values(state.actors)) {
    for (const propId of actor.heldPropIds) {
      const prop = state.props[propId];
      if (prop === undefined) {
        diagnostics.push(
          diagnostic(
            "STATE_ACTOR_HELD_PROP_MISSING",
            `Actor ${actor.id} references missing prop ${propId}.`,
            actor.id,
          ),
        );
        continue;
      }

      if (prop.holderCharacterId !== actor.id) {
        diagnostics.push(
          diagnostic(
            "STATE_PROP_HOLDER_MISMATCH",
            `Prop ${prop.id} holder does not match actor ${actor.id}.`,
            prop.id,
          ),
        );
      }
    }
  }

  for (const prop of Object.values(state.props)) {
    if (prop.holderCharacterId === null) {
      continue;
    }

    const actor = state.actors[prop.holderCharacterId];
    if (actor === undefined || !actor.heldPropIds.includes(prop.id)) {
      diagnostics.push(
        diagnostic(
          "STATE_PROP_HOLDER_MISMATCH",
          `Prop ${prop.id} points to a holder that does not reference the prop.`,
          prop.id,
        ),
      );
    }
  }

  return diagnostics;
}

export function validateCommand(
  state: CanonicalState,
  command: StudioCommand,
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [...validateStateInvariants(state)];

  switch (command.type) {
    case "MOVE_ACTOR": {
      const actor = state.actors[command.actorId];
      if (actor === undefined) {
        diagnostics.push(
          diagnostic("CMD_ACTOR_NOT_FOUND", `Actor ${command.actorId} was not found.`, command.actorId),
        );
        return diagnostics;
      }

      if (isHumanLocked(actor, command.meta.source)) {
        diagnostics.push(
          diagnostic(
            "CMD_ENTITY_HUMAN_LOCKED",
            `Actor ${actor.id} is protected by a human lock.`,
            actor.id,
          ),
        );
      }

      diagnostics.push(...validateTransform(command.to));
      return diagnostics;
    }

    case "PICK_UP_PROP": {
      const actor = state.actors[command.actorId];
      const prop = state.props[command.propId];

      if (actor === undefined) {
        diagnostics.push(
          diagnostic("CMD_ACTOR_NOT_FOUND", `Actor ${command.actorId} was not found.`, command.actorId),
        );
      }

      if (prop === undefined) {
        diagnostics.push(
          diagnostic("CMD_PROP_NOT_FOUND", `Prop ${command.propId} was not found.`, command.propId),
        );
      }

      if (actor === undefined || prop === undefined) {
        return diagnostics;
      }

      if (isHumanLocked(actor, command.meta.source)) {
        diagnostics.push(
          diagnostic(
            "CMD_ENTITY_HUMAN_LOCKED",
            `Actor ${actor.id} is protected by a human lock.`,
            actor.id,
          ),
        );
      }

      if (isHumanLocked(prop, command.meta.source)) {
        diagnostics.push(
          diagnostic(
            "CMD_ENTITY_HUMAN_LOCKED",
            `Prop ${prop.id} is protected by a human lock.`,
            prop.id,
          ),
        );
      }

      if (prop.holderCharacterId === actor.id) {
        diagnostics.push(
          diagnostic(
            "CMD_PROP_ALREADY_HELD",
            `Actor ${actor.id} already holds prop ${prop.id}.`,
            prop.id,
          ),
        );
      } else if (prop.holderCharacterId !== null) {
        diagnostics.push(
          diagnostic(
            "CMD_PROP_HELD_BY_OTHER",
            `Prop ${prop.id} is already held by actor ${prop.holderCharacterId}.`,
            prop.id,
          ),
        );
      }

      return diagnostics;
    }

    case "PUT_DOWN_PROP": {
      const actor = state.actors[command.actorId];
      const prop = state.props[command.propId];

      if (actor === undefined) {
        diagnostics.push(
          diagnostic("CMD_ACTOR_NOT_FOUND", `Actor ${command.actorId} was not found.`, command.actorId),
        );
      }

      if (prop === undefined) {
        diagnostics.push(
          diagnostic("CMD_PROP_NOT_FOUND", `Prop ${command.propId} was not found.`, command.propId),
        );
      }

      if (actor === undefined || prop === undefined) {
        return diagnostics;
      }

      if (isHumanLocked(actor, command.meta.source)) {
        diagnostics.push(
          diagnostic(
            "CMD_ENTITY_HUMAN_LOCKED",
            `Actor ${actor.id} is protected by a human lock.`,
            actor.id,
          ),
        );
      }

      if (isHumanLocked(prop, command.meta.source)) {
        diagnostics.push(
          diagnostic(
            "CMD_ENTITY_HUMAN_LOCKED",
            `Prop ${prop.id} is protected by a human lock.`,
            prop.id,
          ),
        );
      }

      if (prop.holderCharacterId !== actor.id || !actor.heldPropIds.includes(prop.id)) {
        diagnostics.push(
          diagnostic(
            "CMD_PROP_NOT_HELD_BY_ACTOR",
            `Actor ${actor.id} does not hold prop ${prop.id}.`,
            prop.id,
          ),
        );
      }

      diagnostics.push(...validateTransform(command.at));
      return diagnostics;
    }
  }
}

export function decideCommand(state: CanonicalState, command: StudioCommand): readonly StudioEvent[] {
  switch (command.type) {
    case "MOVE_ACTOR": {
      const actor = state.actors[command.actorId];
      if (actor === undefined) {
        throw new Error("MOVE_ACTOR reached decision stage without a valid actor.");
      }

      return [
        {
          type: "ACTOR_MOVED",
          actorId: actor.id,
          from: actor.transform,
          to: command.to,
        },
      ];
    }

    case "PICK_UP_PROP": {
      const prop = state.props[command.propId];
      if (prop === undefined) {
        throw new Error("PICK_UP_PROP reached decision stage without a valid prop.");
      }

      return [
        {
          type: "PROP_PICKED_UP",
          actorId: command.actorId,
          propId: prop.id,
          previousTransform: prop.transform,
        },
      ];
    }

    case "PUT_DOWN_PROP":
      return [
        {
          type: "PROP_PUT_DOWN",
          actorId: command.actorId,
          propId: command.propId,
          at: command.at,
        },
      ];
  }
}

export function reduceEvent(state: CanonicalState, event: StudioEvent): CanonicalState {
  switch (event.type) {
    case "ACTOR_MOVED": {
      const actor = state.actors[event.actorId];
      if (actor === undefined) {
        throw new Error("ACTOR_MOVED cannot be reduced because the actor is missing.");
      }

      const nextActor: ActorState = {
        ...actor,
        revision: actor.revision + 1,
        transform: event.to,
      };

      return {
        ...state,
        revision: state.revision + 1,
        actors: { ...state.actors, [actor.id]: nextActor },
      };
    }

    case "PROP_PICKED_UP": {
      const actor = state.actors[event.actorId];
      const prop = state.props[event.propId];
      if (actor === undefined || prop === undefined) {
        throw new Error("PROP_PICKED_UP cannot be reduced because actor or prop is missing.");
      }

      const nextActor: ActorState = {
        ...actor,
        revision: actor.revision + 1,
        heldPropIds: [...actor.heldPropIds, prop.id],
      };
      const nextProp: PropState = {
        ...prop,
        revision: prop.revision + 1,
        holderCharacterId: actor.id,
      };

      return {
        ...state,
        revision: state.revision + 1,
        actors: { ...state.actors, [actor.id]: nextActor },
        props: { ...state.props, [prop.id]: nextProp },
      };
    }

    case "PROP_PUT_DOWN": {
      const actor = state.actors[event.actorId];
      const prop = state.props[event.propId];
      if (actor === undefined || prop === undefined) {
        throw new Error("PROP_PUT_DOWN cannot be reduced because actor or prop is missing.");
      }

      const nextActor: ActorState = {
        ...actor,
        revision: actor.revision + 1,
        heldPropIds: actor.heldPropIds.filter((propId) => propId !== prop.id),
      };
      const nextProp: PropState = {
        ...prop,
        revision: prop.revision + 1,
        holderCharacterId: null,
        transform: event.at,
      };

      return {
        ...state,
        revision: state.revision + 1,
        actors: { ...state.actors, [actor.id]: nextActor },
        props: { ...state.props, [prop.id]: nextProp },
      };
    }
  }
}

export function reduceEvents(
  state: CanonicalState,
  events: readonly StudioEvent[],
): CanonicalState {
  return events.reduce(reduceEvent, state);
}

function buildUndoCommands(
  command: StudioCommand,
  events: readonly StudioEvent[],
): readonly StudioCommand[] {
  return [...events]
    .reverse()
    .map((event): StudioCommand => {
      switch (event.type) {
        case "ACTOR_MOVED":
          return {
            type: "MOVE_ACTOR",
            actorId: event.actorId,
            to: event.from,
            meta: command.meta,
          };
        case "PROP_PICKED_UP":
          return {
            type: "PUT_DOWN_PROP",
            actorId: event.actorId,
            propId: event.propId,
            at: event.previousTransform,
            meta: command.meta,
          };
        case "PROP_PUT_DOWN":
          return {
            type: "PICK_UP_PROP",
            actorId: event.actorId,
            propId: event.propId,
            meta: command.meta,
          };
      }
    });
}

export function executeCommand(
  state: CanonicalState,
  command: StudioCommand,
): CommandExecution {
  const diagnostics = validateCommand(state, command);
  if (diagnostics.some((item) => item.severity === "error")) {
    return { accepted: false, state, diagnostics };
  }

  const events = decideCommand(state, command);
  const nextState = reduceEvents(state, events);
  const changeSet: ChangeSet = {
    sequence: state.revision + 1,
    beforeRevision: state.revision,
    afterRevision: nextState.revision,
    command,
    events,
    undoCommands: buildUndoCommands(command, events),
  };

  return {
    accepted: true,
    state: nextState,
    diagnostics,
    changeSet,
  };
}
