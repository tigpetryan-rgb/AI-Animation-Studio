import {
  asEventId,
  type CharacterId,
  type EventId,
  type LocationId,
  type PropId,
} from "@aistudio/core-types";

export type StoryAction =
  | "ENTER"
  | "EXIT"
  | "MOVE_TO"
  | "WALK_TO"
  | "RUN_TO"
  | "TURN_TO"
  | "LOOK_AT"
  | "NOTICE"
  | "SEARCH_FOR"
  | "PICK_UP"
  | "PUT_DOWN"
  | "GIVE"
  | "RECEIVE"
  | "TOUCH"
  | "USE"
  | "OPEN"
  | "CLOSE"
  | "LOCK"
  | "UNLOCK"
  | "SIT"
  | "STAND"
  | "WAIT"
  | "SPEAK"
  | "RESPOND"
  | "REACT"
  | "CHANGE_STATE";

export type EntityKind = "character" | "prop" | "location";
export type StoryEntityId = CharacterId | PropId | LocationId;

export interface StoryEntityRef {
  readonly id: StoryEntityId;
  readonly kind: EntityKind;
  readonly aliases: readonly string[];
}

export interface StoryEntityRegistry {
  readonly entities: readonly StoryEntityRef[];
}

export interface SourceSpan {
  readonly line: number;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly text: string;
}

export interface StoryPredicate {
  readonly kind: "precondition" | "effect";
  readonly expression: string;
}

export interface StoryEvent {
  readonly id: EventId;
  readonly type: StoryAction;
  readonly actorId: CharacterId;
  readonly targetId?: StoryEntityId;
  readonly parameters: Readonly<Record<string, string>>;
  readonly preconditions: readonly StoryPredicate[];
  readonly effects: readonly StoryPredicate[];
  readonly causes: readonly EventId[];
  readonly sourceSpan: SourceSpan;
  readonly confidence: number;
  readonly humanLock: boolean;
}

export interface CausalEdge {
  readonly from: EventId;
  readonly to: EventId;
  readonly kind: "entity" | "temporal";
}

export interface StoryIR {
  readonly schemaVersion: 1;
  readonly source: string;
  readonly events: readonly StoryEvent[];
  readonly causalEdges: readonly CausalEdge[];
}

export type StoryDiagnosticCode =
  | "STORY_EMPTY_SOURCE"
  | "STORY_INVALID_STATEMENT"
  | "STORY_UNKNOWN_ACTION"
  | "STORY_UNKNOWN_ACTOR"
  | "STORY_UNKNOWN_TARGET"
  | "STORY_INVALID_TARGET_KIND"
  | "STORY_MISSING_TARGET"
  | "STORY_UNEXPECTED_TARGET"
  | "STORY_MISSING_STATE_VALUE";

export interface StoryDiagnostic {
  readonly code: StoryDiagnosticCode;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly sourceSpan?: SourceSpan;
}

export interface StoryCompileResult {
  readonly ok: boolean;
  readonly ir: StoryIR;
  readonly diagnostics: readonly StoryDiagnostic[];
}

export interface StoryParserAdapter {
  parse(source: string, registry: StoryEntityRegistry): StoryCompileResult;
}

const ACTIONS: ReadonlySet<string> = new Set<StoryAction>([
  "ENTER", "EXIT", "MOVE_TO", "WALK_TO", "RUN_TO", "TURN_TO", "LOOK_AT", "NOTICE",
  "SEARCH_FOR", "PICK_UP", "PUT_DOWN", "GIVE", "RECEIVE", "TOUCH", "USE", "OPEN",
  "CLOSE", "LOCK", "UNLOCK", "SIT", "STAND", "WAIT", "SPEAK", "RESPOND", "REACT",
  "CHANGE_STATE",
]);

const NO_TARGET = new Set<StoryAction>(["SIT", "STAND", "WAIT", "SPEAK", "RESPOND", "REACT"]);
const LOCATION_TARGET = new Set<StoryAction>(["ENTER", "EXIT"]);
const PROP_TARGET = new Set<StoryAction>([
  "PICK_UP", "PUT_DOWN", "GIVE", "RECEIVE", "TOUCH", "USE", "OPEN", "CLOSE", "LOCK", "UNLOCK",
]);

function normalizeAlias(value: string): string {
  return value.trim().toLocaleUpperCase("en-US");
}

function buildAliasIndex(registry: StoryEntityRegistry): ReadonlyMap<string, StoryEntityRef> {
  const index = new Map<string, StoryEntityRef>();
  for (const entity of registry.entities) {
    index.set(normalizeAlias(entity.id), entity);
    for (const alias of entity.aliases) {
      index.set(normalizeAlias(alias), entity);
    }
  }
  return index;
}

function spanFor(line: string, lineNumber: number): SourceSpan {
  const firstNonWhitespace = line.search(/\S/);
  return {
    line: lineNumber,
    startColumn: firstNonWhitespace < 0 ? 1 : firstNonWhitespace + 1,
    endColumn: Math.max(line.length, 1),
    text: line,
  };
}

function diagnostic(
  code: StoryDiagnosticCode,
  message: string,
  sourceSpan?: SourceSpan,
): StoryDiagnostic {
  return sourceSpan === undefined
    ? { code, severity: "error", message }
    : { code, severity: "error", message, sourceSpan };
}

function expectedTargetKind(action: StoryAction): EntityKind | "any" | "none" {
  if (NO_TARGET.has(action)) return "none";
  if (LOCATION_TARGET.has(action)) return "location";
  if (PROP_TARGET.has(action)) return "prop";
  return "any";
}

function buildPredicates(
  action: StoryAction,
  actorId: CharacterId,
  targetId: StoryEntityId | undefined,
  parameters: Readonly<Record<string, string>>,
): { readonly preconditions: readonly StoryPredicate[]; readonly effects: readonly StoryPredicate[] } {
  const actor = String(actorId);
  const target = targetId === undefined ? undefined : String(targetId);
  const preconditions: StoryPredicate[] = [];
  const effects: StoryPredicate[] = [];

  if (target !== undefined) {
    preconditions.push({ kind: "precondition", expression: `exists(${target})` });
  }

  switch (action) {
    case "ENTER":
      effects.push({ kind: "effect", expression: `present(${actor},${target})` });
      break;
    case "EXIT":
      effects.push({ kind: "effect", expression: `not_present(${actor},${target})` });
      break;
    case "NOTICE":
      effects.push({ kind: "effect", expression: `knows(${actor},${target})` });
      break;
    case "PICK_UP":
      preconditions.push({ kind: "precondition", expression: `available(${target})` });
      effects.push({ kind: "effect", expression: `held_by(${target},${actor})` });
      break;
    case "PUT_DOWN":
      preconditions.push({ kind: "precondition", expression: `held_by(${target},${actor})` });
      effects.push({ kind: "effect", expression: `not_held(${target})` });
      break;
    case "OPEN":
      effects.push({ kind: "effect", expression: `state(${target},open)` });
      break;
    case "CLOSE":
      effects.push({ kind: "effect", expression: `state(${target},closed)` });
      break;
    case "LOCK":
      effects.push({ kind: "effect", expression: `state(${target},locked)` });
      break;
    case "UNLOCK":
      effects.push({ kind: "effect", expression: `state(${target},unlocked)` });
      break;
    case "CHANGE_STATE":
      effects.push({ kind: "effect", expression: `state(${target},${parameters.value ?? "unknown"})` });
      break;
    default:
      effects.push({ kind: "effect", expression: `performed(${actor},${action}${target === undefined ? "" : `,${target}`})` });
      break;
  }

  return { preconditions, effects };
}

function parseParameters(action: StoryAction, tokens: readonly string[]): Readonly<Record<string, string>> {
  if (action === "SPEAK") {
    return { text: tokens.slice(2).join(" ") };
  }
  if (action === "CHANGE_STATE") {
    return tokens[3] === undefined ? {} : { value: tokens.slice(3).join(" ") };
  }
  return {};
}

export function compileStory(source: string, registry: StoryEntityRegistry): StoryCompileResult {
  const diagnostics: StoryDiagnostic[] = [];
  const events: StoryEvent[] = [];
  const causalEdges: CausalEdge[] = [];
  const aliases = buildAliasIndex(registry);
  const lastEventByEntity = new Map<string, EventId>();

  if (source.trim().length === 0) {
    diagnostics.push(diagnostic("STORY_EMPTY_SOURCE", "Story source is empty."));
  }

  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index] ?? "";
    const trimmed = original.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const span = spanFor(original, index + 1);
    const tokens = trimmed.split(/\s+/);
    if (tokens.length < 2) {
      diagnostics.push(diagnostic("STORY_INVALID_STATEMENT", "Expected ACTOR ACTION [TARGET].", span));
      continue;
    }

    const actorToken = tokens[0] ?? "";
    const actionToken = normalizeAlias(tokens[1] ?? "");
    const actor = aliases.get(normalizeAlias(actorToken));

    if (actor === undefined || actor.kind !== "character") {
      diagnostics.push(diagnostic("STORY_UNKNOWN_ACTOR", `Unknown character alias: ${actorToken}.`, span));
      continue;
    }

    if (!ACTIONS.has(actionToken)) {
      diagnostics.push(diagnostic("STORY_UNKNOWN_ACTION", `Unknown story action: ${actionToken}.`, span));
      continue;
    }

    const action = actionToken as StoryAction;
    const targetKind = expectedTargetKind(action);
    const targetToken = targetKind === "none" || action === "SPEAK" ? undefined : tokens[2];
    let target: StoryEntityRef | undefined;

    if (targetKind !== "none") {
      if (targetToken === undefined) {
        diagnostics.push(diagnostic("STORY_MISSING_TARGET", `${action} requires a target.`, span));
        continue;
      }
      target = aliases.get(normalizeAlias(targetToken));
      if (target === undefined) {
        diagnostics.push(diagnostic("STORY_UNKNOWN_TARGET", `Unknown target alias: ${targetToken}.`, span));
        continue;
      }
      if (targetKind !== "any" && target.kind !== targetKind) {
        diagnostics.push(diagnostic(
          "STORY_INVALID_TARGET_KIND",
          `${action} requires a ${targetKind} target, received ${target.kind}.`,
          span,
        ));
        continue;
      }
    } else if (action !== "SPEAK" && tokens[2] !== undefined) {
      diagnostics.push(diagnostic("STORY_UNEXPECTED_TARGET", `${action} does not accept a target.`, span));
      continue;
    }

    const parameters = parseParameters(action, tokens);
    if (action === "CHANGE_STATE" && parameters.value === undefined) {
      diagnostics.push(diagnostic("STORY_MISSING_STATE_VALUE", "CHANGE_STATE requires a state value.", span));
      continue;
    }

    const id = asEventId(`story_event_l${index + 1}`);
    const touchedEntities = [String(actor.id), ...(target === undefined ? [] : [String(target.id)])];
    const causes = Array.from(new Set(
      touchedEntities
        .map((entityId) => lastEventByEntity.get(entityId))
        .filter((eventId): eventId is EventId => eventId !== undefined),
    ));

    for (const cause of causes) {
      causalEdges.push({ from: cause, to: id, kind: "entity" });
    }

    const predicates = buildPredicates(action, actor.id as CharacterId, target?.id, parameters);
    const event: StoryEvent = {
      id,
      type: action,
      actorId: actor.id as CharacterId,
      ...(target === undefined ? {} : { targetId: target.id }),
      parameters,
      preconditions: predicates.preconditions,
      effects: predicates.effects,
      causes,
      sourceSpan: span,
      confidence: 1,
      humanLock: false,
    };
    events.push(event);

    for (const entityId of touchedEntities) {
      lastEventByEntity.set(entityId, id);
    }
  }

  const ir: StoryIR = {
    schemaVersion: 1,
    source,
    events,
    causalEdges,
  };

  return {
    ok: !diagnostics.some((item) => item.severity === "error"),
    ir,
    diagnostics,
  };
}

export const deterministicStoryParser: StoryParserAdapter = {
  parse: compileStory,
};
