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

**PHASE 7 IS COMPLETE. PHASE 8 — NATIVE RENDER + MEDIA PIPELINE — IS THE CURRENT MANDATORY PRODUCTION PHASE.**

Latest verified Phase-7 technical checkpoint is historical evidence and MUST be reverified live before relying on it:

- branch: `m58/native-3d-character-runtime`
- exact technical SHA: `7f64b6e9938527e08d766172df6234a0506eff89`
- Phase 7 Production Orchestration CI #1: SUCCESS
- Foundation CI #364: SUCCESS
- Native Android CI #123: SUCCESS
- Armenian natural-language Scene IR entry path: SUCCESS
- exact script/reference/source identity binding: SUCCESS
- canonical character/prop/location entity resolution: SUCCESS
- direct Scene IR → Phase-4/5/6 production contracts without legacy textual lowering: SUCCESS
- canonical prop transitions + world-bound hand/grasp contacts: SUCCESS
- semantic camera/lighting/environment control coverage: SUCCESS
- 320×240 @ 12 fps × 14 s → exact 168-frame contiguous production timeline: SUCCESS
- identity-bound acyclic prepare/render-shot DAG: SUCCESS
- deterministic replay fingerprint/timeline/jobs/state: SUCCESS
- exact-head APK/security/provenance checks: SUCCESS
- artifact: `studio-native-android-7f64b6e9938527e08d766172df6234a0506eff89`
- artifact digest: `sha256:7711345bf9f9f85b533a2b6da61e472ae3abb0e656e4fd3ef19b6e80206f978d`

Phase 7 intentionally stops at a validated canonical timeline and render-job graph. It does not claim real frame rendering, encoding, muxing, decoder validity or long-export safety. Those are Phase 8 scope.

Current concrete objective:

**Consume the accepted Phase-7 frame-exact production timeline/render-job graph and finish the browser-free native render-to-media chain: real 3D frames, exact frame timing, native/offscreen surface, safe encoding, audio synchronization, MP4 muxing, cancellation/long-export safety, decode-to-EOS verification and media provenance.**

Phase-8 DONE gate requires the accepted Phase-7 canonical timeline to produce a standards-compatible MP4 with correct duration/frame count/audio sync, successful decode-to-EOS verification, cancellation/long-export safety and no browser/WebView dependency.

Do not start Phase 9 QC + Repair until Phase 8's DONE gate is proven.

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
