# AI Animation Studio / «Վիդեոստուդիա»

> ## ⛔ MANDATORY BEFORE ANY WORK
>
> Every new chat/agent/coding session must first read:
>
> 1. **[`AGENTS.md`](./AGENTS.md)** — mandatory operating contract
> 2. **[`CANONICAL_MASTER_PLAN.md`](./CANONICAL_MASTER_PLAN.md)** — single canonical execution plan
>
> Do **not** make code, CI, branch, release, or architecture decisions before reading them.

## Current production direction

The canonical production direction is **native Android AI Animation Studio**.

Canonical chain:

**Natural language / screenplay → semantic interpretation → strict Scene/Story IR → validation → canonical state → character/world → actor performance/blocking/IK → virtual director/camera/lighting → native render → audio/media → MP4 → QC/repair → physical-device verification.**

Core law:

> **AI proposes. Engines execute. Validators verify. Canonical state decides. Human can override.**

## Current mandatory phase

**PHASE 6 — LIGHTING + WORLD PRODUCTION.**

Phase 5 is proven complete at the latest verified technical checkpoint:

- branch: `m58/native-3d-character-runtime`
- exact technical SHA: `2d9b4e4b38dd4c608a38b90062194f9b162cf61f`
- Phase 5 Virtual Director CI #1: SUCCESS
- Foundation CI #349: SUCCESS
- Native Android CI #108: SUCCESS
- same accepted Phase-4 master performance → multiple deterministic cinematic shots: SUCCESS
- WIDE/FULL/MEDIUM/MEDIUM_CLOSE/CLOSE_UP shot-size language: SUCCESS
- deterministic 35/40/50/55/65/85 mm lens/FOV choices: SUCCESS
- static/tracking/orbit/pan/dolly-in motion coverage: SUCCESS
- story/performance-intent shot selection: SUCCESS
- bounded subject framing and visibility: SUCCESS
- actor + explicit target-anchor collision clearance: SUCCESS
- stable screen-side eyeline continuity: SUCCESS
- deterministic one-performance-many-cameras replay: SUCCESS
- artifact: `studio-native-android-2d9b4e4b38dd4c608a38b90062194f9b162cf61f`
- artifact digest: `sha256:dc277e24c5828d02d49f703a12fbc19432a9ad763e2b50e96986655abfdd8ba6`

Phase 5 does not claim full world collision or lighting integration. Its safety contract covers the actor and explicit Phase-4 rehearsal target anchors. Phase 6 owns canonical environment/prop anchors, spatial state, full collision integration and lighting.

Current Phase-6 objective is to connect canonical locations, props and spatial state to the accepted actor-performance + Virtual Director stack: semantic anchors, collisions, prop ownership/state transitions, environment layout, key/fill/rim/environment lighting, exposure/visibility and camera-aware lighting constraints. Rehearsal anchors should be replaced by canonical world anchors where appropriate.

The exact branch/SHA/CI facts must always be re-verified live before work. Do not start Phase 7 until the Phase-6 DONE gate is proven.

## Historical architecture warning

This repository contains substantial historical browser/PWA/WebView code, tests, documents and milestones. They remain valuable as implementation history, compatibility evidence and reusable subsystem code, but they **do not define the final production runtime anymore**.

The following are no longer primary production directions unless the user explicitly changes the canonical plan:

- Browser/PWA/WebKit/Chromium as final runtime
- M55 WebView Controlled Runtime as final Android architecture
- PR #49 WebView line as production future
- a large multilingual LLM packaged inside the APK as the primary semantic architecture
- Runway/PixVerse/other proprietary cloud generators as core runtime dependencies

## Architecture constitution retained from the original Design Freeze

1. Canonical Project State is the source of truth.
2. Pixels are outputs, not truth.
3. AI proposes; it never silently mutates canonical state.
4. Human locks always win.
5. Deterministic code is preferred for deterministic problems.
6. Character appearance, actor performance, camera, lighting and world state are explicit independent layers.
7. Every expensive operation should be cacheable where practical.
8. Cache is disposable and is not canonical state.
9. Story events produce explicit state transitions.
10. Definitions and runtime instances remain separate.
11. Project formats must survive Studio upgrades through migrations.
12. Autonomous actions must be traceable, validated and reversible where practical.

## Canonical references

- Repository execution plan: [`CANONICAL_MASTER_PLAN.md`](./CANONICAL_MASTER_PLAN.md)
- Repository agent contract: [`AGENTS.md`](./AGENTS.md)
- Persistent Google Drive plan mirror: https://docs.google.com/document/d/1fBywdZl3_D7YEGp76Eivb-zB2ACnmh77GO2KCf7uWpE/edit
- Research/benchmark library: https://drive.google.com/drive/folders/1aJihdEbWRN2s3nSQ4bmjBSr4FNKzi5nK

If historical documentation conflicts with the canonical plan, **the canonical plan governs product direction; live GitHub governs current branch/SHA/CI/code facts.**
