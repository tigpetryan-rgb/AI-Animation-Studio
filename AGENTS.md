# AGENTS.md — MANDATORY REPOSITORY WORKING CONTRACT

**Scope: entire repository.**

Before any coding/review/CI/release work, every agent or ChatGPT session MUST read:

1. [`CANONICAL_MASTER_PLAN.md`](./CANONICAL_MASTER_PLAN.md)
2. Then only the archive/handoff material relevant to the active phase.

Canonical Drive mirror:
https://docs.google.com/document/d/1fBywdZl3_D7YEGp76Eivb-zB2ACnmh77GO2KCf7uWpE/edit

## Non-negotiable operating rules

- The plan controls execution order and product logic.
- Live GitHub controls current branch/SHA/CI/code facts.
- Re-check the real branch head and exact 40-char SHA before code/CI/artifact conclusions.
- Work on exactly one active plan phase and one concrete next objective.
- Do not open a later phase until the current phase DONE gate is proven.
- `⚠️` never becomes `✅` merely because code exists.
- Do not revive any `🗑️` direction without explicit user instruction and a canonical-plan update.
- Current production direction is **native Android**, not browser/PWA/WebView.
- External semantic AI may propose strict Scene/Story IR; provider secrets must never be packaged in APK.
- Keep character appearance, actor performance, camera, lighting, world state, timeline, render, media, QC and canonical state as explicit layers.
- Preserve deterministic engines and canonical state; AI output is candidate input, not truth.
- Do not rewrite completed Foundation/Timeline/Persistence/Media layers without evidence.
- Do not merge any PR without explicit user instruction.
- Skipped CI/release stages are not PASS; failed-CI artifacts are not final.
- Physical-device certification cannot be replaced by emulator/simulator evidence.
- Parallel chats must use non-overlapping subproblems, one integration owner and the same exact base SHA/active phase.
- Only one code-writer may modify overlapping code.
- If GitHub and Drive canonical copies disagree, report the contradiction and take the least-deviation safe action until reconciled.

## Current phase

**PHASE 6 IS COMPLETE. PHASE 7 — SCENE IR → FULL PRODUCTION ORCHESTRATION — IS THE CURRENT MANDATORY PRODUCTION PHASE.**

Latest verified Phase-6 technical checkpoint is historical evidence and MUST be reverified live before relying on it:

- branch: `m58/native-3d-character-runtime`
- exact technical SHA: `79ca570b1796c43ec134599457051dbf9255c9b1`
- Phase 6 World Lighting CI #4: SUCCESS
- Foundation CI #358: SUCCESS
- Native Android CI #117: SUCCESS
- canonical semantic anchors replace rehearsal target anchors: SUCCESS
- accepted Phase-4 actor root tracks rebase to the canonical world path: SUCCESS
- RIGHT_HAND / PROP_GRASP contacts bind to the canonical prop anchor: SUCCESS
- deterministic prop ownership/state transitions: SUCCESS
- environment bounds + actor/camera collision clearance against world obstacles/props: SUCCESS
- accepted Phase-5 camera coverage rebased onto canonical world state: SUCCESS
- deterministic key/fill/rim/environment lighting + exposure/subject visibility: SUCCESS
- camera-aware lighting constraints: SUCCESS
- deterministic identical world-bound actor + Phase-6 production replay: SUCCESS
- exact-head APK/security/provenance checks: SUCCESS
- artifact: `studio-native-android-79ca570b1796c43ec134599457051dbf9255c9b1`
- artifact digest: `sha256:dc7151dfde9d74e99b20acf06b595e4ff6cbcc8ebc8403c93670c55e89a354c5`

Phase 6 deliberately does not perform automatic Scene IR → whole-production orchestration. It proves the accepted character/performance/camera stack can be bound to one canonical world + lighting state. Phase 7 owns automatic orchestration from semantic IR.

Current concrete objective:

**Connect the accepted M57 Scene/Story IR directly to the completed character, world, actor-performance, camera, lighting, timeline and render-job contracts so one natural-language scene becomes a validated production-ready timeline without developer-built internal JSON/state.**

Phase-7 DONE gate requires one natural-language scene to produce entities, state transitions, blocking, performances, canonical world/props, cameras, lighting, timeline and render jobs deterministically without manual internal-state construction.

Do not start Phase 8 Native Render + Media Pipeline until Phase 7's DONE gate is proven.

## Required session ending

Every significant work session must leave:
- Plan version
- Active phase
- Exact branch + 40-char SHA
- CI status
- Artifact/evidence status
- What changed
- What remains
- Exact next action

When context becomes heavy, stop with a clean continuation package rather than drifting from the canonical plan.
