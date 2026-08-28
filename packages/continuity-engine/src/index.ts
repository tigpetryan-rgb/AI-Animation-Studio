import type { CanonicalState } from "@aistudio/core-state";
import type { CharacterId, PropId } from "@aistudio/core-types";

export type LockClass = "HARD" | "SOFT" | "ANIMATABLE";
export type ContinuitySeverity = "INFO" | "WARNING" | "FAIL" | "HARD_FAIL";
export type ContinuityOverall = "PASS" | "WARNING" | "FAIL" | "HARD_FAIL";

export interface ContinuityPropertySpec {
  readonly key: string;
  readonly expected: string;
  readonly lock: LockClass;
  readonly pinned?: boolean;
}

export interface IdentityComponentSpec {
  readonly key: string;
  readonly lock: LockClass;
}

export interface CharacterContinuitySpec {
  readonly characterId: CharacterId;
  readonly definitionVersion: number;
  readonly identityComponents: readonly IdentityComponentSpec[];
  readonly properties: readonly ContinuityPropertySpec[];
  readonly requiredAccessories: readonly { readonly id: string; readonly lock: LockClass }[];
}

export interface PropContinuitySpec {
  readonly propId: PropId;
  readonly expectedHolderCharacterId: CharacterId | null;
  readonly lock: LockClass;
}

export interface ContinuityContract {
  readonly shotId: string;
  readonly characters: readonly CharacterContinuitySpec[];
  readonly props: readonly PropContinuitySpec[];
}

export interface CharacterObservation {
  readonly characterId: CharacterId;
  readonly identityScores: Readonly<Record<string, number | undefined>>;
  readonly properties: Readonly<Record<string, string | undefined>>;
  readonly accessories: readonly string[];
}

export interface PropObservation {
  readonly propId: PropId;
  readonly holderCharacterId: CharacterId | null | undefined;
}

export interface CandidateObservation {
  readonly characters: readonly CharacterObservation[];
  readonly props: readonly PropObservation[];
}

export interface QCPolicyProfile {
  readonly hardIdentityThreshold: number;
  readonly softIdentityThreshold: number;
  readonly warningIdentityThreshold: number;
}

export type ContinuityCheckCode =
  | "CONT_CHARACTER_MISSING"
  | "CONT_IDENTITY_HARD_MISMATCH"
  | "CONT_IDENTITY_SOFT_MISMATCH"
  | "CONT_IDENTITY_WARNING"
  | "CONT_PROPERTY_HARD_MISMATCH"
  | "CONT_PROPERTY_SOFT_MISMATCH"
  | "CONT_ANIMATABLE_PIN_MISMATCH"
  | "CONT_ACCESSORY_HARD_MISSING"
  | "CONT_ACCESSORY_SOFT_MISSING"
  | "CONT_PROP_OBSERVATION_MISSING"
  | "CONT_PROP_HOLDER_MISMATCH";

export interface ContinuityCheck {
  readonly code: ContinuityCheckCode;
  readonly severity: ContinuitySeverity;
  readonly targetId: string;
  readonly field?: string;
  readonly expected?: string;
  readonly observed?: string;
  readonly score?: number;
}

export interface ContinuityReport {
  readonly overall: ContinuityOverall;
  readonly checks: readonly ContinuityCheck[];
  readonly displayScore?: number;
}

export type RepairAuthority = "AUTO_LOCAL" | "REQUIRES_CANONICAL_DECISION" | "NONE";

function maxOverall(a: ContinuityOverall, severity: ContinuitySeverity): ContinuityOverall {
  const rank: Record<ContinuityOverall, number> = { PASS: 0, WARNING: 1, FAIL: 2, HARD_FAIL: 3 };
  const mapped: ContinuityOverall = severity === "INFO" ? "PASS" : severity;
  return rank[mapped] > rank[a] ? mapped : a;
}

function validatePolicy(policy: QCPolicyProfile): void {
  for (const [key, value] of Object.entries(policy)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`${key} must be between 0 and 1.`);
    }
  }
  if (policy.warningIdentityThreshold > policy.softIdentityThreshold || policy.softIdentityThreshold > policy.hardIdentityThreshold) {
    throw new RangeError("Identity thresholds must satisfy warning <= soft <= hard.");
  }
}

export function contractFromCanonicalState(
  shotId: string,
  state: CanonicalState,
  characters: readonly CharacterContinuitySpec[],
  propLocks: Readonly<Record<string, LockClass>> = {},
): ContinuityContract {
  return {
    shotId,
    characters,
    props: Object.values(state.props)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((prop) => ({
        propId: prop.id,
        expectedHolderCharacterId: prop.holderCharacterId,
        lock: propLocks[prop.id] ?? "HARD",
      })),
  };
}

export function evaluateContinuity(
  contract: ContinuityContract,
  observation: CandidateObservation,
  policy: QCPolicyProfile,
): ContinuityReport {
  validatePolicy(policy);
  const checks: ContinuityCheck[] = [];
  const scored: number[] = [];
  const observedCharacters = new Map(observation.characters.map((item) => [item.characterId, item]));
  const observedProps = new Map(observation.props.map((item) => [item.propId, item]));

  for (const spec of contract.characters) {
    const observed = observedCharacters.get(spec.characterId);
    if (observed === undefined) {
      checks.push({ code: "CONT_CHARACTER_MISSING", severity: "HARD_FAIL", targetId: spec.characterId });
      continue;
    }

    for (const identity of spec.identityComponents) {
      const score = observed.identityScores[identity.key];
      if (score === undefined) continue;
      scored.push(score);
      if (identity.lock === "HARD" && score < policy.hardIdentityThreshold) {
        checks.push({ code: "CONT_IDENTITY_HARD_MISMATCH", severity: "HARD_FAIL", targetId: spec.characterId, field: identity.key, score });
      } else if (identity.lock === "SOFT" && score < policy.softIdentityThreshold) {
        checks.push({ code: "CONT_IDENTITY_SOFT_MISMATCH", severity: "FAIL", targetId: spec.characterId, field: identity.key, score });
      } else if (score < policy.warningIdentityThreshold) {
        checks.push({ code: "CONT_IDENTITY_WARNING", severity: "WARNING", targetId: spec.characterId, field: identity.key, score });
      }
    }

    for (const property of spec.properties) {
      const actual = observed.properties[property.key];
      if (actual === undefined || actual === property.expected) continue;
      if (property.lock === "HARD") {
        checks.push({ code: "CONT_PROPERTY_HARD_MISMATCH", severity: "HARD_FAIL", targetId: spec.characterId, field: property.key, expected: property.expected, observed: actual });
      } else if (property.lock === "SOFT") {
        checks.push({ code: "CONT_PROPERTY_SOFT_MISMATCH", severity: "FAIL", targetId: spec.characterId, field: property.key, expected: property.expected, observed: actual });
      } else if (property.pinned === true) {
        checks.push({ code: "CONT_ANIMATABLE_PIN_MISMATCH", severity: "FAIL", targetId: spec.characterId, field: property.key, expected: property.expected, observed: actual });
      }
    }

    const accessorySet = new Set(observed.accessories);
    for (const accessory of spec.requiredAccessories) {
      if (accessorySet.has(accessory.id)) continue;
      checks.push({
        code: accessory.lock === "HARD" ? "CONT_ACCESSORY_HARD_MISSING" : "CONT_ACCESSORY_SOFT_MISSING",
        severity: accessory.lock === "HARD" ? "HARD_FAIL" : "FAIL",
        targetId: spec.characterId,
        field: accessory.id,
        expected: "present",
        observed: "missing",
      });
    }
  }

  for (const spec of contract.props) {
    const observed = observedProps.get(spec.propId);
    if (observed === undefined || observed.holderCharacterId === undefined) {
      checks.push({ code: "CONT_PROP_OBSERVATION_MISSING", severity: "WARNING", targetId: spec.propId });
      continue;
    }
    if (observed.holderCharacterId !== spec.expectedHolderCharacterId) {
      checks.push({
        code: "CONT_PROP_HOLDER_MISMATCH",
        severity: spec.lock === "HARD" ? "HARD_FAIL" : "FAIL",
        targetId: spec.propId,
        expected: spec.expectedHolderCharacterId ?? "none",
        observed: observed.holderCharacterId ?? "none",
      });
    }
  }

  let overall: ContinuityOverall = "PASS";
  for (const check of checks) overall = maxOverall(overall, check.severity);
  const displayScore = scored.length === 0 ? undefined : scored.reduce((sum, value) => sum + value, 0) / scored.length;
  return displayScore === undefined ? { overall, checks } : { overall, checks, displayScore };
}

export function repairAuthority(check: ContinuityCheck): RepairAuthority {
  switch (check.code) {
    case "CONT_IDENTITY_HARD_MISMATCH":
    case "CONT_IDENTITY_SOFT_MISMATCH":
    case "CONT_IDENTITY_WARNING":
    case "CONT_ACCESSORY_HARD_MISSING":
    case "CONT_ACCESSORY_SOFT_MISSING":
      return "AUTO_LOCAL";
    case "CONT_PROP_HOLDER_MISMATCH":
    case "CONT_PROPERTY_HARD_MISMATCH":
    case "CONT_PROPERTY_SOFT_MISMATCH":
    case "CONT_ANIMATABLE_PIN_MISMATCH":
      return "REQUIRES_CANONICAL_DECISION";
    case "CONT_CHARACTER_MISSING":
    case "CONT_PROP_OBSERVATION_MISSING":
      return "NONE";
  }
}
