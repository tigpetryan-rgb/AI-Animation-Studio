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

At the time this contract was introduced, the mandatory next production phase is:

**PHASE 2 — bring `m58/native-3d-character-runtime` onto the latest verified M57 green base and make the real M58 3D mesh/skinning gate RUN + PASS.**

Historical checkpoint only; MUST be reverified live:
- M57 green baseline: `a96d8ee2fc021b5e04558bd3e9a5f9ac30c0d2c8`
- M58 pre-plan head: `3ab5e0fa7dc3e672b1d630e55190ab74b2910b4b`

Do not start Character Modeling Phase 3 until Phase 2's DONE gate is proven.

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
