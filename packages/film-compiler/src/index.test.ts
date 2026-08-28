import { describe, expect, it } from "vitest";
import {
  asCharacterId,
  asPropId,
  type LocationId,
} from "@aistudio/core-types";
import { compileStory, type StoryEntityRegistry } from "./index.js";

const registry: StoryEntityRegistry = {
  entities: [
    { id: asCharacterId("char_bim"), kind: "character", aliases: ["BIM"] },
    { id: asPropId("prop_key"), kind: "prop", aliases: ["KEY"] },
    { id: asPropId("prop_door"), kind: "prop", aliases: ["DOOR"] },
    { id: "loc_room" as LocationId, kind: "location", aliases: ["ROOM"] },
  ],
};

describe("compileStory", () => {
  it("compiles a deterministic hello-world story into Story IR", () => {
    const source = [
      "BIM ENTER ROOM",
      "BIM NOTICE KEY",
      "BIM WALK_TO KEY",
      "BIM PICK_UP KEY",
      "BIM LOOK_AT DOOR",
      "BIM OPEN DOOR",
      "BIM EXIT ROOM",
    ].join("\n");

    const result = compileStory(source, registry);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.ir.schemaVersion).toBe(1);
    expect(result.ir.events).toHaveLength(7);
    expect(result.ir.events[0]?.id).toBe("story_event_l1");
    expect(result.ir.events[0]?.type).toBe("ENTER");
    expect(result.ir.events[0]?.actorId).toBe("char_bim");
    expect(result.ir.events[0]?.targetId).toBe("loc_room");
    expect(result.ir.events[3]?.effects[1]?.expression).toBe("held_by(prop_key,char_bim)");
    expect(result.ir.events[5]?.effects[0]?.expression).toBe("state(prop_door,open)");
    expect(result.ir.events[6]?.causes).toContain("story_event_l1");
    expect(result.ir.causalEdges.length).toBeGreaterThan(0);
  });

  it("preserves source mapping and deterministic ids", () => {
    const source = "  BIM NOTICE KEY";
    const first = compileStory(source, registry);
    const second = compileStory(source, registry);

    expect(first.ir.events[0]?.id).toBe(second.ir.events[0]?.id);
    expect(first.ir.events[0]?.sourceSpan).toEqual({
      line: 1,
      startColumn: 3,
      endColumn: source.length,
      text: source,
    });
  });

  it("rejects unknown actors and actions with stable diagnostic codes", () => {
    const result = compileStory("GHOST ENTER ROOM\nBIM TELEPORT ROOM", registry);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "STORY_UNKNOWN_ACTOR",
      "STORY_UNKNOWN_ACTION",
    ]);
    expect(result.ir.events).toEqual([]);
  });

  it("rejects invalid target kinds", () => {
    const result = compileStory("BIM OPEN ROOM", registry);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("STORY_INVALID_TARGET_KIND");
  });

  it("requires CHANGE_STATE values", () => {
    const result = compileStory("BIM CHANGE_STATE DOOR", registry);

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("STORY_MISSING_STATE_VALUE");
  });

  it("allows comments and blank lines without changing source line ids", () => {
    const result = compileStory("# setup\n\nBIM NOTICE KEY", registry);

    expect(result.ok).toBe(true);
    expect(result.ir.events[0]?.id).toBe("story_event_l3");
  });
});
