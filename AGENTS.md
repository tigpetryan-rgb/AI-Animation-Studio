# AGENTS.md — MANDATORY REPOSITORY WORKING CONTRACT

**Scope: entire repository.**

Before doing anything else in this repository, every coding/review/CI/release agent or ChatGPT work session MUST read:

1. [`CANONICAL_MASTER_PLAN.md`](./CANONICAL_MASTER_PLAN.md)
2. Then only the archive/handoff material relevant to the active phase.

The canonical Drive mirror is:
https://docs.google.com/document/d/1fBywdZl3_D7YEGp76Eivb-zB2ACnmh77GO2KCf7uWpE/edit

## Non-negotiable operating rules

- The plan controls execution order and product logic.
- Live GitHub controls current branch/SHA/CI/code facts.
- Re-check the real branch head and exact 40-char SHA before code/CI/artifact conclusions.
- Work on exactly one active plan phase and one concrete next objective.
- Do not open a later phase until the current phase DONE gate is proven.
- `⚠️` does not become `✅` merely because code exists.
- Do not revive any `🗑️` direction without explicit user instruction and a canonical-plan update.
- Current production direction is **native Android**, not browser/PWA/WebView.
- External semantic AI may propose strict Scene/Story IR; provider secrets must never be packaged in APK.
- Keep character appearance, actor performance, camera, lighting, world state, timeline, render, media, QC, and canonical state as explicit layers.
- Preserve deterministic engines and canonical state; AI output is candidate input, not truth.
- Do not rewrite completed Foundation/Timeline/Persistence/Media layers without evidence.
- Do not merge any PR without explicit user instruction.
- Do not treat skipped CI/release stages as PASS.
- Do not treat artifacts from failed CI as final release artifacts.
- Physical-device certification cannot be replaced by emulator/simulator evidence.
- If parallel chats are used, they must have non-overlapping subproblems, one integration owner, and the same exact base SHA/active phase.
- Only one code-writer may modify overlapping code. Verifier/auditor roles remain read-only unless explicitly assigned otherwise.
- If GitHub and Drive canonical plan copies disagree, do not invent a new direction; report the contradiction and take the least-deviation safe action until reconciled.

## Current phase

**PHASE 3 IS COMPLETE. PHASE 4 — ACTOR PERFORMANCE ENGINE — IS THE CURRENT MANDATORY PRODUCTION PHASE.**

Latest verified Phase-3 technical checkpoint below is historical evidence and MUST be reverified live before relying on it:

- branch: `m58/native-3d-character-runtime`
- exact technical SHA: `14ef943f32db2a6edce2cca50cc343b7bd8021c2`
- Phase 3 Character CI #6: SUCCESS
- Foundation CI #334: SUCCESS
- Native Android CI #93: SUCCESS
- multi-view PNG reference silhouettes drive measurably source-dependent 3D proportions: SUCCESS
- real topology/humanoid rig/skinning/UV/material regions: SUCCESS
- exact reference appearance bytes owned by reusable `CharacterDefinition3D`: SUCCESS
- checksummed save/reopen and exact appearance/materialization continuity: SUCCESS
- exact-head native APK/security/provenance checks: SUCCESS
- artifact: `studio-native-android-14ef943f32db2a6edce2cca50cc343b7bd8021c2`
- artifact digest: `sha256:da52a0c002ab6d0017eb0b0c9953edb27fca47bb188275ac93c183debdaa8d63`

Current concrete objective:

**Turn the reusable Phase-3 character into a deterministic virtual actor: blocking/locomotion, turns, root motion + retargeting, IK/foot lock/contact continuity, body/head/face/hands/gaze layers, prop pickup/use, emotion/reaction timing and acting-intent/microperformance hooks.**

Phase-4 DONE gate requires one script-driven multi-step scene: walk, stop, look/turn, interact with a prop, react and express emotion without visible contact/continuity collapse.

Do not start Phase 5 Virtual Director/Camera until Phase 4's DONE gate is proven.

## Required session ending

Every significant work session must leave a continuation package with:

- Plan version
- Active phase
- Exact branch + 40-char SHA
- CI status
- Artifact/evidence status
- What changed
- What remains
- Exact next action

When context becomes heavy, prefer stopping with a clean continuation package rather than drifting from the canonical plan.
