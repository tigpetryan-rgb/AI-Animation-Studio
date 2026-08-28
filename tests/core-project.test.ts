import { describe, expect, it } from "vitest";
import {
  ProjectFormatError,
  createStudioProject,
  deserializeProject,
  dispatchProjectCommand,
  redoProject,
  serializeProject,
  undoProject,
} from "../packages/core-project/src/index.ts";
import {
  createCanonicalState,
  type ActorState,
  type PropState,
} from "../packages/core-state/src/index.ts";
import {
  IDENTITY_TRANSFORM,
  asCharacterId,
  asProjectId,
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

function fixture() {
  const actorId = asCharacterId("actor-1");
  const propId = asPropId("prop-1");
  const actor: ActorState = {
    id: actorId,
    revision: 0,
    transform: IDENTITY_TRANSFORM,
    heldPropIds: [],
  };
  const prop: PropState = {
    id: propId,
    revision: 0,
    transform: transform(2),
    holderCharacterId: null,
  };

  return {
    actorId,
    propId,
    project: createStudioProject({
      projectId: asProjectId("project-1"),
      name: "Foundation Test",
      state: createCanonicalState([actor], [prop]),
    }),
  };
}

describe("core-project", () => {
  it("dispatches through the canonical command engine and journals only accepted changes", () => {
    const { actorId, project } = fixture();
    const moved = dispatchProjectCommand(project, {
      type: "MOVE_ACTOR",
      actorId,
      to: transform(4),
      meta: { source: "human", requestId: "move" },
    });

    expect(moved.accepted).toBe(true);
    if (!moved.accepted) throw new Error("Expected move to be accepted");
    expect(moved.project.state.actors[actorId]?.transform).toEqual(transform(4));
    expect(moved.project.history.journal).toHaveLength(1);
    expect(moved.project.history.undoStack).toHaveLength(1);
    expect(moved.project.history.redoStack).toHaveLength(0);

    const rejected = dispatchProjectCommand(moved.project, {
      type: "MOVE_ACTOR",
      actorId: asCharacterId("missing"),
      to: transform(9),
      meta: { source: "human" },
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.project).toBe(moved.project);
    expect(rejected.project.history.journal).toHaveLength(1);
  });

  it("undoes atomically, keeps an append-only journal, and can redo", () => {
    const { actorId, project } = fixture();
    const moved = dispatchProjectCommand(project, {
      type: "MOVE_ACTOR",
      actorId,
      to: transform(5),
      meta: { source: "human" },
    });
    if (!moved.accepted) throw new Error("Expected move to be accepted");

    const undone = undoProject(moved.project);
    expect(undone.applied).toBe(true);
    if (!undone.applied) throw new Error("Expected undo to apply");
    expect(undone.project.state.actors[actorId]?.transform).toEqual(IDENTITY_TRANSFORM);
    expect(undone.project.history.journal).toHaveLength(2);
    expect(undone.project.history.undoStack).toHaveLength(0);
    expect(undone.project.history.redoStack).toHaveLength(1);

    const redone = redoProject(undone.project);
    expect(redone.applied).toBe(true);
    if (!redone.applied) throw new Error("Expected redo to apply");
    expect(redone.project.state.actors[actorId]?.transform).toEqual(transform(5));
    expect(redone.project.history.journal).toHaveLength(3);
    expect(redone.project.history.undoStack).toHaveLength(1);
    expect(redone.project.history.redoStack).toHaveLength(0);
    expect(redone.project.state.revision).toBe(3);
  });

  it("clears redo history when a new command branches after undo", () => {
    const { actorId, project } = fixture();
    const first = dispatchProjectCommand(project, {
      type: "MOVE_ACTOR",
      actorId,
      to: transform(1),
      meta: { source: "human" },
    });
    if (!first.accepted) throw new Error("Expected first move");

    const second = dispatchProjectCommand(first.project, {
      type: "MOVE_ACTOR",
      actorId,
      to: transform(2),
      meta: { source: "human" },
    });
    if (!second.accepted) throw new Error("Expected second move");

    const undone = undoProject(second.project);
    if (!undone.applied) throw new Error("Expected undo");
    expect(undone.project.history.redoStack).toHaveLength(1);

    const branch = dispatchProjectCommand(undone.project, {
      type: "MOVE_ACTOR",
      actorId,
      to: transform(10),
      meta: { source: "human" },
    });
    if (!branch.accepted) throw new Error("Expected branch move");
    expect(branch.project.history.redoStack).toHaveLength(0);
    expect(branch.project.state.actors[actorId]?.transform).toEqual(transform(10));
  });

  it("undoes and redoes prop ownership through the same command pipeline", () => {
    const { actorId, propId, project } = fixture();
    const pickup = dispatchProjectCommand(project, {
      type: "PICK_UP_PROP",
      actorId,
      propId,
      meta: { source: "human" },
    });
    if (!pickup.accepted) throw new Error("Expected pickup");
    expect(pickup.project.state.props[propId]?.holderCharacterId).toBe(actorId);

    const undone = undoProject(pickup.project);
    if (!undone.applied) throw new Error("Expected undo");
    expect(undone.project.state.props[propId]?.holderCharacterId).toBeNull();
    expect(undone.project.state.props[propId]?.transform).toEqual(transform(2));

    const redone = redoProject(undone.project);
    if (!redone.applied) throw new Error("Expected redo");
    expect(redone.project.state.props[propId]?.holderCharacterId).toBe(actorId);
  });

  it("round-trips a deterministic project snapshot including history", () => {
    const { actorId, project } = fixture();
    const moved = dispatchProjectCommand(project, {
      type: "MOVE_ACTOR",
      actorId,
      to: transform(7, 3),
      meta: { source: "system", requestId: "snapshot-test" },
    });
    if (!moved.accepted) throw new Error("Expected move");

    const serialized = serializeProject(moved.project);
    const restored = deserializeProject(serialized);
    expect(restored).toEqual(moved.project);
    expect(serializeProject(restored)).toBe(serialized);
  });

  it("returns explicit history reasons when undo or redo is unavailable", () => {
    const { project } = fixture();
    const undo = undoProject(project);
    expect(undo.applied).toBe(false);
    if (undo.applied) throw new Error("Undo must not apply");
    expect(undo.reason).toBe("NOTHING_TO_UNDO");

    const redo = redoProject(project);
    expect(redo.applied).toBe(false);
    if (redo.applied) throw new Error("Redo must not apply");
    expect(redo.reason).toBe("NOTHING_TO_REDO");
  });

  it("rejects invalid JSON, unsupported versions and corrupt canonical state", () => {
    expect(() => deserializeProject("{"))
      .toThrowError(expect.objectContaining<ProjectFormatError>({ code: "PROJECT_INVALID_JSON" }));

    const unsupported = JSON.stringify({
      formatVersion: 999,
      projectId: "project-1",
      name: "Wrong",
      state: { revision: 0, actors: {}, props: {} },
      history: { journal: [], undoStack: [], redoStack: [] },
    });
    expect(() => deserializeProject(unsupported))
      .toThrowError(expect.objectContaining<ProjectFormatError>({ code: "PROJECT_UNSUPPORTED_VERSION" }));

    const corrupt = JSON.stringify({
      formatVersion: 1,
      projectId: "project-1",
      name: "Corrupt",
      state: {
        revision: 0,
        actors: {
          "actor-1": {
            id: "actor-1",
            revision: 0,
            transform: IDENTITY_TRANSFORM,
            heldPropIds: ["prop-1"],
          },
        },
        props: {
          "prop-1": {
            id: "prop-1",
            revision: 0,
            transform: transform(2),
            holderCharacterId: null,
          },
        },
      },
      history: { journal: [], undoStack: [], redoStack: [] },
    });

    expect(() => deserializeProject(corrupt))
      .toThrowError(expect.objectContaining<ProjectFormatError>({ code: "PROJECT_INVALID_STATE" }));
  });
});
