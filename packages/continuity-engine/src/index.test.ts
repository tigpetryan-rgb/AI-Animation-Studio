import { describe, expect, it } from "vitest";
import { createCanonicalState, type ActorState, type PropState } from "@aistudio/core-state";
import {
  asCharacterId,
  asPropId,
  IDENTITY_TRANSFORM,
} from "@aistudio/core-types";
import {
  contractFromCanonicalState,
  evaluateContinuity,
  repairAuthority,
  type CharacterContinuitySpec,
  type CandidateObservation,
  type QCPolicyProfile,
} from "./index.js";

const bim = asCharacterId("char_bim");
const friend = asCharacterId("char_friend");
const key = asPropId("prop_key");

const actor: ActorState = {
  id: bim,
  revision: 0,
  transform: IDENTITY_TRANSFORM,
  heldPropIds: [key],
};

const prop: PropState = {
  id: key,
  revision: 0,
  transform: IDENTITY_TRANSFORM,
  holderCharacterId: bim,
};

const characterSpec: CharacterContinuitySpec = {
  characterId: bim,
  definitionVersion: 1,
  identityComponents: [
    { key: "face", lock: "HARD" },
    { key: "palette", lock: "SOFT" },
  ],
  properties: [
    { key: "wardrobe", expected: "outfit_01", lock: "HARD" },
    { key: "expression", expected: "curious", lock: "ANIMATABLE" },
  ],
  requiredAccessories: [{ id: "pendant_star", lock: "HARD" }],
};

const policy: QCPolicyProfile = {
  hardIdentityThreshold: 0.9,
  softIdentityThreshold: 0.8,
  warningIdentityThreshold: 0.7,
};

function observation(overrides: Partial<CandidateObservation> = {}): CandidateObservation {
  return {
    characters: [{
      characterId: bim,
      identityScores: { face: 0.99, palette: 0.95 },
      properties: { wardrobe: "outfit_01", expression: "happy" },
      accessories: ["pendant_star"],
    }],
    props: [{ propId: key, holderCharacterId: bim }],
    ...overrides,
  };
}

describe("continuity engine", () => {
  it("derives prop ownership from canonical state and passes an exact candidate", () => {
    const state = createCanonicalState([actor], [prop]);
    const contract = contractFromCanonicalState("shot_1", state, [characterSpec]);
    const report = evaluateContinuity(contract, observation(), policy);
    expect(contract.props[0]?.expectedHolderCharacterId).toBe(bim);
    expect(report.overall).toBe("PASS");
    expect(report.checks).toEqual([]);
  });

  it("does not let a high average hide one hard identity failure", () => {
    const contract = contractFromCanonicalState("shot_1", createCanonicalState([actor], [prop]), [characterSpec]);
    const report = evaluateContinuity(contract, observation({
      characters: [{
        characterId: bim,
        identityScores: { face: 0.2, palette: 1 },
        properties: { wardrobe: "outfit_01" },
        accessories: ["pendant_star"],
      }],
    }), policy);
    expect(report.displayScore).toBe(0.6);
    expect(report.overall).toBe("HARD_FAIL");
    expect(report.checks.some((check) => check.code === "CONT_IDENTITY_HARD_MISMATCH")).toBe(true);
  });

  it("reports soft identity failure below policy threshold", () => {
    const contract = contractFromCanonicalState("shot_1", createCanonicalState([actor], [prop]), [characterSpec]);
    const report = evaluateContinuity(contract, observation({
      characters: [{
        characterId: bim,
        identityScores: { face: 0.99, palette: 0.75 },
        properties: { wardrobe: "outfit_01" },
        accessories: ["pendant_star"],
      }],
    }), policy);
    expect(report.overall).toBe("FAIL");
    expect(report.checks[0]?.code).toBe("CONT_IDENTITY_SOFT_MISMATCH");
  });

  it("treats canonical prop ownership mismatch as hard fail", () => {
    const contract = contractFromCanonicalState("shot_1", createCanonicalState([actor], [prop]), [characterSpec]);
    const report = evaluateContinuity(contract, observation({
      props: [{ propId: key, holderCharacterId: friend }],
    }), policy);
    expect(report.overall).toBe("HARD_FAIL");
    expect(report.checks.find((check) => check.code === "CONT_PROP_HOLDER_MISMATCH")?.expected).toBe(bim);
  });

  it("allows unpinned animatable differences", () => {
    const contract = contractFromCanonicalState("shot_1", createCanonicalState([actor], [prop]), [characterSpec]);
    const report = evaluateContinuity(contract, observation(), policy);
    expect(report.checks.some((check) => check.field === "expression")).toBe(false);
  });

  it("hard-fails a missing hard accessory", () => {
    const contract = contractFromCanonicalState("shot_1", createCanonicalState([actor], [prop]), [characterSpec]);
    const report = evaluateContinuity(contract, observation({
      characters: [{
        characterId: bim,
        identityScores: { face: 0.99, palette: 0.95 },
        properties: { wardrobe: "outfit_01" },
        accessories: [],
      }],
    }), policy);
    expect(report.overall).toBe("HARD_FAIL");
    const check = report.checks.find((item) => item.code === "CONT_ACCESSORY_HARD_MISSING");
    expect(check).toBeDefined();
    expect(check === undefined ? "NONE" : repairAuthority(check)).toBe("AUTO_LOCAL");
  });

  it("requires canonical decision for prop ownership repair", () => {
    const contract = contractFromCanonicalState("shot_1", createCanonicalState([actor], [prop]), [characterSpec]);
    const report = evaluateContinuity(contract, observation({ props: [{ propId: key, holderCharacterId: friend }] }), policy);
    const check = report.checks.find((item) => item.code === "CONT_PROP_HOLDER_MISMATCH");
    expect(check).toBeDefined();
    expect(check === undefined ? "NONE" : repairAuthority(check)).toBe("REQUIRES_CANONICAL_DECISION");
  });
});
