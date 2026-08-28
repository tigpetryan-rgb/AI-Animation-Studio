import { describe, expect, it } from "vitest";
import type { StudioCommand } from "../packages/core-events/src/index.ts";
import {
  createCanonicalState,
  executeCommand,
  validateCommand,
  type ActorState,
  type PropState,
} from "../packages/core-state/src/index.ts";
import {
  IDENTITY_TRANSFORM,
  asCharacterId,
  asPropId,
  type Transform3D,
} from "../packages/core-types/src/index.ts";

function transform(x: number, y = 0, z = 0): Transform3D {
  return {
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

function fixture(options?: { humanLockActor?: boolean; humanLockProp?: boolean }) {
  const actorId = asCharacterId("actor-1");
  const propId = asPropId("prop-1");
  const actor: ActorState = {
    id: actorId,
    revision: 0,
    transform: IDENTITY_TRANSFORM,
    heldPropIds: [],
    ...(options?.humanLockActor
      ? { lock: { locked: true, owner: "human" as const, reason: "director lock" } }
      : {}),
  };
  const prop: PropState = {
    id: propId,
    revision: 0,
    transform: transform(2),
    holderCharacterId: null,
    ...(options?.humanLockProp
      ? { lock: { locked: true, owner: "human" as const, reason: "continuity lock" } }
      : {}),
  };

  return { actorId, propId, state: createCanonicalState([actor], [prop]) };
}

describe("core-state command pipeline", () => {
  it("moves an actor immutably and records undo data", () => {
    const { actorId, state } = fixture();
    const command: StudioCommand = {
      type: "MOVE_ACTOR",
      actorId,
      to: transform(5, 1),
      meta: { source: "human", requestId: "move-1" },
    };

    const result = executeCommand(state, command);
    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("Expected accepted command");

    expect(state.actors[actorId]?.transform).toEqual(IDENTITY_TRANSFORM);
    expect(result.state.actors[actorId]?.transform).toEqual(transform(5, 1));
    expect(result.changeSet.beforeRevision).toBe(0);
    expect(result.changeSet.afterRevision).toBe(1);
    expect(result.changeSet.undoCommands).toEqual([
      {
        type: "MOVE_ACTOR",
        actorId,
        to: IDENTITY_TRANSFORM,
        meta: command.meta,
      },
    ]);
  });

  it("blocks system and AI mutations behind a human lock but permits a human override", () => {
    const { actorId, state } = fixture({ humanLockActor: true });
    const systemCommand: StudioCommand = {
      type: "MOVE_ACTOR",
      actorId,
      to: transform(3),
      meta: { source: "system" },
    };

    const blocked = executeCommand(state, systemCommand);
    expect(blocked.accepted).toBe(false);
    expect(blocked.diagnostics.map((item) => item.code)).toContain("CMD_ENTITY_HUMAN_LOCKED");

    const human = executeCommand(state, { ...systemCommand, meta: { source: "human" } });
    expect(human.accepted).toBe(true);
  });

  it("picks up a prop and rejects a duplicate pickup", () => {
    const { actorId, propId, state } = fixture();
    const pickup: StudioCommand = {
      type: "PICK_UP_PROP",
      actorId,
      propId,
      meta: { source: "human" },
    };

    const first = executeCommand(state, pickup);
    expect(first.accepted).toBe(true);
    if (!first.accepted) throw new Error("Expected pickup to succeed");

    expect(first.state.actors[actorId]?.heldPropIds).toEqual([propId]);
    expect(first.state.props[propId]?.holderCharacterId).toBe(actorId);
    expect(first.changeSet.undoCommands[0]).toEqual({
      type: "PUT_DOWN_PROP",
      actorId,
      propId,
      at: transform(2),
      meta: pickup.meta,
    });

    const duplicate = executeCommand(first.state, pickup);
    expect(duplicate.accepted).toBe(false);
    expect(duplicate.diagnostics.map((item) => item.code)).toContain("CMD_PROP_ALREADY_HELD");
  });

  it("puts down only a prop held by that actor and records exact placement", () => {
    const { actorId, propId, state } = fixture();
    const pickup = executeCommand(state, {
      type: "PICK_UP_PROP",
      actorId,
      propId,
      meta: { source: "human" },
    });
    if (!pickup.accepted) throw new Error("Expected pickup to succeed");

    const dropAt = transform(8, 0, -1);
    const putDown = executeCommand(pickup.state, {
      type: "PUT_DOWN_PROP",
      actorId,
      propId,
      at: dropAt,
      meta: { source: "human" },
    });

    expect(putDown.accepted).toBe(true);
    if (!putDown.accepted) throw new Error("Expected put down to succeed");
    expect(putDown.state.actors[actorId]?.heldPropIds).toEqual([]);
    expect(putDown.state.props[propId]?.holderCharacterId).toBeNull();
    expect(putDown.state.props[propId]?.transform).toEqual(dropAt);
    expect(putDown.changeSet.undoCommands[0]).toEqual({
      type: "PICK_UP_PROP",
      actorId,
      propId,
      meta: { source: "human" },
    });
  });

  it("rejects invalid transforms with stable diagnostic codes", () => {
    const { actorId, state } = fixture();
    const invalid: StudioCommand = {
      type: "MOVE_ACTOR",
      actorId,
      to: {
        ...IDENTITY_TRANSFORM,
        position: { x: Number.NaN, y: 0, z: 0 },
      },
      meta: { source: "human" },
    };

    expect(validateCommand(state, invalid).map((item) => item.code)).toContain(
      "CMD_NON_FINITE_TRANSFORM",
    );

    const invalidScale: StudioCommand = {
      type: "MOVE_ACTOR",
      actorId,
      to: {
        ...IDENTITY_TRANSFORM,
        scale: { x: 1, y: 0, z: 1 },
      },
      meta: { source: "human" },
    };

    expect(validateCommand(state, invalidScale).map((item) => item.code)).toContain(
      "CMD_INVALID_SCALE",
    );
  });

  it("blocks AI pickup when the prop is human locked", () => {
    const { actorId, propId, state } = fixture({ humanLockProp: true });
    const result = executeCommand(state, {
      type: "PICK_UP_PROP",
      actorId,
      propId,
      meta: { source: "ai" },
    });

    expect(result.accepted).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain("CMD_ENTITY_HUMAN_LOCKED");
  });

  it("replays deterministically from identical state and command", () => {
    const { actorId, state } = fixture();
    const command: StudioCommand = {
      type: "MOVE_ACTOR",
      actorId,
      to: transform(7),
      meta: { source: "system", requestId: "determinism" },
    };

    expect(executeCommand(state, command)).toEqual(executeCommand(state, command));
  });
});
