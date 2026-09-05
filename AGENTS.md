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

**PHASE 4 IS COMPLETE. PHASE 5 — VIRTUAL DIRECTOR + CAMERA — IS THE CURRENT MANDATORY PRODUCTION PHASE.**

Latest verified Phase-4 technical checkpoint below is historical evidence and MUST be reverified live before relying on it:

- branch: `m58/native-3d-character-runtime`
- exact technical SHA: `30b0186766b747f4844cba3f4fb91fea4e13349d`
- Phase 4 Actor Performance CI #4 attempt 2: SUCCESS
- Foundation CI #343: SUCCESS
- Native Android CI #102: SUCCESS
- walk/stop/turn/look/prop pickup+use/reaction multi-step performance: SUCCESS
- root motion + semantic retargeting: SUCCESS
- explicit foot-lock/right-hand/prop-grasp contacts: SUCCESS
- body/head/face/gaze/hands/secondary acting layers: SUCCESS
- emotion/reaction + blink/breath/gaze/head-lead microperformance hooks: SUCCESS
- deterministic equivalent performance after reusable-character reopen: SUCCESS
- real Phase-3 skinned mesh remains finite, volumetric, bounded and continuous across sampled performance poses: SUCCESS
- exact-head native APK/security/provenance checks: SUCCESS
- artifact: `studio-native-android-30b0186766b747f4844cba3f4fb91fea4e13349d`
- artifact digest: `sha256:1e72f9a010743f967c53d04a40ab967b428123c270f114ecc0e9644e090d5199`

The first Phase-4 CI #4 attempt was an infrastructure-only Maven Central HTTP 429 failure before project/test execution; the unchanged exact SHA passed attempt 2. Do not reinterpret that external rate-limit event as a product failure.

Current concrete objective:

**Build the deterministic Virtual Director + Camera engine over the accepted Phase-4 master performance: shot sizes, composition/framing, lens/FOV, angle, camera zones, static/dolly/pan/tilt/orbit/tracking motion, subject visibility, collision avoidance, eyeline/continuity, one-performance-many-cameras and shot selection from story/performance intent.**

Phase-5 DONE gate requires the same master performance to produce multiple logical, cinematic, continuity-safe shots without actor/world collision or broken framing.

Do not start Phase 6 Lighting + World Production until Phase 5's DONE gate is proven.

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
